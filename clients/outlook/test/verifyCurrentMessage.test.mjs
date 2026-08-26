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

test("the result carries a sender classification, so the task pane knows whether to offer a reply", async () => {
  const block = "From: Bob <bob@example.org>\r\nSubject: hi\r\n\r\nbody";
  const result = await verifyCurrentMessage(fakeItem(block), settings());
  assert.equal(result.state, StampState.MISSING);
  assert.equal(result.sender.replyable, true);
  assert.equal(result.sender.reason, null);
});

test("a mailing list message is classified as not worth replying to", async () => {
  const block = "From: news@example.org\r\nList-Id: <news.example.org>\r\nList-Post: <mailto:x@example.org>\r\n\r\nb";
  const result = await verifyCurrentMessage(fakeItem(block), settings());
  assert.equal(result.sender.list, true);
  assert.equal(result.sender.replyable, false);
  assert.match(result.sender.reason, /mailing list/);
});

test("an automated sender is classified from Auto-Submitted, and \"no\" is not automation", async () => {
  const auto = "From: bob@example.org\r\nAuto-Submitted: auto-replied\r\n\r\nb";
  assert.equal((await verifyCurrentMessage(fakeItem(auto), settings())).sender.automated, true);
  const human = "From: bob@example.org\r\nAuto-Submitted: no\r\n\r\nb";
  assert.equal((await verifyCurrentMessage(fakeItem(human), settings())).sender.automated, false);
});

test("a no-reply address is recognised from the item's own From, not only the header", async () => {
  const item = {
    from: { emailAddress: "no-reply@example.org" },
    getAllInternetHeadersAsync(callback) {
      callback({ status: "succeeded", value: "From: Newsletter <no-reply@example.org>\r\n\r\nb" });
    }
  };
  const result = await verifyCurrentMessage(item, settings());
  assert.equal(result.sender.noReply, true);
  assert.equal(result.sender.replyable, false);
});
