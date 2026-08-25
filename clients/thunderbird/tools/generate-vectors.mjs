/**
 * Regenerates test/vectors.json - deterministic ESF-Stamp test vectors for cross-implementation testing.
 *
 * Everything is fixed: mailboxes, timestamp, salt and Message-ID, and the nonce is the *first* solution found when
 * counting up from 0. Any change to canonicalisation, token derivation or the canonical work input breaks the vector
 * test, which is exactly the point. Whitepaper 4.1 asks for reusable test vectors across implementations.
 *
 * Usage: npm run vectors
 */

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { serializeStamp } from "../src/protocol/parser.js";
import {
  buildWorkBase,
  buildWorkInput,
  messageIdToken,
  recipientToken,
  searchNonce,
  senderToken
} from "../src/protocol/stamp.js";

const here = dirname(fileURLToPath(import.meta.url));

const FROM = "Sender <Sender@Example.ORG>";
const MESSAGE_ID = "<6f1a2c34-0000-4000-8000-000000000001@esf.invalid>";
const TIMESTAMP = 1787651400;
const SALT = "8f2c1d4ea7b3906512c0de77a15be340";

const CASES = [
  { name: "d8", recipient: "alice@example.com", difficulty: 8 },
  { name: "d12", recipient: "alice@example.com", difficulty: 12 },
  { name: "d16", recipient: "Bob.Smith@Example.ORG", difficulty: 16 },
  { name: "d20", recipient: "carol@example.net", difficulty: 20 },
  { name: "d12-mixed-case-local-part", recipient: "CaseSensitive@example.net", difficulty: 12 }
];

const vectors = [];
for (const testCase of CASES) {
  const stamp = {
    version: 1,
    algorithm: "sha256",
    difficulty: testCase.difficulty,
    timestamp: TIMESTAMP,
    sid: await senderToken(FROM),
    rid: await recipientToken(testCase.recipient, SALT),
    mid: await messageIdToken(MESSAGE_ID),
    salt: SALT,
    profileParams: {}
  };
  const workBase = buildWorkBase(stamp);
  const result = await searchNonce({ workBase, difficulty: testCase.difficulty, batchSize: 50000 });
  const complete = { ...stamp, nonce: result.nonce };
  vectors.push({
    name: testCase.name,
    from: FROM,
    recipient: testCase.recipient,
    messageId: MESSAGE_ID,
    timestamp: TIMESTAMP,
    salt: SALT,
    difficulty: testCase.difficulty,
    sid: stamp.sid,
    rid: stamp.rid,
    mid: stamp.mid,
    nonce: result.nonce,
    hash: result.hash,
    workInput: buildWorkInput(stamp, result.nonce),
    header: serializeStamp(complete)
  });
  console.log(`${testCase.name}: nonce=${result.nonce} after ${result.hashes} hashes`);
}

await writeFile(join(here, "..", "test", "vectors.json"), `${JSON.stringify(vectors, null, 2)}\n`, "utf8");
console.log(`wrote ${vectors.length} vectors`);
