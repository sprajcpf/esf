import test from "node:test";
import assert from "node:assert/strict";

import { parseProofHeader, serializeProof } from "../src/protocol/parser.js";
import { MAX_HEADER_LENGTH } from "../src/protocol/constants.js";

const VALID = "v=1; alg=sha256; bits=22; ts=20260825T103800Z; rcpt=user@example.com; " +
  "nonce=839274829374; salt=8f2c1d4ea7b3906512c0de77a15be340";

test("parses a well-formed header", () => {
  const parsed = parseProofHeader(VALID);
  assert.equal(parsed.ok, true);
  assert.deepEqual(
    {
      version: parsed.proof.version,
      algorithm: parsed.proof.algorithm,
      bits: parsed.proof.bits,
      timestamp: parsed.proof.timestamp,
      recipient: parsed.proof.recipient,
      recipientHash: parsed.proof.recipientHash,
      messageId: parsed.proof.messageId,
      nonce: parsed.proof.nonce,
      salt: parsed.proof.salt
    },
    {
      version: 1,
      algorithm: "sha256",
      bits: 22,
      timestamp: "20260825T103800Z",
      recipient: "user@example.com",
      recipientHash: null,
      messageId: "",
      nonce: "839274829374",
      salt: "8f2c1d4ea7b3906512c0de77a15be340"
    }
  );
});

test("is tolerant about whitespace, field order, case and unknown fields", () => {
  const header = "  ALG=SHA256 ;bits=20;  V=1 ; TS=20260825T103800Z ; RCPT = User@Example.com ; " +
    "nonce=7 ; salt=AABBCCDDEEFF00112233445566778899 ; future-field=whatever;";
  const parsed = parseProofHeader(header);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.proof.recipient, "user@example.com");
  assert.equal(parsed.proof.salt, "aabbccddeeff00112233445566778899");
  assert.equal(parsed.proof.algorithm, "sha256");
});

test("accepts a hashed recipient binding", () => {
  const header = VALID.replace("rcpt=user@example.com", `rid=${"ab".repeat(32)}`);
  const parsed = parseProofHeader(header);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.proof.recipient, null);
  assert.equal(parsed.proof.recipientHash, "ab".repeat(32));
});

test("accepts an explicit message id", () => {
  const parsed = parseProofHeader(`${VALID}; mid=<abc.123@host.example>`);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.proof.messageId, "abc.123@host.example");
});

const MALFORMED = {
  "empty header": "",
  "whitespace only": "   ",
  "not a string": 42,
  "no fields": "garbage",
  "field without value": `${VALID}; brokenfield`,
  "empty value": `${VALID}; mid=`,
  "duplicate field": `${VALID}; bits=2`,
  "missing version": VALID.replace("v=1; ", ""),
  "missing algorithm": VALID.replace("alg=sha256; ", ""),
  "missing bits": VALID.replace("bits=22; ", ""),
  "missing timestamp": VALID.replace("ts=20260825T103800Z; ", ""),
  "missing nonce": VALID.replace("nonce=839274829374; ", ""),
  "missing salt": VALID.replace("; salt=8f2c1d4ea7b3906512c0de77a15be340", ""),
  "missing recipient binding": VALID.replace("rcpt=user@example.com; ", ""),
  "both rcpt and rid": `${VALID}; rid=${"ab".repeat(32)}`,
  "non-numeric bits": VALID.replace("bits=22", "bits=twentytwo"),
  "oversized bits field": VALID.replace("bits=22", "bits=9999"),
  "negative bits": VALID.replace("bits=22", "bits=-1"),
  "bad timestamp": VALID.replace("20260825T103800Z", "2026-08-25T10:38:00Z"),
  "non-numeric nonce": VALID.replace("nonce=839274829374", "nonce=0x1f"),
  "overlong nonce": VALID.replace("nonce=839274829374", `nonce=${"9".repeat(21)}`),
  "odd-length salt": VALID.replace("salt=8f2c1d4ea7b3906512c0de77a15be340", "salt=abc"),
  "short salt": VALID.replace("salt=8f2c1d4ea7b3906512c0de77a15be340", "salt=aabb"),
  "non-hex salt": VALID.replace("salt=8f2c1d4ea7b3906512c0de77a15be340", "salt=zz2c1d4ea7b3906512c0de77a15be340"),
  "bad rcpt": VALID.replace("rcpt=user@example.com", "rcpt=not-an-address"),
  "short rid": VALID.replace("rcpt=user@example.com", "rid=abcd"),
  "control characters": `${VALID}${String.fromCharCode(1)}`,
  "injected header break": `${VALID}\r\nX-Spam: no`,
  "invalid field name": `${VALID}; 9bad=1`,
  "message id with semicolon": `${VALID}; mid=a;b@host`
};

for (const [name, header] of Object.entries(MALFORMED)) {
  test(`rejects malformed header: ${name}`, () => {
    const parsed = parseProofHeader(header);
    assert.equal(parsed.ok, false, `expected rejection, got ${JSON.stringify(parsed)}`);
    assert.equal(parsed.reason, "malformed");
    assert.ok(typeof parsed.detail === "string" && parsed.detail.length > 0);
  });
}

test("rejects oversized headers instead of parsing them", () => {
  const padded = `${VALID}; pad=${"a".repeat(MAX_HEADER_LENGTH)}`;
  const parsed = parseProofHeader(padded);
  assert.equal(parsed.ok, false);
  assert.match(parsed.detail, /too long/);
});

test("rejects headers with an absurd number of fields", () => {
  const many = new Array(40).fill("x=1").join("; ");
  const parsed = parseProofHeader(`${VALID}; ${many}`);
  assert.equal(parsed.ok, false);
});

test("serializeProof round-trips through parseProofHeader", () => {
  const proof = {
    version: 1,
    algorithm: "sha256",
    bits: 24,
    timestamp: "20260825T103800Z",
    recipient: "user@example.com",
    recipientHash: null,
    messageId: "abc@host",
    nonce: "12345",
    salt: "8f2c1d4ea7b3906512c0de77a15be340"
  };
  const parsed = parseProofHeader(serializeProof(proof));
  assert.equal(parsed.ok, true);
  for (const key of Object.keys(proof)) {
    assert.deepEqual(parsed.proof[key], proof[key], `field ${key}`);
  }
});

test("serializeProof emits rid for hidden recipients and never the address", () => {
  const header = serializeProof({
    version: 1,
    algorithm: "sha256",
    bits: 22,
    timestamp: "20260825T103800Z",
    recipient: null,
    recipientHash: "cd".repeat(32),
    messageId: "abc@host",
    nonce: "1",
    salt: "8f2c1d4ea7b3906512c0de77a15be340"
  });
  assert.match(header, /rid=cdcd/);
  assert.doesNotMatch(header, /rcpt=/);
});
