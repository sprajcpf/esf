/**
 * Deciding whether suggesting ESF to a sender makes any sense.
 *
 * The button that offers this sits on messages without an accepted stamp, which today is almost every message. Two
 * things therefore have to be prevented, or the feature turns the add-on into a nuisance:
 *
 *  - **Pointless replies.** Newsletters, ticket systems, delivery notifications and no-reply addresses do not have a
 *    person at the other end who can install anything. A reply there is noise at best.
 *  - **Confirming an address.** Replying to an unknown sender proves the mailbox is real and read. For legitimate
 *    correspondence that is harmless; for spam it is the one thing not to do. The interface has to say so, because
 *    "no stamp" looks identical in both cases.
 *
 * Nothing here is a spam verdict. It only distinguishes "there might be a person to talk to" from "there is not".
 */

/** Header fields that mark mail as coming from a machine or a list rather than a correspondent. */
const LIST_HEADERS = ["list-id", "list-unsubscribe", "list-post", "list-help", "mailing-list"];
const AUTOMATED_HEADERS = ["auto-submitted", "x-auto-response-suppress", "x-autoreply", "x-autorespond"];

/** Local-parts that exist to refuse replies. */
const NO_REPLY = /^(no[-._]?reply|do[-._]?not[-._]?reply|donotreply|noreply|bounce|mailer[-._]?daemon|postmaster)$/i;

/**
 * @param {object} input
 * @param {Record<string, string[]|string>} [input.headers] header dictionary as returned by messages.getHeaders
 * @param {string} [input.author] the From value
 * @returns {{list: boolean, automated: boolean, noReply: boolean, replyable: boolean, reason: string|null}}
 */
export function classifySender({ headers = {}, author = "" } = {}) {
  const names = new Set(Object.keys(headers).map(name => name.toLowerCase()));
  const value = name => {
    const entry = headers[name] ?? headers[name.toLowerCase()];
    const first = Array.isArray(entry) ? entry[0] : entry;
    return typeof first === "string" ? first.toLowerCase() : "";
  };

  const list = LIST_HEADERS.some(name => names.has(name)) ||
    ["list", "bulk"].includes(value("precedence").trim());
  // Auto-Submitted: no means "a human sent this", which is the one value that does not mark automation (RFC 3834).
  const autoSubmitted = value("auto-submitted");
  const automated = (autoSubmitted && autoSubmitted !== "no") ||
    AUTOMATED_HEADERS.some(name => name !== "auto-submitted" && names.has(name));

  const localPart = String(author).replace(/^.*<|>.*$/g, "").split("@")[0] || "";
  const noReply = NO_REPLY.test(localPart.trim());

  let reason = null;
  if (list) {
    reason = "This came through a mailing list, so a reply would not reach whoever wrote it.";
  } else if (automated) {
    reason = "This was sent automatically, so there is nobody at the other end to ask.";
  } else if (noReply) {
    reason = "This came from an address that does not accept replies.";
  }
  return { list, automated, noReply, replyable: reason === null, reason };
}
