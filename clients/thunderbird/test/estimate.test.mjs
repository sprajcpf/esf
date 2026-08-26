/**
 * What the progress window is allowed to claim.
 *
 * The nonce search is memoryless, so the interesting tests here are about *not* over-claiming: no percentage, no
 * countdown that shrinks with work done, and an honest acknowledgement when a wait has become unusual.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  autoDifficulty,
  blendRate,
  canSendFaster,
  chanceWithin,
  describeProgress,
  expectedSeconds,
  fasterDifficulty,
  formatRate,
  formatSeconds,
  hashRate
} from "../src/utils/estimate.js";
import * as strings from "../src/ui/strings.js";

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

test("no user-facing string mentions mining or cryptocurrency", () => {
  // A product decision worth a test: see the note at the top of src/ui/strings.js.
  const shown = Object.values(strings)
    .flatMap(value => (typeof value === "string" ? [value] : Object.values(value)))
    .join(" ")
    .toLowerCase();
  for (const word of ["mining", "miner", "mine ", "crypto", "bitcoin", "blockchain", "coin"]) {
    assert.ok(!shown.includes(word), `user-facing wording must not contain "${word.trim()}"`);
  }
});

test("the details explain the wait on their own terms, without analogies", () => {
  assert.match(strings.WORK_EXPLANATION, /no shortcut/);
  assert.match(strings.WORK_EXPLANATION, /costs the recipient almost nothing/);
  assert.match(strings.MEMORYLESS_EXPLANATION, /no progress bar/);
  assert.equal(strings.PRIMARY_LABEL, "Creating proof of work");
});

test("a faster send picks the highest difficulty that fits the target on this machine", () => {
  // 300k/s: three seconds buys 900k attempts, so 19 bits (524k expected) fits and 20 does not.
  assert.equal(fasterDifficulty(22, 300000), 19);
  assert.equal(fasterDifficulty(26, 300000), 19, "coming down from higher lands in the same place");
  // A fast machine can keep more of the work.
  assert.equal(fasterDifficulty(26, 4000000), 23);
});

test("a faster send never goes below the floor, however slow the machine", () => {
  assert.equal(fasterDifficulty(22, 1000), 18, "a very slow machine still gets a stamp worth having");
  assert.equal(fasterDifficulty(22, 0), 18, "no measurement yet: the floor is the fallback");
  assert.equal(fasterDifficulty(19, 100), 18);
});

test("a faster send always lowers the difficulty by at least one bit", () => {
  assert.equal(fasterDifficulty(20, 10_000_000), 19, "never proposes the difficulty already being worked on");
  assert.ok(fasterDifficulty(24, 300000) < 24);
});

test("the offer is withheld when it could not help", () => {
  assert.equal(canSendFaster(20), true);
  assert.equal(canSendFaster(18), false, "already at the floor: a button that changes nothing is worse than none");
  assert.equal(canSendFaster(undefined), false);
});

/* ---------------------------------------------------------------- automatic difficulty */

test("automatic mode picks the most work that fits the time budget", () => {
  // 300k/s and three seconds buys 900k attempts: 19 bits (524k expected) fits, 20 (1.05M) does not.
  assert.equal(autoDifficulty(300000, { targetSeconds: 3 }), 19);
  assert.equal(autoDifficulty(1_200_000, { targetSeconds: 3 }), 21, "a faster machine does more work");
  assert.equal(autoDifficulty(8_000_000, { targetSeconds: 3 }), 24);
});

test("a longer budget buys a stronger stamp, a shorter one a weaker", () => {
  assert.ok(autoDifficulty(300000, { targetSeconds: 10 }) > autoDifficulty(300000, { targetSeconds: 1 }));
  assert.equal(autoDifficulty(300000, { targetSeconds: 1 }), 18, "one second on a slow machine lands at the floor");
});

test("automatic mode stays inside bounds that keep the stamp worth having", () => {
  assert.equal(autoDifficulty(100, { targetSeconds: 3 }), 18, "never below the floor, however slow the machine");
  assert.equal(autoDifficulty(1e12, { targetSeconds: 3 }), 26, "never above the ceiling, however fast");
  assert.equal(autoDifficulty(0), 18, "no measurement: the floor");
  assert.equal(autoDifficulty(NaN), 18);
});

test("the machine estimate moves towards new measurements without lurching", () => {
  assert.equal(blendRate(0, 300000), 300000, "the first measurement is taken as it is");
  const slower = blendRate(300000, 100000);
  assert.ok(slower < 300000 && slower > 100000, "one bad sample moves the estimate without owning it");
  // Repeated agreement converges.
  let rate = 300000;
  for (let i = 0; i < 20; i++) {
    rate = blendRate(rate, 100000);
  }
  assert.ok(Math.abs(rate - 100000) < 5000, "a real change is learned");
  assert.equal(blendRate(300000, 0), 300000, "an unusable sample is ignored, not treated as zero");
});
