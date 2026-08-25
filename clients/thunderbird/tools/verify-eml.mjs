/**
 * Verifies the ESF stamps of one or more .eml files from the command line - the same protocol code the add-on runs,
 * without Thunderbird.
 *
 * Usage: node tools/verify-eml.mjs <file.eml> [more.eml ...] [--as me@example.com]
 *
 * `--as` overrides the recipient the stamp is checked against; by default every mailbox found in To and Cc is tried,
 * which is what a receiving client does with its own identities.
 */

import { readFile } from "node:fs/promises";

import { ACCEPTED_HEADER_NAMES, StampState } from "../src/protocol/constants.js";
import { parseStampList } from "../src/protocol/parser.js";
import { canonicalMailbox } from "../src/protocol/stamp.js";
import { verifyStamp } from "../src/protocol/verifier.js";

/** Splits an RFC 5322 header block into unfolded name/value pairs. */
function parseHeaders(raw) {
  const end = raw.search(/\r?\n\r?\n/);
  const block = end === -1 ? raw : raw.slice(0, end);
  const unfolded = [];
  for (const line of block.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += ` ${line.trim()}`;
    } else {
      unfolded.push(line);
    }
  }
  return unfolded
    .map(line => {
      const colon = line.indexOf(":");
      return colon < 1 ? null : { name: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() };
    })
    .filter(Boolean);
}

const mailboxes = value => value.split(",").map(canonicalMailbox).filter(Boolean);

const asIndex = process.argv.indexOf("--as");
const override = asIndex !== -1 ? process.argv[asIndex + 1] : null;
const files = process.argv.slice(2).filter((argument, index, all) =>
  argument !== "--as" && all[index - 1] !== "--as");

if (files.length === 0) {
  console.error("usage: node tools/verify-eml.mjs <file.eml> [...] [--as me@example.com]");
  process.exit(1);
}

let missing = 0;
for (const file of files) {
  const headers = parseHeaders(await readFile(file, "utf8"));
  const get = name => headers.filter(header => header.name.toLowerCase() === name).map(header => header.value);
  const subject = get("subject")[0] || "(no subject)";
  const from = get("from")[0] || "";
  const messageId = get("message-id")[0] || "";
  const recipients = override
    ? [canonicalMailbox(override)].filter(Boolean)
    : [...get("to"), ...get("cc")].flatMap(mailboxes);
  const stampHeaders = headers
    .filter(header => ACCEPTED_HEADER_NAMES.includes(header.name.toLowerCase()))
    .map(header => header.value);

  console.log(`\n=== ${subject}`);
  console.log(`from        ${from}`);
  console.log(`recipients  ${recipients.join(", ") || "(none found)"}`);
  console.log(`message-id  ${messageId}`);

  if (stampHeaders.length === 0) {
    console.log("stamp       NONE - this message carries no ESF stamp");
    missing++;
    continue;
  }

  const entries = stampHeaders.flatMap(value => parseStampList(value));
  console.log(`stamp       ${entries.length} stamp(s) in ${stampHeaders.length} header field(s)`);

  for (const entry of entries) {
    if (!entry.ok) {
      console.log(`  MALFORMED  ${entry.detail}`);
      continue;
    }
    const stamp = entry.stamp;
    const when = new Date(stamp.timestamp * 1000).toISOString();
    console.log(`  alg=${stamp.algorithm} d=${stamp.difficulty} t=${stamp.timestamp} (${when}) ` +
      `nonce=${stamp.nonce} salt=${stamp.salt}`);
    for (const recipient of recipients) {
      const result = await verifyStamp(stamp, {
        localMailboxes: [recipient],
        from,
        // The prototype binds a self-minted identifier, so the carrier Message-ID is not comparable.
        messageId: undefined,
        minDifficulty: 1,
        requireSenderBinding: false
      });
      const marker = result.state === StampState.STRONG ? "OK  " : "    ";
      const bits = result.leadingZeroBits !== undefined
        ? `, ${result.leadingZeroBits} leading zero bits found`
        : "";
      console.log(`  ${marker}as ${recipient}: ${result.signal}/${result.state}/${result.reason}${bits}` +
        (result.senderBound === false ? " [sid does not match From]" : "") +
        (result.detail ? ` [${result.detail}]` : ""));
      if (result.hash) {
        console.log(`       digest ${result.hash}`);
      }
    }
  }
}

if (missing > 0) {
  console.log(`\n${missing} of ${files.length} message(s) carried no stamp`);
}
