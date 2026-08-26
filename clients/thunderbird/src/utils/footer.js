/**
 * The one-line footer appended to a stamped message.
 *
 * Purpose is spread: a recipient who sees a stamped message learns what made it verifiable and where to get the same
 * thing. Three rules keep that honest:
 *
 *  - it is only ever added to a message that actually carries a stamp, so the line never advertises work that was
 *    not done;
 *  - it is added at most once, no matter how often a draft is saved and sent;
 *  - it claims nothing about identity or safety - the same discipline as the rest of the UI.
 *
 * Like the sender suggestion it exists in German and English, chosen by the language of the mail client. A German
 * user writing a German mail should not have an English line stapled to the bottom of it, and the line is the first
 * thing a recipient reads about ESF - in a language they may not speak, it advertises nothing.
 */

// eslint-disable-next-line import/no-cycle -- one-way: strings.js knows nothing about the footer
import { textLanguage } from "../ui/strings.js";

export const PROJECT_URL = "https://github.com/sprajcpf/esf";

/**
 * The marker used to detect a footer that is already there: the URL, which no other line will contain.
 *
 * Language-independent on purpose. A draft started in one language and sent in another must not end up with two
 * footers, and the URL is the one part that is the same in every translation.
 */
const MARKER = PROJECT_URL;

const html = text =>
  `<p style="margin-top:1em;font-size:small;color:#5b6472">${text} ` +
  `<a href="${PROJECT_URL}" style="color:#1a4a9c">${PROJECT_URL.replace("https://", "")}</a></p>`;

/** The footer per language, keyed exactly like the suggestion text. */
export const FOOTERS = {
  en: {
    plain: `Sent with ESF (End Spam Forever) - this message carries a proof of work: ${PROJECT_URL}`,
    html: html("Sent with ESF (End Spam Forever) &ndash; this message carries a proof of work:")
  },
  de: {
    plain: `Mit ESF gesendet (End Spam Forever) - diese Nachricht trägt Rechenzeit als Porto: ${PROJECT_URL}`,
    html: html("Mit ESF gesendet (End Spam Forever) &ndash; diese Nachricht trägt Rechenzeit als Porto:")
  }
};

/**
 * The footer for a client locale.
 *
 * @param {string} [locale] as reported by the mail client
 * @returns {{plain: string, html: string}}
 */
export function footerFor(locale) {
  return FOOTERS[textLanguage(locale)] ?? FOOTERS.en;
}

/** The English footer, kept as a named export for call sites that do not know a locale. */
export const FOOTER_PLAIN = FOOTERS.en.plain;

export const FOOTER_HTML = FOOTERS.en.html;

/**
 * Builds the ComposeDetails patch that appends the footer.
 *
 * @param {object} details ComposeDetails as handed to compose.onBeforeSend
 * @param {string} [locale] the mail client's language
 * @returns {object} a partial ComposeDetails - empty when nothing should change
 */
export function buildFooterPatch(details, locale) {
  const footer = footerFor(locale);
  const plainText = details.isPlainText === true;
  const field = plainText ? "plainTextBody" : "body";
  const current = typeof details[field] === "string" ? details[field] : "";

  // Already footed: leave it alone. Saving and re-sending a draft must not stack lines.
  if (current.includes(MARKER)) {
    return {};
  }

  if (plainText) {
    // A plain text body ends with the signature, if any. One blank line, then the footer, and no second "-- "
    // delimiter: the message already has at most one, and adding another breaks signature-aware clients.
    const separator = current.endsWith("\n") ? "\n" : "\n\n";
    return { plainTextBody: `${current}${separator}${footer.plain}\n` };
  }

  // HTML: append inside the body element when there is one, otherwise at the end.
  const closing = current.search(/<\/body\s*>/i);
  if (closing !== -1) {
    return { body: `${current.slice(0, closing)}${footer.html}${current.slice(closing)}` };
  }
  return { body: `${current}${footer.html}` };
}

/**
 * The footer text, for the options page to show what will be appended.
 *
 * @param {string} [locale] the mail client's language
 */
export function footerPreview(locale) {
  return footerFor(locale).plain;
}
