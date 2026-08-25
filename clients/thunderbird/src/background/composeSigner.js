/**
 * Outgoing side: hooks compose.onBeforeSend, computes one proof per recipient and injects the X-Email-PoW headers.
 *
 * Bcc handling: a header is visible to every recipient of the message, so writing a Bcc address into `rcpt` would
 * leak it. Bcc recipients therefore get `rid=sha256(salt|address)` instead - a Bcc'd recipient can still verify the
 * proof (they know their own address), while other recipients only see an opaque digest. Users who consider even
 * that too much can switch Bcc handling to "skip" in the options.
 */

import { HEADER_NAME, PROTOCOL_VERSION } from "../protocol/constants.js";
import { resolveOutgoingBits } from "../protocol/policy.js";
import { serializeProof } from "../protocol/parser.js";
import { buildPreimageBase, formatTimestamp, generateSalt, normalizeAddress, recipientId } from "../protocol/pow.js";
import { resolveWorkerCount } from "../utils/settings.js";
import { createLogger } from "../utils/log.js";

const log = createLogger("compose");

/** Phases reported to the compose popup. */
export const ComposePhase = {
  IDLE: "idle",
  COMPUTING: "computing",
  ASKING: "asking",
  DONE: "done",
  SKIPPED: "skipped",
  CANCELLED: "cancelled"
};

/**
 * Flattens a ComposeRecipientList into plain addresses.
 * Address book contacts/mailing lists arrive as {id, type} nodes; those cannot be expanded here, so they are counted
 * and reported instead of silently dropped.
 *
 * @param {any} list
 * @returns {{addresses: string[], unresolved: number}}
 */
export function flattenRecipients(list) {
  const entries = list === undefined || list === null ? [] : Array.isArray(list) ? list : [list];
  const addresses = [];
  let unresolved = 0;
  for (const entry of entries) {
    if (typeof entry === "string") {
      const address = normalizeAddress(entry);
      if (address) {
        addresses.push(address);
      } else {
        unresolved++;
      }
    } else {
      unresolved++;
    }
  }
  return { addresses: [...new Set(addresses)], unresolved };
}

export class ComposeSigner {
  /**
   * @param {object} deps
   * @param {import("./solver.js").PowSolver} deps.solver
   * @param {() => Promise<object>} deps.getSettings
   * @param {(tabId: number, state: object) => void} deps.onStateChange
   * @param {(tabId: number) => Promise<"continue"|"send-without"|"cancel">} deps.askUser
   */
  constructor({ solver, getSettings, onStateChange, askUser }) {
    this.solver = solver;
    this.getSettings = getSettings;
    this.onStateChange = onStateChange;
    this.askUser = askUser;
    /** @type {Map<number, object>} tabId -> live state for the compose popup */
    this.states = new Map();
    /** @type {Map<number, AbortController>} */
    this.controllers = new Map();
    /** @type {Map<number, (decision: string) => void>} */
    this.pendingDecisions = new Map();
  }

  getState(tabId) {
    return this.states.get(tabId) || { phase: ComposePhase.IDLE };
  }

  #setState(tabId, patch) {
    const next = { ...this.getState(tabId), ...patch, tabId };
    this.states.set(tabId, next);
    this.onStateChange(tabId, next);
    return next;
  }

  /** Resolves a pending "what should I do" question from the compose popup. */
  resolveDecision(tabId, decision) {
    const resolver = this.pendingDecisions.get(tabId);
    if (resolver) {
      this.pendingDecisions.delete(tabId);
      resolver(decision);
      return true;
    }
    return false;
  }

  /** Aborts a running computation for a compose tab. */
  abort(tabId) {
    const controller = this.controllers.get(tabId);
    if (controller) {
      controller.abort();
    }
  }

  /**
   * compose.onBeforeSend handler.
   *
   * @param {{id: number}} tab
   * @param {object} details ComposeDetails
   * @returns {Promise<object>} an onBeforeSend result
   */
  async handleBeforeSend(tab, details) {
    const tabId = tab.id;
    const settings = await this.getSettings();
    const keptHeaders = (details.customHeaders || []).filter(
      header => String(header.name).toLowerCase() !== HEADER_NAME.toLowerCase()
    );

    if (!settings.enabled || settings.outgoingBits <= 0) {
      this.#setState(tabId, { phase: ComposePhase.SKIPPED, reason: "disabled" });
      return {};
    }

    const visible = flattenRecipients(details.to).addresses.concat(flattenRecipients(details.cc).addresses);
    const bccResult = flattenRecipients(details.bcc);
    const bcc = settings.bccMode === "skip" ? [] : bccResult.addresses;
    const targets = [
      ...new Set(visible).values()
    ].map(address => ({ address, hidden: false }));
    for (const address of bcc) {
      if (!visible.includes(address)) {
        targets.push({ address, hidden: true });
      }
    }

    if (targets.length === 0) {
      this.#setState(tabId, { phase: ComposePhase.SKIPPED, reason: "no-recipients" });
      return {};
    }

    // The final Message-ID is assigned by Thunderbird after the send hook, so the proof is bound to a random
    // identifier we generate here and publish in the `mid` field instead. See README, "Limitations".
    const messageId = `${crypto.randomUUID()}@esf.invalid`;
    const timestamp = formatTimestamp(Date.now());
    const workerCount = resolveWorkerCount(settings);
    const controller = new AbortController();
    this.controllers.set(tabId, controller);

    const headers = [];
    let hashesTotal = 0;
    const startedAt = Date.now();
    this.#setState(tabId, {
      phase: ComposePhase.COMPUTING,
      bits: settings.outgoingBits,
      recipientCount: targets.length,
      completed: 0,
      hashes: 0,
      startedAt,
      workerCount
    });

    try {
      for (let index = 0; index < targets.length; index++) {
        const target = targets[index];
        const { bits } = resolveOutgoingBits({
          recipient: target.address,
          recipientCount: targets.length,
          settings
        });
        if (bits <= 0) {
          continue;
        }

        const salt = generateSalt();
        const base = buildPreimageBase({ recipient: target.address, timestamp, messageId, salt });
        const budgetMs = settings.maxComputeSeconds * 1000;
        let outcome = await this.#solveWithBudget({
          tabId, base, bits, workerCount, budgetMs, signal: controller.signal, baseHashes: hashesTotal, index
        });

        while (outcome.timedOut) {
          const decision = await this.#askDecision(tabId, settings, { index, bits });
          if (decision === "cancel") {
            this.#setState(tabId, { phase: ComposePhase.CANCELLED });
            return { cancel: true };
          }
          if (decision === "send-without") {
            this.#setState(tabId, { phase: ComposePhase.SKIPPED, reason: "timeout" });
            return { details: { customHeaders: keptHeaders } };
          }
          this.#setState(tabId, { phase: ComposePhase.COMPUTING });
          outcome = await this.#solveWithBudget({
            tabId, base, bits, workerCount, budgetMs, signal: controller.signal, baseHashes: hashesTotal, index
          });
        }

        hashesTotal += outcome.hashes;
        if (outcome.cancelled) {
          this.#setState(tabId, { phase: ComposePhase.CANCELLED });
          return { cancel: true };
        }
        if (!outcome.found) {
          log.warn("no nonce found for", target.address);
          continue;
        }

        const proof = {
          version: PROTOCOL_VERSION,
          algorithm: "sha256",
          bits,
          timestamp,
          recipient: target.hidden ? null : target.address,
          recipientHash: target.hidden ? await recipientId(salt, target.address) : null,
          messageId,
          nonce: outcome.nonce,
          salt
        };
        headers.push({ name: HEADER_NAME, value: serializeProof(proof) });
        this.#setState(tabId, { completed: index + 1, hashes: hashesTotal });
      }
    } catch (error) {
      log.error("proof generation failed", error);
      this.#setState(tabId, { phase: ComposePhase.SKIPPED, reason: "error", error: String(error) });
      return { details: { customHeaders: keptHeaders } };
    } finally {
      this.controllers.delete(tabId);
      this.pendingDecisions.delete(tabId);
    }

    this.#setState(tabId, {
      phase: ComposePhase.DONE,
      completed: headers.length,
      hashes: hashesTotal,
      elapsedMs: Date.now() - startedAt
    });
    log.debug(`generated ${headers.length} proof(s) in ${Date.now() - startedAt} ms, ${hashesTotal} hashes`);
    return { details: { customHeaders: [...keptHeaders, ...headers] } };
  }

  /** Runs one search with a wall-clock budget. A timeout does not discard progress, it just returns for a decision. */
  async #solveWithBudget({ tabId, base, bits, workerCount, budgetMs, signal, baseHashes, index }) {
    const deadline = setTimeoutHandle(budgetMs);
    const result = await this.solver.solve({
      base,
      bits,
      workerCount,
      signal: anySignal([signal, deadline.signal]),
      onProgress: hashes => this.#setState(tabId, { hashes: baseHashes + hashes, completed: index })
    });
    const timedOut = deadline.fired && !result.found && !signal.aborted;
    deadline.clear();
    return { ...result, timedOut };
  }

  async #askDecision(tabId, settings, context) {
    if (settings.onTimeout === "send-without" || settings.onTimeout === "cancel") {
      return settings.onTimeout;
    }
    this.#setState(tabId, { phase: ComposePhase.ASKING, ...context });
    const decision = await new Promise(resolve => {
      this.pendingDecisions.set(tabId, resolve);
      this.askUser(tabId).catch(error => {
        log.warn("cannot open compose popup, falling back to send-without", error);
        this.resolveDecision(tabId, "send-without");
      });
    });
    return decision;
  }
}

/** An AbortSignal that fires after `ms`, plus a flag telling whether it was the timer that fired. */
function setTimeoutHandle(ms) {
  const controller = new AbortController();
  const handle = { signal: controller.signal, fired: false, clear: () => clearTimeout(timer) };
  const timer = setTimeout(() => {
    handle.fired = true;
    controller.abort();
  }, ms);
  return handle;
}

/** Combines several AbortSignals into one. */
function anySignal(signals) {
  const controller = new AbortController();
  for (const signal of signals.filter(Boolean)) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller.signal;
}
