import test from "node:test";
import assert from "node:assert/strict";

import { countLeadingZeroBits, fromHex, sha256, sha256Sync, toHex } from "../src/protocol/hash.js";

test("sha256 matches the published NIST test vectors", async () => {
  assert.equal(toHex(await sha256("")),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(toHex(await sha256("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(toHex(await sha256("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")),
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
});

test("the synchronous implementation is digest-identical to crypto.subtle", async () => {
  const inputs = ["", "a", "abc", "x".repeat(54), "x".repeat(55), "x".repeat(56), "x".repeat(63), "x".repeat(64),
    "x".repeat(65), "x".repeat(1000), "ümlaut|äöü|🔒", "1|alice@example.com|20260825T103800Z|mid|salt|4711"];
  for (const input of inputs) {
    assert.equal(toHex(sha256Sync(input)), toHex(await sha256(input)), `mismatch for input length ${input.length}`);
  }
});

test("countLeadingZeroBits counts bits, not hex characters", () => {
  assert.equal(countLeadingZeroBits(fromHex("ff")), 0);
  assert.equal(countLeadingZeroBits(fromHex("80")), 0);
  assert.equal(countLeadingZeroBits(fromHex("7f")), 1);
  assert.equal(countLeadingZeroBits(fromHex("40")), 1);
  assert.equal(countLeadingZeroBits(fromHex("01")), 7);
  assert.equal(countLeadingZeroBits(fromHex("0080")), 8);
  assert.equal(countLeadingZeroBits(fromHex("0040")), 9);
  assert.equal(countLeadingZeroBits(fromHex("000fff")), 12);
  assert.equal(countLeadingZeroBits(fromHex("0007ff")), 13);
  assert.equal(countLeadingZeroBits(fromHex("000003ff")), 22);
  assert.equal(countLeadingZeroBits(new Uint8Array(32)), 256);
});

test("a 3-hex-zero digest can still be short of 12 bits", () => {
  // 0x000f... has exactly 12 leading zero bits, 0x0008... has 12 as well, but 0x0018 only 11.
  assert.equal(countLeadingZeroBits(fromHex("0018")), 11);
  assert.equal(countLeadingZeroBits(fromHex("0008")), 12);
});

test("hex helpers round-trip and reject garbage", () => {
  assert.equal(toHex(fromHex("00ff10")), "00ff10");
  assert.throws(() => fromHex("abc"));
  assert.throws(() => fromHex("zz"));
});
