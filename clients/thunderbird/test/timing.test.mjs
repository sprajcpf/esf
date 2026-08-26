/**
 * The feedback floor: an operation faster than perception has to be *held*, not faked.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { MINIMUM_FEEDBACK_MS, atLeast } from "../src/utils/timing.js";

const elapsed = async work => {
  const started = Date.now();
  const value = await work();
  return { value, ms: Date.now() - started };
};

test("an instant result is held back until the floor has passed", async () => {
  const { value, ms } = await elapsed(() => atLeast(Promise.resolve("verified"), 120));
  assert.equal(value, "verified");
  assert.ok(ms >= 115, `resolved after ${ms} ms, expected at least the 120 ms floor`);
});

test("work slower than the floor is not delayed any further", async () => {
  const slow = new Promise(resolve => setTimeout(() => resolve("late"), 150));
  const { value, ms } = await elapsed(() => atLeast(slow, 20));
  assert.equal(value, "late");
  assert.ok(ms < 300, `resolved after ${ms} ms; the floor must not add to a slow operation`);
});

test("a rejection is held back the same way, so an error cannot flash past", async () => {
  const started = Date.now();
  await assert.rejects(() => atLeast(Promise.reject(new Error("boom")), 100), /boom/);
  assert.ok(Date.now() - started >= 95, "an error message needs to be readable too");
});

test("a zero or negative floor is allowed and simply does not wait", async () => {
  const { value } = await elapsed(() => atLeast(Promise.resolve(1), 0));
  assert.equal(value, 1);
  assert.equal(await atLeast(Promise.resolve(2), -50), 2);
});

test("the default floor is long enough to register and short enough not to annoy", () => {
  assert.ok(MINIMUM_FEEDBACK_MS >= 300, "shorter than this is not reliably noticed");
  assert.ok(MINIMUM_FEEDBACK_MS <= 800, "longer than this reads as the add-on being slow");
});
