/**
 * Appends the ESF footer to a message Outlook is about to send.
 *
 * The text is imported rather than copied, so the two clients cannot drift into advertising ESF differently. It moves
 * to packages/ together with the protocol core (roadmap stage 2).
 *
 * The text exists in German and English, chosen by Outlook's interface language, and comes from the same table the
 * Thunderbird client reads.
 *
 * Office.js has an API made exactly for this: `body.appendOnSendAsync` adds text at send time without touching the
 * body the user is still editing. It needs Mailbox requirement set 1.13, so a client that cannot do it simply sends
 * without a footer - the stamp is the point, the footer is the advertisement.
 */

// eslint-disable-next-line import/no-relative-parent-imports -- shared product text, see the note above
import { footerFor } from "../../../thunderbird/src/utils/footer.js";
import { isMailboxSetSupported } from "../outlook-api/capabilities.js";
import { clientLocale } from "../outlook-api/locale.js";

/** Requirement set that introduced body.appendOnSendAsync. */
const APPEND_ON_SEND_SET = "1.13";

/** @returns {boolean} whether this client can append at send time at all */
export function canAppendFooter() {
  return isMailboxSetSupported(APPEND_ON_SEND_SET);
}

/**
 * Appends the footer to `item`, if the platform supports it.
 *
 * Only ever called for a message that actually carries a stamp: the line must never advertise work that was not
 * done. Failure is not fatal - a message without a footer is still a stamped message.
 *
 * @param {object} item the current Office.js item
 * @returns {Promise<boolean>} whether a footer was appended
 */
export async function appendFooter(item) {
  if (!canAppendFooter() || !item || !item.body || typeof item.body.appendOnSendAsync !== "function") {
    return false;
  }

  const coercionType = await bodyType(item);
  // Outlook's interface language, matching the sender suggestion: a German message should not carry an English line.
  const footer = footerFor(clientLocale());
  const text = coercionType === "html" ? footer.html : footer.plain;
  const options = globalThis.Office?.CoercionType
    ? { coercionType: coercionType === "html" ? Office.CoercionType.Html : Office.CoercionType.Text }
    : {};

  return new Promise(resolve => {
    try {
      item.body.appendOnSendAsync(text, options, result => {
        resolve(result?.status === globalThis.Office?.AsyncResultStatus?.Succeeded);
      });
    } catch {
      resolve(false);
    }
  });
}

/** Resolves "html" or "text"; anything unclear is treated as text, which is safe in an HTML body too. */
function bodyType(item) {
  return new Promise(resolve => {
    if (typeof item.body.getTypeAsync !== "function") {
      resolve("text");
      return;
    }
    try {
      item.body.getTypeAsync(result => {
        const html = globalThis.Office?.CoercionType?.Html;
        resolve(result?.status === globalThis.Office?.AsyncResultStatus?.Succeeded && result.value === html
          ? "html"
          : "text");
      });
    } catch {
      resolve("text");
    }
  });
}
