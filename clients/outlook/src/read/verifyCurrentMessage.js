/**
 * Incoming side: reads the MIME headers of the displayed message, verifies every ESF stamp through the shared core
 * and applies the replay ledger (whitepaper 6.7, 6.8). Verification is fully local.
 */

import {
  MAX_DECLARED_DIFFICULTY,
  REPLAY_RETENTION_DAYS,
  Reason,
  Signal,
  StampState,
  canonicalMailbox,
  classifySender,
  receiverPolicy,
  stampId,
  verifyMessageStamps
} from "../esf-core.js";
import { extractEsfHeaders } from "../outlook-api/mimeHeaders.js";
import { getAllInternetHeaders } from "../outlook-api/office.js";

const REPLAY_STORE_KEY = "esfSeenStamps";
const REPLAY_STORE_LIMIT = 2000;

/**
 * The mailboxes a stamp may bind to: the signed-in mailbox plus configured aliases. Office.js cannot enumerate
 * aliases, so anything beyond the primary address must come from settings.
 *
 * @param {object} settings
 * @returns {string[]}
 */
export function localMailboxes(settings) {
  const mailboxes = new Set();
  const profile = globalThis.Office?.context?.mailbox?.userProfile;
  const primary = canonicalMailbox((profile && profile.emailAddress) || "");
  if (primary) {
    mailboxes.add(primary);
  }
  for (const alias of settings.aliasMailboxes || []) {
    const mailbox = canonicalMailbox(alias);
    if (mailbox) {
      mailboxes.add(mailbox);
    }
  }
  return [...mailboxes];
}

/**
 * Verifies the currently displayed message.
 *
 * @param {any} item a read-mode mailbox item
 * @param {object} settings normalized settings
 * @returns {Promise<object>} state/signal/reason plus diagnostics for the details panel
 */
/**
 * When the message came into being - the instant the stamp has to be contemporaneous with.
 *
 * Preference order matters for security: the topmost Received timestamp is written by the receiving infrastructure
 * and is not the sender's to choose, so it wins. The sender-controlled Date header is the fallback, then the item's
 * own creation time where Outlook exposes it. Never later than now, so a future-dated message cannot buy extra room.
 *
 * @param {any} item a read-mode mailbox item
 * @param {number|undefined} receivedAt from the topmost Received field
 * @param {number|undefined} dateMs from the Date header
 * @param {number} [now]
 * @returns {number} milliseconds since the epoch
 */
export function messageReference(item, receivedAt, dateMs, now = Date.now()) {
  if (Number.isFinite(receivedAt)) {
    return Math.min(receivedAt, now);
  }
  if (Number.isFinite(dateMs)) {
    return Math.min(dateMs, now);
  }
  const created = item && item.dateTimeCreated ? new Date(item.dateTimeCreated).getTime() : Number.NaN;
  return Number.isFinite(created) ? Math.min(created, now) : now;
}

export async function verifyCurrentMessage(item, settings) {
  const headerBlock = await getAllInternetHeaders(item);
  const { stampValues, messageId, from, receivedAt, dateMs, headers } = extractEsfHeaders(headerBlock);
  const policy = receiverPolicy(settings);
  const fromMailbox = (item && item.from && item.from.emailAddress) || from;

  const outcome = await verifyMessageStamps(stampValues, {
    localMailboxes: localMailboxes(settings),
    from: fromMailbox || "",
    // The stamp binds the identifier the sender minted (see sendSigner), so the carrier Message-ID is not compared;
    // passing it would reject every prototype stamp. Same contract as the Thunderbird verificationService.
    messageId: undefined,
    now: Date.now(),
    // The stamp is checked against when the message came into being, not against the moment it is opened:
    // verifying at display time would turn every archived message stale weeks after it arrived.
    messageTime: messageReference(item, receivedAt, dateMs),
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
    state: outcome.state,
    signal: outcome.signal,
    reason: outcome.reason,
    best: outcome.best,
    results: outcome.results,
    headerCount: stampValues.length,
    skipped: outcome.skipped,
    headersAvailable: headerBlock.length > 0,
    // Whether there is plausibly a person at the other end. Not a spam verdict and not part of the protocol result:
    // it only decides whether the task pane may offer to write to this sender (see compose/suggest.js).
    sender: classifySender({ headers, author: fromMailbox || from })
  };

  // Replay is only interesting for stamps that are otherwise acceptable (whitepaper 6.7 step 8).
  if (result.state === StampState.STRONG || result.state === StampState.WEAK) {
    const key = await stampId(outcome.best.stamp);
    const messageKey = messageId || (item && item.itemId) || "";
    if (seenElsewhere(key, messageKey, settings)) {
      result = { ...result, state: StampState.INVALID, signal: Signal.RED, reason: Reason.REPLAY };
    }
  }
  return result;
}

/**
 * Records a stamp and reports whether it was already seen on a *different* message. Re-opening the same message is
 * not a replay. The ledger lives in localStorage: per browser profile / Outlook installation, which is the honest
 * scope a client-side verifier has - it cannot promise cross-device replay detection.
 */
export function seenElsewhere(key, messageKey, settings, storage = defaultStorage()) {
  if (!storage) {
    return false;
  }
  let ledger = {};
  try {
    ledger = JSON.parse(storage.getItem(REPLAY_STORE_KEY) || "{}") || {};
  } catch {
    ledger = {};
  }
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
    try {
      storage.setItem(REPLAY_STORE_KEY, JSON.stringify(ledger));
    } catch {
      // Quota or private-mode failure: losing replay memory degrades detection, never verification itself.
    }
  }
  return false;
}

function defaultStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}
