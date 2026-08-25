/** Settings storage. Thin wrapper around browser.storage.local so every consumer sees the same defaults. */

import { DEFAULT_DIFFICULTY, DEFAULT_MAX_AGE_DAYS, SELECTABLE_DIFFICULTY } from "../protocol/constants.js";

const STORAGE_KEY = "settings";

export const DEFAULTS = Object.freeze({
  /** Master switch for outgoing stamp generation. Verification of incoming mail stays active. */
  enabled: true,
  /** Baseline outgoing difficulty in leading zero bits; 0 disables generation. */
  outgoingDifficulty: DEFAULT_DIFFICULTY,
  /** Wall-clock budget per recipient before the user is asked what to do. */
  maxComputeSeconds: 5,
  /** Incoming stamps older than this are rejected (whitepaper 6.7 step 5). */
  maxStampAgeDays: DEFAULT_MAX_AGE_DAYS,
  /** Below this difficulty a valid stamp counts as weak/yellow rather than strong/green. */
  minIncomingDifficulty: 18,
  /** Show the traffic light on displayed messages. */
  showBadge: true,
  /**
   * Feed a red result into Thunderbird's junk flag. Off by default: during adoption a missing stamp must not be
   * treated as malicious (whitepaper 10.1, 11).
   */
  junkOnRed: false,
  /** Reserved for the trust-aware policy in src/protocol/policy.js. */
  trustAwareDifficulty: false,
  /** Bcc handling: "omit" (whitepaper fallback) or "token" (include the salted rid). */
  bccMode: "omit",
  /** 0 means auto: min(2, cores - 1). Never consume every core by default (whitepaper 13). */
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
  const outgoingDifficulty = Number(input.outgoingDifficulty);
  return {
    ...DEFAULTS,
    ...input,
    enabled: input.enabled !== false,
    outgoingDifficulty: SELECTABLE_DIFFICULTY.includes(outgoingDifficulty)
      ? outgoingDifficulty
      : DEFAULTS.outgoingDifficulty,
    maxComputeSeconds: clamp(Number(input.maxComputeSeconds), 1, 120, DEFAULTS.maxComputeSeconds),
    maxStampAgeDays: clamp(Number(input.maxStampAgeDays), 1, 365, DEFAULTS.maxStampAgeDays),
    minIncomingDifficulty: clamp(Number(input.minIncomingDifficulty), 1, 30, DEFAULTS.minIncomingDifficulty),
    maxWorkers: clamp(Number(input.maxWorkers), 0, 32, DEFAULTS.maxWorkers),
    showBadge: input.showBadge !== false,
    junkOnRed: input.junkOnRed === true,
    trustAwareDifficulty: input.trustAwareDifficulty === true,
    debugLogging: input.debugLogging === true,
    bccMode: input.bccMode === "token" ? "token" : "omit",
    onTimeout: ["ask", "send-without", "cancel"].includes(input.onTimeout) ? input.onTimeout : DEFAULTS.onTimeout
  };
}

function clamp(value, min, max, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Number of workers for a nonce search. Leaves at least one core to Thunderbird itself.
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
