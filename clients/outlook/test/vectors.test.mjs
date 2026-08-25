import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { extractEsfHeaders } from "../src/outlook-api/mimeHeaders.js";
import { StampState, verifyMessageStamps } from "../src/esf-core.js";

/**
 * Interoperability: the Outlook adapter must accept exactly the shared ESF test vectors that the Thunderbird client
 * generates and verifies (clients/thunderbird/test/vectors.json). No client-specific protocol variants.
 */
const vectors = JSON.parse(await readFile(new URL("../../thunderbird/test/vectors.json", import.meta.url), "utf8"));

for (const vector of vectors) {
  test(`shared vector ${vector.name} verifies through the Outlook read path`, async () => {
    // As delivered mail: the stamp arrives as a folded MIME header field, under either accepted name.
    const folded = `X-ESF-Stamp: ${vector.header.replace("; sid=", ";\r\n sid=")}\r\nFrom: ${vector.from}\r\n\r\n`;
    const { stampValues } = extractEsfHeaders(folded);
    assert.equal(stampValues.length, 1);
    const outcome = await verifyMessageStamps(stampValues, {
      localMailboxes: [vector.recipient],
      from: vector.from,
      now: vector.timestamp * 1000 + 1000,
      minDifficulty: 1,
      requireSenderBinding: false
    });
    assert.equal(outcome.state, StampState.STRONG, JSON.stringify(outcome.best));
  });
}
