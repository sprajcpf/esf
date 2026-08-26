/**
 * ESF-Stamp work function: canonicalisation, binding tokens, canonical work input and the nonce search.
 * Implements the SHA-256 profile of the ESF v1.0 whitepaper (sections 6.3, 6.4, 6.6).
 *
 * Canonical work input:
 *
 *   ESF1\n alg=<alg>\n [<profile params>\n] d=<d>\n t=<t>\n sid=<sid>\n rid=<rid>\n mid=<mid>\n salt=<salt>\n
 *   nonce=<nonce>\n
 *
 * valid iff leading_zero_bits(SHA256(work)) >= d
 */

import { MAX_NONCE_HEX, SALT_BYTES, TOKEN_LENGTH, WORK_PREFIX } from "./constants.js";
import { countLeadingZeroBits, randomHex, sha256, sha256Sync, toBase64Url, toHex } from "./hash.js";

/**
 * Canonicalises a mailbox for token derivation.
 *
 * Whitepaper 6.3: trim, parse the addr-spec, lowercase the domain, and preserve the local-part exactly. Local-parts
 * are case sensitive in principle, so lowercasing them would be wrong.
 *
 * @param {string} mailbox may be "Name <a@b.c>", "<a@b.c>" or "a@b.c"
 * @returns {string} canonical addr-spec, or "" when nothing usable was found
 */
export function canonicalMailbox(mailbox) {
  if (typeof mailbox !== "string") {
    return "";
  }
  let value = mailbox.trim();
  const angled = value.match(/<([^>]*)>\s*$/);
  if (angled) {
    value = angled[1].trim();
  }
  value = value.replace(/^mailto:/i, "").trim();
  if (!value || value.length > 254 || /[\s,;]/.test(value)) {
    return "";
  }
  const at = value.lastIndexOf("@");
  if (at < 1 || at === value.length - 1) {
    return "";
  }
  const localPart = value.slice(0, at);
  const domain = value.slice(at + 1).toLowerCase();
  if (!domain.includes(".") && domain !== "localhost") {
    return "";
  }
  return `${localPart}@${domain}`;
}

/** Normalises a Message-ID by removing the angle brackets (whitepaper 6.3). */
export function normalizeMessageId(messageId) {
  if (typeof messageId !== "string") {
    return "";
  }
  return messageId.trim().replace(/^<|>$/g, "").trim();
}

/**
 * sid = BASE64URL(SHA256("from:" || canonical_from))
 *
 * @param {string} from
 * @returns {Promise<string>}
 */
export async function senderToken(from) {
  return toBase64Url(await sha256(`from:${canonicalMailbox(from)}`));
}

/**
 * rid = BASE64URL(SHA256("to:" || canonical_recipient || 0x00 || salt))
 *
 * The recipient is never carried in clear text; the receiver recomputes the token for its own mailboxes. The salt
 * makes precomputed tables useless, but it does not hide a mailbox from someone who can guess it (whitepaper 6.3).
 *
 * @param {string} recipient
 * @param {string} salt hex salt from the stamp
 * @returns {Promise<string>}
 */
export async function recipientToken(recipient, salt) {
  // The 0x00 byte is the separator mandated by the whitepaper, so a mailbox cannot run into the salt.
  return toBase64Url(await sha256(`to:${canonicalMailbox(recipient)}\u0000${salt}`));
}

/**
 * mid = BASE64URL(SHA256("mid:" || normalized_message_id))
 *
 * @param {string} messageId
 * @returns {Promise<string>}
 */
export async function messageIdToken(messageId) {
  return toBase64Url(await sha256(`mid:${normalizeMessageId(messageId)}`));
}

/** Unix seconds, the `t` field of a stamp (whitepaper 6.2). */
export function unixSeconds(date = Date.now()) {
  return Math.floor(new Date(date).getTime() / 1000);
}

/**
 * Builds the canonical work input up to (but excluding) the nonce line.
 *
 * @param {object} stamp
 * @param {string} stamp.algorithm
 * @param {number} stamp.difficulty
 * @param {number} stamp.timestamp unix seconds
 * @param {string} stamp.sid
 * @param {string} stamp.rid
 * @param {string} stamp.mid
 * @param {string} stamp.salt
 * @param {Record<string, string|number>} [stamp.profileParams] profile specific parameters, e.g. argon2id mem/iter
 * @returns {string}
 */
export function buildWorkBase({ algorithm, difficulty, timestamp, sid, rid, mid, salt, profileParams }) {
  const lines = [WORK_PREFIX, `alg=${algorithm}`];
  // Profile parameters belong in the work input so a sender cannot silently change them (whitepaper 6.5).
  for (const key of Object.keys(profileParams || {}).sort()) {
    lines.push(`${key}=${profileParams[key]}`);
  }
  lines.push(`d=${difficulty}`, `t=${timestamp}`, `sid=${sid}`, `rid=${rid}`, `mid=${mid}`, `salt=${salt}`);
  return `${lines.join("\n")}\n`;
}

/** Full canonical work input for one nonce. */
export function buildWorkInput(stamp, nonce) {
  return `${buildWorkBase(stamp)}nonce=${nonce}\n`;
}

/** Hashes one candidate (async, WebCrypto). */
export function hashCandidate(workBase, nonce) {
  return sha256(`${workBase}nonce=${nonce}\n`);
}

/** Hashes one candidate synchronously - the hot loop of the nonce search. Digest-identical to hashCandidate. */
export function hashCandidateSync(workBase, nonce, out) {
  return sha256Sync(`${workBase}nonce=${nonce}\n`, out);
}

/** Nonces are hex encoded (whitepaper appendix A: nonce = 1*64HEXDIG). */
export function encodeNonce(counter) {
  const hex = counter.toString(16);
  return hex.length > MAX_NONCE_HEX ? hex.slice(-MAX_NONCE_HEX) : hex;
}

/** Fresh random salt, 128 bits (whitepaper 6.2 recommendation). */
export function generateSalt() {
  return randomHex(SALT_BYTES);
}

/**
 * A work base with placeholder tokens, for measuring how fast this machine hashes.
 *
 * It has to be the same *size* as a real one, not merely the same shape: SHA-256 processes 64 byte blocks, and a real
 * work input is four blocks where a short improvised one is a single block. Measuring with a short input therefore
 * overestimates the achievable rate by about 1.8x, which - if that measurement is used to choose a difficulty -
 * makes every send take roughly 1.8x longer than the user asked for.
 *
 * @returns {string}
 */
export function probeWorkBase() {
  return buildWorkBase({
    algorithm: "sha256",
    difficulty: 20,
    timestamp: unixSeconds(),
    sid: "P".repeat(TOKEN_LENGTH),
    rid: "R".repeat(TOKEN_LENGTH),
    mid: "M".repeat(TOKEN_LENGTH),
    salt: "0".repeat(SALT_BYTES * 2),
    profileParams: {}
  });
}

/**
 * Searches a nonce range for a digest with at least `difficulty` leading zero bits.
 *
 * Cooperative: every `batchSize` candidates it consults `shouldStop` and yields, so it never blocks a UI thread and
 * can be cancelled promptly (whitepaper 10.1, 13).
 *
 * @param {object} options
 * @param {string} options.workBase result of buildWorkBase()
 * @param {number} options.difficulty required leading zero bits
 * @param {number} [options.startCounter] first counter value to try
 * @param {number} [options.stride] increment between candidates, used to shard across workers
 * @param {number} [options.batchSize] candidates per cooperative slice
 * @param {number} [options.maxCandidates] upper bound on tried candidates
 * @param {() => boolean} [options.shouldStop]
 * @param {(hashes: number) => void} [options.onProgress]
 * @returns {Promise<{found: boolean, nonce: string|null, hash: string|null, hashes: number, stopped: boolean}>}
 */
export async function searchNonce({
  workBase,
  difficulty,
  startCounter = 0,
  stride = 1,
  batchSize = 2000,
  maxCandidates = Number.POSITIVE_INFINITY,
  shouldStop,
  onProgress
}) {
  let counter = startCounter;
  let hashes = 0;
  const scratch = new Uint8Array(32);
  while (hashes < maxCandidates) {
    const limit = Math.min(batchSize, maxCandidates - hashes);
    for (let i = 0; i < limit; i++) {
      const nonce = encodeNonce(counter);
      const digest = hashCandidateSync(workBase, nonce, scratch);
      hashes++;
      if (countLeadingZeroBits(digest) >= difficulty) {
        return { found: true, nonce, hash: toHex(digest), hashes, stopped: false };
      }
      counter += stride;
    }
    if (onProgress) {
      onProgress(hashes);
    }
    if (shouldStop && shouldStop()) {
      return { found: false, nonce: null, hash: null, hashes, stopped: true };
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return { found: false, nonce: null, hash: null, hashes, stopped: false };
}

/**
 * Produces a complete stamp for one recipient. Used by tests and as the non-worker fallback; the extension normally
 * drives the search through the worker pool in src/background/solver.js.
 *
 * @param {object} options
 * @param {string} options.from sender mailbox
 * @param {string} options.recipient recipient mailbox
 * @param {string} options.messageId Message-ID the stamp is bound to
 * @param {number} options.difficulty
 * @param {string} [options.algorithm]
 * @param {string} [options.salt]
 * @param {Date|number} [options.now]
 * @param {() => boolean} [options.shouldStop]
 * @param {number} [options.maxCandidates]
 * @returns {Promise<{stamp: object|null, hashes: number, stopped: boolean}>}
 */
export async function generateStamp({
  from,
  recipient,
  messageId,
  difficulty,
  algorithm = "sha256",
  salt = generateSalt(),
  now = Date.now(),
  shouldStop,
  maxCandidates
}) {
  const canonicalRecipient = canonicalMailbox(recipient);
  if (!canonicalRecipient) {
    throw new Error(`unusable recipient mailbox: ${recipient}`);
  }
  const stamp = {
    version: 1,
    algorithm,
    difficulty,
    timestamp: unixSeconds(now),
    sid: await senderToken(from),
    rid: await recipientToken(canonicalRecipient, salt),
    mid: await messageIdToken(messageId),
    salt,
    profileParams: {}
  };
  const workBase = buildWorkBase(stamp);
  const result = await searchNonce({ workBase, difficulty: stamp.difficulty, shouldStop, maxCandidates });
  if (!result.found) {
    return { stamp: null, hashes: result.hashes, stopped: result.stopped };
  }
  return {
    stamp: { ...stamp, nonce: result.nonce, hash: result.hash },
    hashes: result.hashes,
    stopped: false
  };
}
