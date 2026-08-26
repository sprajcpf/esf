/**
 * What this machine can do, remembered between sends.
 *
 * Automatic difficulty needs a hash rate, and the cheapest place to get one is the work the add-on does anyway:
 * every send measures itself and folds the result into a stored average. No benchmark, no separate button, no
 * telemetry - the number never leaves the profile.
 *
 * The rate is stored per worker count, because that is the one setting that changes it by a factor rather than a few
 * percent.
 */

import { blendRate } from "./estimate.js";
import { createLogger } from "./log.js";

const log = createLogger("calibration");
const STORAGE_KEY = "calibration";

/** A stored rate older than this is kept but re-measured opportunistically: hardware and power profiles change. */
const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * @typedef {object} Calibration
 * @property {number} rate hashes per second across all workers, 0 when unknown
 * @property {number} workers worker count the rate was measured with
 * @property {number} measuredAt
 * @property {number} samples
 */

/** @returns {Promise<Calibration>} */
export async function loadCalibration(workers) {
  try {
    const stored = (await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
    const entry = stored && typeof stored === "object" ? stored[String(workers)] : null;
    if (entry && Number.isFinite(entry.rate) && entry.rate > 0) {
      return { rate: entry.rate, workers, measuredAt: entry.measuredAt || 0, samples: entry.samples || 1 };
    }
  } catch (error) {
    log.warn("cannot read the calibration", error);
  }
  return { rate: 0, workers, measuredAt: 0, samples: 0 };
}

/**
 * Records a measurement from a completed search.
 *
 * @param {number} rate hashes per second
 * @param {number} workers
 */
export async function recordMeasurement(rate, workers) {
  if (!Number.isFinite(rate) || rate <= 0) {
    return;
  }
  try {
    const stored = (await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || {};
    const previous = stored[String(workers)] || {};
    const blended = blendRate(previous.rate || 0, rate);
    stored[String(workers)] = {
      rate: blended,
      measuredAt: Date.now(),
      samples: (previous.samples || 0) + 1
    };
    await browser.storage.local.set({ [STORAGE_KEY]: stored });
    log.debug(`calibration for ${workers} worker(s): ${Math.round(blended)} hashes/s`);
  } catch (error) {
    log.warn("cannot store the calibration", error);
  }
}

/** Whether a stored rate is old enough that a fresh measurement is worth preferring. */
export function isStale(calibration, now = Date.now()) {
  return !calibration.measuredAt || now - calibration.measuredAt > STALE_AFTER_MS;
}
