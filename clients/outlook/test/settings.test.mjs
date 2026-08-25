import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULTS, normalizeSettings } from "../src/settings/settings.js";
import { seenElsewhere } from "../src/read/verifyCurrentMessage.js";

test("normalizeSettings falls back to defaults on garbage", () => {
  const normalized = normalizeSettings({ outgoingDifficulty: 99, maxComputeSeconds: -5, askAfterSeconds: "soon",
    maxStampToMessageHours: -1, onSendFailure: "explode", bccMode: "shout", aliasMailboxes: "not-an-array" });
  assert.equal(normalized.outgoingDifficulty, DEFAULTS.outgoingDifficulty);
  assert.equal(normalized.maxComputeSeconds, 1);
  assert.equal(normalized.askAfterSeconds, DEFAULTS.askAfterSeconds);
  assert.equal(normalized.maxStampToMessageHours, 1);
  assert.equal(normalized.onSendFailure, "block");
  assert.equal(normalized.bccMode, "omit");
  assert.deepEqual(normalized.aliasMailboxes, []);
});

test("stamps never expire by default; 0 is preserved, not clamped up", () => {
  assert.equal(normalizeSettings({}).maxStampAgeDays, 0);
  assert.equal(normalizeSettings({ maxStampAgeDays: 0 }).maxStampAgeDays, 0);
  assert.equal(normalizeSettings({ maxStampAgeDays: 30 }).maxStampAgeDays, 30);
});

test("normalizeSettings keeps valid values", () => {
  const normalized = normalizeSettings({ enabled: false, outgoingDifficulty: 18, askAfterSeconds: 30,
    maxStampToMessageHours: 48, onSendFailure: "send-without", bccMode: "token",
    aliasMailboxes: ["alias@example.com", 42] });
  assert.equal(normalized.enabled, false);
  assert.equal(normalized.outgoingDifficulty, 18);
  assert.equal(normalized.askAfterSeconds, 30);
  assert.equal(normalized.maxStampToMessageHours, 48);
  assert.equal(normalized.onSendFailure, "send-without");
  assert.equal(normalized.bccMode, "token");
  assert.deepEqual(normalized.aliasMailboxes, ["alias@example.com"]);
});

function memoryStorage() {
  const map = new Map();
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value))
  };
}

test("seenElsewhere flags the same stamp on a different message, not a re-open", () => {
  const storage = memoryStorage();
  const settings = normalizeSettings({});
  assert.equal(seenElsewhere("stamp-1", "<msg-a>", settings, storage), false);
  assert.equal(seenElsewhere("stamp-1", "<msg-a>", settings, storage), false);
  assert.equal(seenElsewhere("stamp-1", "<msg-b>", settings, storage), true);
});

test("seenElsewhere degrades to no-replay-detection without storage", () => {
  assert.equal(seenElsewhere("stamp-1", "<msg-a>", normalizeSettings({}), null), false);
});
