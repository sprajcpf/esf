/**
 * Settings storage on Office.context.roamingSettings, so the configuration follows the mailbox across Outlook
 * clients. Defaults and clamping mirror the Thunderbird client (clients/thunderbird/src/utils/settings.js), so both
 * reference implementations behave the same out of the box.
 */

import {
  DEFAULT_DIFFICULTY,
  DEFAULT_MAX_AGE_DAYS,
  DEFAULT_STAMP_TO_MESSAGE_HOURS,
  SELECTABLE_DIFFICULTY
} from "../esf-core.js";

const STORAGE_KEY = "esfSettings";

export const DEFAULTS = Object.freeze({
  /** Master switch for outgoing stamp generation. Verification of incoming mail stays active. */
  enabled: true,
  /**
   * How the outgoing difficulty is chosen.
   *
   * "auto" is the default and the point of the whole setting: the user says how long a send may take, and the
   * difficulty follows from what this machine measurably manages, adjusting upwards on a fast machine and downwards
   * on a slow one. "fixed" is for people who want a specific number and accept the wait that comes with it.
   */
  difficultyMode: "auto",
  /**
   * What a send should typically cost the user in automatic mode.
   *
   * Two seconds rather than three: this is an *expectation*, and the search is memoryless, so about a quarter of
   * sends take twice as long as the target and one in seven takes twice that again. Aiming at two keeps the tail
   * where people do not notice it - and in Outlook the tail is not merely annoying, it runs into the Smart Alerts
   * "still working" dialog after roughly five seconds.
   */
  autoTargetSeconds: 2,
  /** Difficulty used when difficultyMode is "fixed", in leading zero bits; 0 disables generation. */
  outgoingDifficulty: DEFAULT_DIFFICULTY,
  /**
   * Quiet phase per recipient, in seconds - kept for parity with the Thunderbird client, where the search shows
   * progress once it passes. An Outlook event handler has no progress surface (Outlook shows its own "taking long"
   * dialog after about five seconds), so here the search simply keeps going until askAfterSeconds.
   */
  maxComputeSeconds: 1,
  /**
   * Hard per-recipient bound, in seconds. With ESF enabled a message is meant to carry a stamp, so the search does
   * not give up after the quiet phase - it keeps working up to this bound, well below the ~5 minute Smart Alerts
   * runtime limit. Mirrors the Thunderbird askAfterSeconds; what happens then is onSendFailure.
   */
  askAfterSeconds: 15,
  /**
   * How long before its message a stamp may have been minted (whitepaper 6.7 step 5). This is the check that keeps
   * senders on a schedule: a stamp produced weeks earlier was either stockpiled or lifted off another message.
   */
  maxStampToMessageHours: DEFAULT_STAMP_TO_MESSAGE_HOURS,
  /** Optional absolute window: stamps older than this are rejected outright; 0 means they never expire (default). */
  maxStampAgeDays: DEFAULT_MAX_AGE_DAYS,
  /** Below this difficulty a valid stamp counts as weak/yellow rather than strong/green. */
  minIncomingDifficulty: 18,
  /**
   * What to do once askAfterSeconds is exhausted: "block" completes the send event with allowEvent=false, so the
   * Smart Alerts dialog asks the user (Send Anyway / Don't Send; pressing Send again retries with a fresh budget).
   * That is the Outlook equivalent of Thunderbird's "ask" default - with ESF enabled, silently sending unstamped is
   * the wrong default. "send-without" keeps mail flowing with an informational notice instead.
   */
  onSendFailure: "block",
  /**
   * Append a one-line footer naming ESF and linking the project, on messages that carry a stamp. Mirrors the
   * Thunderbird default; needs Mailbox requirement set 1.13, and is simply skipped where that is unavailable.
   */
  appendFooter: true,
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
    difficultyMode: input.difficultyMode === "fixed" ? "fixed" : "auto",
    autoTargetSeconds: clamp(Number(input.autoTargetSeconds), 1, 60, DEFAULTS.autoTargetSeconds),
    outgoingDifficulty: SELECTABLE_DIFFICULTY.includes(outgoingDifficulty)
      ? outgoingDifficulty
      : DEFAULTS.outgoingDifficulty,
    maxComputeSeconds: clamp(Number(input.maxComputeSeconds), 1, 120, DEFAULTS.maxComputeSeconds),
    askAfterSeconds: clamp(Number(input.askAfterSeconds), 2, 240, DEFAULTS.askAfterSeconds),
    maxStampToMessageHours: clamp(Number(input.maxStampToMessageHours), 1, 8760, DEFAULTS.maxStampToMessageHours),
    maxStampAgeDays: clamp(Number(input.maxStampAgeDays), 0, 3650, DEFAULTS.maxStampAgeDays),
    minIncomingDifficulty: clamp(Number(input.minIncomingDifficulty), 1, 30, DEFAULTS.minIncomingDifficulty),
    onSendFailure: input.onSendFailure === "send-without" ? "send-without" : "block",
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
