/**
 * Tests for the glue code that is still testable without Thunderbird: recipient flattening, the raw header fallback
 * parser, the difficulty policy and the settings normaliser.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { flattenRecipients } from "../src/background/composeSigner.js";
import { parseRawHeaders } from "../src/background/verificationService.js";
import { PeerClass, resolveIncomingMinBits, resolveOutgoingBits } from "../src/protocol/policy.js";
import { DEFAULTS, normalizeSettings, resolveWorkerCount } from "../src/utils/settings.js";

test("flattenRecipients normalises, deduplicates and counts unresolvable entries", () => {
  const result = flattenRecipients([
    "Alice <alice@example.com>",
    "alice@EXAMPLE.com",
    { id: "abc", type: "contact" },
    "garbage",
    "bob@example.org"
  ]);
  assert.deepEqual(result.addresses, ["alice@example.com", "bob@example.org"]);
  assert.equal(result.unresolved, 2);
});

test("flattenRecipients accepts the single-value and empty forms of ComposeRecipientList", () => {
  assert.deepEqual(flattenRecipients("a@b.c").addresses, ["a@b.c"]);
  assert.deepEqual(flattenRecipients(undefined).addresses, []);
  assert.deepEqual(flattenRecipients(null).addresses, []);
});

test("parseRawHeaders extracts folded proof headers and the message id", () => {
  const raw = [
    "Return-Path: <sender@example.org>",
    "Message-ID: <abc.123@host.example>",
    "X-Email-PoW: v=1; alg=sha256; bits=22; ts=20260825T103800Z;",
    "\trcpt=alice@example.com; nonce=4711; salt=8f2c1d4ea7b3906512c0de77a15be340",
    "X-Email-PoW: v=1; alg=sha256; bits=22; ts=20260825T103800Z; rcpt=bob@example.org; nonce=1; salt=aabb",
    "Subject: hello",
    "",
    "body X-Email-PoW: not a header"
  ].join("\r\n");

  const [values, messageId] = parseRawHeaders(raw, "x-email-pow");
  assert.equal(values.length, 2);
  assert.match(values[0], /rcpt=alice@example\.com; nonce=4711/);
  assert.equal(messageId, "<abc.123@host.example>");
});

test("parseRawHeaders ignores the body and tolerates LF-only line endings", () => {
  const raw = "Message-ID: <x@y>\nX-Email-PoW: v=1\n\nX-Email-PoW: injected";
  const [values] = parseRawHeaders(raw, "x-email-pow");
  assert.deepEqual(values, ["v=1"]);
});

test("the static policy returns the configured difficulty for everyone", () => {
  const settings = normalizeSettings({ outgoingBits: 24 });
  const resolved = resolveOutgoingBits({ recipient: "a@b.c", recipientCount: 1, settings });
  assert.deepEqual(resolved, { bits: 24, peerClass: PeerClass.UNKNOWN });
});

test("difficulty 0 disables generation", () => {
  const settings = normalizeSettings({ outgoingBits: 0 });
  assert.equal(resolveOutgoingBits({ recipient: "a@b.c", recipientCount: 1, settings }).bits, 0);
});

test("the adaptive policy applies the per-class rule", () => {
  const settings = normalizeSettings({ outgoingBits: 22, adaptiveDifficulty: true });
  const resolved = resolveOutgoingBits({ recipient: "a@b.c", recipientCount: 1, settings });
  assert.equal(resolved.bits, 22, "unknown peers get the base difficulty");
});

test("incoming minimum difficulty falls back to 1 when unset", () => {
  assert.equal(resolveIncomingMinBits({}), 1);
  assert.equal(resolveIncomingMinBits({ minIncomingBits: 20 }), 20);
});

test("settings are clamped so a corrupt profile cannot break the send path", () => {
  const settings = normalizeSettings({
    outgoingBits: 99,
    maxComputeSeconds: -5,
    maxProofAgeDays: 100000,
    minIncomingBits: 999,
    maxWorkers: -3,
    bccMode: "leak-everything",
    onTimeout: "explode",
    markMissingAsJunk: "yes please"
  });
  assert.equal(settings.outgoingBits, DEFAULTS.outgoingBits);
  assert.equal(settings.maxComputeSeconds, 1);
  assert.equal(settings.maxProofAgeDays, 365);
  assert.equal(settings.minIncomingBits, 30);
  assert.equal(settings.maxWorkers, 0);
  assert.equal(settings.bccMode, "hashed");
  assert.equal(settings.onTimeout, DEFAULTS.onTimeout);
  assert.equal(settings.markMissingAsJunk, false, "only a real boolean enables junk marking");
});

test("worker count leaves a core to Thunderbird and honours the override", () => {
  assert.equal(resolveWorkerCount(normalizeSettings({}), 1), 1);
  assert.equal(resolveWorkerCount(normalizeSettings({}), 2), 1);
  assert.equal(resolveWorkerCount(normalizeSettings({}), 8), 2);
  assert.equal(resolveWorkerCount(normalizeSettings({ maxWorkers: 6 }), 8), 6);
  assert.equal(resolveWorkerCount(normalizeSettings({ maxWorkers: 16 }), 4), 4);
});
