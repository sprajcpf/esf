/** SHA-256 helpers plus the bit-counting primitive the protocol is built on. Works in Node, workers and pages. */

import { sha256Bytes } from "./sha256.js";

const encoder = new TextEncoder();

/**
 * @param {string} text
 * @returns {Promise<Uint8Array>} raw 32 byte digest
 */
export async function sha256(text) {
  const webcrypto = globalThis.crypto;
  // Outlook's event-based add-ins may run in a JavaScript-only runtime without WebCrypto; the bundled pure-JS
  // implementation is digest-identical, so every client sees the same tokens either way.
  if (!webcrypto || !webcrypto.subtle) {
    return sha256Bytes(encoder.encode(text));
  }
  const digest = await webcrypto.subtle.digest("SHA-256", encoder.encode(text));
  return new Uint8Array(digest);
}

/**
 * Synchronous SHA-256 of a string. Digest-identical to sha256(), but usable in a tight loop.
 *
 * @param {string} text
 * @param {Uint8Array} [out] optional 32 byte buffer to reuse
 * @returns {Uint8Array}
 */
export function sha256Sync(text, out) {
  return sha256Bytes(encoder.encode(text), out);
}

/**
 * Counts leading zero *bits* of a digest. This is the difficulty measure of the protocol; counting leading hex zero
 * characters would only ever express multiples of four bits.
 *
 * @param {Uint8Array} bytes
 * @returns {number}
 */
export function countLeadingZeroBits(bytes) {
  let bits = 0;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte === 0) {
      bits += 8;
      continue;
    }
    // Math.clz32 counts on 32 bit words, so subtract the 24 padding bits of a single byte.
    return bits + (Math.clz32(byte) - 24);
  }
  return bits;
}

/** @param {Uint8Array} bytes */
export function toHex(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

/** @param {string} hex */
export function fromHex(hex) {
  if (typeof hex !== "string" || hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error("invalid hex string");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

/**
 * BASE64URL without padding - the encoding used for the sid/rid/mid binding tokens (whitepaper 6.3).
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function toBase64Url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Cryptographically random hex string of `byteLength` bytes. */
export function randomHex(byteLength) {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return toHex(bytes);
}
