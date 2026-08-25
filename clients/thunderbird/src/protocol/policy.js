/**
 * Difficulty policy. Version 1 ships a static policy; the shape below is the extension point for adaptive rules
 * (address book lookups, reputation, bulk detection) without touching the send path.
 */

/** How a peer is classified. Only UNKNOWN is produced by the static policy. */
export const PeerClass = {
  KNOWN_CONTACT: "known-contact",
  TRUSTED: "trusted",
  UNKNOWN: "unknown",
  SUSPICIOUS: "suspicious",
  BULK: "bulk"
};

/** Difficulty offsets/overrides per class, expressed relative to the configured base difficulty. */
export const ADAPTIVE_OUTGOING = {
  [PeerClass.KNOWN_CONTACT]: { mode: "absolute", bits: 0 },
  [PeerClass.TRUSTED]: { mode: "absolute", bits: 0 },
  [PeerClass.UNKNOWN]: { mode: "base", delta: 0 },
  [PeerClass.SUSPICIOUS]: { mode: "base", delta: 2 },
  [PeerClass.BULK]: { mode: "base", delta: 2 }
};

/**
 * Classifies an outgoing recipient. The static policy treats everyone as unknown, which yields the configured base
 * difficulty. Replace/extend this function to add address-book or reputation driven behaviour.
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
 * @returns {{bits: number, peerClass: string}}
 */
export function resolveOutgoingBits({ recipient, recipientCount, settings }) {
  const base = Number(settings.outgoingBits) || 0;
  if (base <= 0) {
    return { bits: 0, peerClass: PeerClass.UNKNOWN };
  }
  if (!settings.adaptiveDifficulty) {
    return { bits: base, peerClass: PeerClass.UNKNOWN };
  }
  const peerClass = classifyRecipient({ recipient, recipientCount, settings });
  const rule = ADAPTIVE_OUTGOING[peerClass] || { mode: "base", delta: 0 };
  const bits = rule.mode === "absolute" ? rule.bits : Math.max(0, base + rule.delta);
  return { bits, peerClass };
}

/**
 * Minimum difficulty an incoming proof must carry to be counted as valid. Kept separate from the outgoing setting so
 * that a user may send 24 bit proofs while still accepting 18 bit ones.
 *
 * @param {object} settings
 * @returns {number}
 */
export function resolveIncomingMinBits(settings) {
  const configured = Number(settings.minIncomingBits);
  return Number.isInteger(configured) && configured > 0 ? configured : 1;
}
