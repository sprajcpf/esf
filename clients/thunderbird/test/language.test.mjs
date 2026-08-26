import test from "node:test";
import assert from "node:assert/strict";

import {
  SUGGESTION,
  SUGGESTION_LABELS,
  SUGGESTION_NOTE,
  SUGGESTION_TEXTS,
  TEXT_LANGUAGES,
  suggestionFor,
  textLanguage
} from "../src/ui/strings.js";
import { FOOTERS, PROJECT_URL, buildFooterPatch, footerFor, footerPreview } from "../src/utils/footer.js";

/* ---------------------------------------------------------------- choosing the language */

test("a German client gets German, whatever shape the locale arrives in", () => {
  for (const locale of ["de", "de-DE", "de-AT", "de-CH", "de_DE", "DE", "De-de", " de-DE "]) {
    assert.equal(textLanguage(locale), "de", locale);
  }
});

test("every other language gets English, including no answer at all", () => {
  for (const locale of ["en", "en-GB", "fr", "fr-CA", "nl", "da", "deutsch", "german", "", "   ", undefined, null,
    42, {}]) {
    assert.equal(textLanguage(locale), "en", String(locale));
  }
});

test("the footer and the suggestion never disagree about the language", () => {
  // Same reducer, so a message cannot end up with a German body and an English footer.
  for (const locale of ["de-DE", "en-US", "es", undefined]) {
    const language = textLanguage(locale);
    assert.equal(suggestionFor(locale), SUGGESTION_TEXTS[language]);
    assert.equal(footerFor(locale), FOOTERS[language]);
  }
});

test("both text tables cover exactly the declared languages", () => {
  assert.deepEqual(TEXT_LANGUAGES, ["en", "de"]);
  assert.deepEqual(Object.keys(FOOTERS), TEXT_LANGUAGES);
});

test("SUGGESTION stays the English text, for callers that know no locale", () => {
  assert.equal(SUGGESTION, SUGGESTION_TEXTS.en);
});

/* ---------------------------------------------------------------- the German mail */

const GERMAN = suggestionFor("de-DE");

test("the German suggestion tells the same story rather than translating the words", () => {
  const body = GERMAN.missing.body(PROJECT_URL);
  for (const word of ["Briefkasten", "Porto", "Rechenzeit", "Million"]) {
    assert.ok(body.includes(word), `expected the German text to use "${word}"`);
  }
  assert.ok(body.includes(PROJECT_URL));
  assert.ok(body.length < 1000, "still short enough to be read");
});

test("the German suggestion carries no jargon either", () => {
  const text = `${GERMAN.missing.body(PROJECT_URL)} ${GERMAN.missing.subject}`.toLowerCase();
  for (const word of ["hash", "nonce", "bit", "algorithm", "header", "proof of work", "arbeitsnachweis", "mining",
    "krypto", "protokoll", "sha", "verschlüssel"]) {
    assert.ok(!text.includes(word), `the German text must not say "${word}"`);
  }
});

test("the German suggestion addresses the reader as Sie, consistently", () => {
  const body = GERMAN.missing.body(PROJECT_URL);
  // An unwanted "du" to a stranger is the wrong note; the user can still change it in the draft.
  assert.ok(/\bIhre\b/.test(body) && /\bSie\b/.test(body));
  assert.ok(!/\bdein|\bdeine|\bdu\b/i.test(body), "no mixed forms of address");
});

test("the German suggestion asks for nothing and blames nobody", () => {
  const body = GERMAN.missing.body(PROJECT_URL);
  assert.ok(body.includes("gut angekommen"), "it opens by saying the message was fine");
  assert.ok(body.includes("nicht nötig"), "and closes without asking for a reply");
});

test("the German failure variant quotes the verifier and never leaks undefined", () => {
  const withReason = GERMAN.invalid.body(PROJECT_URL, "Stempel ist zu alt");
  assert.ok(withReason.includes("Stempel ist zu alt"));
  assert.ok(!GERMAN.invalid.body(PROJECT_URL).includes("undefined"));
  assert.notEqual(GERMAN.invalid.subject, GERMAN.missing.subject);
});

test("German is a different text from English, not the same one with umlauts", () => {
  const english = suggestionFor("en");
  assert.notEqual(GERMAN.missing.body(PROJECT_URL), english.missing.body(PROJECT_URL));
  assert.notEqual(GERMAN.missing.subject, english.missing.subject);
});

test("no paragraph is pre-wrapped, in either language", () => {
  // The reason this rule exists: a mail client wraps to the reader's window, and wrapping it here produces the
  // ragged half-line look of a machine-generated message.
  for (const language of TEXT_LANGUAGES) {
    const text = SUGGESTION_TEXTS[language];
    for (const body of [text.missing.body(PROJECT_URL), text.invalid.body(PROJECT_URL, "reason")]) {
      for (const paragraph of body.split("\n\n")) {
        assert.ok(!paragraph.includes("\n"), `${language}: paragraph is pre-wrapped: ${paragraph.slice(0, 40)}`);
      }
    }
  }
});

/* ---------------------------------------------------------------- the German footer */

test("the German footer keeps the postage comparison and the link", () => {
  const footer = footerFor("de");
  assert.ok(footer.plain.includes("Porto"));
  assert.ok(footer.plain.includes(PROJECT_URL));
  assert.ok(footer.html.includes(`href="${PROJECT_URL}"`));
  assert.ok(!footer.plain.includes("proof of work"));
});

test("a German client appends the German footer, plain and HTML", () => {
  const plain = buildFooterPatch({ isPlainText: true, plainTextBody: "Guten Tag.\n" }, "de-DE");
  assert.ok(plain.plainTextBody.includes("Mit ESF gesendet"));
  const html = buildFooterPatch({ isPlainText: false, body: "<body><p>Guten Tag.</p></body>" }, "de-DE");
  assert.ok(html.body.includes("Porto"));
  assert.ok(html.body.indexOf("Porto") < html.body.indexOf("</body>"), "still inside the body element");
});

test("an unknown client language appends the English footer", () => {
  const patch = buildFooterPatch({ isPlainText: true, plainTextBody: "Hi.\n" }, "sv-SE");
  assert.ok(patch.plainTextBody.includes("proof of work"));
});

test("a footer in one language is not doubled by a send in another", () => {
  // The marker is the URL, which every translation shares - a draft written in German and sent from an English
  // profile must not end up with two footers.
  const german = buildFooterPatch({ isPlainText: true, plainTextBody: "Hallo.\n" }, "de");
  assert.deepEqual(buildFooterPatch({ isPlainText: true, plainTextBody: german.plainTextBody }, "en"), {});
  const englishHtml = buildFooterPatch({ isPlainText: false, body: "<p>Hi.</p>" }, "en");
  assert.deepEqual(buildFooterPatch({ isPlainText: false, body: englishHtml.body }, "de"), {});
});

test("the options page previews the footer the user will actually get", () => {
  assert.equal(footerPreview("de-DE"), FOOTERS.de.plain);
  assert.equal(footerPreview("en-US"), FOOTERS.en.plain);
  assert.equal(footerPreview(), FOOTERS.en.plain);
});

/* ---------------------------------------------------------------- what is deliberately not translated */

test("the interface wording around the button stays one language", () => {
  // A single German button in an otherwise English panel reads as a bug. Interface localisation is a job for the
  // whole surface at once, and this test records that this was a decision rather than an omission.
  assert.equal(typeof SUGGESTION_LABELS.missing, "string");
  assert.ok(SUGGESTION_NOTE.includes("a reply"));
});
