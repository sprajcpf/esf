import test from "node:test";
import assert from "node:assert/strict";

import { messageReference, verifyCurrentMessage } from "../src/read/verifyCurrentMessage.js";
import { mintStamps } from "../src/compose/sendSigner.js";
import { Reason, Signal, StampState } from "../src/esf-core.js";
import { normalizeSettings } from "../src/settings/settings.js";

/** The signed-in mailbox cannot be faked without Office, so the tests bind via the alias list instead. */
function settings(patch = {}) {
  return normalizeSettings({ aliasMailboxes: ["alice@example.com"], ...patch });
}

function fakeItem(headerBlock) {
  return {
    from: { emailAddress: "sender@example.org" },
    getAllInternetHeadersAsync(callback) {
      callback({ status: "succeeded", value: headerBlock });
    }
  };
}

async function mintHeaderValue() {
  const outcome = await mintStamps({
    from: "sender@example.org",
    to: ["alice@example.com"],
    cc: [],
    bcc: [],
    settings: { ...settings(), outgoingDifficulty: 4 }
  });
  assert.equal(outcome.status, "done");
  return outcome.headerValue;
}

test("a fresh stamp verifies green against the message's Received time", async () => {
  const headerValue = await mintHeaderValue();
  const received = new Date(Date.now() + 30 * 1000).toUTCString();
  const block = `Received: from a by b; ${received}\r\nESF-Stamp: ${headerValue}\r\n\r\nbody`;
  const result = await verifyCurrentMessage(fakeItem(block), { ...settings(), minIncomingDifficulty: 1 });
  assert.equal(result.state, StampState.STRONG);
  assert.equal(result.signal, Signal.GREEN);
});

test("messageReference prefers Received, then Date, then the item, never later than now", () => {
  const now = 1_000_000_000_000;
  assert.equal(messageReference({}, 900, 800, now), 900);
  assert.equal(messageReference({}, undefined, 800, now), 800);
  assert.equal(messageReference({ dateTimeCreated: new Date(700) }, undefined, undefined, now), 700);
  assert.equal(messageReference({}, undefined, undefined, now), now);
  // A future-dated message cannot buy itself extra room.
  assert.equal(messageReference({}, now + 5000, undefined, now), now);
});

test("a stamp minted long before its message is red: stamp-too-old", async () => {
  // Mint with a back-dated timestamp (two days ago); the message arrives now.
  const outcome = await mintStamps({
    from: "sender@example.org",
    to: ["alice@example.com"],
    cc: [],
    bcc: [],
    settings: { ...settings(), outgoingDifficulty: 4 },
    now: Date.now() - 2 * 24 * 60 * 60 * 1000
  });
  assert.equal(outcome.status, "done");
  const received = new Date().toUTCString();
  const block = `Received: from a by b; ${received}\r\nESF-Stamp: ${outcome.headerValue}\r\n\r\nbody`;
  const result = await verifyCurrentMessage(fakeItem(block), { ...settings(), minIncomingDifficulty: 1 });
  assert.equal(result.state, StampState.INVALID);
  assert.equal(result.reason, Reason.STAMP_TOO_OLD);
  assert.equal(result.signal, Signal.RED);
});
