/**
 * Strict parser / serialiser for the ESF-Stamp header field (whitepaper 6.1, appendix A).
 *
 *   X-ESF-Stamp: v=1; alg=sha256; d=22; t=1787651400; sid=F8Y0...; rid=AP3K...; mid=2T1C...;
 *                salt=7a12d4b5e6891f20; nonce=19d82c
 *
 * Everything here treats its input as hostile: bounded length, bounded field count, no duplicate keys, no
 * backtracking-prone regexes, and unknown fields are kept as profile parameters rather than trusted (6.7 steps 1-2).
 */

import {
  MAX_FIELDS_PER_STAMP,
  MAX_HEADER_TOTAL_LENGTH,
  MAX_NONCE_HEX,
  MAX_SALT_HEX,
  MAX_STAMPS_PER_HEADER,
  MAX_STAMP_LENGTH,
  MIN_SALT_HEX,
  Reason,
  STAMP_SEPARATOR
} from "./constants.js";

const KEY_RE = /^[a-z][a-z0-9_-]{0,15}$/;
const ALG_RE = /^[a-z0-9-]{1,16}$/;
const SMALL_INT_RE = /^[0-9]{1,3}$/;
const TIMESTAMP_RE = /^[0-9]{1,12}$/;
const HEX_RE = /^[0-9a-f]+$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const PARAM_VALUE_RE = /^[A-Za-z0-9_.:@+-]{1,64}$/;

/** Fields consumed by the base protocol; anything else is a profile parameter. */
const CORE_FIELDS = new Set(["v", "alg", "d", "t", "sid", "rid", "mid", "salt", "nonce"]);

function fail(detail) {
  return { ok: false, reason: Reason.MALFORMED, detail };
}

/**
 * Parses one stamp.
 *
 * @param {string} raw a single stamp, without the header field name
 * @returns {{ok: true, stamp: object} | {ok: false, reason: string, detail: string}}
 */
export function parseStamp(raw) {
  if (typeof raw !== "string") {
    return fail("not a string");
  }
  const value = raw.trim();
  if (value.length === 0) {
    return fail("empty stamp");
  }
  if (value.length > MAX_STAMP_LENGTH) {
    return fail(`stamp too long (${value.length} > ${MAX_STAMP_LENGTH})`);
  }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) {
    return fail("control characters in stamp");
  }

  const parts = value.split(";");
  if (parts.length > MAX_FIELDS_PER_STAMP) {
    return fail(`too many fields (${parts.length})`);
  }

  /** @type {Record<string, string>} */
  const fields = Object.create(null);
  for (const part of parts) {
    const chunk = part.trim();
    if (chunk === "") {
      continue;
    }
    const eq = chunk.indexOf("=");
    if (eq < 1) {
      return fail(`field without value: ${chunk.slice(0, 24)}`);
    }
    const key = chunk.slice(0, eq).trim().toLowerCase();
    const fieldValue = chunk.slice(eq + 1).trim();
    if (!KEY_RE.test(key)) {
      return fail(`invalid field name: ${key.slice(0, 24)}`);
    }
    if (key in fields) {
      return fail(`duplicate field: ${key}`);
    }
    if (fieldValue === "") {
      return fail(`empty value for field: ${key}`);
    }
    fields[key] = fieldValue;
  }

  for (const required of ["v", "alg", "d", "t", "sid", "rid", "mid", "salt", "nonce"]) {
    if (!(required in fields)) {
      return fail(`missing field: ${required}`);
    }
  }

  if (!SMALL_INT_RE.test(fields.v)) {
    return fail("invalid version");
  }
  const algorithm = fields.alg.toLowerCase();
  if (!ALG_RE.test(algorithm)) {
    return fail("invalid algorithm");
  }
  if (!SMALL_INT_RE.test(fields.d)) {
    return fail("invalid difficulty");
  }
  if (!TIMESTAMP_RE.test(fields.t)) {
    return fail("invalid timestamp");
  }
  for (const token of ["sid", "rid", "mid"]) {
    if (!TOKEN_RE.test(fields[token])) {
      return fail(`invalid ${token}`);
    }
  }
  const salt = fields.salt.toLowerCase();
  if (!HEX_RE.test(salt) || salt.length % 2 !== 0 || salt.length < MIN_SALT_HEX || salt.length > MAX_SALT_HEX) {
    return fail("invalid salt");
  }
  const nonce = fields.nonce.toLowerCase();
  if (!HEX_RE.test(nonce) || nonce.length > MAX_NONCE_HEX) {
    return fail("invalid nonce");
  }

  // Profile parameters (argon2id mem/iter/lanes and future profiles) are carried through untouched but validated
  // syntactically, because they take part in the canonical work input.
  const profileParams = {};
  for (const [key, fieldValue] of Object.entries(fields)) {
    if (CORE_FIELDS.has(key)) {
      continue;
    }
    if (!PARAM_VALUE_RE.test(fieldValue)) {
      return fail(`invalid profile parameter: ${key}`);
    }
    profileParams[key] = fieldValue;
  }

  return {
    ok: true,
    stamp: {
      version: Number(fields.v),
      algorithm,
      difficulty: Number(fields.d),
      timestamp: Number(fields.t),
      sid: fields.sid,
      rid: fields.rid,
      mid: fields.mid,
      salt,
      nonce,
      profileParams,
      raw: value
    }
  };
}

/**
 * Parses a header value that may carry several stamps, one per recipient.
 *
 * The whitepaper describes one ESF-Stamp field per recipient; Thunderbird's customHeaders API keeps only one field
 * per name, so the prototype also accepts a comma separated list inside one field. Malformed entries are reported
 * individually - a message may legitimately carry a stamp for a recipient whose entry we cannot read.
 *
 * @param {string} raw
 * @returns {Array<{ok: true, stamp: object} | {ok: false, reason: string, detail: string}>}
 */
export function parseStampList(raw) {
  if (typeof raw !== "string") {
    return [fail("not a string")];
  }
  if (raw.length > MAX_HEADER_TOTAL_LENGTH) {
    return [fail(`header too long (${raw.length} > ${MAX_HEADER_TOTAL_LENGTH})`)];
  }
  const parts = raw.split(",").map(part => part.trim()).filter(part => part !== "");
  if (parts.length === 0) {
    return [fail("empty header")];
  }
  if (parts.length > MAX_STAMPS_PER_HEADER) {
    return [fail(`too many stamps (${parts.length} > ${MAX_STAMPS_PER_HEADER})`)];
  }
  return parts.map(parseStamp);
}

/**
 * Serialises one stamp. Field order is fixed, so output is reproducible and the replay identifier is stable.
 *
 * @param {object} stamp
 * @returns {string}
 */
export function serializeStamp(stamp) {
  const fields = [["v", String(stamp.version)], ["alg", stamp.algorithm]];
  for (const key of Object.keys(stamp.profileParams || {}).sort()) {
    fields.push([key, String(stamp.profileParams[key])]);
  }
  fields.push(
    ["d", String(stamp.difficulty)],
    ["t", String(stamp.timestamp)],
    ["sid", stamp.sid],
    ["rid", stamp.rid],
    ["mid", stamp.mid],
    ["salt", stamp.salt],
    ["nonce", stamp.nonce]
  );
  return fields.map(([key, value]) => `${key}=${value}`).join("; ");
}

/** Serialises several stamps into one header value. */
export function serializeStampList(stamps) {
  return stamps.map(serializeStamp).join(STAMP_SEPARATOR);
}
