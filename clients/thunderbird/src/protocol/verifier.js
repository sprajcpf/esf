/**
 * Verification of incoming proofs.
 *
 * Cost model: verifying one header is exactly one SHA-256 invocation plus a handful of string checks, independent of
 * the declared difficulty. That is what makes the scheme asymmetric - and it is why the verifier must never derive
 * any amount of work from attacker-controlled values.
 */

import {
  MAX_ACCEPTED_DIFFICULTY,
  MAX_CLOCK_SKEW_MS,
  MAX_HEADERS_PER_MESSAGE,
  MIN_ACCEPTED_DIFFICULTY,
  Reason,
  SUPPORTED_ALGORITHMS,
  SUPPORTED_VERSIONS,
  VerificationStatus
} from "./constants.js";
import { countLeadingZeroBits, toHex } from "./hash.js";
import { parseProofHeader } from "./parser.js";
import { buildPreimageBase, hashCandidate, normalizeAddress, normalizeMessageId, parseTimestamp, recipientId }
  from "./pow.js";

/**
 * @typedef {object} VerifyContext
 * @property {string[]} localAddresses addresses the receiving user owns; a proof must be bound to one of them
 * @property {string} [messageId] Message-ID of the carrying message, used when the header omits `mid`
 * @property {number} [now] current time in ms, injectable for tests
 * @property {number} [maxAgeMs] acceptance window
 * @property {number} [clockSkewMs] tolerance for senders whose clock runs ahead
 * @property {number} [maxBits] highest difficulty we are willing to accept as declared
 * @property {number} [minBits] lowest difficulty that still counts as a valid proof
 * @property {boolean} [requireMessageIdMatch] when the header carries `mid`, require it to match the message
 */

function result(status, reason, extra = {}) {
  return { status, reason, ...extra };
}

/**
 * Verifies a single parsed proof.
 *
 * @param {object} proof output of parseProofHeader().proof
 * @param {VerifyContext} context
 */
export async function verifyProof(proof, context) {
  const now = context.now ?? Date.now();
  const maxAgeMs = context.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000;
  const clockSkewMs = context.clockSkewMs ?? MAX_CLOCK_SKEW_MS;
  const maxBits = Math.min(context.maxBits ?? MAX_ACCEPTED_DIFFICULTY, MAX_ACCEPTED_DIFFICULTY);
  const minBits = Math.max(context.minBits ?? MIN_ACCEPTED_DIFFICULTY, MIN_ACCEPTED_DIFFICULTY);
  const started = Date.now();
  // Every outcome reports how long verification took, so "cheap to verify" stays measurable rather than assumed.
  const result = (status, reason, extra = {}) =>
    ({ status, reason, verificationMs: Date.now() - started, ...extra });

  if (!SUPPORTED_VERSIONS.has(proof.version)) {
    return result(VerificationStatus.INVALID, Reason.UNSUPPORTED_VERSION, { detail: `v=${proof.version}` });
  }
  if (!SUPPORTED_ALGORITHMS.has(proof.algorithm)) {
    return result(VerificationStatus.INVALID, Reason.UNSUPPORTED_ALGORITHM, { detail: proof.algorithm });
  }
  // A hostile sender may declare any difficulty. Refuse implausible declarations before doing anything else.
  if (!Number.isInteger(proof.bits) || proof.bits > maxBits) {
    return result(VerificationStatus.INVALID, Reason.DIFFICULTY_OUT_OF_RANGE, { detail: `bits=${proof.bits}` });
  }
  if (proof.bits < minBits) {
    return result(VerificationStatus.INVALID, Reason.DIFFICULTY_TOO_LOW, { detail: `bits=${proof.bits}` });
  }

  const timestamp = parseTimestamp(proof.timestamp);
  if (!timestamp) {
    return result(VerificationStatus.INVALID, Reason.MALFORMED, { detail: "unparseable timestamp" });
  }
  const age = now - timestamp.getTime();
  if (age > maxAgeMs) {
    return result(VerificationStatus.INVALID, Reason.EXPIRED, { detail: `${Math.round(age / 86400000)} days old` });
  }
  if (age < -clockSkewMs) {
    return result(VerificationStatus.INVALID, Reason.FUTURE_TIMESTAMP, { detail: proof.timestamp });
  }

  // Recipient binding. Either the plaintext address matches one of ours, or the hashed form does. Without this a
  // proof computed for someone else could simply be replayed at us.
  const candidates = (context.localAddresses || []).map(normalizeAddress).filter(Boolean);
  let matchedRecipient = null;
  if (proof.recipient) {
    matchedRecipient = candidates.includes(proof.recipient) ? proof.recipient : null;
  } else {
    for (const candidate of candidates) {
      if (await recipientId(proof.salt, candidate) === proof.recipientHash) {
        matchedRecipient = candidate;
        break;
      }
    }
  }
  if (!matchedRecipient) {
    return result(VerificationStatus.INVALID, Reason.RECIPIENT_MISMATCH, {
      detail: proof.recipient || `rid=${String(proof.recipientHash).slice(0, 12)}...`
    });
  }

  const carrierMessageId = normalizeMessageId(context.messageId || "");
  if (proof.messageId && context.requireMessageIdMatch && carrierMessageId && proof.messageId !== carrierMessageId) {
    return result(VerificationStatus.INVALID, Reason.MESSAGE_ID_MISMATCH, { detail: proof.messageId });
  }
  // The header carries the id the proof was computed for; fall back to the message's own id for older senders.
  const boundMessageId = proof.messageId || carrierMessageId;

  const base = buildPreimageBase({
    version: proof.version,
    recipient: matchedRecipient,
    timestamp: proof.timestamp,
    messageId: boundMessageId,
    salt: proof.salt
  });
  const digest = await hashCandidate(base, proof.nonce);
  const leadingZeroBits = countLeadingZeroBits(digest);
  const hash = toHex(digest);
  const common = {
    bits: proof.bits,
    leadingZeroBits,
    hash,
    matchedRecipient,
    timestamp: proof.timestamp,
    timestampMs: timestamp.getTime(),
    algorithm: proof.algorithm,
    verificationMs: Date.now() - started,
    proof
  };
  if (leadingZeroBits < proof.bits) {
    return result(VerificationStatus.INVALID, Reason.INSUFFICIENT_WORK, common);
  }
  return result(VerificationStatus.VALID, Reason.OK, common);
}

/**
 * Verifies every X-Email-PoW header of a message and reduces them to a single outcome.
 *
 * Only the first MAX_HEADERS_PER_MESSAGE headers are looked at: a message carrying thousands of headers must not be
 * able to keep us busy.
 *
 * @param {string[]} headerValues
 * @param {VerifyContext} context
 * @returns {Promise<{status: string, reason: string, best: object|null, results: object[], skipped: number}>}
 */
export async function verifyMessageHeaders(headerValues, context) {
  const values = Array.isArray(headerValues) ? headerValues : [];
  const considered = values.slice(0, MAX_HEADERS_PER_MESSAGE);
  const skipped = values.length - considered.length;
  if (considered.length === 0) {
    return { status: VerificationStatus.MISSING, reason: Reason.NO_HEADER, best: null, results: [], skipped };
  }

  const results = [];
  for (const value of considered) {
    const parsed = parseProofHeader(value);
    if (!parsed.ok) {
      results.push(result(VerificationStatus.INVALID, parsed.reason, { detail: parsed.detail, raw: value }));
      continue;
    }
    results.push(await verifyProof(parsed.proof, context));
  }

  // A message can carry one proof per recipient, so exactly one of them is expected to be bound to us. A valid proof
  // therefore wins over any number of proofs that are simply addressed to someone else.
  const valid = results.filter(item => item.status === VerificationStatus.VALID);
  if (valid.length > 0) {
    const best = valid.reduce((a, b) => (b.bits > a.bits ? b : a));
    return { status: VerificationStatus.VALID, reason: Reason.OK, best, results, skipped };
  }
  const addressedToUs = results.find(item => item.reason !== Reason.RECIPIENT_MISMATCH);
  const best = addressedToUs || results[0];
  return { status: VerificationStatus.INVALID, reason: best.reason, best, results, skipped };
}

/**
 * Stable key for replay bookkeeping: a proof is only ever legitimate for one recipient and one digest.
 *
 * @param {{matchedRecipient: string, hash: string}} verified
 */
export function replayKey(verified) {
  return `${verified.matchedRecipient}|${verified.hash}`;
}
