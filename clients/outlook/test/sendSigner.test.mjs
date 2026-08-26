import test from "node:test";
import assert from "node:assert/strict";

import { canonicalRecipients, mintStamps, probeHashRate, resolveAutoDifficulty } from "../src/compose/sendSigner.js";
import { extractEsfHeaders } from "../src/outlook-api/mimeHeaders.js";
import { Reason, Signal, StampState, verifyMessageStamps } from "../src/esf-core.js";
import { normalizeSettings } from "../src/settings/settings.js";

/**
 * Low difficulty keeps the nonce search instant; the policy path is what these tests exercise. difficultyMode is
 * pinned to "fixed" because the default is "auto", and automatic mode would ignore outgoingDifficulty and mint at the
 * 18 bit floor - correct behaviour, but seconds per test.
 */
function settings(patch = {}) {
  return normalizeSettings({ difficultyMode: "fixed", outgoingDifficulty: 18, minIncomingDifficulty: 18, ...patch });
}

// normalizeSettings only accepts selectable difficulties; force a tiny one for fast tests.
function fastSettings(patch = {}) {
  return { ...settings(patch), outgoingDifficulty: 4 };
}

test("canonicalRecipients deduplicates and counts unusable entries", () => {
  // Domains are canonicalised, local-parts stay case-sensitive per whitepaper 6.3.
  const { mailboxes, unresolved } = canonicalRecipients(["a@Example.com", "a@example.com", "A@example.com", "broken",
    ""]);
  assert.deepEqual(mailboxes, ["a@example.com", "A@example.com"]);
  assert.equal(unresolved, 2);
});

test("mintStamps produces one stamp per visible recipient that Outlook and Thunderbird both verify", async () => {
  const outcome = await mintStamps({
    from: "sender@example.org",
    to: ["alice@example.com"],
    cc: ["bob@example.net"],
    bcc: [],
    settings: fastSettings()
  });
  assert.equal(outcome.status, "done");
  assert.equal(outcome.stampCount, 2);

  // Roundtrip through the read side exactly as a receiving client would see it.
  const { stampValues } = extractEsfHeaders(`ESF-Stamp: ${outcome.headerValue}\r\n\r\n`);
  const verified = await verifyMessageStamps(stampValues, {
    localMailboxes: ["alice@example.com"],
    from: "sender@example.org",
    minDifficulty: 4,
    requireSenderBinding: false
  });
  assert.equal(verified.state, StampState.STRONG);
  assert.equal(verified.signal, Signal.GREEN);
});

test("a stamp minted for alice does not verify for mallory", async () => {
  const outcome = await mintStamps({
    from: "sender@example.org",
    to: ["alice@example.com"],
    cc: [],
    bcc: [],
    settings: fastSettings()
  });
  const { stampValues } = extractEsfHeaders(`ESF-Stamp: ${outcome.headerValue}\r\n\r\n`);
  const verified = await verifyMessageStamps(stampValues, {
    localMailboxes: ["mallory@example.com"],
    from: "sender@example.org",
    minDifficulty: 4
  });
  assert.equal(verified.signal, Signal.RED);
  assert.equal(verified.reason, Reason.WRONG_RECIPIENT);
});

test("bccMode omit leaves Bcc recipients unstamped and reports it", async () => {
  const outcome = await mintStamps({
    from: "sender@example.org",
    to: ["alice@example.com"],
    cc: [],
    bcc: ["hidden@example.com"],
    settings: fastSettings({ bccMode: "omit" })
  });
  assert.equal(outcome.stampCount, 1);
  assert.equal(outcome.skippedBcc, 1);
  // The Bcc mailbox must not appear anywhere in the header value.
  assert.ok(!outcome.headerValue.includes("hidden@example.com"));
});

test("bccMode token stamps Bcc recipients without leaking the address", async () => {
  const outcome = await mintStamps({
    from: "sender@example.org",
    to: [],
    cc: [],
    bcc: ["hidden@example.com"],
    settings: fastSettings({ bccMode: "token" })
  });
  assert.equal(outcome.status, "done");
  assert.equal(outcome.stampCount, 1);
  assert.ok(!outcome.headerValue.includes("hidden@example.com"));
  const { stampValues } = extractEsfHeaders(`ESF-Stamp: ${outcome.headerValue}\r\n\r\n`);
  const verified = await verifyMessageStamps(stampValues, {
    localMailboxes: ["hidden@example.com"],
    minDifficulty: 4
  });
  assert.equal(verified.state, StampState.STRONG);
});

test("a message with no stampable recipients is skipped, not an error", async () => {
  const outcome = await mintStamps({
    from: "sender@example.org",
    to: ["not-a-mailbox"],
    cc: [],
    bcc: [],
    settings: fastSettings()
  });
  assert.equal(outcome.status, "skipped");
  assert.equal(outcome.headerValue, null);
  assert.equal(outcome.unresolved, 1);
});

test("an exhausted budget reports a timeout instead of a partial stamp set", async () => {
  const outcome = await mintStamps({
    from: "sender@example.org",
    to: ["alice@example.com"],
    cc: [],
    bcc: [],
    settings: { ...settings(), outgoingDifficulty: 26, maxComputeSeconds: 0.001 },
    shouldStop: () => true
  });
  assert.equal(outcome.status, "timeout");
  assert.equal(outcome.headerValue, null);
  assert.equal(outcome.timedOutRecipient, "alice@example.com");
});

/** Automatic mode with a stored rate; targetSeconds 2 is the shipped default. */
function autoSettings(patch = {}) {
  return normalizeSettings({ difficultyMode: "auto", autoTargetSeconds: 2, minIncomingDifficulty: 18, ...patch });
}

/** A calibration entry measured just now, i.e. one automatic mode may use without re-measuring. */
function freshCalibration(rate) {
  return { rate, key: "hc8", measuredAt: Date.now(), samples: 3 };
}

test("automatic mode derives the difficulty from the stored rate and does not probe again", async () => {
  // 2 s at 2^21 hashes/s buys 2^22 candidates, so 22 bits is what this machine can afford.
  const auto = await resolveAutoDifficulty({ settings: autoSettings(), calibration: freshCalibration(2 ** 21) });
  assert.equal(auto.difficulty, 22);
  assert.equal(auto.source, "stored");
  assert.equal(auto.probedRate, 0);
});

test("a longer time budget buys more work on the same machine", async () => {
  const calibration = freshCalibration(2 ** 21);
  const quick = await resolveAutoDifficulty({ settings: autoSettings({ autoTargetSeconds: 1 }), calibration });
  const patient = await resolveAutoDifficulty({ settings: autoSettings({ autoTargetSeconds: 8 }), calibration });
  assert.equal(quick.difficulty, 21);
  assert.equal(patient.difficulty, 24);
});

test("the difficulty stays between the floor and the ceiling on absurd machines", async () => {
  const slow = await resolveAutoDifficulty({ settings: autoSettings(), calibration: freshCalibration(1) });
  const fast = await resolveAutoDifficulty({ settings: autoSettings(), calibration: freshCalibration(1e15) });
  // Below 18 bits a stamp is refused as too weak, above 26 the extra work buys nothing a receiver asks for.
  assert.equal(slow.difficulty, 18);
  assert.equal(fast.difficulty, 26);
});

test("a stale stored rate is re-measured by a probe", async () => {
  const stale = { rate: 2 ** 21, key: "hc8", measuredAt: Date.now() - 60 * 24 * 60 * 60 * 1000, samples: 9 };
  const auto = await resolveAutoDifficulty({ settings: autoSettings(), calibration: stale, probeMs: 30 });
  assert.equal(auto.source, "probe");
  assert.ok(auto.probedRate > 0, "the probe must produce a rate");
  assert.ok(auto.difficulty >= 18 && auto.difficulty <= 26);
});

test("the first send ever probes instead of guessing, and the probe respects its budget", async () => {
  const startedAt = Date.now();
  const auto = await resolveAutoDifficulty({ settings: autoSettings(), calibration: null, probeMs: 60 });
  const elapsed = Date.now() - startedAt;
  assert.equal(auto.source, "probe");
  assert.ok(auto.difficulty >= 18, "a probed difficulty is never below the floor");
  // Generous upper bound: this must be a short measurement on the send path, not a benchmark.
  assert.ok(elapsed < 2000, `probe took ${elapsed} ms`);
});

test("probeHashRate measures with a full-size work base, not a flattering short one", async () => {
  const rate = await probeHashRate({ probeMs: 40 });
  assert.ok(rate > 0, "a probe must produce a rate");
  // Regression guard for the block-size trap: a real ESF work input is four 64 byte SHA-256 blocks. Measuring with a
  // single-block string overestimates the rate by ~1.8x, and the difficulty chosen from it makes every send that
  // much slower than the user asked for. Anything under three blocks means the probe input was shortened.
  const { probeWorkBase } = await import("../src/esf-core.js");
  assert.ok(probeWorkBase().length > 128, `probe work base is only ${probeWorkBase().length} bytes`);
});

test("automatic mode ignores outgoingDifficulty and reports which rate it used", async () => {
  const outcome = await mintStamps({
    from: "sender@example.org",
    to: ["alice@example.com"],
    cc: [],
    bcc: [],
    // A fixed-mode leftover of 0 must not read as "generation off" once the mode is automatic.
    settings: autoSettings({ outgoingDifficulty: 0 }),
    calibration: freshCalibration(1),
    shouldStop: () => true
  });
  assert.equal(outcome.automatic, true);
  assert.equal(outcome.difficulty, 18);
  assert.equal(outcome.rateSource, "stored");
  // shouldStop fires immediately, so this is the honest timeout rather than a partially stamped message.
  assert.equal(outcome.status, "timeout");
  assert.equal(outcome.headerValue, null);
});

test("every send measures the machine, so the calibration self-corrects without a benchmark", async () => {
  const outcome = await mintStamps({
    from: "sender@example.org",
    to: ["alice@example.com"],
    cc: [],
    bcc: [],
    // 14 bits rather than the 4 of fastSettings: a search that finishes inside a millisecond yields no measurable
    // rate at all, and reporting 0 there is deliberate - better no measurement than an invented one.
    settings: { ...settings(), outgoingDifficulty: 14 }
  });
  assert.equal(outcome.status, "done");
  assert.ok(outcome.rate > 0, "a completed send must report a measured hash rate");
  // Fixed mode: nothing automatic to report, and no probe was run.
  assert.equal(outcome.automatic, false);
  assert.equal(outcome.rateSource, null);
  assert.equal(outcome.probedRate, 0);
});
