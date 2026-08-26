/** Settings storage. Thin wrapper around browser.storage.local so every consumer sees the same defaults. */

import {
  DEFAULT_DIFFICULTY,
  DEFAULT_MAX_AGE_DAYS,
  DEFAULT_STAMP_TO_MESSAGE_HOURS,
  SELECTABLE_DIFFICULTY
} from "../protocol/constants.js";

const STORAGE_KEY = "settings";

export const DEFAULTS = Object.freeze({
  /** Master switch for outgoing stamp generation. Verification of incoming mail stays active. */
  enabled: true,
  /** Baseline outgoing difficulty in leading zero bits; 0 disables generation. */
  outgoingDifficulty: DEFAULT_DIFFICULTY,
  /**
   * Quiet phase per recipient, in seconds. Most sends finish inside it and nothing is shown at all. When it passes,
   * the search keeps running and the compose button starts showing progress - it does not give up, because an
   * enabled ESF is expected to actually produce a stamp.
   */
  maxComputeSeconds: 1,
  /**
   * When to fall back on asking, in seconds. Only reached on a slow machine or a high difficulty; up to here the
   * add-on keeps working silently rather than bothering anyone.
   */
  askAfterSeconds: 15,
  /**
   * How long before its message a stamp may have been minted. This is the check that keeps senders on a schedule:
   * a stamp produced weeks earlier was either stockpiled or lifted off another message.
   */
  maxStampToMessageHours: DEFAULT_STAMP_TO_MESSAGE_HOURS,
  /** Optional absolute window: stamps older than this are rejected outright; 0 means they never expire (default). */
  maxStampAgeDays: DEFAULT_MAX_AGE_DAYS,
  /** Below this difficulty a valid stamp counts as weak/yellow rather than strong/green. */
  minIncomingDifficulty: 18,
  /**
   * Show a small window while a send is computing longer than the quiet phase. Off means the toolbar button is the
   * only indication - and that the "taking too long" question has nowhere to appear, so the configured fallback
   * applies instead.
   */
  showProgress: true,
  /** Show the traffic light on displayed messages. */
  showBadge: true,
  /**
   * Feed a red result into Thunderbird's junk flag. Off by default: during adoption a missing stamp must not be
   * treated as malicious (whitepaper 10.1, 11).
   */
  junkOnRed: false,
  /**
   * Append a one-line footer naming ESF and linking the project, on messages that carry a stamp. This is how a
   * recipient finds out what made the message verifiable, which is the only spreading mechanism ESF has.
   */
  appendFooter: true,
  /** Reserved for the trust-aware policy in src/protocol/policy.js. */
  trustAwareDifficulty: false,
  /** Bcc handling: "omit" (whitepaper fallback) or "token" (include the salted rid). */
  bccMode: "omit",
  /** 0 means auto: min(4, cores - 2). Never consume every core by default (whitepaper 13). */
  maxWorkers: 0,
  /**
   * What to do once askAfterSeconds is reached: "ask" | "send-without" | "cancel". Default "ask": with ESF enabled a
   * message is meant to carry a stamp, so giving up silently is the wrong default - but the question only comes up
   * after the add-on has genuinely run out of patience.
   */
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
    askAfterSeconds: clamp(Number(input.askAfterSeconds), 2, 600, DEFAULTS.askAfterSeconds),
    maxStampToMessageHours: clamp(Number(input.maxStampToMessageHours), 1, 8760,
      DEFAULTS.maxStampToMessageHours),
    maxStampAgeDays: clamp(Number(input.maxStampAgeDays), 0, 3650, DEFAULTS.maxStampAgeDays),
    minIncomingDifficulty: clamp(Number(input.minIncomingDifficulty), 1, 30, DEFAULTS.minIncomingDifficulty),
    maxWorkers: clamp(Number(input.maxWorkers), 0, 32, DEFAULTS.maxWorkers),
    showProgress: input.showProgress !== false,
    showBadge: input.showBadge !== false,
    junkOnRed: input.junkOnRed === true,
    appendFooter: input.appendFooter !== false,
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
 * Number of workers for a nonce search. Never takes the whole machine.
 *
 * @param {typeof DEFAULTS} settings
 * @param {number} [concurrency]
 */
export function resolveWorkerCount(settings, concurrency = globalThis.navigator?.hardwareConcurrency || 2) {
  if (settings.maxWorkers > 0) {
    return Math.max(1, Math.min(settings.maxWorkers, concurrency));
  }
  // Up to four shards, always leaving two cores to Thunderbird and the rest of the machine (whitepaper 13). More
  // shards shorten the wait proportionally, which is what makes a one-second budget worth having.
  return Math.max(1, Math.min(4, concurrency - 2));
}

/** Registers a callback invoked whenever settings change in any extension context. */
export function onSettingsChanged(callback) {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEY]) {
      callback(normalizeSettings(changes[STORAGE_KEY].newValue));
    }
  });
}
