/**
 * The footer is the project's only spreading mechanism, and it edits the user's message, so its rules are tested as
 * carefully as the protocol: once only, the right body field, and never a claim the stamp does not support.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { PROJECT_URL, buildFooterPatch, footerPreview } from "../src/utils/footer.js";

test("a plain text body gets one line, separated by a blank line", () => {
  const patch = buildFooterPatch({ isPlainText: true, plainTextBody: "Hello.\n\n-- \nChristian\n" });
  assert.ok(patch.plainTextBody.startsWith("Hello.\n\n-- \nChristian\n"), "the original body is preserved verbatim");
  assert.ok(patch.plainTextBody.includes(PROJECT_URL));
  assert.equal(patch.body, undefined, "a plain text message must not gain an HTML body");
});

test("the plain footer adds no second signature delimiter", () => {
  const patch = buildFooterPatch({ isPlainText: true, plainTextBody: "Hi\n\n-- \nSignature\n" });
  assert.equal((patch.plainTextBody.match(/^-- $/gm) || []).length, 1,
    "signature-aware clients cut at the first delimiter; a second one would hide the signature");
});

test("an HTML body gets the footer inside the body element", () => {
  const patch = buildFooterPatch({ isPlainText: false, body: "<html><body><p>Hello.</p></body></html>" });
  assert.match(patch.body, /<p>Hello\.<\/p><p style=[^>]*>Sent with ESF/);
  assert.ok(patch.body.endsWith("</body></html>"), "the document structure stays intact");
  assert.equal(patch.plainTextBody, undefined);
});

test("an HTML fragment without a body element still gets the footer", () => {
  const patch = buildFooterPatch({ isPlainText: false, body: "<p>Hello.</p>" });
  assert.ok(patch.body.startsWith("<p>Hello.</p>"));
  assert.ok(patch.body.includes(PROJECT_URL));
});

test("the footer is added at most once, however often a draft is sent", () => {
  const first = buildFooterPatch({ isPlainText: true, plainTextBody: "Hello.\n" });
  const second = buildFooterPatch({ isPlainText: true, plainTextBody: first.plainTextBody });
  assert.deepEqual(second, {}, "no patch at all the second time");

  const html = buildFooterPatch({ isPlainText: false, body: "<body><p>Hi</p></body>" });
  assert.deepEqual(buildFooterPatch({ isPlainText: false, body: html.body }), {});
});

test("an empty or missing body is handled without producing junk", () => {
  assert.ok(buildFooterPatch({ isPlainText: true }).plainTextBody.includes(PROJECT_URL));
  assert.ok(buildFooterPatch({ isPlainText: false }).body.includes(PROJECT_URL));
});

test("the footer links the project and stays one line in plain text", () => {
  const preview = footerPreview();
  assert.ok(preview.includes(PROJECT_URL));
  assert.ok(!preview.includes("\n"), "one line, so it cannot dominate a short message");
  assert.ok(preview.length < 120);
});

test("the footer claims work, never identity or safety", () => {
  const preview = footerPreview().toLowerCase();
  assert.match(preview, /proof of work/);
  for (const forbidden of ["secure", "safe", "verified sender", "authentic", "trusted", "spam-free"]) {
    assert.ok(!preview.includes(forbidden), `the footer must not claim "${forbidden}"`);
  }
});
