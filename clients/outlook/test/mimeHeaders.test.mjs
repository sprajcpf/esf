import test from "node:test";
import assert from "node:assert/strict";

import { extractEsfHeaders, parseReceivedTime, unfoldHeaderBlock } from "../src/outlook-api/mimeHeaders.js";

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

test("parseReceivedTime reads the date after the final semicolon (RFC 5322 3.6.7)", () => {
  const received = "from mx.example.org (mx.example.org [192.0.2.1]) by mail.example.com; Tue, 25 Aug 2026 10:15:00 +0200";
  assert.equal(parseReceivedTime(received), Date.parse("Tue, 25 Aug 2026 10:15:00 +0200"));
  assert.equal(parseReceivedTime("no semicolon here"), undefined);
  assert.equal(parseReceivedTime("by host; not a date"), undefined);
  assert.equal(parseReceivedTime(undefined), undefined);
});

test("extractEsfHeaders takes the topmost Received and the Date header as freshness references", () => {
  const block = [
    "Received: from a by b; Tue, 25 Aug 2026 10:15:00 +0200",
    "Received: from c by a; Tue, 25 Aug 2026 10:14:00 +0200",
    "Date: Tue, 25 Aug 2026 10:13:00 +0200",
    "ESF-Stamp: stamp"
  ].join("\r\n");
  const { receivedAt, dateMs } = extractEsfHeaders(block);
  assert.equal(receivedAt, Date.parse("Tue, 25 Aug 2026 10:15:00 +0200"));
  assert.equal(dateMs, Date.parse("Tue, 25 Aug 2026 10:13:00 +0200"));
});

test("extractEsfHeaders survives a huge hostile block", () => {
  const block = `${"junk: x\n".repeat(100000)}X-ESF-Stamp: late`;
  const { stampValues } = extractEsfHeaders(block);
  // The stamp sits behind the line/size bounds; the point is bounded work, not finding it.
  assert.ok(Array.isArray(stampValues));
});
