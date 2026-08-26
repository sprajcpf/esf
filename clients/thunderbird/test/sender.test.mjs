/**
 * Who is worth telling about ESF.
 *
 * The button that offers this sits on unstamped mail, which is nearly all mail, so the interesting tests are about
 * withholding it: a reply to a list, a robot or a no-reply address is noise, and the interface has to know that.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { classifySender } from "../src/utils/sender.js";
import { SUGGESTION } from "../src/ui/strings.js";
import { PROJECT_URL } from "../src/utils/footer.js";

test("an ordinary person is worth telling", () => {
  const result = classifySender({ headers: { subject: ["hello"] }, author: "Alice <alice@example.org>" });
  assert.equal(result.replyable, true);
  assert.equal(result.reason, null);
});

test("mailing list mail is not, because a reply misses whoever wrote it", () => {
  for (const header of ["list-id", "list-unsubscribe", "list-post"]) {
    const result = classifySender({ headers: { [header]: ["<x.example.org>"] }, author: "a@b.cc" });
    assert.equal(result.list, true, header);
    assert.equal(result.replyable, false);
    assert.match(result.reason, /mailing list/);
  }
  assert.equal(classifySender({ headers: { precedence: ["bulk"] }, author: "a@b.cc" }).replyable, false);
});

test("automated mail is not, because nobody is listening", () => {
  const auto = classifySender({ headers: { "auto-submitted": ["auto-generated"] }, author: "a@b.cc" });
  assert.equal(auto.automated, true);
  assert.match(auto.reason, /sent automatically/);
  // RFC 3834: "no" is the value that means a human sent it.
  assert.equal(classifySender({ headers: { "auto-submitted": ["no"] }, author: "a@b.cc" }).replyable, true);
});

test("no-reply addresses are recognised in their usual spellings", () => {
  for (const mailbox of ["noreply@x.cc", "no-reply@x.cc", "No_Reply@x.cc", "donotreply@x.cc",
    "mailer-daemon@x.cc", "Bounce <bounce@x.cc>"]) {
    const result = classifySender({ author: mailbox });
    assert.equal(result.replyable, false, mailbox);
    assert.match(result.reason, /does not accept replies/);
  }
  assert.equal(classifySender({ author: "replies@x.cc" }).replyable, true, "not every address with 'repl' in it");
});

test("missing input is handled without pretending to know anything", () => {
  assert.equal(classifySender().replyable, true, "nothing known: leave the decision to the user");
  assert.equal(classifySender({ headers: {}, author: "" }).replyable, true);
});

test("the suggestion reads as an offer, not a complaint", () => {
  const body = SUGGESTION.missing.body(PROJECT_URL);
  assert.match(body, /not a complaint/);
  assert.match(body, /arrived fine/);
  assert.ok(body.includes(PROJECT_URL));
  assert.match(body, /No need to reply/);
  for (const word of ["must", "should install", "required", "blocked", "rejected"]) {
    assert.ok(!body.toLowerCase().includes(word), `the suggestion must not demand: "${word}"`);
  }
});

test("a failed stamp gets a different message than a missing one", () => {
  const invalid = SUGGESTION.invalid.body(PROJECT_URL);
  assert.match(invalid, /did not verify/);
  assert.notEqual(invalid, SUGGESTION.missing.body(PROJECT_URL));
  assert.notEqual(SUGGESTION.invalid.subject, SUGGESTION.missing.subject);
});
