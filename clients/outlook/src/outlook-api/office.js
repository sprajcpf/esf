/**
 * Thin promise wrappers around the callback-style Office.js mailbox item API.
 *
 * Everything Outlook-specific that the send and read flows need goes through here, so the flows themselves stay
 * testable with a fake item object. No wrapper throws on a missing API - callers see empty results and decide via
 * the capability layer (capabilities.js) what that means.
 */

/** @returns {any} the current mailbox item, or null outside an item context */
export function currentItem() {
  const context = globalThis.Office && globalThis.Office.context;
  return (context && context.mailbox && context.mailbox.item) || null;
}

function succeeded(result) {
  const Office = globalThis.Office;
  return result && (!Office || result.status === Office.AsyncResultStatus.Succeeded);
}

/**
 * Promisifies one getAsync-style call.
 *
 * @param {object} target object carrying the method, e.g. item.to
 * @param {string} method
 * @param {any[]} [args]
 * @returns {Promise<any>} the asyncResult.value, or null when the API is missing or reports an error
 */
export function callAsync(target, method, args = []) {
  return new Promise(resolve => {
    if (!target || typeof target[method] !== "function") {
      resolve(null);
      return;
    }
    try {
      target[method](...args, result => resolve(succeeded(result) ? result.value : null));
    } catch {
      resolve(null);
    }
  });
}

/**
 * Reads one recipient field of a compose item and flattens it to plain mailbox strings.
 * EmailAddressDetails.emailAddress is the resolved SMTP address; unresolved entries are counted, never guessed.
 *
 * @param {any} field item.to / item.cc / item.bcc
 * @returns {Promise<{mailboxes: string[], unresolved: number}>}
 */
export async function getRecipientMailboxes(field) {
  const value = await callAsync(field, "getAsync");
  const entries = Array.isArray(value) ? value : [];
  const mailboxes = [];
  let unresolved = 0;
  for (const entry of entries) {
    const address = entry && typeof entry.emailAddress === "string" ? entry.emailAddress : "";
    if (address) {
      mailboxes.push(address);
    } else {
      unresolved++;
    }
  }
  return { mailboxes, unresolved };
}

/**
 * Resolves the sending mailbox of a compose item. item.from.getAsync needs Mailbox 1.7; the signed-in profile is the
 * fallback for older clients and for shared-mailbox edge cases where from is unavailable.
 *
 * @param {any} item
 * @returns {Promise<string>}
 */
export async function getFromMailbox(item) {
  const from = await callAsync(item && item.from, "getAsync");
  if (from && typeof from.emailAddress === "string" && from.emailAddress) {
    return from.emailAddress;
  }
  const profile = globalThis.Office?.context?.mailbox?.userProfile;
  return (profile && profile.emailAddress) || "";
}

/**
 * Sets custom internet headers on the compose item (Mailbox 1.8).
 *
 * @param {any} item
 * @param {Record<string, string>} headers
 * @returns {Promise<boolean>} true when Outlook confirmed the write
 */
export function setInternetHeaders(item, headers) {
  return new Promise(resolve => {
    const target = item && item.internetHeaders;
    if (!target || typeof target.setAsync !== "function") {
      resolve(false);
      return;
    }
    try {
      target.setAsync(headers, result => resolve(succeeded(result)));
    } catch {
      resolve(false);
    }
  });
}

/**
 * Reads the full MIME header block of a read item (Mailbox 1.8).
 *
 * @param {any} item
 * @returns {Promise<string>} the raw header block, or "" when unavailable
 */
export async function getAllInternetHeaders(item) {
  const value = await callAsync(item, "getAllInternetHeadersAsync");
  return typeof value === "string" ? value : "";
}

/**
 * Adds or replaces an informational notification on the item. Used for the non-blocking "sent without ESF" notice;
 * failures are irrelevant to the send outcome, so they are swallowed.
 *
 * @param {any} item
 * @param {string} key
 * @param {string} message informational text, at most 150 characters per the API contract
 */
export async function notify(item, key, message) {
  const target = item && item.notificationMessages;
  const Office = globalThis.Office;
  if (!target || typeof target.replaceAsync !== "function" || !Office) {
    return;
  }
  const details = {
    type: Office.MailboxEnums.ItemNotificationMessageType.InformationalMessage,
    message: message.slice(0, 150),
    icon: "Icon.16",
    persistent: false
  };
  await new Promise(resolve => {
    try {
      target.replaceAsync(key, details, () => resolve());
    } catch {
      resolve();
    }
  });
}
