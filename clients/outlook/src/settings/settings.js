/**
 * Settings storage on Office.context.roamingSettings, so the configuration follows the mailbox across Outlook
 * clients. Defaults and clamping mirror the Thunderbird client (clients/thunderbird/src/utils/settings.js), so both
 * reference implementations behave the same out of the box.
 */

import { DEFAULT_DIFFICULTY, DEFAULT_MAX_AGE_DAYS, SELECTABLE_DIFFICULTY } from "../esf-core.js";

const STORAGE_KEY = "esfSettings";

export const DEFAULTS = Object.freeze({
  /** Master switch for outgoing stamp generation. Verification of incoming mail stays active. */
  enabled: true,
  /** Baseline outgoing difficulty in leading zero bits; 0 disables generation. */
  outgoingDifficulty: DEFAULT_DIFFICULTY,
  /**
   * Wall-clock budget per recipient. Deliberately short so sending stays snappy: Outlook shows its own "taking long"
   * dialog after about five seconds, and the Smart Alerts runtime hard-limits the whole handler to ~5 minutes.
   * Mirrors the Thunderbird default, and pairs with the shared 18 bit baseline.
   */
  maxComputeSeconds: 1,
  /** Incoming stamps older than this are rejected (whitepaper 6.7 step 5). */
  maxStampAgeDays: DEFAULT_MAX_AGE_DAYS,
  /** Below this difficulty a valid stamp counts as weak/yellow rather than strong/green. */
  minIncomingDifficulty: 18,
  /**
   * What to do when a proof cannot be produced in time: "send-without" keeps mail flowing (an informational notice
   * is added), "block" completes the send event with allowEvent=false so the Smart Alerts dialog appears. There is
   * no "ask" here: an event handler cannot open its own dialogs, the Smart Alerts dialog is the ask.
   */
  onSendFailure: "send-without",
  /** Bcc handling: "omit" (whitepaper fallback) or "token" (include the salted rid). See composeSigner in TB. */
  bccMode: "omit",
  /**
   * Own addresses besides the signed-in mailbox (aliases, plus-addresses). Office.js cannot enumerate aliases, and a
   * stamp binds the exact mailbox the sender used, so aliases must be declared to verify green.
   */
  aliasMailboxes: [],
  debugLogging: false
});

/** Clamps and type-checks stored values, so a corrupted mailbox setting cannot produce nonsensical behaviour. */
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
    onSendFailure: input.onSendFailure === "block" ? "block" : "send-without",
    bccMode: input.bccMode === "token" ? "token" : "omit",
    aliasMailboxes: Array.isArray(input.aliasMailboxes)
      ? input.aliasMailboxes.filter(entry => typeof entry === "string").slice(0, 32)
      : [],
    debugLogging: input.debugLogging === true
  };
}

/** @returns {typeof DEFAULTS} synchronous read; roamingSettings is an in-memory copy loaded with the add-in */
export function loadSettings() {
  try {
    const roaming = globalThis.Office?.context?.roamingSettings;
    return normalizeSettings(roaming ? roaming.get(STORAGE_KEY) : null);
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Merges a partial update and persists it to the mailbox.
 *
 * @param {Partial<typeof DEFAULTS>} patch
 * @returns {Promise<typeof DEFAULTS>}
 */
export async function saveSettings(patch) {
  const next = normalizeSettings({ ...loadSettings(), ...patch });
  const roaming = globalThis.Office?.context?.roamingSettings;
  if (roaming) {
    roaming.set(STORAGE_KEY, next);
    await new Promise(resolve => roaming.saveAsync(() => resolve()));
  }
  return next;
}

function clamp(value, min, max, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}
