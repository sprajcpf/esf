/**
 * Difficulty and receiver policy (whitepaper 7.1 "difficulty is policy, not a universal constant" and 7.3
 * trust-aware difficulty).
 *
 * v1 of this client ships the static policy: every unknown peer gets the configured baseline. The shape below is the
 * extension point for trust-aware rules (address book, previous replies, DKIM-authenticated organisations,
 * reputation) without touching the send path.
 */

import { ALGORITHM_SHA256 } from "./constants.js";

/** Peer classes of whitepaper 7.3. */
export const PeerClass = {
  KNOWN_CONTACT: "known-contact",
  REPLIED_TO: "replied-to",
  TRUSTED_ORGANISATION: "trusted-organisation",
  UNKNOWN: "unknown",
  SUSPICIOUS: "suspicious",
  CONSENTED_BULK: "consented-bulk"
};

/**
 * Outgoing rules per class. `absolute` pins a value (0 = no work), `relative` shifts the configured baseline.
 * Whitepaper 7.3: do not charge every message equally, and do not waste computation on consented streams.
 */
export const OUTGOING_RULES = {
  [PeerClass.KNOWN_CONTACT]: { mode: "absolute", difficulty: 0 },
  [PeerClass.REPLIED_TO]: { mode: "absolute", difficulty: 0 },
  [PeerClass.TRUSTED_ORGANISATION]: { mode: "absolute", difficulty: 0 },
  [PeerClass.UNKNOWN]: { mode: "relative", delta: 0 },
  [PeerClass.SUSPICIOUS]: { mode: "relative", delta: 2 },
  [PeerClass.CONSENTED_BULK]: { mode: "absolute", difficulty: 0 }
};

/**
 * Classifies an outgoing recipient. The static policy treats everyone as unknown, which yields the configured
 * baseline difficulty. Replace or extend this to add trust-aware behaviour.
 *
 * @param {{recipient: string, recipientCount: number, settings: object}} _input
 * @returns {string} a PeerClass value
 */
export function classifyRecipient(_input) {
  return PeerClass.UNKNOWN;
}

/**
 * Resolves the difficulty for one outgoing recipient.
 *
 * @param {object} params
 * @param {string} params.recipient
 * @param {number} params.recipientCount
 * @param {object} params.settings
 * @param {number} [params.calibrated] difficulty chosen for this machine in automatic mode
 * @returns {{difficulty: number, peerClass: string}}
 */
export function resolveOutgoingDifficulty({ recipient, recipientCount, settings, calibrated }) {
  // In automatic mode the baseline is whatever this machine can do inside the user's time budget; the caller
  // measures that and passes it in, because the protocol layer knows nothing about the local machine.
  const baseline = settings.difficultyMode === "auto" && Number.isInteger(calibrated)
    ? calibrated
    : Number(settings.outgoingDifficulty) || 0;
  if (baseline <= 0) {
    return { difficulty: 0, peerClass: PeerClass.UNKNOWN };
  }
  if (!settings.trustAwareDifficulty) {
    return { difficulty: baseline, peerClass: PeerClass.UNKNOWN };
  }
  const peerClass = classifyRecipient({ recipient, recipientCount, settings });
  const rule = OUTGOING_RULES[peerClass] || { mode: "relative", delta: 0 };
  const difficulty = rule.mode === "absolute" ? rule.difficulty : Math.max(0, baseline + rule.delta);
  return { difficulty, peerClass };
}

/**
 * Receiver policy for verification: which profiles are accepted and what counts as strong.
 *
 * Difficulty numbers are profile specific and MUST NOT be compared across work functions (whitepaper 7.2), hence the
 * per-profile minimum.
 *
 * @param {object} settings
 * @returns {{minDifficulty: (algorithm: string) => number, acceptedAlgorithms: string[]}}
 */
export function receiverPolicy(settings) {
  const configured = Number(settings.minIncomingDifficulty);
  const sha256Minimum = Number.isInteger(configured) && configured > 0 ? configured : 1;
  return {
    acceptedAlgorithms: [ALGORITHM_SHA256],
    minDifficulty(algorithm) {
      return algorithm === ALGORITHM_SHA256 ? sha256Minimum : 1;
    }
  };
}
