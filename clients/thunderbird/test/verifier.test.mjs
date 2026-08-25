import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_DECLARED_DIFFICULTY,
  MAX_STAMPS_PER_HEADER,
  Reason,
  Signal,
  StampState
} from "../src/protocol/constants.js";
import { parseStamp, serializeStamp, serializeStampList } from "../src/protocol/parser.js";
import { generateStamp, recipientToken, senderToken } from "../src/protocol/stamp.js";
import { stampId, verifyMessageStamps, verifyStamp } from "../src/protocol/verifier.js";

const NOW = 1787651400_000;
const DAY = 24 * 60 * 60 * 1000;
const FROM = "sender@example.org";
const ME = "alice@example.com";
const MESSAGE_ID = "msg-1@host.example";

function context(overrides = {}) {
  return {
    localMailboxes: [ME],
    from: FROM,
    now: NOW,
    messageTime: NOW,
    maxAgeMs: 7 * DAY,
    minDifficulty: 1,
    ...overrides
  };
}

async function makeStamp(overrides = {}) {
  const { stamp } = await generateStamp({
    from: overrides.from || FROM,
    recipient: overrides.recipient || ME,
    messageId: overrides.messageId || MESSAGE_ID,
    difficulty: overrides.difficulty ?? 8,
    now: overrides.now ?? NOW - 60_000
  });
  return { ...stamp, ...(overrides.patch || {}) };
}

/* ---------------------------------------------------------------- happy path */

test("a fresh stamp verifies as strong and green", async () => {
  const result = await verifyStamp(await makeStamp(), context());
  assert.equal(result.state, StampState.STRONG);
  assert.equal(result.signal, Signal.GREEN);
  assert.equal(result.reason, Reason.OK);
  assert.equal(result.matchedRecipient, ME);
  assert.equal(result.senderBound, true);
  assert.ok(result.leadingZeroBits >= result.difficulty);
  assert.equal(typeof result.verificationMs, "number");
});

test("verification is one hash, so it stays cheap whatever is declared", async () => {
  const strong = await makeStamp({ difficulty: 20 });
  const result = await verifyStamp(strong, context());
  assert.equal(result.state, StampState.STRONG);
  assert.ok(result.verificationMs < 100, `verification took ${result.verificationMs} ms`);
});

/* ---------------------------------------------------------------- weak vs strong (whitepaper 11.1) */

test("a valid stamp below the receiver policy is weak and yellow, not invalid", async () => {
  const result = await verifyStamp(await makeStamp({ difficulty: 8 }), context({ minDifficulty: 18 }));
  assert.equal(result.state, StampState.WEAK);
  assert.equal(result.signal, Signal.YELLOW);
  assert.equal(result.reason, Reason.BELOW_POLICY);
  assert.equal(result.requiredDifficulty, 18);
  assert.ok(result.leadingZeroBits >= 8, "the work really was done");
});

/* ---------------------------------------------------------------- unsupported profiles */

test("a registered but unimplemented profile is unsupported, not invalid", async () => {
  const stamp = { ...await makeStamp(), algorithm: "argon2id" };
  const result = await verifyStamp(stamp, context());
  assert.equal(result.state, StampState.UNSUPPORTED);
  assert.equal(result.signal, Signal.YELLOW);
  assert.equal(result.reason, Reason.UNSUPPORTED_ALGORITHM);
  assert.match(result.detail, /argon2id/);
});

test("an unknown profile is also unsupported and costs no work", async () => {
  const result = await verifyStamp({ ...await makeStamp(), algorithm: "sha3-512" }, context());
  assert.equal(result.state, StampState.UNSUPPORTED);
  assert.ok(result.verificationMs < 50);
});

test("a newer protocol version is unsupported rather than invalid", async () => {
  const result = await verifyStamp({ ...await makeStamp(), version: 2 }, context());
  assert.equal(result.state, StampState.UNSUPPORTED);
  assert.equal(result.reason, Reason.UNSUPPORTED_VERSION);
});

/* ---------------------------------------------------------------- forged and tampered stamps */

test("a tampered nonce is invalid", async () => {
  const result = await verifyStamp(await makeStamp({ patch: { nonce: "deadbeef" } }), context());
  assert.equal(result.state, StampState.INVALID);
  assert.equal(result.signal, Signal.RED);
  assert.equal(result.reason, Reason.INSUFFICIENT_WORK);
});

test("a tampered salt breaks the recipient binding", async () => {
  const result = await verifyStamp({ ...await makeStamp(), salt: "00".repeat(16) }, context());
  assert.equal(result.reason, Reason.WRONG_RECIPIENT);
});

test("a tampered timestamp is invalid", async () => {
  const stamp = await makeStamp();
  const result = await verifyStamp({ ...stamp, timestamp: stamp.timestamp - 30 }, context());
  assert.equal(result.reason, Reason.INSUFFICIENT_WORK);
});

test("claiming more work than was done is invalid", async () => {
  const result = await verifyStamp({ ...await makeStamp({ difficulty: 8 }), difficulty: 26 }, context());
  assert.equal(result.reason, Reason.INSUFFICIENT_WORK);
});

test("an absurd declared difficulty is refused before any work", async () => {
  const result = await verifyStamp({ ...await makeStamp(), difficulty: 250 }, context());
  assert.equal(result.state, StampState.INVALID);
  assert.equal(result.reason, Reason.DIFFICULTY_OUT_OF_RANGE);
  assert.ok(result.verificationMs < 50, "must not spend time on an attacker-declared difficulty");
});

test("the hard difficulty cap cannot be raised by local policy", async () => {
  const result = await verifyStamp({ ...await makeStamp(), difficulty: MAX_DECLARED_DIFFICULTY + 1 },
    context({ maxDifficulty: 999 }));
  assert.equal(result.reason, Reason.DIFFICULTY_OUT_OF_RANGE);
});

test("difficulty 0 is refused", async () => {
  const result = await verifyStamp({ ...await makeStamp(), difficulty: 0 }, context());
  assert.equal(result.reason, Reason.DIFFICULTY_OUT_OF_RANGE);
});

/* ---------------------------------------------------------------- freshness */

test("a stale stamp is rejected when an absolute window is configured", async () => {
  // Two days before the message keeps it contemporaneous, so only the absolute window can reject it.
  const stamp = await makeStamp({ now: NOW - 8 * DAY });
  const result = await verifyStamp(stamp, context({ messageTime: NOW - 8 * DAY + 60_000, maxAgeMs: 7 * DAY }));
  assert.equal(result.state, StampState.INVALID);
  assert.equal(result.reason, Reason.STALE);
});

test("without an absolute window a stamp never expires", async () => {
  const stamp = await makeStamp({ now: NOW - 400 * DAY });
  const result = await verifyStamp(stamp, context({
    now: NOW,
    messageTime: NOW - 400 * DAY + 60_000,
    maxAgeMs: Number.POSITIVE_INFINITY
  }));
  assert.equal(result.state, StampState.STRONG, result.reason);
});

test("a stamp minted long before its message is refused - stockpiling does not pay", async () => {
  const stamp = await makeStamp({ now: NOW - 30 * DAY });
  const result = await verifyStamp(stamp, context({ maxAgeMs: Number.POSITIVE_INFINITY }));
  assert.equal(result.state, StampState.INVALID);
  assert.equal(result.reason, Reason.STAMP_TOO_OLD);
  assert.match(result.detail, /before the message/);
});

test("the contemporaneity window is what it says: 24 hours passes, 25 does not", async () => {
  const hour = 60 * 60 * 1000;
  const within = await makeStamp({ now: NOW - 23 * hour });
  const outside = await makeStamp({ now: NOW - 25 * hour });
  const window = { maxStampToMessageMs: 24 * hour, maxAgeMs: Number.POSITIVE_INFINITY };
  assert.equal((await verifyStamp(within, context(window))).state, StampState.STRONG);
  assert.equal((await verifyStamp(outside, context(window))).reason, Reason.STAMP_TOO_OLD);
});

test("an archived message keeps its verdict: old message, old stamp, still strong", async () => {
  const arrived = NOW - 300 * DAY;
  const stamp = await makeStamp({ now: arrived - 60_000 });
  const result = await verifyStamp(stamp, context({
    now: NOW,
    messageTime: arrived,
    maxAgeMs: Number.POSITIVE_INFINITY
  }));
  assert.equal(result.state, StampState.STRONG, result.reason);
});

test("the acceptance window is policy", async () => {
  const stamp = await makeStamp({ now: NOW - 8 * DAY });
  const result = await verifyStamp(stamp, context({ messageTime: NOW - 8 * DAY + 60_000, maxAgeMs: 30 * DAY }));
  assert.equal(result.state, StampState.STRONG, result.reason);
});

test("moderate clock skew is tolerated, a stamp minted well after its message is not", async () => {
  assert.equal((await verifyStamp(await makeStamp({ now: NOW + 30 * 60 * 1000 }), context())).state,
    StampState.STRONG);
  const far = await verifyStamp(await makeStamp({ now: NOW + 3 * 60 * 60 * 1000 }), context());
  assert.equal(far.reason, Reason.FUTURE_TIMESTAMP);
});

/* ---------------------------------------------------------------- bindings */

test("a stamp minted for another recipient does not verify for us", async () => {
  const result = await verifyStamp(await makeStamp({ recipient: "carol@example.net" }), context());
  assert.equal(result.reason, Reason.WRONG_RECIPIENT);
});

test("a stamp verifies for whichever of our mailboxes it was minted for", async () => {
  const stamp = await makeStamp({ recipient: "second@example.net" });
  const result = await verifyStamp(stamp, context({ localMailboxes: [ME, "second@example.net"] }));
  assert.equal(result.state, StampState.STRONG);
  assert.equal(result.matchedRecipient, "second@example.net");
});

test("recipient matching is case sensitive in the local-part, insensitive in the domain", async () => {
  const stamp = await makeStamp({ recipient: "Alice@Example.COM" });
  assert.equal((await verifyStamp(stamp, context({ localMailboxes: ["Alice@example.com"] }))).state,
    StampState.STRONG);
  assert.equal((await verifyStamp(stamp, context({ localMailboxes: ["alice@example.com"] }))).reason,
    Reason.WRONG_RECIPIENT);
});

test("a stamp moved to a message from a different sender is caught when sender binding is required", async () => {
  const stamp = await makeStamp();
  const lenient = await verifyStamp(stamp, context({ from: "attacker@evil.example", requireSenderBinding: false }));
  assert.equal(lenient.state, StampState.STRONG);
  assert.equal(lenient.senderBound, false, "the mismatch is still reported");

  const strict = await verifyStamp(stamp, context({ from: "attacker@evil.example" }));
  assert.equal(strict.reason, Reason.SENDER_MISMATCH);
});

test("the message binding is checked when the carrier Message-ID is supplied", async () => {
  const stamp = await makeStamp({ messageId: "other@host.example" });
  const result = await verifyStamp(stamp, context({ messageId: MESSAGE_ID }));
  assert.equal(result.reason, Reason.MESSAGE_MISMATCH);

  const matching = await verifyStamp(await makeStamp(), context({ messageId: MESSAGE_ID }));
  assert.equal(matching.state, StampState.STRONG);
  assert.equal(matching.messageBound, true);
});

test("tokens cannot be swapped between fields", async () => {
  const stamp = await makeStamp();
  const swapped = { ...stamp, sid: stamp.rid, rid: stamp.sid };
  const result = await verifyStamp(swapped, context());
  assert.equal(result.reason, Reason.WRONG_RECIPIENT);
});

/* ---------------------------------------------------------------- message level */

test("a message without a stamp is missing and red, and that is not an error", async () => {
  const outcome = await verifyMessageStamps([], context());
  assert.equal(outcome.state, StampState.MISSING);
  assert.equal(outcome.signal, Signal.RED);
  assert.equal(outcome.reason, Reason.NO_STAMP);
  assert.equal(outcome.best, null);
});

test("our stamp is found among stamps for other recipients", async () => {
  const stamps = [];
  for (const recipient of ["bob@example.org", ME, "carol@example.net"]) {
    stamps.push(await makeStamp({ recipient }));
  }
  const outcome = await verifyMessageStamps([serializeStampList(stamps)], context());
  assert.equal(outcome.state, StampState.STRONG);
  assert.equal(outcome.best.matchedRecipient, ME);
  assert.equal(outcome.results.length, 3);
});

test("repeated header fields work as well as one list", async () => {
  const mine = serializeStamp(await makeStamp());
  const other = serializeStamp(await makeStamp({ recipient: "bob@example.org" }));
  const outcome = await verifyMessageStamps([other, mine], context());
  assert.equal(outcome.state, StampState.STRONG);
});

test("a strong stamp wins over a weak one", async () => {
  const weak = await makeStamp({ difficulty: 4 });
  const strong = await makeStamp({ difficulty: 20 });
  const outcome = await verifyMessageStamps([serializeStampList([weak, strong])], context({ minDifficulty: 18 }));
  assert.equal(outcome.state, StampState.STRONG);
  assert.equal(outcome.best.difficulty, 20);
});

test("a malformed entry does not hide a good stamp", async () => {
  const good = serializeStamp(await makeStamp());
  const outcome = await verifyMessageStamps([`totally broken, ${good}`], context());
  assert.equal(outcome.state, StampState.STRONG);
});

test("header bombing is bounded and reported", async () => {
  const junk = `v=1; alg=sha256; d=22; t=1787651400; sid=${"A".repeat(43)}; rid=${"B".repeat(43)}; ` +
    `mid=${"C".repeat(43)}; salt=8f2c1d4ea7b3906512c0de77a15be340; nonce=1`;
  const started = Date.now();
  const outcome = await verifyMessageStamps(new Array(500).fill(junk), context());
  assert.equal(outcome.state, StampState.INVALID);
  assert.ok(outcome.results.length <= MAX_STAMPS_PER_HEADER);
  assert.ok(outcome.skipped > 400, "the surplus is reported, not silently ignored");
  assert.ok(Date.now() - started < 1000);
});

/* ---------------------------------------------------------------- replay identity (whitepaper 6.8) */

test("the replay identifier is the digest of the canonical stamp", async () => {
  const stamp = await makeStamp();
  const key = await stampId(stamp);
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(key, await stampId({ ...stamp }), "same stamp, same identifier");
  assert.notEqual(key, await stampId(await makeStamp()), "a different stamp gets a different identifier");
});

test("the replay identifier survives re-parsing the wire form", async () => {
  const stamp = await makeStamp();
  const parsed = parseStamp(serializeStamp(stamp));
  assert.equal(parsed.ok, true);
  assert.equal(await stampId(parsed.stamp), await stampId(stamp));
});

/* ---------------------------------------------------------------- token helpers used by the verifier */

test("verification recomputes the very tokens the sender derived", async () => {
  const stamp = await makeStamp();
  assert.equal(stamp.rid, await recipientToken(ME, stamp.salt));
  assert.equal(stamp.sid, await senderToken(FROM));
});
