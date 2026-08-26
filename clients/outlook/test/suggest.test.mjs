/**
 * The sender suggestion on the read side.
 *
 * Two things are worth a test here and both are product decisions rather than plumbing: the offer is *withheld* far
 * more often than it is made, and the add-in only ever opens a draft. The wording itself is tested in the
 * Thunderbird suite - what is asserted here is that this client shows the very same sentences instead of its own.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  canOpenReplyDraft,
  htmlParagraphs,
  openSuggestionDraft,
  suggestionDraft,
  suggestionOffer
} from "../src/compose/suggest.js";
import { verifyWithFeedback } from "../src/ui/taskpane.js";
import {
  MINIMUM_FEEDBACK_MS,
  PROJECT_URL,
  Reason,
  SUGGESTION,
  SUGGESTION_LABELS,
  SUGGESTION_NOTE,
  Signal,
  StampState,
  classifySender
} from "../src/esf-core.js";

/** Minimal Office.js stand-in for the requirement-set gate and the async status enum. */
function stubOffice({ supported = true } = {}) {
  globalThis.Office = {
    AsyncResultStatus: { Succeeded: "succeeded", Failed: "failed" },
    context: { requirements: { isSetSupported: name => supported && name === "Mailbox" } }
  };
}

/**
 * A read item that records what it was asked to open. Anything that could put mail in the outbox throws: if the
 * add-in ever grows a send call, this is where it must fail.
 */
function stubItem({ async: hasAsync = true, sync = false, status = "succeeded" } = {}) {
  const opened = [];
  const item = {
    sendAsync() {
      throw new Error("the add-in must never send");
    },
    displayReplyAllFormAsync() {
      throw new Error("reply-all would copy everyone into a note about mail software");
    }
  };
  if (hasAsync) {
    item.displayReplyFormAsync = (formData, callback) => {
      opened.push({ via: "async", formData });
      callback({ status, error: { message: "Outlook said no" } });
    };
  }
  if (sync) {
    item.displayReplyForm = formData => opened.push({ via: "sync", formData });
  }
  return { item, opened };
}

const redMissing = { signal: Signal.RED, state: StampState.MISSING, reason: Reason.NO_STAMP };

test("the offer needs a red light and a sender who can be reached", () => {
  const person = classifySender({ headers: { from: ["Bob <bob@example.org>"] }, author: "bob@example.org" });
  const offered = suggestionOffer({ ...redMissing, sender: person });
  assert.equal(offered.offer, true);
  assert.equal(offered.label, SUGGESTION_LABELS.missing);
  // Imported, not re-worded: the warning about confirming your address must read identically in both clients.
  assert.equal(offered.note, SUGGESTION_NOTE);
});

test("nothing is offered on a message that already carries accepted work", () => {
  const person = classifySender({ author: "bob@example.org" });
  const offered = suggestionOffer({ signal: Signal.GREEN, state: StampState.STRONG, sender: person });
  assert.equal(offered.offer, false);
  assert.equal(offered.note, "", "a green light needs no explanation about replying");
});

test("a mailing list gets the reason in the button's place, never the button", () => {
  const list = classifySender({ headers: { "list-id": ["<news.example.org>"] }, author: "news@example.org" });
  const offered = suggestionOffer({ ...redMissing, sender: list });
  assert.equal(offered.offer, false);
  assert.equal(offered.note, list.reason);
  assert.match(offered.note, /mailing list/);
});

test("a no-reply sender gets the reason in the button's place", () => {
  const noReply = classifySender({ author: "no-reply@example.org" });
  const offered = suggestionOffer({ ...redMissing, sender: noReply });
  assert.equal(offered.offer, false);
  assert.equal(offered.note, noReply.reason);
});

test("an unclassified result offers nothing rather than defaulting to yes", () => {
  assert.equal(suggestionOffer({}).offer, false);
  assert.equal(suggestionOffer(redMissing).offer, false, "no sender information is not permission");
});

test("without header access nothing is offered, because a list cannot be told from a person", () => {
  const person = classifySender({ author: "bob@example.org" });
  const offered = suggestionOffer({ ...redMissing, headersAvailable: false, sender: person });
  assert.equal(offered.offer, false, "a classifier fed nothing must not be read as permission");
  assert.match(offered.note, /cannot read the message's headers/);
});

test("a rejected stamp switches the label", () => {
  const person = classifySender({ author: "bob@example.org" });
  const offered = suggestionOffer({
    signal: Signal.RED,
    state: StampState.INVALID,
    reason: Reason.INSUFFICIENT_WORK,
    sender: person
  });
  assert.equal(offered.label, SUGGESTION_LABELS.invalid);
});

test("the draft body is the shared text, not a local copy", () => {
  assert.equal(suggestionDraft(redMissing).plain, SUGGESTION.missing.body(PROJECT_URL));
});

test("a rejected stamp gets the other draft, quoting the verifier's reason", () => {
  const draft = suggestionDraft({ state: StampState.INVALID, reason: Reason.INSUFFICIENT_WORK });
  assert.equal(draft.invalid, true);
  assert.equal(draft.plain, SUGGESTION.invalid.body(PROJECT_URL, Reason.INSUFFICIENT_WORK));
  assert.ok(draft.plain.includes(Reason.INSUFFICIENT_WORK), "the sender needs something to act on");
  assert.ok(draft.html.includes(Reason.INSUFFICIENT_WORK));
  assert.notEqual(draft.plain, suggestionDraft(redMissing).plain);
});

test("each paragraph becomes one unbroken HTML line, so the reader's client wraps it", () => {
  const html = htmlParagraphs("one\n\ntwo words\nstill two");
  assert.equal(html, "<p>one</p>\n<p>two words still two</p>");
  assert.ok(!html.includes("<br"), "pre-wrapped text is what makes a message look machine-generated");
  for (const line of html.split("\n")) {
    assert.match(line, /^<p>.*<\/p>$/, "a paragraph may not be broken across lines");
  }
});

test("the project link is a link; everything else is inert text", () => {
  const html = htmlParagraphs(SUGGESTION.missing.body(PROJECT_URL));
  assert.ok(html.includes(`<p><a href="${PROJECT_URL}">${PROJECT_URL}</a></p>`));
  assert.equal(html.split("<a ").length - 1, 1, "one link, no surprises");
});

test("a sender-supplied reason cannot inject markup into the draft", () => {
  const html = htmlParagraphs("bad <img src=x onerror=\"alert(1)\"> & ok");
  assert.ok(!html.includes("<img"));
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; ok/);
});

test("the draft opens through displayReplyFormAsync, and nothing is sent", async () => {
  stubOffice();
  const { item, opened } = stubItem();
  assert.equal(canOpenReplyDraft(item), true);
  assert.deepEqual(await openSuggestionDraft(item, redMissing), { ok: true });
  assert.equal(opened.length, 1);
  assert.equal(opened[0].formData.htmlBody, suggestionDraft(redMissing).html);
  assert.deepEqual(Object.keys(opened[0].formData), ["htmlBody"],
    "a draft carries a body and nothing that could send it");
});

test("a refusal from Outlook is reported to the user, not swallowed", async () => {
  stubOffice();
  const { item } = stubItem({ status: "failed" });
  const outcome = await openSuggestionDraft(item, redMissing);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, "Outlook said no");
});

test("a throwing API is contained", async () => {
  stubOffice();
  const { item } = stubItem();
  item.displayReplyFormAsync = () => {
    throw new Error("Office exploded");
  };
  assert.deepEqual(await openSuggestionDraft(item, redMissing), { ok: false, reason: "Office exploded" });
});

test("an older client falls back to the synchronous reply form", async () => {
  stubOffice({ supported: false });
  const { item, opened } = stubItem({ async: false, sync: true });
  assert.deepEqual(await openSuggestionDraft(item, redMissing), { ok: true });
  assert.equal(opened.length, 1);
  assert.equal(opened[0].via, "sync");
});

test("the async form is preferred where the requirement set is there", async () => {
  stubOffice({ supported: true });
  const { item, opened } = stubItem({ async: true, sync: true });
  await openSuggestionDraft(item, redMissing);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].via, "async");
});

test("an async-only client is asked even when the requirement set says no", async () => {
  // A version string it may report badly must not strand a host that has the function and no fallback.
  stubOffice({ supported: false });
  const { item, opened } = stubItem({ async: true, sync: false });
  assert.deepEqual(await openSuggestionDraft(item, redMissing), { ok: true });
  assert.equal(opened[0].via, "async");
});

test("a platform with no reply API says so instead of pretending", async () => {
  stubOffice({ supported: false });
  assert.equal(canOpenReplyDraft({}), false);
  const outcome = await openSuggestionDraft({}, redMissing);
  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /cannot open a reply/);
});

test("a re-check holds its result long enough to be seen", async () => {
  // An instant verification with no floor is indistinguishable from a button that does nothing.
  const started = Date.now();
  assert.equal(await verifyWithFeedback(Promise.resolve("verdict"), true), "verdict");
  assert.ok(Date.now() - started >= MINIMUM_FEEDBACK_MS - 25, "the new verdict must not flash past");
});

test("opening the task pane is not slowed down", async () => {
  const started = Date.now();
  assert.equal(await verifyWithFeedback(Promise.resolve("verdict"), false), "verdict");
  assert.ok(Date.now() - started < MINIMUM_FEEDBACK_MS, "only a user-triggered re-check needs the floor");
});

test("a failed re-check is held back the same way, so the error does not flash past", async () => {
  const started = Date.now();
  await assert.rejects(verifyWithFeedback(Promise.reject(new Error("no headers")), true), /no headers/);
  assert.ok(Date.now() - started >= MINIMUM_FEEDBACK_MS - 25);
});

/* ---------------------------------------------------------------- language */

test("the draft follows Outlook's interface language", () => {
  const german = suggestionDraft({ state: StampState.MISSING }, "de-DE");
  assert.equal(german.language, "de");
  assert.ok(german.plain.includes("Briefkasten"));
  assert.ok(german.html.includes("Briefkasten"));

  const swedish = suggestionDraft({ state: StampState.MISSING }, "sv-SE");
  assert.equal(swedish.language, "en");
  assert.ok(swedish.plain.includes("letterbox"));
});

test("the German failure variant reaches the draft with the verifier's reason", () => {
  const draft = suggestionDraft({ state: StampState.INVALID, reason: "Stempel ist zu alt" }, "de");
  assert.equal(draft.invalid, true);
  assert.ok(draft.plain.includes("Stempel ist zu alt"));
  assert.ok(!draft.plain.includes("letterbox"));
});

test("with no host language the draft is English rather than empty", () => {
  // Office.context is absent here, exactly as in the classic Windows runtime before it is ready.
  const draft = suggestionDraft({ state: StampState.MISSING });
  assert.equal(draft.language, "en");
  assert.ok(draft.plain.includes("letterbox"));
});

test("the German draft keeps one paragraph per HTML element, unwrapped", () => {
  const draft = suggestionDraft({ state: StampState.MISSING }, "de");
  assert.ok(!draft.html.includes("<br"), "no hard breaks: the reader's client wraps");
  assert.equal(draft.html.match(/<p>/g).length, draft.plain.split("\n\n").length);
});
