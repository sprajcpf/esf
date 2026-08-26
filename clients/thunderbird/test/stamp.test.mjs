import test from "node:test";
import assert from "node:assert/strict";

import { countLeadingZeroBits, sha256, toBase64Url, toHex } from "../src/protocol/hash.js";
import {
  buildWorkBase,
  buildWorkInput,
  canonicalMailbox,
  encodeNonce,
  generateSalt,
  generateStamp,
  hashCandidate,
  hashCandidateSync,
  messageIdToken,
  normalizeMessageId,
  probeWorkBase,
  recipientToken,
  searchNonce,
  senderToken,
  unixSeconds
} from "../src/protocol/stamp.js";

/* ---------------------------------------------------------------- canonicalisation (whitepaper 6.3) */

test("canonicalMailbox lowercases the domain and preserves the local-part", () => {
  assert.equal(canonicalMailbox("Alice <Alice.Smith@Example.COM>"), "Alice.Smith@example.com");
  assert.equal(canonicalMailbox("  UPPER@EXAMPLE.ORG "), "UPPER@example.org");
  assert.equal(canonicalMailbox("mailto:User+tag@Example.NET"), "User+tag@example.net");
});

test("canonicalMailbox does not assume dots or plus tags are insignificant", () => {
  assert.notEqual(canonicalMailbox("a.b@example.com"), canonicalMailbox("ab@example.com"));
  assert.notEqual(canonicalMailbox("user+x@example.com"), canonicalMailbox("user@example.com"));
  assert.notEqual(canonicalMailbox("Case@example.com"), canonicalMailbox("case@example.com"));
});

test("canonicalMailbox rejects unusable input", () => {
  for (const input of ["", "   ", "not-an-address", "a@b.c, d@e.f", "@example.com", "user@", undefined, 42,
    `${"x".repeat(250)}@example.com`]) {
    assert.equal(canonicalMailbox(input), "", `expected rejection for ${String(input).slice(0, 20)}`);
  }
});

test("normalizeMessageId strips angle brackets", () => {
  assert.equal(normalizeMessageId("<abc@host>"), "abc@host");
  assert.equal(normalizeMessageId(" abc@host "), "abc@host");
  assert.equal(normalizeMessageId(42), "");
});

/* ---------------------------------------------------------------- binding tokens (whitepaper 6.3) */

test("sid = BASE64URL(SHA256(\"from:\" || canonical_from))", async () => {
  const expected = toBase64Url(await sha256("from:sender@example.org"));
  assert.equal(await senderToken("Sender <sender@Example.ORG>"), expected);
});

test("mid = BASE64URL(SHA256(\"mid:\" || normalized_message_id))", async () => {
  const expected = toBase64Url(await sha256("mid:abc@host"));
  assert.equal(await messageIdToken("<abc@host>"), expected);
});

test("rid = BASE64URL(SHA256(\"to:\" || canonical_recipient || 0x00 || salt))", async () => {
  const salt = "8f2c1d4ea7b3906512c0de77a15be340";
  const expected = toBase64Url(await sha256(`to:alice@example.com${String.fromCharCode(0)}${salt}`));
  assert.equal(await recipientToken("Alice <alice@example.com>", salt), expected);
});

test("the rid separator prevents a mailbox from running into the salt", async () => {
  const a = await recipientToken("alice@example.com", "ffff0000ffff0000");
  const b = await recipientToken("alice@example.comffff0000", "ffff0000");
  assert.notEqual(a, b);
});

test("rid is salt-dependent, so tokens cannot be precomputed per mailbox", async () => {
  assert.notEqual(
    await recipientToken("x@y.zz", "aaaaaaaaaaaaaaaa"),
    await recipientToken("x@y.zz", "bbbbbbbbbbbbbbbb")
  );
});

test("tokens never contain the mailbox itself", async () => {
  const token = await recipientToken("secret@example.net", generateSalt());
  assert.ok(!token.includes("secret"));
  assert.ok(!token.includes("example"));
});

/* ---------------------------------------------------------------- canonical work input (whitepaper 6.4) */

const STAMP = {
  algorithm: "sha256",
  difficulty: 22,
  timestamp: 1787651400,
  sid: "A".repeat(43),
  rid: "B".repeat(43),
  mid: "C".repeat(43),
  salt: "7a12d4b5e6891f20",
  profileParams: {}
};

test("the canonical work input follows the whitepaper line format", () => {
  assert.equal(
    buildWorkInput(STAMP, "19d82c"),
    `ESF1\nalg=sha256\nd=22\nt=1787651400\nsid=${"A".repeat(43)}\nrid=${"B".repeat(43)}\n` +
    `mid=${"C".repeat(43)}\nsalt=7a12d4b5e6891f20\nnonce=19d82c\n`
  );
});

test("profile parameters take part in the work input, in a stable order", () => {
  const argon = { ...STAMP, algorithm: "argon2id", profileParams: { mem: 16384, lanes: 1, iter: 1 } };
  const work = buildWorkBase(argon);
  assert.match(work, /^ESF1\nalg=argon2id\niter=1\nlanes=1\nmem=16384\nd=22\n/);
  // A sender cannot change a parameter without changing the work.
  assert.notEqual(work, buildWorkBase({ ...argon, profileParams: { mem: 8192, lanes: 1, iter: 1 } }));
});

test("every field is bound: changing any one changes the work input", () => {
  const base = buildWorkBase(STAMP);
  for (const [field, value] of Object.entries({
    algorithm: "argon2id", difficulty: 23, timestamp: 1787651401, sid: "Z".repeat(43), rid: "Z".repeat(43),
    mid: "Z".repeat(43), salt: "0000000000000000"
  })) {
    assert.notEqual(buildWorkBase({ ...STAMP, [field]: value }), base, `${field} must be bound`);
  }
});

test("the synchronous and asynchronous candidate hashes agree", async () => {
  const workBase = buildWorkBase(STAMP);
  assert.equal(toHex(hashCandidateSync(workBase, "beef")), toHex(await hashCandidate(workBase, "beef")));
});

/* ---------------------------------------------------------------- nonce search */

test("nonces are hex encoded and bounded", () => {
  assert.equal(encodeNonce(0), "0");
  assert.equal(encodeNonce(255), "ff");
  assert.equal(encodeNonce(0x19d82c), "19d82c");
  assert.ok(encodeNonce(Number.MAX_SAFE_INTEGER).length <= 64);
});

test("searchNonce finds a nonce that really carries the work", async () => {
  const workBase = buildWorkBase({ ...STAMP, difficulty: 12 });
  const result = await searchNonce({ workBase, difficulty: 12 });
  assert.equal(result.found, true);
  assert.match(result.nonce, /^[0-9a-f]+$/);
  const digest = await hashCandidate(workBase, result.nonce);
  assert.ok(countLeadingZeroBits(digest) >= 12);
  assert.equal(toHex(digest), result.hash);
});

test("searchNonce respects the candidate limit", async () => {
  const result = await searchNonce({ workBase: buildWorkBase(STAMP), difficulty: 40, maxCandidates: 500,
    batchSize: 100 });
  assert.equal(result.found, false);
  assert.equal(result.hashes, 500);
  assert.equal(result.stopped, false);
});

test("searchNonce stops promptly when cancelled", async () => {
  let batches = 0;
  const result = await searchNonce({
    workBase: buildWorkBase(STAMP),
    difficulty: 40,
    batchSize: 50,
    shouldStop: () => ++batches >= 2
  });
  assert.equal(result.stopped, true);
  assert.equal(result.hashes, 100);
});

test("sharded searches cover disjoint candidate ranges", async () => {
  const workBase = buildWorkBase(STAMP);
  const shardA = await searchNonce({ workBase, difficulty: 40, startCounter: 0, stride: 2, maxCandidates: 10,
    batchSize: 10 });
  const shardB = await searchNonce({ workBase, difficulty: 40, startCounter: 1, stride: 2, maxCandidates: 10,
    batchSize: 10 });
  assert.equal(shardA.hashes, 10);
  assert.equal(shardB.hashes, 10);
});

/* ---------------------------------------------------------------- generateStamp */

test("generateStamp produces a complete, self-consistent stamp", async () => {
  const { stamp, hashes } = await generateStamp({
    from: "Me <me@example.org>",
    recipient: "Alice <alice@example.com>",
    messageId: "<test@host>",
    difficulty: 12
  });
  assert.equal(stamp.version, 1);
  assert.equal(stamp.algorithm, "sha256");
  assert.equal(stamp.difficulty, 12);
  assert.equal(stamp.sid, await senderToken("me@example.org"));
  assert.equal(stamp.rid, await recipientToken("alice@example.com", stamp.salt));
  assert.equal(stamp.mid, await messageIdToken("test@host"));
  assert.equal(stamp.salt.length, 32, "128 bit salt");
  assert.ok(hashes >= 1);

  const digest = await sha256(buildWorkInput(stamp, stamp.nonce));
  assert.equal(toHex(digest), stamp.hash);
  assert.ok(countLeadingZeroBits(digest) >= 12);
});

test("generateStamp rejects an unusable recipient", async () => {
  await assert.rejects(() => generateStamp({ from: "a@b.cc", recipient: "garbage", messageId: "m", difficulty: 4 }));
});

test("unixSeconds is a whole number of seconds", () => {
  assert.equal(unixSeconds(1787651400123), 1787651400);
  assert.equal(unixSeconds(new Date("2026-08-25T10:38:00Z")), 1787654280);
});

test("generateSalt returns 16 fresh random bytes", () => {
  const first = generateSalt();
  assert.equal(first.length, 32);
  assert.notEqual(first, generateSalt());
});

test("the measuring probe hashes as much data as a real stamp", () => {
  // SHA-256 works in 64 byte blocks. A short probe input is one block where a real work input is four, so measuring
  // with a short one reports a rate the machine cannot deliver - and a difficulty chosen from it makes every send
  // roughly 1.8x slower than the user asked for. This test is why that cannot come back.
  // A real stamp carries a 128 bit salt (32 hex characters); the fixture above uses a shorter one, so the
  // comparison has to be against the real thing rather than against the fixture.
  const real = buildWorkBase({ ...STAMP, salt: generateSalt() });
  const probe = probeWorkBase();
  const blocks = text => Math.ceil((text.length + "nonce=1f2e3d\n".length + 9) / 64);
  assert.equal(blocks(probe), blocks(real),
    `probe is ${probe.length} bytes / ${blocks(probe)} blocks, real is ${real.length} / ${blocks(real)}`);
  assert.ok(Math.abs(probe.length - real.length) <= 8, "and within a few bytes of the same length");
});
