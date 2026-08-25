/**
 * Outgoing side: hooks compose.onBeforeSend, mints one ESF stamp per recipient and attaches the header field
 * (whitepaper 6.6, 10.1).
 *
 * Bcc (whitepaper 6.9): a header field is visible to every recipient, so a Bcc recipient's binding token must not be
 * exposed unless it is safe. The preferred solution is a separate message copy per Bcc recipient, which a
 * MailExtension cannot create from the send hook. This client therefore offers two honest options:
 *
 *   "omit" (default) - no stamp for Bcc recipients, per the whitepaper's fallback recommendation
 *   "token"          - include the salted rid, which a determined observer with a guess list can test
 */

import { ALGORITHM_SHA256, HEADER_NAME, PROTOCOL_VERSION } from "../protocol/constants.js";
import { resolveOutgoingDifficulty } from "../protocol/policy.js";
import { serializeStampList } from "../protocol/parser.js";
import {
  buildWorkBase,
  canonicalMailbox,
  generateSalt,
  messageIdToken,
  recipientToken,
  senderToken,
  unixSeconds
} from "../protocol/stamp.js";
import { resolveWorkerCount } from "../utils/settings.js";
import { createLogger } from "../utils/log.js";

const log = createLogger("compose");

/** How often to keep computing when the user cannot be asked, before giving up on the stamp. */
const MAX_UNANSWERED_ASKS = 3;

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
 * Flattens a ComposeRecipientList into canonical mailboxes.
 * Address book contacts and mailing lists arrive as {id, type} nodes; those cannot be expanded here, so they are
 * counted and reported instead of silently dropped.
 *
 * @param {any} list
 * @returns {{mailboxes: string[], unresolved: number}}
 */
export function flattenRecipients(list) {
  const entries = list === undefined || list === null ? [] : Array.isArray(list) ? list : [list];
  const mailboxes = [];
  let unresolved = 0;
  for (const entry of entries) {
    if (typeof entry === "string") {
      const mailbox = canonicalMailbox(entry);
      if (mailbox) {
        mailboxes.push(mailbox);
      } else {
        unresolved++;
      }
    } else {
      unresolved++;
    }
  }
  return { mailboxes: [...new Set(mailboxes)], unresolved };
}

export class ComposeSigner {
  /**
   * @param {object} deps
   * @param {import("./solver.js").PowSolver} deps.solver
   * @param {() => Promise<object>} deps.getSettings
   * @param {(tabId: number, state: object) => void} deps.onStateChange
   * @param {(tabId: number) => Promise<void>} deps.askUser
   * @param {(details: object) => Promise<string>} [deps.resolveFrom] resolves the sending mailbox for sid
   */
  constructor({ solver, getSettings, onStateChange, askUser, resolveFrom }) {
    this.solver = solver;
    this.getSettings = getSettings;
    this.onStateChange = onStateChange;
    this.askUser = askUser;
    // ComposeDetails.from may be an address book node rather than a string, so the caller resolves the identity.
    this.resolveFrom = resolveFrom || (async details => (typeof details.from === "string" ? details.from : ""));
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

  /** Resolves a pending "this is taking long" question from the compose popup. */
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

    if (!settings.enabled || settings.outgoingDifficulty <= 0) {
      this.#setState(tabId, { phase: ComposePhase.SKIPPED, reason: "disabled" });
      return {};
    }

    const from = canonicalMailbox(await this.resolveFrom(details));
    const visible = flattenRecipients(details.to).mailboxes.concat(flattenRecipients(details.cc).mailboxes);
    const bcc = flattenRecipients(details.bcc);
    const targets = [...new Set(visible)].map(mailbox => ({ mailbox, hidden: false }));
    const bccIncluded = settings.bccMode === "token";
    if (bccIncluded) {
      for (const mailbox of bcc.mailboxes) {
        if (!visible.includes(mailbox)) {
          targets.push({ mailbox, hidden: true });
        }
      }
    }
    const skippedBcc = bccIncluded ? 0 : bcc.mailboxes.filter(mailbox => !visible.includes(mailbox)).length;

    if (targets.length === 0) {
      this.#setState(tabId, { phase: ComposePhase.SKIPPED, reason: "no-recipients", skippedBcc });
      return {};
    }

    // Thunderbird assigns the Message-ID after this hook returns and customHeaders cannot set a non-X- field, so the
    // stamp binds a message identifier we mint here. See README, "API limitations".
    const messageId = `${crypto.randomUUID()}@esf.invalid`;
    const timestamp = unixSeconds();
    const sid = await senderToken(from);
    const mid = await messageIdToken(messageId);
    const workerCount = resolveWorkerCount(settings);
    const controller = new AbortController();
    this.controllers.set(tabId, controller);

    const stamps = [];
    let hashesTotal = 0;
    const startedAt = Date.now();
    this.#setState(tabId, {
      phase: ComposePhase.COMPUTING,
      difficulty: settings.outgoingDifficulty,
      recipientCount: targets.length,
      completed: 0,
      hashes: 0,
      startedAt,
      workerCount,
      skippedBcc,
      unresolvedRecipients: flattenRecipients(details.to).unresolved + flattenRecipients(details.cc).unresolved
    });

    try {
      for (let index = 0; index < targets.length; index++) {
        const target = targets[index];
        const { difficulty } = resolveOutgoingDifficulty({
          recipient: target.mailbox,
          recipientCount: targets.length,
          settings
        });
        if (difficulty <= 0) {
          continue;
        }

        const salt = generateSalt();
        const stamp = {
          version: PROTOCOL_VERSION,
          algorithm: ALGORITHM_SHA256,
          difficulty,
          timestamp,
          sid,
          rid: await recipientToken(target.mailbox, salt),
          mid,
          salt,
          profileParams: {}
        };
        const workBase = buildWorkBase(stamp);
        // Two stages, because an enabled ESF is expected to produce a stamp: the search runs silently for the quiet
        // phase, then keeps running while the compose button shows progress, and only asks once patience runs out.
        const quietMs = settings.maxComputeSeconds * 1000;
        const askAfterMs = Math.max(quietMs, settings.askAfterSeconds * 1000);
        // Resuming must continue behind the range already searched; restarting at 0 would retry the very same
        // candidates and run out of time again forever.
        let startOffset = 0;
        let refusedAsks = 0;
        let outcome = await this.#solveWithBudget({
          tabId, workBase, difficulty, workerCount, budgetMs: askAfterMs, quietMs, signal: controller.signal,
          baseHashes: hashesTotal, index, startOffset
        });

        while (outcome.timedOut) {
          startOffset += outcome.hashes;
          hashesTotal += outcome.hashes;
          const decision = await this.#askDecision(tabId, settings, { index, difficulty });
          if (decision === "cancel") {
            this.#setState(tabId, { phase: ComposePhase.CANCELLED });
            return { cancel: true };
          }
          if (decision === "send-without") {
            this.#setState(tabId, { phase: ComposePhase.SKIPPED, reason: "timeout" });
            return { details: { customHeaders: keptHeaders } };
          }
          if (decision === "unavailable") {
            // The question could not be put to the user. Keep working rather than dropping the stamp silently, but
            // do not retry forever - a send has to end.
            refusedAsks++;
            if (refusedAsks > MAX_UNANSWERED_ASKS) {
              log.error("cannot ask the user and out of patience; sending without a stamp");
              this.#setState(tabId, { phase: ComposePhase.SKIPPED, reason: "cannot-ask" });
              return { details: { customHeaders: keptHeaders } };
            }
          }
          this.#setState(tabId, { phase: ComposePhase.COMPUTING, overBudget: true });
          outcome = await this.#solveWithBudget({
            tabId, workBase, difficulty, workerCount, budgetMs: askAfterMs, quietMs, signal: controller.signal,
            baseHashes: hashesTotal, index, startOffset
          });
        }

        hashesTotal += outcome.hashes;
        if (outcome.cancelled) {
          this.#setState(tabId, { phase: ComposePhase.CANCELLED });
          return { cancel: true };
        }
        if (!outcome.found) {
          log.warn("no nonce found for a recipient");
          continue;
        }
        stamps.push({ ...stamp, nonce: outcome.nonce });
        this.#setState(tabId, { completed: index + 1, hashes: hashesTotal });
      }
    } catch (error) {
      log.error("stamp generation failed", error);
      this.#setState(tabId, { phase: ComposePhase.SKIPPED, reason: "error", error: String(error) });
      return { details: { customHeaders: keptHeaders } };
    } finally {
      this.controllers.delete(tabId);
      this.pendingDecisions.delete(tabId);
    }

    this.#setState(tabId, {
      phase: ComposePhase.DONE,
      completed: stamps.length,
      hashes: hashesTotal,
      elapsedMs: Date.now() - startedAt
    });
    log.debug(`minted ${stamps.length} stamp(s) in ${Date.now() - startedAt} ms, ${hashesTotal} hashes`);
    if (stamps.length === 0) {
      return { details: { customHeaders: keptHeaders } };
    }
    // Thunderbird keeps only one custom header per name, so all stamps of a message travel in one field value.
    const header = { name: HEADER_NAME, value: serializeStampList(stamps) };
    return { details: { customHeaders: [...keptHeaders, header] } };
  }

  /**
   * Runs one search until it succeeds or `budgetMs` runs out. After `quietMs` the state flips to "over budget", so
   * the compose button can show that something is still happening - the search itself is not interrupted there.
   */
  async #solveWithBudget({ tabId, workBase, difficulty, workerCount, budgetMs, quietMs, signal, baseHashes, index,
    startOffset }) {
    const deadline = deadlineSignal(budgetMs);
    const quiet = quietMs && quietMs < budgetMs
      ? setTimeout(() => this.#setState(tabId, { phase: ComposePhase.COMPUTING, overBudget: true }), quietMs)
      : null;
    const result = await this.solver.solve({
      workBase,
      difficulty,
      startOffset,
      workerCount,
      signal: anySignal([signal, deadline.signal]),
      onProgress: hashes => this.#setState(tabId, { hashes: baseHashes + hashes, completed: index })
    });
    const timedOut = deadline.fired && !result.found && !signal.aborted;
    deadline.clear();
    if (quiet) {
      clearTimeout(quiet);
    }
    return { ...result, timedOut };
  }

  async #askDecision(tabId, settings, context) {
    if (settings.onTimeout === "send-without" || settings.onTimeout === "cancel") {
      return settings.onTimeout;
    }
    this.#setState(tabId, { phase: ComposePhase.ASKING, ...context });
    return new Promise(resolve => {
      this.pendingDecisions.set(tabId, resolve);
      this.askUser(tabId).catch(error => {
        // Never turn "I could not ask" into "sent without a stamp" here: the caller decides how long to keep going.
        log.warn("cannot open the compose popup to ask", error);
        this.resolveDecision(tabId, "unavailable");
      });
    });
  }
}

/** An AbortSignal that fires after `ms`, plus a flag telling whether it was the timer that fired. */
function deadlineSignal(ms) {
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
