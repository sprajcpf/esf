/**
 * Strict parser / serialiser for the X-Email-PoW header.
 *
 *   X-Email-PoW: v=1; alg=sha256; bits=22; ts=20260825T103800Z; rcpt=user@example.com; nonce=839274; salt=8f2c...
 *
 * Everything in here treats its input as hostile: bounded length, bounded field count, no duplicate keys, no
 * backtracking-prone regexes, and unknown fields are ignored rather than trusted.
 */

import {
  MAX_FIELDS_PER_HEADER,
  MAX_HEADER_LENGTH,
  MAX_MESSAGE_ID_LENGTH,
  MAX_NONCE_DIGITS,
  MAX_SALT_HEX,
  MIN_SALT_HEX,
  Reason
} from "./constants.js";
import { normalizeAddress } from "./pow.js";

const KEY_RE = /^[a-z][a-z0-9_-]{0,15}$/;
const ALG_RE = /^[a-z0-9-]{1,16}$/;
const DIGITS_RE = /^[0-9]{1,3}$/;
const NONCE_RE = /^[0-9]{1,20}$/;
const HEX_RE = /^[0-9a-f]+$/;
const RID_RE = /^[0-9a-f]{64}$/;
const TIMESTAMP_RE = /^[0-9]{8}T[0-9]{6}Z$/;
const MESSAGE_ID_RE = /^[\x21-\x3a\x3c-\x7e]+$/; // printable ASCII without ";" and whitespace

function fail(detail) {
  return { ok: false, reason: Reason.MALFORMED, detail };
}

/**
 * Parses one header value into a proof object.
 *
 * @param {string} raw the header value, without the "X-Email-PoW:" name
 * @returns {{ok: true, proof: object} | {ok: false, reason: string, detail: string}}
 */
export function parseProofHeader(raw) {
  if (typeof raw !== "string") {
    return fail("not a string");
  }
  const value = raw.trim();
  if (value.length === 0) {
    return fail("empty header");
  }
  if (value.length > MAX_HEADER_LENGTH) {
    return fail(`header too long (${value.length} > ${MAX_HEADER_LENGTH})`);
  }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) {
    return fail("control characters in header");
  }

  const parts = value.split(";");
  if (parts.length > MAX_FIELDS_PER_HEADER) {
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

  for (const required of ["v", "alg", "bits", "ts", "nonce", "salt"]) {
    if (!(required in fields)) {
      return fail(`missing field: ${required}`);
    }
  }
  const hasRcpt = "rcpt" in fields;
  const hasRid = "rid" in fields;
  if (hasRcpt === hasRid) {
    return fail(hasRcpt ? "both rcpt and rid present" : "missing recipient binding (rcpt or rid)");
  }

  if (!DIGITS_RE.test(fields.v)) {
    return fail("invalid version");
  }
  const algorithm = fields.alg.toLowerCase();
  if (!ALG_RE.test(algorithm)) {
    return fail("invalid algorithm");
  }
  if (!DIGITS_RE.test(fields.bits)) {
    return fail("invalid bits");
  }
  if (!TIMESTAMP_RE.test(fields.ts)) {
    return fail("invalid timestamp");
  }
  if (!NONCE_RE.test(fields.nonce) || fields.nonce.length > MAX_NONCE_DIGITS) {
    return fail("invalid nonce");
  }
  const salt = fields.salt.toLowerCase();
  if (!HEX_RE.test(salt) || salt.length % 2 !== 0 || salt.length < MIN_SALT_HEX || salt.length > MAX_SALT_HEX) {
    return fail("invalid salt");
  }

  let recipient = null;
  let recipientHash = null;
  if (hasRcpt) {
    recipient = normalizeAddress(fields.rcpt);
    if (!recipient) {
      return fail("invalid rcpt");
    }
  } else {
    recipientHash = fields.rid.toLowerCase();
    if (!RID_RE.test(recipientHash)) {
      return fail("invalid rid");
    }
  }

  let messageId = "";
  if ("mid" in fields) {
    if (fields.mid.length > MAX_MESSAGE_ID_LENGTH || !MESSAGE_ID_RE.test(fields.mid)) {
      return fail("invalid mid");
    }
    messageId = fields.mid.replace(/^<|>$/g, "");
  }

  return {
    ok: true,
    proof: {
      version: Number(fields.v),
      algorithm,
      bits: Number(fields.bits),
      timestamp: fields.ts,
      recipient,
      recipientHash,
      messageId,
      nonce: fields.nonce,
      salt,
      raw: value
    }
  };
}

/**
 * Serialises a proof object into a header value. Field order is fixed so that output is reproducible.
 *
 * @param {object} proof
 * @returns {string}
 */
export function serializeProof(proof) {
  const fields = [
    ["v", String(proof.version)],
    ["alg", proof.algorithm],
    ["bits", String(proof.bits)]
  ];
  fields.push(["ts", proof.timestamp]);
  if (proof.recipient) {
    fields.push(["rcpt", proof.recipient]);
  } else {
    fields.push(["rid", proof.recipientHash]);
  }
  if (proof.messageId) {
    fields.push(["mid", proof.messageId]);
  }
  fields.push(["nonce", proof.nonce]);
  fields.push(["salt", proof.salt]);
  return fields.map(([key, value]) => `${key}=${value}`).join("; ");
}
