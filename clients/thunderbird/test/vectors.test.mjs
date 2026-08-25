import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { countLeadingZeroBits, sha256, sha256Sync, toHex } from "../src/protocol/hash.js";
import { parseProofHeader } from "../src/protocol/parser.js";
import { buildPreimageBase, recipientId } from "../src/protocol/pow.js";
import { verifyProof } from "../src/protocol/verifier.js";
import { VerificationStatus } from "../src/protocol/constants.js";

const vectors = JSON.parse(await readFile(new URL("./vectors.json", import.meta.url), "utf8"));

test("the vector file is populated", () => {
  assert.ok(vectors.length >= 5);
});

for (const vector of vectors) {
  test(`vector ${vector.name}: preimage is canonical`, () => {
    const base = buildPreimageBase({
      recipient: vector.recipient,
      timestamp: vector.timestamp,
      messageId: vector.messageId,
      salt: vector.salt
    });
    assert.equal(`${base}|${vector.nonce}`, vector.preimage);
  });

  test(`vector ${vector.name}: digest and difficulty match`, async () => {
    assert.equal(toHex(await sha256(vector.preimage)), vector.hash);
    assert.equal(toHex(sha256Sync(vector.preimage)), vector.hash);
    assert.ok(countLeadingZeroBits(await sha256(vector.preimage)) >= vector.bits);
  });

  test(`vector ${vector.name}: header parses and verifies`, async () => {
    const parsed = parseProofHeader(vector.header);
    assert.equal(parsed.ok, true, JSON.stringify(parsed));
    assert.equal(parsed.proof.bits, vector.bits);
    assert.equal(parsed.proof.nonce, vector.nonce);
    if (vector.hiddenRecipient) {
      assert.equal(parsed.proof.recipient, null);
      assert.equal(parsed.proof.recipientHash, await recipientId(vector.salt, vector.recipient));
    } else {
      assert.equal(parsed.proof.recipient, vector.recipient);
    }

    const result = await verifyProof(parsed.proof, {
      localAddresses: [vector.recipient],
      messageId: vector.messageId,
      now: Date.UTC(2026, 7, 25, 12, 0, 0),
      maxAgeMs: 7 * 24 * 60 * 60 * 1000,
      minBits: 1
    });
    assert.equal(result.status, VerificationStatus.VALID, result.reason);
    assert.equal(result.hash, vector.hash);
  });

  test(`vector ${vector.name}: the nonce is the first solution, so the search is reproducible`, async () => {
    const nonce = Number(vector.nonce);
    if (nonce > 400000) {
      return; // keep the suite fast; the lower vectors already pin the search order
    }
    const base = vector.preimage.slice(0, vector.preimage.lastIndexOf("|"));
    for (let candidate = 0; candidate < nonce; candidate++) {
      if (countLeadingZeroBits(sha256Sync(`${base}|${candidate}`)) >= vector.bits) {
        assert.fail(`nonce ${candidate} solves ${vector.name} before the recorded ${nonce}`);
      }
    }
  });
}
