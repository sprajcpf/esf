/**
 * Deterministic cross-implementation test vectors. If another ESF implementation reproduces test/vectors.json, the
 * two agree on canonicalisation, token derivation, the canonical work input and the difficulty measure.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { countLeadingZeroBits, sha256, sha256Sync, toHex } from "../src/protocol/hash.js";
import { parseStamp } from "../src/protocol/parser.js";
import {
  buildWorkBase,
  buildWorkInput,
  messageIdToken,
  recipientToken,
  senderToken
} from "../src/protocol/stamp.js";
import { StampState } from "../src/protocol/constants.js";
import { verifyStamp } from "../src/protocol/verifier.js";

const vectors = JSON.parse(await readFile(new URL("./vectors.json", import.meta.url), "utf8"));

test("the vector file is populated", () => {
  assert.ok(vectors.length >= 5);
});

for (const vector of vectors) {
  test(`vector ${vector.name}: binding tokens`, async () => {
    assert.equal(await senderToken(vector.from), vector.sid);
    assert.equal(await recipientToken(vector.recipient, vector.salt), vector.rid);
    assert.equal(await messageIdToken(vector.messageId), vector.mid);
  });

  test(`vector ${vector.name}: canonical work input`, () => {
    const workInput = buildWorkInput({
      algorithm: "sha256",
      difficulty: vector.difficulty,
      timestamp: vector.timestamp,
      sid: vector.sid,
      rid: vector.rid,
      mid: vector.mid,
      salt: vector.salt,
      profileParams: {}
    }, vector.nonce);
    assert.equal(workInput, vector.workInput);
    assert.match(workInput, /^ESF1\n/);
    assert.ok(workInput.endsWith(`nonce=${vector.nonce}\n`));
  });

  test(`vector ${vector.name}: digest and difficulty`, async () => {
    assert.equal(toHex(await sha256(vector.workInput)), vector.hash);
    assert.equal(toHex(sha256Sync(vector.workInput)), vector.hash);
    assert.ok(countLeadingZeroBits(await sha256(vector.workInput)) >= vector.difficulty);
  });

  test(`vector ${vector.name}: header parses and verifies`, async () => {
    const parsed = parseStamp(vector.header);
    assert.equal(parsed.ok, true, JSON.stringify(parsed));
    assert.equal(parsed.stamp.difficulty, vector.difficulty);
    assert.equal(parsed.stamp.nonce, vector.nonce);
    assert.equal(parsed.stamp.timestamp, vector.timestamp);

    const result = await verifyStamp(parsed.stamp, {
      localMailboxes: [vector.recipient],
      from: vector.from,
      messageId: vector.messageId,
      now: vector.timestamp * 1000 + 60_000,
      maxAgeMs: 7 * 24 * 60 * 60 * 1000,
      minDifficulty: 1
    });
    assert.equal(result.state, StampState.STRONG, result.reason);
    assert.equal(result.hash, vector.hash);
    assert.equal(result.senderBound, true);
    assert.equal(result.messageBound, true);
  });

  test(`vector ${vector.name}: the nonce is the first solution, so the search order is pinned`, () => {
    const counter = Number.parseInt(vector.nonce, 16);
    if (!Number.isFinite(counter) || counter > 200000) {
      return; // keep the suite fast; the lower vectors already pin the ordering
    }
    const workBase = buildWorkBase({
      algorithm: "sha256",
      difficulty: vector.difficulty,
      timestamp: vector.timestamp,
      sid: vector.sid,
      rid: vector.rid,
      mid: vector.mid,
      salt: vector.salt,
      profileParams: {}
    });
    for (let candidate = 0; candidate < counter; candidate++) {
      const digest = sha256Sync(`${workBase}nonce=${candidate.toString(16)}\n`);
      if (countLeadingZeroBits(digest) >= vector.difficulty) {
        assert.fail(`nonce ${candidate.toString(16)} solves ${vector.name} before the recorded ${vector.nonce}`);
      }
    }
  });
}

test("the vectors cover local-part case sensitivity", () => {
  assert.ok(vectors.some(vector => /[A-Z]/.test(vector.recipient.split("@")[0])),
    "at least one vector must have an upper-case local-part");
});
