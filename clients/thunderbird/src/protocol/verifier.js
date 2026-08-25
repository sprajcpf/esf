/**
 * ESF-Stamp verification, following the ordering of whitepaper 6.7 and appendix B: cheapest checks first, no
 * cryptographic work before the declared parameters are known to be within local bounds.
 *
 * Cost model: verifying one stamp is exactly one SHA-256 invocation plus a handful of string comparisons, whatever
 * difficulty the sender declares. That asymmetry is the whole point, and it is why the verifier must never derive an
 * amount of work from an attacker-controlled value.
 */

import {
  IMPLEMENTED_ALGORITHMS,
  KNOWN_ALGORITHMS,
  MAX_CLOCK_SKEW_MS,
  MAX_DECLARED_DIFFICULTY,
  MAX_STAMPS_PER_HEADER,
  MAX_STAMPS_PER_MESSAGE,
  MIN_DECLARED_DIFFICULTY,
  Reason,
  SIGNAL_BY_STATE,
  StampState,
  SUPPORTED_VERSIONS
} from "./constants.js";
import { countLeadingZeroBits, sha256, toHex } from "./hash.js";
import { parseStampList, serializeStamp } from "./parser.js";
import { buildWorkBase, hashCandidate, messageIdToken, recipientToken, senderToken } from "./stamp.js";

/**
 * @typedef {object} VerifyContext
 * @property {string[]} localMailboxes mailboxes the receiving user owns; a stamp must bind to one of them
 * @property {string} [from] the message's From mailbox, checked against sid
 * @property {string} [messageId] the message's Message-ID, checked against mid
 * @property {number} [now] current time in ms, injectable for tests
 * @property {number} [maxAgeMs] freshness window
 * @property {number} [clockSkewMs] tolerance for senders whose clock runs ahead
 * @property {number} [maxDifficulty] highest difficulty we accept as declared
 * @property {number} [minDifficulty] below this a valid stamp counts as weak, not strong
 * @property {boolean} [requireSenderBinding] treat a missing/mismatching sid as invalid rather than ignoring it
 */

/**
 * Verifies a single parsed stamp.
 *
 * @param {object} stamp output of parseStamp().stamp
 * @param {VerifyContext} context
 * @returns {Promise<object>} a result carrying state, signal, reason and diagnostics
 */
export async function verifyStamp(stamp, context) {
  const now = context.now ?? Date.now();
  const maxAgeMs = context.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000;
  const clockSkewMs = context.clockSkewMs ?? MAX_CLOCK_SKEW_MS;
  const maxDifficulty = Math.min(context.maxDifficulty ?? MAX_DECLARED_DIFFICULTY, MAX_DECLARED_DIFFICULTY);
  const minDifficulty = Math.max(context.minDifficulty ?? MIN_DECLARED_DIFFICULTY, MIN_DECLARED_DIFFICULTY);
  const started = Date.now();

  const outcome = (state, reason, extra = {}) => ({
    state,
    signal: SIGNAL_BY_STATE[state],
    reason,
    difficulty: stamp.difficulty,
    algorithm: stamp.algorithm,
    timestamp: stamp.timestamp,
    verificationMs: Date.now() - started,
    stamp,
    ...extra
  });

  if (!SUPPORTED_VERSIONS.has(stamp.version)) {
    return outcome(StampState.UNSUPPORTED, Reason.UNSUPPORTED_VERSION, { detail: `v=${stamp.version}` });
  }
  // An unimplemented but registered profile is "unsupported", not invalid: we must never guess, and never run
  // attacker-selected work (whitepaper 11.1, 12).
  if (!IMPLEMENTED_ALGORITHMS.has(stamp.algorithm)) {
    const known = KNOWN_ALGORITHMS.has(stamp.algorithm);
    return outcome(StampState.UNSUPPORTED, Reason.UNSUPPORTED_ALGORITHM, {
      detail: known ? `${stamp.algorithm} (ESF v1 profile, not implemented here)` : stamp.algorithm
    });
  }
  if (!Number.isInteger(stamp.difficulty) || stamp.difficulty > maxDifficulty) {
    return outcome(StampState.INVALID, Reason.DIFFICULTY_OUT_OF_RANGE, { detail: `d=${stamp.difficulty}` });
  }
  if (stamp.difficulty < MIN_DECLARED_DIFFICULTY) {
    return outcome(StampState.INVALID, Reason.DIFFICULTY_OUT_OF_RANGE, { detail: `d=${stamp.difficulty}` });
  }

  const timestampMs = stamp.timestamp * 1000;
  const age = now - timestampMs;
  if (age > maxAgeMs) {
    return outcome(StampState.INVALID, Reason.STALE, { detail: `${Math.round(age / 86400000)} days old`, timestampMs });
  }
  if (age < -clockSkewMs) {
    return outcome(StampState.INVALID, Reason.FUTURE_TIMESTAMP, { detail: `${Math.round(-age / 1000)}s ahead` });
  }

  // Recipient binding: recompute rid for each of our own mailboxes. Without this, a stamp minted for somebody else
  // could simply be replayed at us.
  let matchedRecipient = null;
  for (const mailbox of context.localMailboxes || []) {
    if (await recipientToken(mailbox, stamp.salt) === stamp.rid) {
      matchedRecipient = mailbox;
      break;
    }
  }
  if (!matchedRecipient) {
    return outcome(StampState.INVALID, Reason.WRONG_RECIPIENT, { detail: `rid=${stamp.rid.slice(0, 10)}...` });
  }

  // Sender binding. A mismatch means the stamp was not minted for this From, so it was moved between messages.
  let senderBound = null;
  if (context.from) {
    senderBound = await senderToken(context.from) === stamp.sid;
    if (!senderBound && context.requireSenderBinding !== false) {
      return outcome(StampState.INVALID, Reason.SENDER_MISMATCH, { detail: `sid=${stamp.sid.slice(0, 10)}...`,
        matchedRecipient });
    }
  }

  // Message binding.
  let messageBound = null;
  if (context.messageId) {
    messageBound = await messageIdToken(context.messageId) === stamp.mid;
    if (!messageBound) {
      return outcome(StampState.INVALID, Reason.MESSAGE_MISMATCH, { detail: `mid=${stamp.mid.slice(0, 10)}...`,
        matchedRecipient });
    }
  }

  // Exactly one work operation, independent of the declared difficulty.
  const workBase = buildWorkBase({
    algorithm: stamp.algorithm,
    difficulty: stamp.difficulty,
    timestamp: stamp.timestamp,
    sid: stamp.sid,
    rid: stamp.rid,
    mid: stamp.mid,
    salt: stamp.salt,
    profileParams: stamp.profileParams
  });
  const digest = await hashCandidate(workBase, stamp.nonce);
  const leadingZeroBits = countLeadingZeroBits(digest);
  const diagnostics = {
    leadingZeroBits,
    hash: toHex(digest),
    matchedRecipient,
    senderBound,
    messageBound,
    timestampMs
  };
  if (leadingZeroBits < stamp.difficulty) {
    return outcome(StampState.INVALID, Reason.INSUFFICIENT_WORK, diagnostics);
  }
  // Real work, but less than this receiver's policy asks for: valid and yellow, not invalid (whitepaper 11.1).
  if (stamp.difficulty < minDifficulty) {
    return outcome(StampState.WEAK, Reason.BELOW_POLICY, { ...diagnostics, requiredDifficulty: minDifficulty });
  }
  return outcome(StampState.STRONG, Reason.OK, diagnostics);
}

/**
 * Verifies every stamp of a message and reduces them to one outcome.
 *
 * Bounded on both axes: at most MAX_STAMPS_PER_MESSAGE header fields and MAX_STAMPS_PER_HEADER stamps in total, so a
 * message stuffed with stamps cannot keep the verifier busy (whitepaper 6.7 step 1, 12 "header bombing").
 *
 * @param {string[]} headerValues every ESF-Stamp / X-ESF-Stamp field value of the message
 * @param {VerifyContext} context
 * @returns {Promise<{state: string, signal: string, reason: string, best: object|null, results: object[],
 *                    skipped: number}>}
 */
export async function verifyMessageStamps(headerValues, context) {
  const values = Array.isArray(headerValues) ? headerValues : [];
  const considered = values.slice(0, MAX_STAMPS_PER_MESSAGE);
  let skipped = values.length - considered.length;
  if (considered.length === 0) {
    return {
      state: StampState.MISSING,
      signal: SIGNAL_BY_STATE[StampState.MISSING],
      reason: Reason.NO_STAMP,
      best: null,
      results: [],
      skipped
    };
  }

  const entries = [];
  for (const value of considered) {
    for (const parsed of parseStampList(value)) {
      if (entries.length >= MAX_STAMPS_PER_HEADER) {
        skipped++;
        continue;
      }
      entries.push({ parsed, value });
    }
  }

  const results = [];
  for (const { parsed, value } of entries) {
    if (!parsed.ok) {
      results.push({
        state: StampState.INVALID,
        signal: SIGNAL_BY_STATE[StampState.INVALID],
        reason: parsed.reason,
        detail: parsed.detail,
        raw: value.slice(0, 120),
        verificationMs: 0
      });
      continue;
    }
    results.push(await verifyStamp(parsed.stamp, context));
  }

  // A message carries one stamp per recipient, so at most one of them binds to us. Rank by usefulness: a strong
  // stamp beats a weak one, which beats an unsupported profile, which beats anything invalid.
  const rank = { [StampState.STRONG]: 4, [StampState.WEAK]: 3, [StampState.UNSUPPORTED]: 2, [StampState.INVALID]: 1 };
  const boundToUs = results.filter(item => item.reason !== Reason.WRONG_RECIPIENT);
  const pool = boundToUs.length > 0 ? boundToUs : results;
  const best = pool.reduce((a, b) => ((rank[b.state] || 0) > (rank[a.state] || 0) ? b : a));
  return { state: best.state, signal: best.signal, reason: best.reason, best, results, skipped };
}

/**
 * Replay identifier: SHA-256 of the canonical stamp serialisation (whitepaper 6.8).
 *
 * @param {object} stamp
 * @returns {Promise<string>} hex digest
 */
export async function stampId(stamp) {
  return toHex(await sha256(serializeStamp(stamp)));
}
