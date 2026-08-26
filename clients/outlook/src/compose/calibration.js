/**
 * What this machine can do, remembered between sends.
 *
 * Automatic difficulty needs a hash rate, and the cheapest place to get one is the work the add-in does anyway: every
 * send measures itself and folds the result into a stored average. No benchmark, no separate button, no telemetry -
 * the number never leaves the mailbox. Mirrors clients/thunderbird/src/utils/calibration.js.
 *
 * Storage is Office.context.roamingSettings, the same store settings.js uses, because it is the only persistence an
 * OnMessageSend handler reliably has: the classic Windows event runtime has no DOM and therefore no localStorage or
 * IndexedDB, and browser.storage does not exist in Office.js at all.
 *
 * That store roams, which is the awkward part: one mailbox opened on a fast desktop and a slow laptop shares it. So
 * the rate is stored per machine indicator rather than globally (see machineKey), and a stored rate is treated as
 * stale after a month, so wrong-machine and changed-hardware cases correct themselves within a few sends instead of
 * pinning a laptop to a desktop's difficulty forever.
 */

import { blendRate } from "../esf-core.js";

const STORAGE_KEY = "esfCalibration";

/** A stored rate older than this is re-measured opportunistically: hardware and power profiles change. */
export const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/** How many machine entries to keep. Bounded because roamingSettings is a small per-mailbox blob, not a database. */
const MAX_ENTRIES = 8;

/**
 * @typedef {object} Calibration
 * @property {number} rate hashes per second, 0 when unknown
 * @property {string} key machine indicator the rate was measured on
 * @property {number} measuredAt
 * @property {number} samples
 */

/**
 * Crude per-machine discriminator for the stored rate.
 *
 * The nonce search here is single-threaded - the event runtime has no worker pool - so core count does not scale the
 * rate the way a worker count does in Thunderbird. It is used anyway because it is the only machine property Office.js
 * offers for free, and it separates the common "desktop plus laptop on one mailbox" case. Where it is unavailable
 * (the JavaScript-only runtime need not expose navigator) everything shares one entry, which the staleness rule and
 * the moving average still keep usable.
 *
 * @param {number} [concurrency]
 * @returns {string}
 */
export function machineKey(concurrency = globalThis.navigator?.hardwareConcurrency) {
  return Number.isFinite(concurrency) && concurrency > 0 ? `hc${Math.min(128, Math.round(concurrency))}` : "unknown";
}

/** The roamingSettings bag, or null where the add-in runs without one (tests, degraded runtimes). */
function defaultStore() {
  try {
    return globalThis.Office?.context?.roamingSettings || null;
  } catch {
    return null;
  }
}

/**
 * Reads the stored rate. Synchronous like loadSettings, because roamingSettings is an in-memory copy loaded with the
 * add-in - which is what makes it usable on the send path without adding a round trip.
 *
 * @param {string} [key]
 * @param {object|null} [store] injectable roamingSettings stand-in
 * @returns {Calibration}
 */
export function loadCalibration(key = machineKey(), store = defaultStore()) {
  try {
    const stored = store ? store.get(STORAGE_KEY) : null;
    const entry = stored && typeof stored === "object" ? stored[key] : null;
    if (entry && Number.isFinite(entry.rate) && entry.rate > 0) {
      return { rate: entry.rate, key, measuredAt: entry.measuredAt || 0, samples: entry.samples || 1 };
    }
  } catch (error) {
    console.warn("[esf] cannot read the calibration", error);
  }
  return { rate: 0, key, measuredAt: 0, samples: 0 };
}

/**
 * Records a measurement from a completed search and persists it.
 *
 * @param {number} rate hashes per second
 * @param {string} [key]
 * @param {object|null} [store]
 * @returns {Promise<number>} the blended rate now stored, 0 when nothing was stored
 */
export async function recordMeasurement(rate, key = machineKey(), store = defaultStore()) {
  if (!Number.isFinite(rate) || rate <= 0 || !store) {
    return 0;
  }
  try {
    const stored = store.get(STORAGE_KEY);
    const bag = stored && typeof stored === "object" ? { ...stored } : {};
    const previous = bag[key] || {};
    const blended = blendRate(previous.rate || 0, rate);
    bag[key] = { rate: blended, measuredAt: Date.now(), samples: (previous.samples || 0) + 1 };
    store.set(STORAGE_KEY, prune(bag, key));
    await new Promise(resolve => {
      try {
        store.saveAsync(() => resolve());
      } catch (error) {
        // A failed persist costs the next send a fresh probe, nothing more - never the send itself.
        console.warn("[esf] cannot store the calibration", error);
        resolve();
      }
    });
    return blended;
  } catch (error) {
    console.warn("[esf] cannot store the calibration", error);
    return 0;
  }
}

/** Whether a stored rate is old enough that a fresh measurement is worth preferring. */
export function isStale(calibration, now = Date.now()) {
  return !calibration || !calibration.measuredAt || now - calibration.measuredAt > STALE_AFTER_MS;
}

/** Keeps the newest MAX_ENTRIES machines, never dropping the one just measured. */
function prune(bag, keep) {
  const keys = Object.keys(bag);
  if (keys.length <= MAX_ENTRIES) {
    return bag;
  }
  const ordered = keys
    .filter(key => key !== keep)
    .sort((a, b) => (bag[b].measuredAt || 0) - (bag[a].measuredAt || 0))
    .slice(0, MAX_ENTRIES - 1);
  const pruned = { [keep]: bag[keep] };
  for (const key of ordered) {
    pruned[key] = bag[key];
  }
  return pruned;
}
