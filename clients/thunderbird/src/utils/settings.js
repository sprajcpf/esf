/** Settings storage. Thin, typed wrapper around browser.storage.local so every consumer sees the same defaults. */

import { DEFAULT_BITS, DEFAULT_MAX_AGE_DAYS, SELECTABLE_BITS } from "../protocol/constants.js";

const STORAGE_KEY = "settings";

export const DEFAULTS = Object.freeze({
  /** Master switch for outgoing proof generation. Verification of incoming mail stays active. */
  enabled: true,
  /** Outgoing difficulty in leading zero bits; 0 disables generation. */
  outgoingBits: DEFAULT_BITS,
  /** Wall-clock budget for one send before the user is asked what to do. */
  maxComputeSeconds: 5,
  /** Incoming proofs older than this are rejected. */
  maxProofAgeDays: DEFAULT_MAX_AGE_DAYS,
  /** Lowest difficulty accepted from a sender. */
  minIncomingBits: 18,
  /** Show the verification badge on the message display button. */
  showBadge: true,
  /** Mark messages without a valid proof as junk. Off by default - a missing proof is not evidence of spam. */
  markMissingAsJunk: false,
  /** Reserved for the adaptive policy in src/protocol/policy.js. */
  adaptiveDifficulty: false,
  /** How Bcc recipients are handled: "hashed" (rid=) or "skip" (no proof for Bcc). */
  bccMode: "hashed",
  /** 0 means auto: min(2, hardwareConcurrency - 1). */
  maxWorkers: 0,
  /** What to do when the compute budget is exhausted: "ask" | "send-without" | "cancel". */
  onTimeout: "ask",
  debugLogging: false
});

/** @returns {Promise<typeof DEFAULTS>} */
export async function loadSettings() {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  return normalizeSettings(stored[STORAGE_KEY]);
}

/**
 * Merges a partial update into the stored settings.
 *
 * @param {Partial<typeof DEFAULTS>} patch
 * @returns {Promise<typeof DEFAULTS>}
 */
export async function saveSettings(patch) {
  const current = await loadSettings();
  const next = normalizeSettings({ ...current, ...patch });
  await browser.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

/** Clamps and type-checks stored values, so a corrupted profile cannot produce nonsensical behaviour. */
export function normalizeSettings(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const outgoingBits = Number(input.outgoingBits);
  const settings = {
    ...DEFAULTS,
    ...input,
    enabled: input.enabled !== false,
    outgoingBits: SELECTABLE_BITS.includes(outgoingBits) ? outgoingBits : DEFAULTS.outgoingBits,
    maxComputeSeconds: clamp(Number(input.maxComputeSeconds), 1, 120, DEFAULTS.maxComputeSeconds),
    maxProofAgeDays: clamp(Number(input.maxProofAgeDays), 1, 365, DEFAULTS.maxProofAgeDays),
    minIncomingBits: clamp(Number(input.minIncomingBits), 1, 30, DEFAULTS.minIncomingBits),
    maxWorkers: clamp(Number(input.maxWorkers), 0, 32, DEFAULTS.maxWorkers),
    showBadge: input.showBadge !== false,
    markMissingAsJunk: input.markMissingAsJunk === true,
    adaptiveDifficulty: input.adaptiveDifficulty === true,
    debugLogging: input.debugLogging === true,
    bccMode: input.bccMode === "skip" ? "skip" : "hashed",
    onTimeout: ["ask", "send-without", "cancel"].includes(input.onTimeout) ? input.onTimeout : DEFAULTS.onTimeout
  };
  return settings;
}

function clamp(value, min, max, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Number of workers to use for a nonce search. Leaves at least one core to Thunderbird itself.
 *
 * @param {typeof DEFAULTS} settings
 * @param {number} [concurrency]
 */
export function resolveWorkerCount(settings, concurrency = globalThis.navigator?.hardwareConcurrency || 2) {
  if (settings.maxWorkers > 0) {
    return Math.max(1, Math.min(settings.maxWorkers, concurrency));
  }
  return Math.max(1, Math.min(2, concurrency - 1));
}

/** Registers a callback invoked whenever settings change in any extension context. */
export function onSettingsChanged(callback) {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEY]) {
      callback(normalizeSettings(changes[STORAGE_KEY].newValue));
    }
  });
}
