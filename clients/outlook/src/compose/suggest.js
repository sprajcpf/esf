/**
 * Offering to tell a sender about ESF - and mostly deciding not to.
 *
 * The button this module backs sits on messages without an accepted stamp, which today is very nearly every message.
 * That makes restraint the actual feature. Two things have to be prevented:
 *
 *  - **Pointless mail.** Newsletters, ticket systems and no-reply addresses have no person behind them who could
 *    install anything, so the offer is withheld there and the reason is shown instead of the button. The decision is
 *    the shared classifySender, never a copy of it.
 *  - **Confirming an address.** Replying to an unknown sender proves the mailbox is real and read - harmless for a
 *    colleague, the worst possible move for spam, and a missing stamp looks identical in both cases. The note next
 *    to the button says so, in the same words the Thunderbird popup uses.
 *
 * And whatever the user decides, this only ever opens a *draft*. The add-in never sends mail on their behalf.
 */

import {
  PROJECT_URL,
  SUGGESTION_LABELS,
  SUGGESTION_NOTE,
  suggestionFor,
  textLanguage,
  Signal,
  StampState
} from "../esf-core.js";
import { isMailboxSetSupported } from "../outlook-api/capabilities.js";
import { clientLocale } from "../outlook-api/locale.js";

/**
 * Requirement set that introduced displayReplyFormAsync, the only variant that reports whether the draft opened.
 * The synchronous displayReplyForm (Mailbox 1.1) is the fallback for older clients; it returns nothing, so there a
 * missing window is indistinguishable from success.
 */
const REPLY_FORM_ASYNC_SET = "1.9";

/**
 * Whether the interface may offer to write to this sender, plus the wording that goes with the answer.
 *
 * DOM-free on purpose: this is the whole product decision, and it is testable without an Outlook webview. The offer
 * needs both halves - a red light (nothing to say about a message that already carries work) and a sender who can
 * actually be reached. Where the light is red but the sender cannot be reached, the reason takes the button's place
 * so the absence is explained rather than mysterious.
 *
 * @param {object} result a verifyCurrentMessage result
 * @returns {{offer: boolean, label: string, note: string}}
 */
export function suggestionOffer(result = {}) {
  const red = (result.signal || Signal.RED) === Signal.RED;
  const sender = result.sender || {};
  // An Outlook without header access (pre-Mailbox 1.8) cannot tell a mailing list from a person, and a classifier
  // fed nothing says "replyable" - which is exactly the wrong default for a button that writes to strangers.
  const informed = result.headersAvailable !== false;
  const offer = red && informed && sender.replyable === true;
  const label = result.state === StampState.INVALID ? SUGGESTION_LABELS.invalid : SUGGESTION_LABELS.missing;
  const note = offer
    ? SUGGESTION_NOTE
    : red && !informed
      ? "This Outlook cannot read the message's headers, so there is no telling whether a reply would reach a person."
      : red && sender.reason ? sender.reason : "";
  return { offer, label, note };
}

/** Text that lands in a message body, so every character a sender controls is neutralised first. */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Turns the shared plain-text body into HTML, because Outlook's reply form takes only HTML.
 *
 * One rule survives the conversion and matters: a paragraph stays **one unbroken line**. Each blank-line-separated
 * paragraph becomes a single <p>, and no <br> is inserted inside one, so the recipient's mail client wraps the text
 * to their own window instead of showing the ragged mid-sentence breaks of a machine-generated message.
 *
 * @param {string} plain the body from suggestionFor(locale).*.body()
 * @returns {string} HTML paragraphs
 */
export function htmlParagraphs(plain) {
  return String(plain)
    .split(/\n{2,}/)
    .map(paragraph => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter(paragraph => paragraph !== "")
    .map(paragraph => paragraph === PROJECT_URL
      // The link is the one thing the reader has to be able to act on; everything else stays inert text.
      ? `<p><a href="${escapeHtml(PROJECT_URL)}">${escapeHtml(PROJECT_URL)}</a></p>`
      : `<p>${escapeHtml(paragraph)}</p>`)
    .join("\n");
}

/**
 * Builds the draft body for a verification outcome.
 *
 * A stamp that was present but rejected gets the other variant: telling a fellow ESF user "you should try ESF" would
 * be nonsense, and the verifier's own reason is quoted so they have something to act on.
 *
 * The language is Outlook's interface language, so a German user gets the German text - the user's own, not the
 * sender's, because it is their draft and the only language that can actually be known.
 *
 * @param {{state?: string, reason?: string}} result
 * @param {string} [locale] override, for tests and for a caller that already resolved it
 * @returns {{invalid: boolean, plain: string, html: string, language: string}}
 */
export function suggestionDraft(result = {}, locale = clientLocale()) {
  const invalid = result.state === StampState.INVALID;
  const text = suggestionFor(locale);
  const plain = invalid
    ? text.invalid.body(PROJECT_URL, result.reason)
    : text.missing.body(PROJECT_URL);
  return { invalid, plain, html: htmlParagraphs(plain), language: textLanguage(locale) };
}

/** @param {any} item a read-mode mailbox item @returns {boolean} whether any reply form API is reachable */
export function canOpenReplyDraft(item) {
  return Boolean(item && (typeof item.displayReplyFormAsync === "function" ||
    typeof item.displayReplyForm === "function"));
}

/**
 * Opens a reply draft carrying the suggestion. Reply, not reply-all: the message is addressed to whoever wrote, and
 * copying a mailing list or every other recipient into a note about mail software would be exactly the nuisance this
 * feature is built to avoid.
 *
 * Never sends. There is no Office.js call here that could send, and there must not be one added.
 *
 * @param {any} item a read-mode mailbox item
 * @param {{state?: string, reason?: string}} result the verification outcome the draft is written about
 * @returns {Promise<{ok: boolean, reason?: string}>} a failure reason fit for showing to the user
 */
export async function openSuggestionDraft(item, result = {}) {
  const { html } = suggestionDraft(result);
  // The subject stays the reply subject Outlook generates: rewriting it on a reply breaks the thread.
  const formData = { htmlBody: html };
  // The requirement set picks the better call, but it never strands a client: a host that has the function and no
  // synchronous fallback is asked anyway, because refusing on a version string it may report badly is worse.
  const preferAsync = typeof item?.displayReplyFormAsync === "function" &&
    (isMailboxSetSupported(REPLY_FORM_ASYNC_SET) || typeof item.displayReplyForm !== "function");
  if (preferAsync) {
    return new Promise(resolve => {
      try {
        item.displayReplyFormAsync(formData, asyncResult => {
          const succeeded = globalThis.Office?.AsyncResultStatus?.Succeeded || "succeeded";
          const status = asyncResult && asyncResult.status;
          const failed = status && status !== succeeded;
          resolve(failed
            ? { ok: false, reason: (asyncResult.error && asyncResult.error.message) || String(status) }
            : { ok: true });
        });
      } catch (error) {
        resolve({ ok: false, reason: message(error) });
      }
    });
  }
  if (typeof item?.displayReplyForm === "function") {
    try {
      // Fire and forget: the pre-1.9 call reports nothing, so this claims success only in the sense that Outlook
      // accepted the request.
      item.displayReplyForm(formData);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: message(error) };
    }
  }
  return { ok: false, reason: "This Outlook cannot open a reply from an add-in." };
}

function message(error) {
  return String(error && error.message ? error.message : error);
}
