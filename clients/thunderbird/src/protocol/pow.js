/**
 * Core Proof-of-Work algorithm: canonicalisation, preimage construction, nonce search.
 *
 * Canonical preimage (protocol v1):
 *
 *   version | recipient | timestamp | messageId | salt | nonce
 *
 * All parts are UTF-8, joined by "|" so that no field can be shifted into its neighbour. `recipient` is the
 * normalised (lowercased, bracket-stripped) address, `timestamp` the compact UTC form, `nonce` a decimal integer.
 */

import { FIELD_SEPARATOR, MAX_RECIPIENT_LENGTH, PROTOCOL_VERSION, SALT_BYTES } from "./constants.js";
import { countLeadingZeroBits, randomHex, sha256, sha256Sync, toHex } from "./hash.js";

/**
 * Normalises an email address for use in the preimage and in the `rcpt` field.
 * Accepts "Name <a@b.c>", " A@B.C " and plain addresses.
 *
 * @param {string} address
 * @returns {string} normalised address, or "" if nothing usable was found
 */
export function normalizeAddress(address) {
  if (typeof address !== "string") {
    return "";
  }
  let value = address.trim();
  const angled = value.match(/<([^>]*)>\s*$/);
  if (angled) {
    value = angled[1].trim();
  }
  value = value.replace(/^mailto:/i, "").trim().toLowerCase();
  if (!value || value.length > MAX_RECIPIENT_LENGTH || /[\s,;]/.test(value) || !value.includes("@")) {
    return "";
  }
  return value;
}

/** Strips the angle brackets from a Message-ID; returns "" for anything unusable. */
export function normalizeMessageId(messageId) {
  if (typeof messageId !== "string") {
    return "";
  }
  return messageId.trim().replace(/^<|>$/g, "").trim();
}

/**
 * Formats a Date as the compact UTC timestamp used in the header: 20260825T103800Z.
 *
 * @param {Date|number} date
 */
export function formatTimestamp(date) {
  const iso = new Date(date).toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}` +
    `${iso.slice(17, 19)}Z`;
}

const TIMESTAMP_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;

/**
 * Parses the compact UTC timestamp. Returns null when the value is malformed or not a real calendar instant.
 *
 * @param {string} timestamp
 * @returns {Date|null}
 */
export function parseTimestamp(timestamp) {
  if (typeof timestamp !== "string") {
    return null;
  }
  const match = timestamp.match(TIMESTAMP_RE);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  // Reject values like 20261301T000000Z that Date.UTC would silently roll over.
  if (formatTimestamp(date) !== timestamp) {
    return null;
  }
  return date;
}

/**
 * Builds the part of the preimage that is constant across the nonce search.
 *
 * @param {{version?: number, recipient: string, timestamp: string, messageId: string, salt: string}} params
 * @returns {string}
 */
export function buildPreimageBase({ version = PROTOCOL_VERSION, recipient, timestamp, messageId, salt }) {
  return [version, recipient, timestamp, messageId, salt].join(FIELD_SEPARATOR);
}

/** Full preimage for one nonce. */
export function buildPreimage(params, nonce) {
  return `${buildPreimageBase(params)}${FIELD_SEPARATOR}${nonce}`;
}

/**
 * Hashes one candidate.
 *
 * @param {string} base result of buildPreimageBase()
 * @param {string|number} nonce
 * @returns {Promise<Uint8Array>}
 */
export function hashCandidate(base, nonce) {
  return sha256(`${base}${FIELD_SEPARATOR}${nonce}`);
}

/**
 * Synchronous variant used by the nonce search. Identical output to hashCandidate().
 *
 * @param {string} base
 * @param {string|number} nonce
 * @param {Uint8Array} [out] reusable 32 byte buffer
 * @returns {Uint8Array}
 */
export function hashCandidateSync(base, nonce, out) {
  return sha256Sync(`${base}${FIELD_SEPARATOR}${nonce}`, out);
}

/** Generates a fresh random salt. */
export function generateSalt() {
  return randomHex(SALT_BYTES);
}

/**
 * Binds a recipient address to a proof without disclosing it: sha256(salt | address).
 * Used for Bcc recipients, whose addresses must never appear in a header that all recipients can read.
 *
 * @param {string} salt
 * @param {string} address already normalised
 * @returns {Promise<string>} hex digest
 */
export async function recipientId(salt, address) {
  return toHex(await sha256(`${salt}${FIELD_SEPARATOR}${address}`));
}

/**
 * Searches a nonce range for a digest with at least `bits` leading zero bits.
 *
 * Single threaded and cooperative: every `batchSize` candidates it yields to the event loop and consults
 * `shouldStop`, so it can be used on a UI thread (as a fallback) without freezing it. Workers use it via
 * powWorker.js.
 *
 * @param {object} options
 * @param {string} options.base preimage base
 * @param {number} options.bits required leading zero bits
 * @param {number} [options.startNonce] first nonce to try
 * @param {number} [options.stride] increment between candidates (used to shard the search across workers)
 * @param {number} [options.batchSize] candidates per cooperative slice
 * @param {number} [options.maxCandidates] upper bound on tried candidates (unbounded by default)
 * @param {() => boolean} [options.shouldStop] cancellation hook, consulted between batches
 * @param {(hashes: number, nonce: number) => void} [options.onProgress] progress hook, called between batches
 * @returns {Promise<{found: boolean, nonce: string|null, hash: string|null, hashes: number, stopped: boolean}>}
 */
export async function searchNonce({
  base,
  bits,
  startNonce = 0,
  stride = 1,
  batchSize = 2000,
  maxCandidates = Number.POSITIVE_INFINITY,
  shouldStop,
  onProgress
}) {
  let nonce = startNonce;
  let hashes = 0;
  const scratch = new Uint8Array(32);
  while (hashes < maxCandidates) {
    const limit = Math.min(batchSize, maxCandidates - hashes);
    for (let i = 0; i < limit; i++) {
      const digest = hashCandidateSync(base, nonce, scratch);
      hashes++;
      if (countLeadingZeroBits(digest) >= bits) {
        return { found: true, nonce: String(nonce), hash: toHex(digest), hashes, stopped: false };
      }
      nonce += stride;
    }
    if (onProgress) {
      onProgress(hashes, nonce);
    }
    if (shouldStop && shouldStop()) {
      return { found: false, nonce: null, hash: null, hashes, stopped: true };
    }
    // Yield so the host stays responsive even when running without a worker.
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return { found: false, nonce: null, hash: null, hashes, stopped: false };
}

/**
 * Convenience wrapper producing a complete proof object for one recipient. Used by tests and as the non-worker
 * fallback path; the extension normally goes through the worker pool in src/background/solver.js.
 *
 * @param {object} options
 * @param {string} options.recipient
 * @param {number} options.bits
 * @param {string} options.messageId
 * @param {string} [options.salt]
 * @param {Date|number} [options.now]
 * @param {boolean} [options.hideRecipient] emit a hashed `rid` instead of a plaintext `rcpt` (Bcc)
 * @param {() => boolean} [options.shouldStop]
 * @param {number} [options.maxCandidates]
 * @returns {Promise<{proof: object|null, hashes: number, stopped: boolean}>}
 */
export async function generateProof({
  recipient,
  bits,
  messageId,
  salt = generateSalt(),
  now = Date.now(),
  hideRecipient = false,
  shouldStop,
  maxCandidates
}) {
  const normalizedRecipient = normalizeAddress(recipient);
  if (!normalizedRecipient) {
    throw new Error(`unusable recipient address: ${recipient}`);
  }
  const timestamp = formatTimestamp(now);
  const normalizedMessageId = normalizeMessageId(messageId);
  const base = buildPreimageBase({ recipient: normalizedRecipient, timestamp, messageId: normalizedMessageId, salt });
  const result = await searchNonce({ base, bits, shouldStop, maxCandidates });
  if (!result.found) {
    return { proof: null, hashes: result.hashes, stopped: result.stopped };
  }
  const proof = {
    version: PROTOCOL_VERSION,
    algorithm: "sha256",
    bits,
    timestamp,
    recipient: hideRecipient ? null : normalizedRecipient,
    recipientHash: hideRecipient ? await recipientId(salt, normalizedRecipient) : null,
    messageId: normalizedMessageId,
    nonce: result.nonce,
    salt,
    hash: result.hash
  };
  return { proof, hashes: result.hashes, stopped: false };
}
