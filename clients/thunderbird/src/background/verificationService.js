/**
 * Incoming side: reads the ESF-Stamp header fields of a message, verifies them and maintains the replay cache
 * (whitepaper 6.7, 6.8).
 */

import {
  ACCEPTED_HEADER_NAMES,
  MAX_DECLARED_DIFFICULTY,
  REPLAY_RETENTION_DAYS,
  Reason,
  Signal,
  StampState
} from "../protocol/constants.js";
import { receiverPolicy } from "../protocol/policy.js";
import { stampId, verifyMessageStamps } from "../protocol/verifier.js";
import { canonicalMailbox } from "../protocol/stamp.js";
import { createLogger } from "../utils/log.js";

const log = createLogger("verify");

const REPLAY_STORE_KEY = "seenStamps";
const REPLAY_STORE_LIMIT = 2000;
const RESULT_CACHE_LIMIT = 200;

export class VerificationService {
  /** @param {{getSettings: () => Promise<object>}} deps */
  constructor({ getSettings }) {
    this.getSettings = getSettings;
    /** @type {Map<number, object>} message id -> verification result */
    this.cache = new Map();
    this.localMailboxes = null;
  }

  /** Forgets cached identities; called when accounts change. */
  invalidateIdentities() {
    this.localMailboxes = null;
  }

  /** Every mailbox the user owns - the candidates for the rid binding check. */
  async getLocalMailboxes() {
    if (this.localMailboxes) {
      return this.localMailboxes;
    }
    const mailboxes = new Set();
    try {
      for (const identity of await browser.identities.list()) {
        const mailbox = canonicalMailbox(identity.email || "");
        if (mailbox) {
          mailboxes.add(mailbox);
        }
      }
    } catch (error) {
      log.warn("cannot list identities", error);
    }
    this.localMailboxes = [...mailboxes];
    log.debug("local mailboxes", this.localMailboxes);
    return this.localMailboxes;
  }

  /**
   * Verifies one message, with a per-session cache so re-opening a message is free.
   *
   * @param {{id: number, author?: string, headerMessageId?: string}} message a MessageHeader
   * @param {{force?: boolean}} [options]
   */
  async verifyMessage(message, options = {}) {
    if (!options.force && this.cache.has(message.id)) {
      return this.cache.get(message.id);
    }
    const settings = await this.getSettings();
    const policy = receiverPolicy(settings);
    const [headerValues, carrierMessageId, receivedAt] = await this.#readHeaders(message);
    const localMailboxes = await this.getLocalMailboxes();

    const outcome = await verifyMessageStamps(headerValues, {
      localMailboxes,
      from: message.author || "",
      // The stamp binds the identifier the sender minted (see composeSigner), so the carrier Message-ID is only used
      // when the sender bound the real one. Passing it unconditionally would reject every prototype stamp.
      messageId: undefined,
      now: Date.now(),
      // The stamp is checked against when the message came into being, not against the moment it is opened:
      // verifying at display time would turn every archived message stale weeks after it arrived.
      messageTime: messageReference(message, receivedAt),
      maxStampToMessageMs: settings.maxStampToMessageHours * 60 * 60 * 1000,
      // 0 days means a stamp never expires, which is the default.
      maxAgeMs: settings.maxStampAgeDays > 0
        ? settings.maxStampAgeDays * 24 * 60 * 60 * 1000
        : Number.POSITIVE_INFINITY,
      maxDifficulty: MAX_DECLARED_DIFFICULTY,
      minDifficulty: policy.minDifficulty("sha256"),
      requireSenderBinding: false
    });

    let result = {
      messageId: message.id,
      state: outcome.state,
      signal: outcome.signal,
      reason: outcome.reason,
      best: outcome.best,
      headerCount: headerValues.length,
      stampCount: outcome.results.length,
      skipped: outcome.skipped,
      carrierMessageId
    };

    // Replay is only interesting for stamps that are otherwise acceptable (whitepaper 6.7 step 8).
    if (result.state === StampState.STRONG || result.state === StampState.WEAK) {
      const key = await stampId(outcome.best.stamp);
      const messageKey = message.headerMessageId || `id:${message.id}`;
      if (await this.#seenElsewhere(key, messageKey)) {
        result = { ...result, state: StampState.INVALID, signal: Signal.RED, reason: Reason.REPLAY };
      }
    }

    this.#cacheResult(message.id, result);
    log.debug("verified", message.id, result.state, result.reason);
    return result;
  }

  /**
   * Reads the stamp header fields plus the message's own Message-ID.
   *
   * Prefers messages.getHeaders() (Thunderbird 147+, no MIME parsing); falls back to getFull() on older releases and
   * to getRaw() if both are unavailable.
   *
   * @returns {Promise<[string[], string, number|undefined]>} stamps, Message-ID and the arrival time
   */
  async #readHeaders(message) {
    try {
      if (typeof browser.messages.getHeaders === "function") {
        const headers = await browser.messages.getHeaders(message.id);
        return [collectStamps(headers), first(headers, "message-id"), parseReceivedTime(first(headers, "received"))];
      }
      const full = await browser.messages.getFull(message.id, { decodeHeaders: true });
      const headers = (full && full.headers) || {};
      return [collectStamps(headers), first(headers, "message-id"), parseReceivedTime(first(headers, "received"))];
    } catch (error) {
      log.warn("header read failed, falling back to getRaw", error);
    }
    try {
      const raw = await browser.messages.getRaw(message.id, { data_format: "BinaryString" });
      return parseRawHeaders(String(raw));
    } catch (error) {
      log.warn("getRaw failed", error);
      return [[], "", undefined];
    }
  }

  /**
   * Records a stamp and reports whether it was already seen on a *different* message. Re-opening the same message is
   * not a replay.
   */
  async #seenElsewhere(key, messageKey) {
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
      // Without an acceptance window the ledger cannot follow it, so retention is its own bounded value.
      const horizon = Date.now() - REPLAY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      for (const [entryKey, entry] of Object.entries(ledger)) {
        if ((entry.seenAt || 0) < horizon) {
          delete ledger[entryKey];
        }
      }
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
      this.cache.delete(this.cache.keys().next().value);
    }
  }

  /**
   * Optionally reflects a red result in Thunderbird's junk flag. Off by default: during adoption, absence of a stamp
   * is not evidence of abuse (whitepaper 11).
   */
  async applyJunkPolicy(message, result) {
    const settings = await this.getSettings();
    if (!settings.junkOnRed || result.signal !== Signal.RED) {
      return false;
    }
    try {
      await browser.messages.update(message.id, { junk: true });
      return true;
    } catch (error) {
      log.warn("cannot update the junk flag", error);
      return false;
    }
  }
}

/**
 * When the message came into being - the instant the stamp has to be contemporaneous with.
 *
 * Preference order matters for security: the timestamp of the *topmost* Received field is written by the receiving
 * infrastructure and is therefore not the sender's to choose, so it is used when available. The Date header is the
 * fallback; it is sender-controlled, which is why a stockpiled stamp can only be smuggled past this check by also
 * back-dating the message - and a message that presents itself as weeks old is a signal in its own right.
 *
 * Never later than now, so a future-dated message cannot buy itself extra room.
 *
 * @param {{date?: Date|string|number}} message a MessageHeader
 * @param {number} [receivedAt] milliseconds parsed from the topmost Received field, if any
 * @param {number} [now]
 * @returns {number} milliseconds since the epoch
 */
export function messageReference(message, receivedAt, now = Date.now()) {
  if (Number.isFinite(receivedAt)) {
    return Math.min(receivedAt, now);
  }
  const raw = message && message.date;
  const dated = raw instanceof Date ? raw.getTime() : Number(new Date(raw ?? Number.NaN));
  return Number.isFinite(dated) ? Math.min(dated, now) : now;
}

/**
 * Parses the timestamp out of a Received field: the date follows the final semicolon (RFC 5322 section 3.6.7).
 *
 * @param {string} received
 * @returns {number|undefined} milliseconds, or undefined when there is nothing usable
 */
export function parseReceivedTime(received) {
  if (typeof received !== "string") {
    return undefined;
  }
  const semicolon = received.lastIndexOf(";");
  if (semicolon === -1) {
    return undefined;
  }
  const parsed = Date.parse(received.slice(semicolon + 1).trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Collects every accepted stamp header field (X-ESF-Stamp and the standards-track ESF-Stamp). */
function collectStamps(headers) {
  const values = [];
  for (const [name, value] of Object.entries(headers || {})) {
    if (!ACCEPTED_HEADER_NAMES.includes(name.toLowerCase())) {
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
  for (const [name, value] of Object.entries(headers || {})) {
    if (name.toLowerCase() === wantedLowercase) {
      return Array.isArray(value) ? String(value[0]) : String(value);
    }
  }
  return "";
}

/** Minimal RFC 5322 header block parser for the getRaw() fallback, including unfolding of continuation lines. */
export function parseRawHeaders(raw) {
  const blockEnd = raw.search(/\r?\n\r?\n/);
  const block = blockEnd === -1 ? raw : raw.slice(0, blockEnd);
  const unfolded = [];
  for (const line of block.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += ` ${line.trim()}`;
    } else {
      unfolded.push(line);
    }
  }
  const values = [];
  let messageId = "";
  let receivedAt;
  for (const line of unfolded) {
    const colon = line.indexOf(":");
    if (colon < 1) {
      continue;
    }
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (ACCEPTED_HEADER_NAMES.includes(name)) {
      values.push(value);
    } else if (name === "message-id" && !messageId) {
      messageId = value;
    } else if (name === "received" && receivedAt === undefined) {
      receivedAt = parseReceivedTime(value);
    }
  }
  return [values, messageId, receivedAt];
}
