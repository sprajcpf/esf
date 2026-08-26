/**
 * What the progress window is allowed to claim.
 *
 * The nonce search is memoryless, so the interesting tests here are about *not* over-claiming: no percentage, no
 * countdown that shrinks with work done, and an honest acknowledgement when a wait has become unusual.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  chanceWithin,
  describeProgress,
  expectedSeconds,
  formatRate,
  formatSeconds,
  hashRate
} from "../src/utils/estimate.js";
import { MEMORYLESS_EXPLANATION, MINING_EXPLANATION, PRIMARY_LABEL } from "../src/ui/strings.js";

test("hashRate measures what happened, and refuses to invent a number", () => {
  assert.equal(hashRate(300000, 1000), 300000);
  assert.equal(hashRate(150000, 500), 300000);
  assert.equal(hashRate(0, 1000), 0, "nothing measured yet");
  assert.equal(hashRate(1000, 0), 0, "no elapsed time, no rate");
  assert.equal(hashRate(NaN, 1000), 0);
});

test("expectedSeconds is 2^difficulty over the rate", () => {
  assert.equal(expectedSeconds(20, 2 ** 20), 1);
  assert.equal(Math.round(expectedSeconds(20, 300000) * 10) / 10, 3.5, "20 bits at 300k/s");
  assert.equal(Math.round(expectedSeconds(22, 300000)), 14, "22 bits costs four times as much");
  assert.equal(expectedSeconds(20, 0), Number.POSITIVE_INFINITY, "unknown rate stays unknown");
});

test("the estimate does not shrink as work is done - the search is memoryless", () => {
  const early = describeProgress({ difficulty: 20, hashes: 300000, startedAt: 0, workerCount: 2 }, 1000);
  const late = describeProgress({ difficulty: 20, hashes: 3000000, startedAt: 0, workerCount: 2 }, 10000);
  assert.equal(early.expected, late.expected,
    "same measured rate, same expectation: past attempts do not bring the result closer");
  assert.ok(late.elapsedSeconds > early.elapsedSeconds, "only the time spent grows");
});

test("a wait past twice the typical duration is marked unusual, not hidden", () => {
  const normal = describeProgress({ difficulty: 20, hashes: 300000, startedAt: 0 }, 1000);
  assert.equal(normal.unusual, false);
  // 20 bits at 300k/s is ~3.5 s expected; ten seconds in is well past twice that.
  const unlucky = describeProgress({ difficulty: 20, hashes: 3000000, startedAt: 0 }, 10000);
  assert.equal(unlucky.unusual, true);
});

test("chanceWithin follows the exponential distribution", () => {
  assert.equal(Math.round(chanceWithin(3.5, 3.5) * 100), 63, "one expected duration: about 63 %");
  assert.equal(Math.round(chanceWithin(15, 3.5) * 100), 99, "the patience threshold is nearly certain");
  assert.equal(Math.round(chanceWithin(1, 14) * 100), 7, "one second at 22 bits: about 7 %");
  assert.equal(chanceWithin(1, 0), 0);
});

test("durations are coarse on purpose, and never falsely precise", () => {
  assert.equal(formatSeconds(0.4), "under a second");
  assert.equal(formatSeconds(3.4), "3 seconds");
  assert.equal(formatSeconds(42), "40 seconds");
  assert.equal(formatSeconds(150), "2.5 minutes");
  assert.equal(formatSeconds(Number.POSITIVE_INFINITY), "unknown");
});

test("rates are readable rather than exact", () => {
  assert.equal(formatRate(0), "measuring…");
  assert.equal(formatRate(280417), "280k hashes/s");
  assert.equal(formatRate(1_250_000), "1.3M hashes/s");
});

test("the recipient counter counts the one being worked on, not the finished ones", () => {
  const single = describeProgress({ difficulty: 20, recipientCount: 1, completed: 0, startedAt: 0 }, 1000);
  assert.equal(single.recipients, null, "no counter for a single recipient");
  const many = describeProgress({ difficulty: 20, recipientCount: 3, completed: 1, startedAt: 0 }, 1000);
  assert.equal(many.recipients, "recipient 2 of 3");
  const last = describeProgress({ difficulty: 20, recipientCount: 3, completed: 3, startedAt: 0 }, 1000);
  assert.equal(last.recipients, "recipient 3 of 3", "never counts past the total");
});

test("the headline avoids the crypto reading, and the details supply the comparison", () => {
  assert.ok(!PRIMARY_LABEL.toLowerCase().includes("mining"),
    "the primary label stays plain; see src/ui/strings.js for why");
  assert.match(MINING_EXPLANATION, /cryptocurrency mining/);
  assert.match(MINING_EXPLANATION, /nothing is earned/);
  assert.match(MEMORYLESS_EXPLANATION, /no progress bar/);
});
