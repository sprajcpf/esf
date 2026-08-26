import test from "node:test";
import assert from "node:assert/strict";

import { STALE_AFTER_MS, isStale, loadCalibration, machineKey, recordMeasurement } from "../src/compose/calibration.js";

/**
 * Stand-in for Office.context.roamingSettings: an in-memory bag with the same get/set/saveAsync shape. The real one is
 * an in-memory copy too, which is why the read side of calibration can be synchronous.
 */
function memoryRoaming() {
  const bag = new Map();
  return {
    get: key => bag.get(key),
    set: (key, value) => bag.set(key, value),
    saveAsync: callback => callback({ status: "succeeded" }),
    raw: bag
  };
}

test("machineKey separates machines by core count and survives a runtime without navigator", () => {
  assert.equal(machineKey(8), "hc8");
  // null, not undefined: undefined would fall back to the real navigator of the machine running the tests.
  assert.equal(machineKey(null), "unknown");
  assert.equal(machineKey(0), "unknown");
  assert.equal(machineKey("many"), "unknown");
});

test("an unmeasured machine reports a zero rate rather than guessing one", () => {
  const store = memoryRoaming();
  const calibration = loadCalibration("hc8", store);
  assert.equal(calibration.rate, 0);
  assert.equal(calibration.samples, 0);
  assert.equal(isStale(calibration), true);
});

test("a recorded measurement is read back and counted", async () => {
  const store = memoryRoaming();
  await recordMeasurement(500_000, "hc8", store);
  const calibration = loadCalibration("hc8", store);
  assert.equal(calibration.rate, 500_000);
  assert.equal(calibration.samples, 1);
  assert.equal(isStale(calibration), false);
});

test("further measurements are folded in as a moving average, so one unlucky send cannot halve the difficulty",
  async () => {
    const store = memoryRoaming();
    await recordMeasurement(1_000_000, "hc8", store);
    await recordMeasurement(2_000_000, "hc8", store);
    const calibration = loadCalibration("hc8", store);
    // blendRate weights the new sample at 0.3: 1.0M * 0.7 + 2.0M * 0.3.
    assert.equal(Math.round(calibration.rate), 1_300_000);
    assert.equal(calibration.samples, 2);
  });

test("machines keep separate rates, because roamingSettings roams between them", async () => {
  const store = memoryRoaming();
  await recordMeasurement(1_000_000, "hc16", store);
  await recordMeasurement(200_000, "hc4", store);
  assert.equal(loadCalibration("hc16", store).rate, 1_000_000);
  assert.equal(loadCalibration("hc4", store).rate, 200_000);
});

test("a rate older than a month counts as stale so changed hardware is re-measured", () => {
  const now = Date.now();
  assert.equal(isStale({ rate: 1, measuredAt: now - 1000 }, now), false);
  assert.equal(isStale({ rate: 1, measuredAt: now - STALE_AFTER_MS - 1 }, now), true);
  assert.equal(isStale({ rate: 1, measuredAt: 0 }, now), true);
});

test("calibration degrades quietly where roamingSettings is unavailable", async () => {
  assert.equal(loadCalibration("hc8", null).rate, 0);
  assert.equal(await recordMeasurement(500_000, "hc8", null), 0);
  // A store that throws must not take the send down with it.
  const broken = { get: () => { throw new Error("no roaming settings"); }, set: () => {}, saveAsync: () => {} };
  assert.equal(loadCalibration("hc8", broken).rate, 0);
  assert.equal(await recordMeasurement(500_000, "hc8", broken), 0);
});

test("a nonsensical measurement is discarded instead of stored", async () => {
  const store = memoryRoaming();
  await recordMeasurement(0, "hc8", store);
  await recordMeasurement(Number.NaN, "hc8", store);
  await recordMeasurement(-5, "hc8", store);
  assert.equal(loadCalibration("hc8", store).rate, 0);
});

test("the stored bag stays bounded and always keeps the machine just measured", async () => {
  const store = memoryRoaming();
  for (let cores = 1; cores <= 12; cores++) {
    await recordMeasurement(100_000 * cores, `hc${cores}`, store);
  }
  const bag = store.get("esfCalibration");
  assert.ok(Object.keys(bag).length <= 8, `expected at most 8 entries, got ${Object.keys(bag).length}`);
  assert.ok(bag.hc12, "the machine just measured must survive pruning");
});
