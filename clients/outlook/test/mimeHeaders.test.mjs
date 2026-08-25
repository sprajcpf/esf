import test from "node:test";
import assert from "node:assert/strict";

import { extractEsfHeaders, unfoldHeaderBlock } from "../src/outlook-api/mimeHeaders.js";

test("unfoldHeaderBlock joins folded continuation lines", () => {
  const block = "Subject: hello\r\nX-ESF-Stamp: v=1; alg=sha256;\r\n d=8; t=1\r\nFrom: a@b.c\r\n\r\nBody: not-a-header";
  assert.deepEqual(unfoldHeaderBlock(block), [
    "Subject: hello",
    "X-ESF-Stamp: v=1; alg=sha256; d=8; t=1",
    "From: a@b.c"
  ]);
});

test("unfoldHeaderBlock stops at the empty line before the body", () => {
  const lines = unfoldHeaderBlock("A: 1\n\nX-ESF-Stamp: sneaky");
  assert.deepEqual(lines, ["A: 1"]);
});

test("unfoldHeaderBlock tolerates non-string and empty input", () => {
  assert.deepEqual(unfoldHeaderBlock(undefined), []);
  assert.deepEqual(unfoldHeaderBlock(""), []);
});

test("extractEsfHeaders collects both accepted header names, case-insensitively", () => {
  const block = [
    "Message-ID: <real@carrier>",
    "From: Alice <alice@example.com>",
    "x-esf-stamp: first",
    "ESF-Stamp: second",
    "X-Other: ignored"
  ].join("\r\n");
  const { stampValues, messageId, from } = extractEsfHeaders(block);
  assert.deepEqual(stampValues, ["first", "second"]);
  assert.equal(messageId, "<real@carrier>");
  assert.equal(from, "Alice <alice@example.com>");
});

test("extractEsfHeaders keeps only the first Message-ID and From", () => {
  const { messageId, from } = extractEsfHeaders("Message-ID: <one>\nMessage-ID: <two>\nFrom: a@b.c\nFrom: x@y.z");
  assert.equal(messageId, "<one>");
  assert.equal(from, "a@b.c");
});

test("extractEsfHeaders survives a huge hostile block", () => {
  const block = `${"junk: x\n".repeat(100000)}X-ESF-Stamp: late`;
  const { stampValues } = extractEsfHeaders(block);
  // The stamp sits behind the line/size bounds; the point is bounded work, not finding it.
  assert.ok(Array.isArray(stampValues));
});
