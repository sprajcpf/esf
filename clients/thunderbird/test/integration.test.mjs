/**
 * Tests for the glue code that is still testable without Thunderbird: recipient flattening, the raw header fallback
 * parser, difficulty policy, receiver policy, settings normalisation and the traffic-light mapping.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { flattenRecipients } from "../src/background/composeSigner.js";
import { parseRawHeaders } from "../src/background/verificationService.js";
import { PeerClass, receiverPolicy, resolveOutgoingDifficulty } from "../src/protocol/policy.js";
import { DEFAULTS, normalizeSettings, resolveWorkerCount } from "../src/utils/settings.js";
import { SIGNAL_BY_STATE, Signal, StampState } from "../src/protocol/constants.js";

test("flattenRecipients canonicalises, deduplicates and counts unresolvable entries", () => {
  const result = flattenRecipients([
    "Alice <Alice@Example.COM>",
    "Alice@example.com",
    { id: "abc", type: "contact" },
    "garbage",
    "bob@example.org"
  ]);
  assert.deepEqual(result.mailboxes, ["Alice@example.com", "bob@example.org"]);
  assert.equal(result.unresolved, 2);
});

test("flattenRecipients accepts the single-value and empty forms of ComposeRecipientList", () => {
  assert.deepEqual(flattenRecipients("a@b.cc").mailboxes, ["a@b.cc"]);
  assert.deepEqual(flattenRecipients(undefined).mailboxes, []);
  assert.deepEqual(flattenRecipients(null).mailboxes, []);
});

test("parseRawHeaders extracts folded stamp fields and the message id", () => {
  const raw = [
    "Return-Path: <sender@example.org>",
    "Message-ID: <abc.123@host.example>",
    "X-ESF-Stamp: v=1; alg=sha256; d=22; t=1787651400;",
    "\tsid=AAA; rid=BBB; mid=CCC; salt=8f2c1d4ea7b3906512c0de77a15be340; nonce=1",
    "Subject: hello",
    "",
    "body X-ESF-Stamp: not a header"
  ].join("\r\n");

  const [values, messageId] = parseRawHeaders(raw);
  assert.equal(values.length, 1);
  assert.match(values[0], /sid=AAA; rid=BBB/);
  assert.equal(messageId, "<abc.123@host.example>");
});

test("parseRawHeaders accepts the standards-track field name as well", () => {
  const raw = "Message-ID: <x@y>\r\nESF-Stamp: v=1\r\nX-ESF-Stamp: v=1\r\n\r\nbody";
  const [values] = parseRawHeaders(raw);
  assert.equal(values.length, 2);
});

test("parseRawHeaders ignores the body and tolerates LF-only line endings", () => {
  const [values] = parseRawHeaders("Message-ID: <x@y>\nX-ESF-Stamp: v=1\n\nX-ESF-Stamp: injected");
  assert.deepEqual(values, ["v=1"]);
});

test("the static policy charges every unknown peer the configured baseline", () => {
  const settings = normalizeSettings({ outgoingDifficulty: 24 });
  assert.deepEqual(resolveOutgoingDifficulty({ recipient: "a@b.cc", recipientCount: 1, settings }),
    { difficulty: 24, peerClass: PeerClass.UNKNOWN });
});

test("difficulty 0 disables generation", () => {
  const settings = normalizeSettings({ outgoingDifficulty: 0 });
  assert.equal(resolveOutgoingDifficulty({ recipient: "a@b.cc", recipientCount: 1, settings }).difficulty, 0);
});

test("the trust-aware policy applies the per-class rule", () => {
  const settings = normalizeSettings({ outgoingDifficulty: 22, trustAwareDifficulty: true });
  assert.equal(resolveOutgoingDifficulty({ recipient: "a@b.cc", recipientCount: 1, settings }).difficulty, 22,
    "unknown peers get the baseline");
});

test("receiver policy exposes a per-profile minimum, because difficulties are not comparable", () => {
  const policy = receiverPolicy(normalizeSettings({ minIncomingDifficulty: 20 }));
  assert.equal(policy.minDifficulty("sha256"), 20);
  assert.deepEqual(policy.acceptedAlgorithms, ["sha256"]);
});

test("the traffic light follows the whitepaper mapping", () => {
  assert.equal(SIGNAL_BY_STATE[StampState.STRONG], Signal.GREEN);
  assert.equal(SIGNAL_BY_STATE[StampState.WEAK], Signal.YELLOW);
  assert.equal(SIGNAL_BY_STATE[StampState.UNSUPPORTED], Signal.YELLOW);
  assert.equal(SIGNAL_BY_STATE[StampState.MISSING], Signal.RED);
  assert.equal(SIGNAL_BY_STATE[StampState.INVALID], Signal.RED);
});

test("settings are clamped so a corrupt profile cannot break the send path", () => {
  const settings = normalizeSettings({
    outgoingDifficulty: 99,
    maxComputeSeconds: -5,
    maxStampAgeDays: 100000,
    minIncomingDifficulty: 999,
    maxWorkers: -3,
    bccMode: "leak-everything",
    onTimeout: "explode",
    junkOnRed: "yes please"
  });
  assert.equal(settings.outgoingDifficulty, DEFAULTS.outgoingDifficulty);
  assert.equal(settings.maxComputeSeconds, 1);
  assert.equal(settings.maxStampAgeDays, 365);
  assert.equal(settings.minIncomingDifficulty, 30);
  assert.equal(settings.maxWorkers, 0);
  assert.equal(settings.bccMode, "omit");
  assert.equal(settings.onTimeout, DEFAULTS.onTimeout);
  assert.equal(settings.junkOnRed, false, "only a real boolean enables junk marking");
});

test("Bcc defaults to omitting the stamp rather than exposing a token", () => {
  assert.equal(DEFAULTS.bccMode, "omit");
});

test("junk marking is off by default, so a missing stamp is never treated as abuse", () => {
  assert.equal(DEFAULTS.junkOnRed, false);
});

test("worker count leaves a core to Thunderbird and honours the override", () => {
  assert.equal(resolveWorkerCount(normalizeSettings({}), 1), 1);
  assert.equal(resolveWorkerCount(normalizeSettings({}), 2), 1);
  assert.equal(resolveWorkerCount(normalizeSettings({}), 8), 2);
  assert.equal(resolveWorkerCount(normalizeSettings({ maxWorkers: 6 }), 8), 6);
  assert.equal(resolveWorkerCount(normalizeSettings({ maxWorkers: 16 }), 4), 4);
});
