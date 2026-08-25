/**
 * Regenerates test/vectors.json.
 *
 * The vectors are fully deterministic: fixed recipient, timestamp, message id and salt, and the nonce is the *first*
 * one found when counting up from 0. Any change to the canonicalisation or to the hash will therefore break the
 * vector test - which is exactly the point.
 *
 * Usage: npm run vectors
 */

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { serializeProof } from "../src/protocol/parser.js";
import { buildPreimageBase, recipientId, searchNonce } from "../src/protocol/pow.js";

const here = dirname(fileURLToPath(import.meta.url));

const CASES = [
  { name: "8-bit", recipient: "alice@example.com", bits: 8 },
  { name: "12-bit", recipient: "alice@example.com", bits: 12 },
  { name: "16-bit", recipient: "bob@example.org", bits: 16 },
  { name: "20-bit", recipient: "carol@example.net", bits: 20 },
  { name: "20-bit-hidden-recipient", recipient: "dave@example.net", bits: 20, hidden: true }
];

const TIMESTAMP = "20260825T103800Z";
const MESSAGE_ID = "6f1a2c34-0000-4000-8000-000000000001@esf.invalid";
const SALT = "8f2c1d4ea7b3906512c0de77a15be340";

const vectors = [];
for (const testCase of CASES) {
  const base = buildPreimageBase({
    recipient: testCase.recipient,
    timestamp: TIMESTAMP,
    messageId: MESSAGE_ID,
    salt: SALT
  });
  const result = await searchNonce({ base, bits: testCase.bits, batchSize: 50000 });
  const proof = {
    version: 1,
    algorithm: "sha256",
    bits: testCase.bits,
    timestamp: TIMESTAMP,
    recipient: testCase.hidden ? null : testCase.recipient,
    recipientHash: testCase.hidden ? await recipientId(SALT, testCase.recipient) : null,
    messageId: MESSAGE_ID,
    nonce: result.nonce,
    salt: SALT
  };
  vectors.push({
    name: testCase.name,
    recipient: testCase.recipient,
    hiddenRecipient: testCase.hidden === true,
    timestamp: TIMESTAMP,
    messageId: MESSAGE_ID,
    salt: SALT,
    bits: testCase.bits,
    nonce: result.nonce,
    hash: result.hash,
    preimage: `${base}|${result.nonce}`,
    header: serializeProof(proof)
  });
  console.log(`${testCase.name}: nonce=${result.nonce} after ${result.hashes} hashes`);
}

await writeFile(join(here, "..", "test", "vectors.json"), `${JSON.stringify(vectors, null, 2)}\n`, "utf8");
console.log(`wrote ${vectors.length} vectors`);
