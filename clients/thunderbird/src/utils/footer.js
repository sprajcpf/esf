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
 */

export const PROJECT_URL = "https://github.com/sprajcpf/esf";

/** The marker used to detect a footer that is already there: the URL, which no other line will contain. */
const MARKER = PROJECT_URL;

export const FOOTER_PLAIN = `Sent with ESF (End Spam Forever) - this message carries a proof of work: ${PROJECT_URL}`;

export const FOOTER_HTML =
  `<p style="margin-top:1em;font-size:small;color:#5b6472">` +
  `Sent with ESF (End Spam Forever) &ndash; this message carries a proof of work: ` +
  `<a href="${PROJECT_URL}" style="color:#1a4a9c">${PROJECT_URL.replace("https://", "")}</a></p>`;

/**
 * Builds the ComposeDetails patch that appends the footer.
 *
 * @param {object} details ComposeDetails as handed to compose.onBeforeSend
 * @returns {object} a partial ComposeDetails - empty when nothing should change
 */
export function buildFooterPatch(details) {
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
    return { plainTextBody: `${current}${separator}${FOOTER_PLAIN}\n` };
  }

  // HTML: append inside the body element when there is one, otherwise at the end.
  const closing = current.search(/<\/body\s*>/i);
  if (closing !== -1) {
    return { body: `${current.slice(0, closing)}${FOOTER_HTML}${current.slice(closing)}` };
  }
  return { body: `${current}${FOOTER_HTML}` };
}

/** The footer text, for the options page to show what will be appended. */
export function footerPreview() {
  return FOOTER_PLAIN;
}
