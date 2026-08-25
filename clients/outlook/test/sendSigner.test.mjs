import test from "node:test";
import assert from "node:assert/strict";

import { canonicalRecipients, mintStamps } from "../src/compose/sendSigner.js";
import { extractEsfHeaders } from "../src/outlook-api/mimeHeaders.js";
import { Reason, Signal, StampState, verifyMessageStamps } from "../src/esf-core.js";
import { normalizeSettings } from "../src/settings/settings.js";

/** Low difficulty keeps the nonce search instant; the policy path is what these tests exercise. */
function settings(patch = {}) {
  return normalizeSettings({ outgoingDifficulty: 18, minIncomingDifficulty: 18, ...patch });
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
