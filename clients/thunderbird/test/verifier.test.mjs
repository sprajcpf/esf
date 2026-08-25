import test from "node:test";
import assert from "node:assert/strict";

import { MAX_ACCEPTED_DIFFICULTY, Reason, VerificationStatus } from "../src/protocol/constants.js";
import { parseProofHeader, serializeProof } from "../src/protocol/parser.js";
import { generateProof, recipientId } from "../src/protocol/pow.js";
import { replayKey, verifyMessageHeaders, verifyProof } from "../src/protocol/verifier.js";

const NOW = Date.UTC(2026, 7, 25, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const MESSAGE_ID = "msg-1@host.example";

function context(overrides = {}) {
  return {
    localAddresses: ["alice@example.com"],
    messageId: MESSAGE_ID,
    now: NOW,
    maxAgeMs: 7 * DAY,
    minBits: 1,
    ...overrides
  };
}

async function makeProof(overrides = {}) {
  const { proof } = await generateProof({
    recipient: overrides.recipient || "alice@example.com",
    bits: overrides.bits ?? 8,
    messageId: overrides.messageId ?? MESSAGE_ID,
    now: overrides.now ?? NOW - 60_000,
    hideRecipient: overrides.hideRecipient === true
  });
  return { ...proof, ...(overrides.patch || {}) };
}

test("a freshly generated proof verifies", async () => {
  const proof = await makeProof();
  const result = await verifyProof(proof, context());
  assert.equal(result.status, VerificationStatus.VALID);
  assert.equal(result.reason, Reason.OK);
  assert.equal(result.matchedRecipient, "alice@example.com");
  assert.ok(result.leadingZeroBits >= proof.bits);
  assert.equal(typeof result.verificationMs, "number");
});

test("a proof for a hidden (Bcc) recipient verifies against the receiving address", async () => {
  const proof = await makeProof({ recipient: "bcc@example.com", hideRecipient: true });
  assert.equal(proof.recipient, null);
  const result = await verifyProof(proof, context({ localAddresses: ["other@x.y", "bcc@example.com"] }));
  assert.equal(result.status, VerificationStatus.VALID);
  assert.equal(result.matchedRecipient, "bcc@example.com");
});

test("a hidden recipient binding does not verify for anybody else", async () => {
  const proof = await makeProof({ recipient: "bcc@example.com", hideRecipient: true });
  const result = await verifyProof(proof, context({ localAddresses: ["alice@example.com"] }));
  assert.equal(result.status, VerificationStatus.INVALID);
  assert.equal(result.reason, Reason.RECIPIENT_MISMATCH);
});

test("recipient substitution is rejected", async () => {
  const proof = await makeProof();
  const substituted = { ...proof, recipient: "mallory@example.com" };
  const result = await verifyProof(substituted, context({ localAddresses: ["mallory@example.com"] }));
  assert.equal(result.status, VerificationStatus.INVALID);
  assert.equal(result.reason, Reason.INSUFFICIENT_WORK, "the digest is bound to the original recipient");
});

test("a proof addressed to someone else is not accepted for us", async () => {
  const proof = await makeProof({ recipient: "carol@example.net" });
  const result = await verifyProof(proof, context());
  assert.equal(result.status, VerificationStatus.INVALID);
  assert.equal(result.reason, Reason.RECIPIENT_MISMATCH);
});

test("a tampered nonce is rejected", async () => {
  const proof = await makeProof({ patch: { nonce: "999999999" } });
  const result = await verifyProof(proof, context());
  assert.equal(result.status, VerificationStatus.INVALID);
  assert.equal(result.reason, Reason.INSUFFICIENT_WORK);
});

test("a tampered salt is rejected", async () => {
  const proof = await makeProof();
  const result = await verifyProof({ ...proof, salt: "00".repeat(16) }, context());
  assert.equal(result.status, VerificationStatus.INVALID);
  assert.equal(result.reason, Reason.INSUFFICIENT_WORK);
});

test("a tampered timestamp is rejected", async () => {
  const proof = await makeProof();
  const result = await verifyProof({ ...proof, timestamp: "20260825T110000Z" }, context());
  assert.equal(result.status, VerificationStatus.INVALID);
  assert.equal(result.reason, Reason.INSUFFICIENT_WORK);
});

test("claiming more work than was done is rejected", async () => {
  const proof = await makeProof({ bits: 8 });
  const result = await verifyProof({ ...proof, bits: 26 }, context());
  assert.equal(result.status, VerificationStatus.INVALID);
  assert.equal(result.reason, Reason.INSUFFICIENT_WORK);
});

test("an absurd declared difficulty is refused outright, without doing the work", async () => {
  const proof = await makeProof();
  const result = await verifyProof({ ...proof, bits: 250 }, context());
  assert.equal(result.status, VerificationStatus.INVALID);
  assert.equal(result.reason, Reason.DIFFICULTY_OUT_OF_RANGE);
  assert.ok(result.verificationMs < 50, "must not spend time on an attacker-declared difficulty");
});

test("the maximum accepted difficulty cannot be raised past the hard cap", async () => {
  const proof = await makeProof();
  const result = await verifyProof({ ...proof, bits: MAX_ACCEPTED_DIFFICULTY + 1 },
    context({ maxBits: 999 }));
  assert.equal(result.reason, Reason.DIFFICULTY_OUT_OF_RANGE);
});

test("a proof below the configured minimum difficulty is not counted as valid", async () => {
  const proof = await makeProof({ bits: 8 });
  const result = await verifyProof(proof, context({ minBits: 18 }));
  assert.equal(result.status, VerificationStatus.INVALID);
  assert.equal(result.reason, Reason.DIFFICULTY_TOO_LOW);
});

test("stale proofs are rejected", async () => {
  const proof = await makeProof({ now: NOW - 8 * DAY });
  const result = await verifyProof(proof, context());
  assert.equal(result.status, VerificationStatus.INVALID);
  assert.equal(result.reason, Reason.EXPIRED);
});

test("the acceptance window is configurable", async () => {
  const proof = await makeProof({ now: NOW - 8 * DAY });
  const result = await verifyProof(proof, context({ maxAgeMs: 30 * DAY }));
  assert.equal(result.status, VerificationStatus.VALID);
});

test("proofs from the future are rejected beyond the clock skew tolerance", async () => {
  const nearFuture = await makeProof({ now: NOW + 30 * 60 * 1000 });
  assert.equal((await verifyProof(nearFuture, context())).status, VerificationStatus.VALID);

  const farFuture = await makeProof({ now: NOW + 3 * 60 * 60 * 1000 });
  const result = await verifyProof(farFuture, context());
  assert.equal(result.status, VerificationStatus.INVALID);
  assert.equal(result.reason, Reason.FUTURE_TIMESTAMP);
});

test("unsupported versions and algorithms are rejected", async () => {
  const proof = await makeProof();
  assert.equal((await verifyProof({ ...proof, version: 2 }, context())).reason, Reason.UNSUPPORTED_VERSION);
  assert.equal((await verifyProof({ ...proof, algorithm: "md5" }, context())).reason, Reason.UNSUPPORTED_ALGORITHM);
});

test("a self-declared message id verifies, and can be pinned to the carrying message on demand", async () => {
  // The proof carries the id it was computed for (`mid`). By default that is accepted, because Thunderbird assigns
  // the real Message-ID only after the send hook has run - see README, "Limitations".
  const proof = await makeProof({ messageId: "other@host.example" });
  const lenient = await verifyProof(proof, context());
  assert.equal(lenient.status, VerificationStatus.VALID);

  const strict = await verifyProof(proof, context({ requireMessageIdMatch: true }));
  assert.equal(strict.reason, Reason.MESSAGE_ID_MISMATCH);
});

test("dropping the mid field breaks the proof, so the binding cannot be stripped", async () => {
  const proof = await makeProof({ messageId: "other@host.example" });
  const stripped = await verifyProof({ ...proof, messageId: "" }, context());
  assert.equal(stripped.status, VerificationStatus.INVALID);
  assert.equal(stripped.reason, Reason.INSUFFICIENT_WORK);
});

test("verifyMessageHeaders reports a missing proof for messages without the header", async () => {
  const outcome = await verifyMessageHeaders([], context());
  assert.equal(outcome.status, VerificationStatus.MISSING);
  assert.equal(outcome.reason, Reason.NO_HEADER);
  assert.equal(outcome.best, null);
});

test("verifyMessageHeaders finds our proof among proofs for other recipients", async () => {
  const headers = [];
  for (const recipient of ["bob@example.org", "alice@example.com", "carol@example.net"]) {
    headers.push(serializeProof(await makeProof({ recipient, bits: 8 })));
  }
  const outcome = await verifyMessageHeaders(headers, context());
  assert.equal(outcome.status, VerificationStatus.VALID);
  assert.equal(outcome.best.matchedRecipient, "alice@example.com");
  assert.equal(outcome.results.length, 3);
});

test("verifyMessageHeaders keeps the strongest valid proof", async () => {
  const weak = serializeProof(await makeProof({ bits: 4 }));
  const strong = serializeProof(await makeProof({ bits: 12 }));
  const outcome = await verifyMessageHeaders([weak, strong], context());
  assert.equal(outcome.status, VerificationStatus.VALID);
  assert.equal(outcome.best.bits, 12);
});

test("verifyMessageHeaders caps the number of headers it processes", async () => {
  const junk = new Array(500).fill("v=1; alg=sha256; bits=22; ts=20260825T103800Z; rcpt=a@b.c; nonce=1; " +
    "salt=8f2c1d4ea7b3906512c0de77a15be340");
  const started = Date.now();
  const outcome = await verifyMessageHeaders(junk, context());
  assert.equal(outcome.status, VerificationStatus.INVALID);
  assert.equal(outcome.results.length, 8);
  assert.equal(outcome.skipped, 492);
  assert.ok(Date.now() - started < 1000);
});

test("a malformed header among valid ones does not hide the valid proof", async () => {
  const good = serializeProof(await makeProof({ bits: 8 }));
  const outcome = await verifyMessageHeaders(["totally broken", good], context());
  assert.equal(outcome.status, VerificationStatus.VALID);
});

test("replayKey binds a proof to one recipient and one digest", async () => {
  const proof = await makeProof();
  const result = await verifyProof(proof, context());
  const key = replayKey(result);
  assert.equal(key, `alice@example.com|${result.hash}`);

  const other = await verifyProof(await makeProof(), context());
  assert.notEqual(replayKey(other), key, "a second proof must produce a different ledger key");
});

test("a replayed header is detectable through the ledger key", async () => {
  const header = serializeProof(await makeProof());
  const first = await verifyMessageHeaders([header], context());
  const second = await verifyMessageHeaders([header], context());
  assert.equal(first.status, VerificationStatus.VALID);
  assert.equal(second.status, VerificationStatus.VALID);
  assert.equal(replayKey(first.best), replayKey(second.best), "the ledger recognises the identical proof");
});

test("the recipient hash cannot be reused with a different salt", async () => {
  const proof = await makeProof({ recipient: "bcc@example.com", hideRecipient: true });
  const rehashed = { ...proof, salt: "11".repeat(16) };
  const result = await verifyProof(rehashed, context({ localAddresses: ["bcc@example.com"] }));
  assert.equal(result.reason, Reason.RECIPIENT_MISMATCH);
  assert.notEqual(await recipientId("11".repeat(16), "bcc@example.com"), proof.recipientHash);
});

test("parse-then-verify works on the wire format", async () => {
  const header = serializeProof(await makeProof({ bits: 12 }));
  const parsed = parseProofHeader(header);
  assert.equal(parsed.ok, true);
  const result = await verifyProof(parsed.proof, context());
  assert.equal(result.status, VerificationStatus.VALID);
  assert.equal(result.bits, 12);
});
