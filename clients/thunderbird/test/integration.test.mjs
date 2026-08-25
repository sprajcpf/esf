/**
 * Tests for the glue code that is still testable without Thunderbird: recipient flattening, the raw header fallback
 * parser, difficulty policy, receiver policy, settings normalisation and the traffic-light mapping.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { flattenRecipients } from "../src/background/composeSigner.js";
import { messageReference, parseRawHeaders, parseReceivedTime } from "../src/background/verificationService.js";
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

test("the defaults compute quietly for a second, then keep going rather than dropping the stamp", () => {
  assert.equal(DEFAULTS.maxComputeSeconds, 1, "a send must not visibly stall for seconds");
  assert.equal(DEFAULTS.outgoingDifficulty, 18, "the baseline has to be reachable inside the quiet phase");
  assert.equal(DEFAULTS.onTimeout, "ask", "with ESF enabled a message is meant to carry a stamp");
  assert.ok(DEFAULTS.askAfterSeconds > DEFAULTS.maxComputeSeconds,
    "asking must come well after the quiet phase, not instead of it");
});

test("stamps do not expire by default, and the window stays configurable", () => {
  assert.equal(DEFAULTS.maxStampAgeDays, 0, "0 means a stamp never goes stale");
  assert.equal(normalizeSettings({ maxStampAgeDays: 7 }).maxStampAgeDays, 7);
  assert.equal(normalizeSettings({ maxStampAgeDays: -1 }).maxStampAgeDays, 0);
  assert.equal(normalizeSettings({ maxStampAgeDays: 99999 }).maxStampAgeDays, 3650);
});

test("the ask threshold is clamped into something a human would wait for", () => {
  assert.equal(normalizeSettings({ askAfterSeconds: 0 }).askAfterSeconds, 2);
  assert.equal(normalizeSettings({ askAfterSeconds: 99999 }).askAfterSeconds, 600);
  assert.equal(normalizeSettings({ askAfterSeconds: 30 }).askAfterSeconds, 30);
});

test("the stamp is checked against when the message arrived, so archived mail keeps its verdict", () => {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.UTC(2026, 7, 25, 12, 0, 0);
  const arrived = now - 30 * day;
  assert.equal(messageReference({ date: new Date(arrived) }, undefined, now), arrived);
  assert.equal(messageReference({ date: new Date(arrived).toISOString() }, undefined, now), arrived);
});

test("the arrival time from Received wins over the sender-controlled Date", () => {
  const now = Date.UTC(2026, 7, 25, 12, 0, 0);
  const arrived = now - 60 * 60 * 1000;
  const backdated = now - 400 * 24 * 60 * 60 * 1000;
  assert.equal(messageReference({ date: new Date(backdated) }, arrived, now), arrived,
    "a back-dated message cannot pass a stockpiled stamp off as contemporaneous");
});

test("a message dated in the future cannot buy itself extra room", () => {
  const now = Date.UTC(2026, 7, 25, 12, 0, 0);
  assert.equal(messageReference({ date: new Date(now + 90 * 24 * 60 * 60 * 1000) }, undefined, now), now);
  assert.equal(messageReference({}, now + 5000, now), now);
});

test("a message without a usable date falls back to now", () => {
  const now = Date.UTC(2026, 7, 25, 12, 0, 0);
  assert.equal(messageReference({}, undefined, now), now);
  assert.equal(messageReference({ date: "not a date" }, undefined, now), now);
});

test("parseReceivedTime reads the timestamp after the final semicolon", () => {
  const received = "from mx.example.org (mx.example.org [203.0.113.7]) by mail.example.com with ESMTPS " +
    "id abc123 for <alice@example.com>; Tue, 25 Aug 2026 14:57:33 +0200";
  assert.equal(parseReceivedTime(received), Date.parse("Tue, 25 Aug 2026 14:57:33 +0200"));
  assert.equal(parseReceivedTime("no semicolon here"), undefined);
  assert.equal(parseReceivedTime("from x; not a date"), undefined);
  assert.equal(parseReceivedTime(undefined), undefined);
});

test("the contemporaneity default is 24 hours, and it is configurable", () => {
  assert.equal(DEFAULTS.maxStampToMessageHours, 24);
  assert.equal(normalizeSettings({ maxStampToMessageHours: 0 }).maxStampToMessageHours, 1);
  assert.equal(normalizeSettings({ maxStampToMessageHours: 99999 }).maxStampToMessageHours, 8760);
  assert.equal(normalizeSettings({ maxStampToMessageHours: 48 }).maxStampToMessageHours, 48);
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
  assert.equal(settings.maxComputeSeconds, 1, "clamped up from a nonsensical value");
  assert.equal(settings.maxStampAgeDays, 3650);
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

test("worker count never takes the whole machine and honours the override", () => {
  assert.equal(resolveWorkerCount(normalizeSettings({}), 1), 1);
  assert.equal(resolveWorkerCount(normalizeSettings({}), 2), 1);
  assert.equal(resolveWorkerCount(normalizeSettings({}), 4), 2);
  assert.equal(resolveWorkerCount(normalizeSettings({}), 8), 4, "four shards on a machine that can spare them");
  assert.equal(resolveWorkerCount(normalizeSettings({}), 32), 4, "but never more than four by default");
  assert.equal(resolveWorkerCount(normalizeSettings({ maxWorkers: 6 }), 8), 6);
  assert.equal(resolveWorkerCount(normalizeSettings({ maxWorkers: 16 }), 4), 4);
});
