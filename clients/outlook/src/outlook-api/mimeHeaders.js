/**
 * MIME header block handling for the read side.
 *
 * Outlook's getAllInternetHeadersAsync() returns the raw RFC 5322 header block of the message as one string. This
 * module unfolds continuation lines and collects every ESF stamp field. Input is hostile (it arrived by mail), so
 * everything is bounded before any parsing happens; the stamp grammar itself is enforced by the shared core parser.
 */

import { ACCEPTED_HEADER_NAMES } from "../esf-core.js";

/** The raw header block of a message may legitimately be large, but headers beyond this cannot matter to ESF. */
const MAX_HEADER_BLOCK_LENGTH = 512 * 1024;
const MAX_HEADER_LINES = 4000;

/**
 * Unfolds an RFC 5322 header block into "Name: value" lines.
 *
 * @param {string} block raw header text, possibly including the body after an empty line
 * @returns {string[]}
 */
export function unfoldHeaderBlock(block) {
  if (typeof block !== "string" || block.length === 0) {
    return [];
  }
  const text = block.length > MAX_HEADER_BLOCK_LENGTH ? block.slice(0, MAX_HEADER_BLOCK_LENGTH) : block;
  const blockEnd = text.search(/\r?\n\r?\n/);
  const headerPart = blockEnd === -1 ? text : text.slice(0, blockEnd);
  const unfolded = [];
  for (const line of headerPart.split(/\r?\n/)) {
    if (unfolded.length >= MAX_HEADER_LINES) {
      break;
    }
    if (/^[ \t]/.test(line) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += ` ${line.trim()}`;
    } else if (line !== "") {
      unfolded.push(line);
    }
  }
  return unfolded;
}

/**
 * Parses the timestamp out of a Received field: the date follows the final semicolon (RFC 5322 section 3.6.7).
 * Same client-side glue as the Thunderbird verificationService, kept in sync by test.
 *
 * @param {string} received
 * @returns {number|undefined} milliseconds, or undefined when there is nothing usable
 */
export function parseReceivedTime(received) {
  if (typeof received !== "string") {
    return undefined;
  }
  const semicolon = received.lastIndexOf(";");
  if (semicolon === -1) {
    return undefined;
  }
  const parsed = Date.parse(received.slice(semicolon + 1).trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Extracts what the verifier needs from a raw header block: every ESF-Stamp / X-ESF-Stamp field value, the carrier
 * Message-ID and From as fallbacks for clients that expose neither through the item API, plus the reference instant
 * for stamp freshness - the *topmost* Received field (written by the receiving infrastructure, not the sender's to
 * choose) with the sender-controlled Date header only as fallback.
 *
 * @param {string} block output of getAllInternetHeadersAsync()
 * @returns {{stampValues: string[], messageId: string, from: string, receivedAt: number|undefined,
 *            dateMs: number|undefined}}
 */
export function extractEsfHeaders(block) {
  const stampValues = [];
  let messageId = "";
  let from = "";
  let receivedAt;
  let dateMs;
  for (const line of unfoldHeaderBlock(block)) {
    const colon = line.indexOf(":");
    if (colon < 1) {
      continue;
    }
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (ACCEPTED_HEADER_NAMES.includes(name)) {
      stampValues.push(value);
    } else if (name === "message-id" && !messageId) {
      messageId = value;
    } else if (name === "from" && !from) {
      from = value;
    } else if (name === "received" && receivedAt === undefined) {
      receivedAt = parseReceivedTime(value);
    } else if (name === "date" && dateMs === undefined) {
      const parsed = Date.parse(value);
      dateMs = Number.isFinite(parsed) ? parsed : undefined;
    }
  }
  return { stampValues, messageId, from, receivedAt, dateMs };
}
