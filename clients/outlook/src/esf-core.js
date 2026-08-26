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
  probeWorkBase,
  recipientToken,
  searchNonce,
  senderToken,
  unixSeconds
} from "../../thunderbird/src/protocol/stamp.js";

/**
 * Estimation helpers. Pure arithmetic over a measured hash rate, with no client API in sight, so both clients derive
 * the same difficulty from the same measurement instead of each inventing its own curve.
 */
export {
  autoDifficulty,
  blendRate,
  expectedSeconds,
  formatRate,
  formatSeconds,
  hashRate
} from "../../thunderbird/src/utils/estimate.js";

export { parseStamp, parseStampList, serializeStamp, serializeStampList } from "../../thunderbird/src/protocol/parser.js";

export { stampId, verifyMessageStamps, verifyStamp } from "../../thunderbird/src/protocol/verifier.js";

export { receiverPolicy, resolveOutgoingDifficulty } from "../../thunderbird/src/protocol/policy.js";

export { countLeadingZeroBits, randomHex, sha256, toBase64Url, toHex } from "../../thunderbird/src/protocol/hash.js";

// --- Shared client logic and product wording ---------------------------------------------------------------------
// Not protocol, but equally shared: whether it makes sense to talk to a sender, the wording used to do it, and the
// feedback floor that makes an instant verification visible. Copying any of it would let the two clients drift into
// warning users differently about the same risk, so the Outlook adapter imports it through this surface too.

export { classifySender } from "../../thunderbird/src/utils/sender.js";

export {
  SUGGESTION,
  SUGGESTION_LABELS,
  SUGGESTION_NOTE,
  TEXT_LANGUAGES,
  suggestionFor,
  textLanguage
} from "../../thunderbird/src/ui/strings.js";

// footerFor picks the German or English footer. Both clients read the same table, so a recipient cannot tell from
// the footer which add-on sent the message - only which language its sender writes in.
export { PROJECT_URL, footerFor } from "../../thunderbird/src/utils/footer.js";

export { MINIMUM_FEEDBACK_MS, atLeast } from "../../thunderbird/src/utils/timing.js";
