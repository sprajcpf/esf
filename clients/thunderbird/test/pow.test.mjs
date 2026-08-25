import test from "node:test";
import assert from "node:assert/strict";

import { countLeadingZeroBits, fromHex, sha256, toHex } from "../src/protocol/hash.js";
import {
  buildPreimageBase,
  formatTimestamp,
  generateProof,
  generateSalt,
  normalizeAddress,
  normalizeMessageId,
  parseTimestamp,
  recipientId,
  searchNonce
} from "../src/protocol/pow.js";

test("normalizeAddress strips display names, brackets and case", () => {
  assert.equal(normalizeAddress("Alice <A@Example.COM>"), "a@example.com");
  assert.equal(normalizeAddress("  bob@example.org "), "bob@example.org");
  assert.equal(normalizeAddress("mailto:Carol@Example.NET"), "carol@example.net");
  assert.equal(normalizeAddress("\"Weird, Name\" <dave@example.net>"), "dave@example.net");
});

test("normalizeAddress rejects unusable input", () => {
  assert.equal(normalizeAddress(""), "");
  assert.equal(normalizeAddress("not-an-address"), "");
  assert.equal(normalizeAddress("a@b.c, d@e.f"), "");
  assert.equal(normalizeAddress(undefined), "");
  assert.equal(normalizeAddress(`${"x".repeat(250)}@example.com`), "");
});

test("normalizeMessageId strips angle brackets", () => {
  assert.equal(normalizeMessageId("<abc@host>"), "abc@host");
  assert.equal(normalizeMessageId(" abc@host "), "abc@host");
  assert.equal(normalizeMessageId(42), "");
});

test("timestamps round-trip and reject impossible values", () => {
  assert.equal(formatTimestamp(Date.UTC(2026, 7, 25, 10, 38, 0)), "20260825T103800Z");
  assert.equal(parseTimestamp("20260825T103800Z").getTime(), Date.UTC(2026, 7, 25, 10, 38, 0));
  assert.equal(parseTimestamp("20261301T000000Z"), null, "month 13 must be rejected");
  assert.equal(parseTimestamp("20260231T000000Z"), null, "31 February must be rejected");
  assert.equal(parseTimestamp("20260825T996100Z"), null);
  assert.equal(parseTimestamp("2026-08-25T10:38:00Z"), null);
  assert.equal(parseTimestamp(""), null);
});

test("the preimage is unambiguous across field boundaries", () => {
  const a = buildPreimageBase({ recipient: "a@b.c", timestamp: "20260825T103800Z", messageId: "x", salt: "aa" });
  const b = buildPreimageBase({ recipient: "a@b.c", timestamp: "20260825T103800Z", messageId: "", salt: "xaa" });
  assert.notEqual(a, b, "shifting a character between fields must change the preimage");
});

test("generateProof produces a proof that actually carries the claimed work", async () => {
  const { proof, hashes } = await generateProof({
    recipient: "Alice <alice@example.com>",
    bits: 12,
    messageId: "<test@host>"
  });
  assert.equal(proof.recipient, "alice@example.com");
  assert.equal(proof.messageId, "test@host");
  assert.equal(proof.bits, 12);
  assert.equal(proof.algorithm, "sha256");
  assert.equal(proof.recipientHash, null);
  assert.ok(hashes >= 1);
  assert.ok(/^[0-9]+$/.test(proof.nonce));
  assert.equal(proof.salt.length, 32);

  const digest = await sha256(
    `1|alice@example.com|${proof.timestamp}|test@host|${proof.salt}|${proof.nonce}`
  );
  assert.equal(toHex(digest), proof.hash);
  assert.ok(countLeadingZeroBits(digest) >= 12);
});

test("hidden recipients are bound by hash, never by address", async () => {
  const { proof } = await generateProof({ recipient: "bcc@example.com", bits: 8, messageId: "m", hideRecipient: true });
  assert.equal(proof.recipient, null);
  assert.equal(proof.recipientHash, await recipientId(proof.salt, "bcc@example.com"));
  assert.equal(proof.recipientHash.length, 64);
});

test("recipientId is salt-dependent, so proofs cannot be precomputed per address", async () => {
  const a = await recipientId("aaaa", "x@y.z");
  const b = await recipientId("bbbb", "x@y.z");
  assert.notEqual(a, b);
});

test("generateProof rejects an unusable recipient", async () => {
  await assert.rejects(() => generateProof({ recipient: "garbage", bits: 4, messageId: "m" }));
});

test("searchNonce respects the candidate limit and reports no result", async () => {
  const base = buildPreimageBase({ recipient: "a@b.c", timestamp: "20260825T103800Z", messageId: "m", salt: "ab" });
  const result = await searchNonce({ base, bits: 40, maxCandidates: 500, batchSize: 100 });
  assert.equal(result.found, false);
  assert.equal(result.hashes, 500);
  assert.equal(result.stopped, false);
});

test("searchNonce stops when cancelled", async () => {
  const base = buildPreimageBase({ recipient: "a@b.c", timestamp: "20260825T103800Z", messageId: "m", salt: "ab" });
  let batches = 0;
  const result = await searchNonce({
    base,
    bits: 40,
    batchSize: 50,
    shouldStop: () => ++batches >= 2
  });
  assert.equal(result.found, false);
  assert.equal(result.stopped, true);
  assert.equal(result.hashes, 100);
});

test("sharded searches cover disjoint nonce ranges", async () => {
  const base = buildPreimageBase({ recipient: "a@b.c", timestamp: "20260825T103800Z", messageId: "m", salt: "ab" });
  const shardA = await searchNonce({ base, bits: 40, startNonce: 0, stride: 2, maxCandidates: 10, batchSize: 10 });
  const shardB = await searchNonce({ base, bits: 40, startNonce: 1, stride: 2, maxCandidates: 10, batchSize: 10 });
  assert.equal(shardA.hashes, 10);
  assert.equal(shardB.hashes, 10);
});

test("generateSalt returns 16 fresh random bytes", () => {
  const first = generateSalt();
  assert.equal(first.length, 32);
  assert.equal(fromHex(first).length, 16);
  assert.notEqual(first, generateSalt());
});
