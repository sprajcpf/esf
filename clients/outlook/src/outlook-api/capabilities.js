/**
 * Platform capability detection.
 *
 * Outlook is not one platform. Web, new Windows, classic Windows, Mac and mobile support different Mailbox
 * requirement sets, and event handlers on classic Windows run in a JavaScript-only runtime without DOM or WebCrypto.
 * Every flow asks this layer instead of assuming; an unsupported platform degrades explicitly, it is never faked
 * (see the compatibility matrix in the README).
 */

/** @returns {boolean} whether the Mailbox requirement set `version` is supported by the running client */
export function isMailboxSetSupported(version) {
  const requirements = globalThis.Office?.context?.requirements;
  try {
    return Boolean(requirements && requirements.isSetSupported("Mailbox", version));
  } catch {
    return false;
  }
}

/**
 * @typedef {object} OutlookCapabilities
 * @property {boolean} canSetInternetHeaders internetHeaders.setAsync, Mailbox 1.8, compose
 * @property {boolean} canReadInternetHeaders getAllInternetHeadersAsync, Mailbox 1.8, read
 * @property {boolean} canInterceptSend OnMessageSend / Smart Alerts, Mailbox 1.12, not on mobile
 * @property {boolean} canRunSha256Pow salt generation needs crypto randomness; hashing has a pure-JS fallback
 * @property {boolean} canRunArgon2Pow ESF v1 names argon2id, but no client implements it yet (core parity)
 * @property {string} host diagnostic platform name from the Office diagnostics, e.g. "OutlookWebApp"
 */

/** @returns {OutlookCapabilities} */
export function detectCapabilities() {
  const diagnostics = globalThis.Office?.context?.mailbox?.diagnostics;
  const webcrypto = globalThis.crypto;
  return {
    canSetInternetHeaders: isMailboxSetSupported("1.8"),
    canReadInternetHeaders: isMailboxSetSupported("1.8"),
    canInterceptSend: isMailboxSetSupported("1.12"),
    // The nonce search uses the bundled pure-JS SHA-256, but a stamp without a crypto-random salt would invite
    // precomputation, so missing getRandomValues means "cannot generate", never a silent weak fallback.
    canRunSha256Pow: Boolean(webcrypto && typeof webcrypto.getRandomValues === "function"),
    // Argon2id is a registered ESF v1 profile. Incoming argon2id stamps map to "unsupported" (yellow) via the shared
    // core; generation is a later phase and must never silently downgrade to SHA-256.
    canRunArgon2Pow: false,
    host: (diagnostics && diagnostics.hostName) || "unknown"
  };
}
