import test from "node:test";
import assert from "node:assert/strict";

import { MAX_STAMPS_PER_HEADER, MAX_STAMP_LENGTH } from "../src/protocol/constants.js";
import { parseStamp, parseStampList, serializeStamp, serializeStampList } from "../src/protocol/parser.js";

const SID = "6wSaI0IDIy_r5NvA5k1QSCe8Y6m3j5K5qdYxjEzV_qg";
const RID = "tuCnpNbrXzseXq1aJFYyQDTUiObR8jfL87ZLdyS_PMg";
const MID = "E6_RwO9y3KaChgtK5WN3Qye94zi9SeK3l9oIeD0fO9c";
const VALID = `v=1; alg=sha256; d=22; t=1787651400; sid=${SID}; rid=${RID}; mid=${MID}; ` +
  "salt=8f2c1d4ea7b3906512c0de77a15be340; nonce=19d82c";

test("parses a well-formed stamp", () => {
  const parsed = parseStamp(VALID);
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  assert.deepEqual(
    { ...parsed.stamp, raw: undefined },
    {
      version: 1,
      algorithm: "sha256",
      difficulty: 22,
      timestamp: 1787651400,
      sid: SID,
      rid: RID,
      mid: MID,
      salt: "8f2c1d4ea7b3906512c0de77a15be340",
      nonce: "19d82c",
      profileParams: {},
      raw: undefined
    }
  );
});

test("is tolerant about whitespace, order and case where case is insignificant", () => {
  const header = `  ALG=SHA256 ;d=20;  V=1 ; T=1787651400 ; SID=${SID} ; RID=${RID} ; MID=${MID} ; ` +
    "SALT=8F2C1D4EA7B3906512C0DE77A15BE340 ; NONCE=19D82C ;";
  const parsed = parseStamp(header);
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  assert.equal(parsed.stamp.algorithm, "sha256");
  assert.equal(parsed.stamp.salt, "8f2c1d4ea7b3906512c0de77a15be340");
  assert.equal(parsed.stamp.nonce, "19d82c");
  assert.equal(parsed.stamp.sid, SID, "tokens keep their case - base64url is case sensitive");
});

test("keeps unknown fields as profile parameters", () => {
  const parsed = parseStamp(`${VALID}; mem=16384; iter=1; lanes=1`);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.stamp.profileParams, { mem: "16384", iter: "1", lanes: "1" });
});

const MALFORMED = {
  "empty stamp": "",
  "whitespace only": "   ",
  "not a string": 42,
  "no fields": "garbage",
  "field without value": `${VALID}; brokenfield`,
  "empty value": `${VALID}; mem=`,
  "duplicate field": `${VALID}; d=2`,
  "missing version": VALID.replace("v=1; ", ""),
  "missing algorithm": VALID.replace("alg=sha256; ", ""),
  "missing difficulty": VALID.replace("d=22; ", ""),
  "missing timestamp": VALID.replace("t=1787651400; ", ""),
  "missing sid": VALID.replace(`sid=${SID}; `, ""),
  "missing rid": VALID.replace(`rid=${RID}; `, ""),
  "missing mid": VALID.replace(`mid=${MID}; `, ""),
  "missing salt": VALID.replace("salt=8f2c1d4ea7b3906512c0de77a15be340; ", ""),
  "missing nonce": VALID.replace("; nonce=19d82c", ""),
  "non-numeric difficulty": VALID.replace("d=22", "d=twentytwo"),
  "oversized difficulty field": VALID.replace("d=22", "d=9999"),
  "negative difficulty": VALID.replace("d=22", "d=-1"),
  "non-numeric timestamp": VALID.replace("t=1787651400", "t=2026-08-25"),
  "oversized timestamp": VALID.replace("t=1787651400", `t=${"9".repeat(13)}`),
  "short token": VALID.replace(`sid=${SID}`, "sid=abcd"),
  "token with base64 padding": VALID.replace(`rid=${RID}`, `rid=${RID.slice(0, 42)}=`),
  "non-hex salt": VALID.replace("salt=8f2c1d4ea7b3906512c0de77a15be340", "salt=zz2c1d4ea7b3906512c0de77a15be34"),
  "odd-length salt": VALID.replace("salt=8f2c1d4ea7b3906512c0de77a15be340", "salt=8f2c1d4ea7b3906512c0de77a15be34"),
  "short salt": VALID.replace("salt=8f2c1d4ea7b3906512c0de77a15be340", "salt=aabb"),
  "non-hex nonce": VALID.replace("nonce=19d82c", "nonce=0x19d82c"),
  "overlong nonce": VALID.replace("nonce=19d82c", `nonce=${"a".repeat(65)}`),
  "control characters": `${VALID}${String.fromCharCode(1)}`,
  "injected header break": `${VALID}\r\nX-Spam: no`,
  "invalid field name": `${VALID}; 9bad=1`,
  "profile parameter with a semicolon": `${VALID}; mem=16;384`,
  "profile parameter with spaces": `${VALID}; note=hello world`
};

for (const [name, header] of Object.entries(MALFORMED)) {
  test(`rejects malformed stamp: ${name}`, () => {
    const parsed = parseStamp(header);
    assert.equal(parsed.ok, false, `expected rejection, got ${JSON.stringify(parsed)}`);
    assert.equal(parsed.reason, "malformed");
    assert.ok(typeof parsed.detail === "string" && parsed.detail.length > 0);
  });
}

test("rejects an oversized stamp instead of parsing it", () => {
  const parsed = parseStamp(`${VALID}; pad=${"a".repeat(MAX_STAMP_LENGTH)}`);
  assert.equal(parsed.ok, false);
  assert.match(parsed.detail, /too long/);
});

test("rejects a stamp with an absurd number of fields", () => {
  const parsed = parseStamp(`${VALID}; ${new Array(40).fill("x=1").join("; ")}`);
  assert.equal(parsed.ok, false);
});

test("serializeStamp round-trips through parseStamp", () => {
  const stamp = {
    version: 1,
    algorithm: "sha256",
    difficulty: 24,
    timestamp: 1787651400,
    sid: SID,
    rid: RID,
    mid: MID,
    salt: "8f2c1d4ea7b3906512c0de77a15be340",
    nonce: "19d82c",
    profileParams: {}
  };
  const parsed = parseStamp(serializeStamp(stamp));
  assert.equal(parsed.ok, true);
  for (const key of Object.keys(stamp)) {
    assert.deepEqual(parsed.stamp[key], stamp[key], `field ${key}`);
  }
});

test("serializeStamp emits the whitepaper field order", () => {
  const header = serializeStamp({
    version: 1, algorithm: "sha256", difficulty: 22, timestamp: 1787651400, sid: SID, rid: RID, mid: MID,
    salt: "8f2c1d4ea7b3906512c0de77a15be340", nonce: "19d82c", profileParams: {}
  });
  assert.match(header, /^v=1; alg=sha256; d=22; t=1787651400; sid=/);
  assert.ok(header.indexOf("rid=") < header.indexOf("mid="));
  assert.ok(header.indexOf("salt=") < header.indexOf("nonce="));
});

test("serializeStamp is stable, so the replay identifier is stable", () => {
  const stamp = { version: 1, algorithm: "argon2id", difficulty: 8, timestamp: 1, sid: SID, rid: RID, mid: MID,
    salt: "8f2c1d4ea7b3906512c0de77a15be340", nonce: "3af", profileParams: { mem: 16384, iter: 1, lanes: 1 } };
  const once = serializeStamp(stamp);
  const again = serializeStamp({ ...stamp, profileParams: { lanes: 1, iter: 1, mem: 16384 } });
  assert.equal(once, again, "parameter order must not change the serialisation");
});

/* ---------------------------------------------------------------- stamp lists */

test("a single stamp is a valid list", () => {
  const parsed = parseStampList(VALID);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].ok, true);
});

test("a list is comma separated and parsed entry by entry", () => {
  const parsed = parseStampList(serializeStampList([
    { version: 1, algorithm: "sha256", difficulty: 18, timestamp: 1787651400, sid: SID, rid: RID, mid: MID,
      salt: "8f2c1d4ea7b3906512c0de77a15be340", nonce: "1", profileParams: {} },
    { version: 1, algorithm: "sha256", difficulty: 20, timestamp: 1787651400, sid: SID, rid: MID, mid: MID,
      salt: "8f2c1d4ea7b3906512c0de77a15be341", nonce: "2", profileParams: {} }
  ]));
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].stamp.difficulty, 18);
  assert.equal(parsed[1].stamp.difficulty, 20);
});

test("one broken entry does not invalidate the others", () => {
  const parsed = parseStampList(`v=1; alg=sha256; d=oops, ${VALID}`);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].ok, false);
  assert.equal(parsed[1].ok, true);
});

test("an over-long list is rejected outright", () => {
  const parsed = parseStampList(new Array(MAX_STAMPS_PER_HEADER + 5).fill(VALID).join(", "));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].ok, false);
  assert.match(parsed[0].detail, /too many stamps|too long/);
});

test("the total header length is bounded", () => {
  const parsed = parseStampList("x".repeat(100000));
  assert.equal(parsed[0].ok, false);
  assert.match(parsed[0].detail, /too long/);
});
