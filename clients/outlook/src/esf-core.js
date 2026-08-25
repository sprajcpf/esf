/**
 * Single import surface for the shared ESF protocol core.
 *
 * The protocol implementation lives in clients/thunderbird/src/protocol/ and is deliberately free of any client API
 * usage (see the note at the top of constants.js). This module re-exports it so the Outlook adapter never grows its
 * own copy of the protocol; the build bundles the files, the tests import them directly. When the core moves to
 * packages/esf-core, only the paths below change.
 */

export {
  ACCEPTED_HEADER_NAMES,
  ALGORITHM_ARGON2ID,
  ALGORITHM_SHA256,
  DEFAULT_DIFFICULTY,
  DEFAULT_MAX_AGE_DAYS,
  DEFAULT_STAMP_TO_MESSAGE_HOURS,
  HEADER_NAME,
  IMPLEMENTED_ALGORITHMS,
  KNOWN_ALGORITHMS,
  MAX_DECLARED_DIFFICULTY,
  MAX_HEADER_TOTAL_LENGTH,
  NO_EXPIRY,
  PROTOCOL_VERSION,
  REPLAY_RETENTION_DAYS,
  Reason,
  SELECTABLE_DIFFICULTY,
  SIGNAL_BY_STATE,
  Signal,
  STANDARD_HEADER_NAME,
  StampState
} from "../../thunderbird/src/protocol/constants.js";

export {
  buildWorkBase,
  canonicalMailbox,
  generateSalt,
  generateStamp,
  messageIdToken,
  normalizeMessageId,
  recipientToken,
  searchNonce,
  senderToken,
  unixSeconds
} from "../../thunderbird/src/protocol/stamp.js";

export { parseStamp, parseStampList, serializeStamp, serializeStampList } from "../../thunderbird/src/protocol/parser.js";

export { stampId, verifyMessageStamps, verifyStamp } from "../../thunderbird/src/protocol/verifier.js";

export { receiverPolicy, resolveOutgoingDifficulty } from "../../thunderbird/src/protocol/policy.js";

export { countLeadingZeroBits, randomHex, sha256, toBase64Url, toHex } from "../../thunderbird/src/protocol/hash.js";
