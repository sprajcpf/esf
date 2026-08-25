/**
 * Incoming side: reads the X-Email-PoW headers of a message, verifies them and keeps a small replay ledger.
 */

import { HEADER_NAME, MAX_ACCEPTED_DIFFICULTY, Reason, VerificationStatus } from "../protocol/constants.js";
import { resolveIncomingMinBits } from "../protocol/policy.js";
import { replayKey, verifyMessageHeaders } from "../protocol/verifier.js";
import { normalizeAddress } from "../protocol/pow.js";
import { createLogger } from "../utils/log.js";

const log = createLogger("verify");

const REPLAY_STORE_KEY = "seenProofs";
const REPLAY_STORE_LIMIT = 2000;
const RESULT_CACHE_LIMIT = 200;

export class VerificationService {
  /** @param {{getSettings: () => Promise<object>}} deps */
  constructor({ getSettings }) {
    this.getSettings = getSettings;
    /** @type {Map<number, object>} messageId -> verification result */
    this.cache = new Map();
    this.localAddresses = null;
  }

  /** Forgets cached identities; called when accounts change. */
  invalidateIdentities() {
    this.localAddresses = null;
  }

  /** All addresses the user owns, used for the recipient binding check. */
  async getLocalAddresses() {
    if (this.localAddresses) {
      return this.localAddresses;
    }
    const addresses = new Set();
    try {
      const identities = await browser.identities.list();
      for (const identity of identities) {
        const address = normalizeAddress(identity.email || "");
        if (address) {
          addresses.add(address);
        }
      }
    } catch (error) {
      log.warn("cannot list identities", error);
    }
    this.localAddresses = [...addresses];
    log.debug("local addresses", this.localAddresses);
    return this.localAddresses;
  }

  /**
   * Verifies one message, using a per-session cache so re-opening a message is free.
   *
   * @param {{id: number, headerMessageId?: string}} message a MessageHeader
   * @param {{force?: boolean}} [options]
   */
  async verifyMessage(message, options = {}) {
    if (!options.force && this.cache.has(message.id)) {
      return this.cache.get(message.id);
    }
    const settings = await this.getSettings();
    const [headerValues, carrierMessageId] = await this.#readHeaders(message);
    const localAddresses = await this.getLocalAddresses();

    const outcome = await verifyMessageHeaders(headerValues, {
      localAddresses,
      messageId: carrierMessageId || message.headerMessageId || "",
      maxAgeMs: settings.maxProofAgeDays * 24 * 60 * 60 * 1000,
      maxBits: MAX_ACCEPTED_DIFFICULTY,
      minBits: resolveIncomingMinBits(settings)
    });

    let result = {
      messageId: message.id,
      status: outcome.status,
      reason: outcome.reason,
      best: outcome.best,
      headerCount: headerValues.length,
      skippedHeaders: outcome.skipped
    };

    if (result.status === VerificationStatus.VALID) {
      const messageKey = message.headerMessageId || `id:${message.id}`;
      const replayed = await this.#recordAndCheckReplay(replayKey(outcome.best), messageKey);
      if (replayed) {
        result = { ...result, status: VerificationStatus.INVALID, reason: Reason.REPLAY };
      }
    }

    this.#cacheResult(message.id, result);
    log.debug("verified", message.id, result.status, result.reason, result.best && result.best.bits);
    return result;
  }

  /**
   * Reads the proof headers plus the message's own Message-ID.
   *
   * Prefers messages.getHeaders() (Thunderbird 147+, no MIME parsing); falls back to getFull() on older releases and
   * to getRaw() if both are unavailable.
   *
   * @returns {Promise<[string[], string]>}
   */
  async #readHeaders(message) {
    const wanted = HEADER_NAME.toLowerCase();
    try {
      if (typeof browser.messages.getHeaders === "function") {
        const headers = await browser.messages.getHeaders(message.id);
        return [collect(headers, wanted), first(headers, "message-id")];
      }
      const full = await browser.messages.getFull(message.id, { decodeHeaders: true });
      const headers = (full && full.headers) || {};
      return [collect(headers, wanted), first(headers, "message-id")];
    } catch (error) {
      log.warn("header read failed, falling back to getRaw", error);
    }
    try {
      const raw = await browser.messages.getRaw(message.id, { data_format: "BinaryString" });
      return parseRawHeaders(String(raw), wanted);
    } catch (error) {
      log.warn("getRaw failed", error);
      return [[], ""];
    }
  }

  /**
   * Records a proof and reports whether it has been seen on a *different* message before.
   * Re-opening the same message is not a replay.
   */
  async #recordAndCheckReplay(key, messageKey) {
    const stored = await browser.storage.local.get(REPLAY_STORE_KEY);
    const ledger = stored[REPLAY_STORE_KEY] && typeof stored[REPLAY_STORE_KEY] === "object"
      ? stored[REPLAY_STORE_KEY]
      : {};
    const existing = ledger[key];
    if (existing && existing.messageKey !== messageKey) {
      return true;
    }
    if (!existing) {
      ledger[key] = { messageKey, seenAt: Date.now() };
      const keys = Object.keys(ledger);
      if (keys.length > REPLAY_STORE_LIMIT) {
        keys
          .sort((a, b) => (ledger[a].seenAt || 0) - (ledger[b].seenAt || 0))
          .slice(0, keys.length - REPLAY_STORE_LIMIT)
          .forEach(stale => delete ledger[stale]);
      }
      await browser.storage.local.set({ [REPLAY_STORE_KEY]: ledger });
    }
    return false;
  }

  #cacheResult(messageId, result) {
    this.cache.set(messageId, result);
    if (this.cache.size > RESULT_CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }
  }

  /**
   * Optionally reflects a missing/invalid proof in Thunderbird's junk flag. Off by default: a missing proof is a weak
   * signal, not evidence.
   */
  async applyJunkPolicy(message, result) {
    const settings = await this.getSettings();
    if (!settings.markMissingAsJunk || result.status === VerificationStatus.VALID) {
      return false;
    }
    try {
      await browser.messages.update(message.id, { junk: true });
      return true;
    } catch (error) {
      log.warn("cannot update junk flag", error);
      return false;
    }
  }
}

function collect(headers, wantedLowercase) {
  const values = [];
  for (const [name, value] of Object.entries(headers || {})) {
    if (name.toLowerCase() !== wantedLowercase) {
      continue;
    }
    for (const entry of Array.isArray(value) ? value : [value]) {
      if (typeof entry === "string") {
        values.push(entry);
      }
    }
  }
  return values;
}

function first(headers, wantedLowercase) {
  const values = collect(headers, wantedLowercase);
  return values.length > 0 ? values[0] : "";
}

/** Minimal RFC 5322 header block parser for the getRaw() fallback, including unfolding of continuation lines. */
export function parseRawHeaders(raw, wantedLowercase) {
  const blockEnd = raw.search(/\r?\n\r?\n/);
  const block = blockEnd === -1 ? raw : raw.slice(0, blockEnd);
  const lines = block.split(/\r?\n/);
  const unfolded = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += ` ${line.trim()}`;
    } else {
      unfolded.push(line);
    }
  }
  const values = [];
  let messageId = "";
  for (const line of unfolded) {
    const colon = line.indexOf(":");
    if (colon < 1) {
      continue;
    }
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (name === wantedLowercase) {
      values.push(value);
    } else if (name === "message-id" && !messageId) {
      messageId = value;
    }
  }
  return [values, messageId];
}
