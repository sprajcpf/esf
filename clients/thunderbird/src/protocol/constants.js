/**
 * ESF Proof-of-Work protocol constants.
 *
 * This module (and everything else in src/protocol/) is deliberately free of any Thunderbird API usage so it can be
 * unit tested in plain Node.js and reused in a Web Worker.
 */

/** Protocol version emitted by this implementation. */
export const PROTOCOL_VERSION = 1;

/** Protocol versions this implementation is able to verify. */
export const SUPPORTED_VERSIONS = new Set([1]);

/** Canonical header name. Header names are compared case-insensitively (Thunderbird normalises to Http-Header-Case). */
export const HEADER_NAME = "X-Email-PoW";

export const DEFAULT_ALGORITHM = "sha256";
export const SUPPORTED_ALGORITHMS = new Set(["sha256"]);

/** Default outgoing difficulty in leading zero *bits* (not hex characters). */
export const DEFAULT_BITS = 22;

/** Difficulties offered in the options UI. 0 means "disabled". */
export const SELECTABLE_BITS = [0, 18, 20, 22, 24, 26];

/**
 * Hard verification limits. A remote party declares `bits` itself, so verification must never scale its own work with
 * that value. Verification is always exactly one hash, but we still refuse absurd declarations outright.
 */
export const MAX_ACCEPTED_DIFFICULTY = 30;
export const MIN_ACCEPTED_DIFFICULTY = 1;

/** Anti-DoS limits for parsing untrusted headers. */
export const MAX_HEADER_LENGTH = 512;
export const MAX_HEADERS_PER_MESSAGE = 8;
export const MAX_FIELDS_PER_HEADER = 16;
export const MAX_NONCE_DIGITS = 20;
export const MIN_SALT_HEX = 16;
export const MAX_SALT_HEX = 64;
export const MAX_MESSAGE_ID_LENGTH = 200;
export const MAX_RECIPIENT_LENGTH = 254;

/** Tolerance for clocks running ahead of ours. */
export const MAX_CLOCK_SKEW_MS = 60 * 60 * 1000;

/** Default acceptance window for incoming proofs. */
export const DEFAULT_MAX_AGE_DAYS = 7;

/** Salt size in bytes. The salt makes precomputation against a known recipient useless. */
export const SALT_BYTES = 16;

/** Separator used when building the hash preimage, so fields cannot be shifted into each other. */
export const FIELD_SEPARATOR = "|";

/** Outcome of verifying a single message. */
export const VerificationStatus = {
  VALID: "valid",
  INVALID: "invalid",
  MISSING: "missing"
};

/** Machine-readable reasons, used for UI strings and tests. */
export const Reason = {
  OK: "ok",
  NO_HEADER: "no-header",
  MALFORMED: "malformed",
  UNSUPPORTED_VERSION: "unsupported-version",
  UNSUPPORTED_ALGORITHM: "unsupported-algorithm",
  DIFFICULTY_OUT_OF_RANGE: "difficulty-out-of-range",
  DIFFICULTY_TOO_LOW: "difficulty-too-low",
  EXPIRED: "expired",
  FUTURE_TIMESTAMP: "future-timestamp",
  RECIPIENT_MISMATCH: "recipient-mismatch",
  MESSAGE_ID_MISMATCH: "message-id-mismatch",
  INSUFFICIENT_WORK: "insufficient-work",
  REPLAY: "replay"
};
