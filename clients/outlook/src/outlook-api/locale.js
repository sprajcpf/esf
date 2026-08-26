/**
 * The language Outlook is running in.
 *
 * `Office.context.displayLanguage` is the language of the *user interface* (an RFC 1766 tag such as `de-DE`), which
 * is the one to follow here: it is what the user reads their mail in, so it is the best available guess at the
 * language they would have written this message in themselves.
 *
 * `contentLanguage` exists too and is deliberately not used - it is the editing/proofing language of the data, which
 * on many installations is left at the OS default and says less about the user than the interface does.
 *
 * Everything here degrades to an empty string rather than throwing. `Office.context` is absent in unit tests, in the
 * classic Windows event runtime during startup, and on hosts that expose only part of the object; the text modules
 * treat an unknown language as English, which is the documented fallback.
 *
 * @returns {string} a locale tag, or "" when the host does not say
 */
export function clientLocale() {
  try {
    const value = globalThis.Office?.context?.displayLanguage;
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}
