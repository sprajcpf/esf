/**
 * ESF-Stamp protocol constants, following the ESF v1.0 Technical Whitepaper (section 6).
 *
 * This module (and everything else in src/protocol/) is deliberately free of any Thunderbird API usage, so the same
 * protocol core and test vectors can be reused by other clients, gateways and filters - which the whitepaper lists
 * as a protocol requirement (section 4.1).
 */

/** Protocol version. Whitepaper 6.2: v MUST be 1. */
export const PROTOCOL_VERSION = 1;
export const SUPPORTED_VERSIONS = new Set([1]);

/**
 * Header field name.
 *
 * The standards-track target is `ESF-Stamp` (RFC 6648 deprecates X- names), but Thunderbird's compose customHeaders
 * API only accepts X- prefixed names, so the prototype transports `X-ESF-Stamp` and accepts both on receipt.
 * Whitepaper 6, 10.1 and appendix C.
 */
export const HEADER_NAME = "X-ESF-Stamp";
export const STANDARD_HEADER_NAME = "ESF-Stamp";
export const ACCEPTED_HEADER_NAMES = [HEADER_NAME.toLowerCase(), STANDARD_HEADER_NAME.toLowerCase()];

/** Canonical work-input prefix (whitepaper 6.4). */
export const WORK_PREFIX = "ESF1";

/** Work profiles. ESF v1 names sha256 and argon2id; only sha256 is implemented here. */
export const ALGORITHM_SHA256 = "sha256";
export const ALGORITHM_ARGON2ID = "argon2id";
export const IMPLEMENTED_ALGORITHMS = new Set([ALGORITHM_SHA256]);
/** Profiles that exist in ESF v1 but are not implemented locally: they map to "unsupported", never to invalid. */
export const KNOWN_ALGORITHMS = new Set([ALGORITHM_SHA256, ALGORITHM_ARGON2ID]);

/** Difficulty offered in the options UI. 0 disables generation. */
export const SELECTABLE_DIFFICULTY = [0, 18, 20, 22, 24, 26];
/**
 * Default difficulty. Whitepaper 7.1 is explicit that a fixed global number is a prototype convenience, not policy,
 * so this is chosen to fit the default one-second compute budget: measured inside Thunderbird at roughly 300k
 * hashes/s across two workers, 18 bits completes within a second about two thirds of the time, while 22 bits would
 * only make it in about one send in fourteen - which would leave almost every message unstamped.
 */
export const DEFAULT_DIFFICULTY = 18;

/**
 * Verification bounds. Difficulty is declared by an untrusted sender, so the verifier applies its own bounds and
 * never derives any amount of work from the declared value (whitepaper 6.7 step 4, 12).
 */
export const MAX_DECLARED_DIFFICULTY = 30;
export const MIN_DECLARED_DIFFICULTY = 1;

/** Anti-DoS limits applied before any cryptographic work (whitepaper 6.7 steps 1-2). */
export const MAX_STAMP_LENGTH = 512;
export const MAX_HEADER_TOTAL_LENGTH = 4096;
export const MAX_STAMPS_PER_MESSAGE = 8;
export const MAX_STAMPS_PER_HEADER = 16;
export const MAX_FIELDS_PER_STAMP = 20;
export const MAX_NONCE_HEX = 64;
export const MIN_SALT_HEX = 16;
export const MAX_SALT_HEX = 64;
export const TOKEN_LENGTH = 43; // BASE64URL of a 32 byte digest, unpadded

/**
 * Freshness (whitepaper 6.7 step 5).
 *
 * A stamp does not expire by default: a proof of work stays a proof of work, and a valid result that silently turns
 * red after a week is confusing and makes stored mail unverifiable. A receiver can still opt into a window, which is
 * what the whitepaper's DNS `maxage` tag advertises. See NO_EXPIRY.
 */
export const MAX_CLOCK_SKEW_MS = 60 * 60 * 1000;
export const NO_EXPIRY = 0;
export const DEFAULT_MAX_AGE_DAYS = NO_EXPIRY;

/**
 * How long the replay ledger remembers a stamp. With no acceptance window this can no longer follow it, so it is a
 * separate, explicit retention: replay detection is exact within it and best-effort beyond.
 */
export const REPLAY_RETENTION_DAYS = 180;

/** Salt size in bytes. Whitepaper 6.2: at least 64 bits, 128 recommended. */
export const SALT_BYTES = 16;

/**
 * Several stamps of one message travel in a single header value, comma separated.
 *
 * The whitepaper (6.9) describes one ESF-Stamp field per recipient. Thunderbird's customHeaders API keeps only one
 * header per name, so the prototype folds them into one field; both forms are accepted on receipt.
 */
export const STAMP_SEPARATOR = ", ";

/**
 * Internal validation states (whitepaper 11.1). The UI maps these onto the traffic light; automation needs the
 * finer distinction, because a legacy sender without ESF is not the same as a forged stamp.
 */
export const StampState = {
  STRONG: "strong",
  WEAK: "weak",
  MISSING: "missing",
  INVALID: "invalid",
  UNSUPPORTED: "unsupported"
};

/** Traffic light (whitepaper 11). */
export const Signal = {
  GREEN: "green",
  YELLOW: "yellow",
  RED: "red"
};

/** Whitepaper 11.1: strong -> green, weak/unsupported -> yellow, missing/invalid -> red. */
export const SIGNAL_BY_STATE = {
  [StampState.STRONG]: Signal.GREEN,
  [StampState.WEAK]: Signal.YELLOW,
  [StampState.UNSUPPORTED]: Signal.YELLOW,
  [StampState.MISSING]: Signal.RED,
  [StampState.INVALID]: Signal.RED
};

/** Machine-readable reasons behind a state. Used for UI strings, automation and tests. */
export const Reason = {
  OK: "ok",
  NO_STAMP: "no-stamp",
  MALFORMED: "malformed",
  UNSUPPORTED_VERSION: "unsupported-version",
  UNSUPPORTED_ALGORITHM: "unsupported-algorithm",
  DIFFICULTY_OUT_OF_RANGE: "difficulty-out-of-range",
  BELOW_POLICY: "below-policy",
  STALE: "stale",
  FUTURE_TIMESTAMP: "future-timestamp",
  WRONG_RECIPIENT: "wrong-recipient",
  SENDER_MISMATCH: "sender-mismatch",
  MESSAGE_MISMATCH: "message-mismatch",
  INSUFFICIENT_WORK: "insufficient-work",
  REPLAY: "replay"
};
