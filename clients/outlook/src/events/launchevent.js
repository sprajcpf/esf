/**
 * OnMessageSend (Smart Alerts) entry point.
 *
 * Runs when the user presses Send, before Outlook releases the message. In classic Outlook on Windows this executes
 * in a JavaScript-only runtime: no DOM, no Office.onReady, and only this single bundled file is loaded - which is
 * why the build emits dist/launchevent.js as one self-contained IIFE and why Office.actions.associate is called at
 * the top level. The handler must stay lightweight; Outlook shows a "taking long" dialog after ~5 s and kills the
 * runtime after ~5 minutes, so the per-recipient compute budget stays far below that.
 *
 * Everything runs locally. No message content, recipient, header or telemetry leaves this machine.
 */

import { STANDARD_HEADER_NAME } from "../esf-core.js";
import { detectCapabilities } from "../outlook-api/capabilities.js";
import { currentItem, getFromMailbox, getRecipientMailboxes, notify, setInternetHeaders } from "../outlook-api/office.js";
import { loadSettings } from "../settings/settings.js";
import { mintStamps } from "../compose/sendSigner.js";

const NOTICE_KEY = "esfSendNotice";

/** Completes the send event, letting the message go out. */
function allow(event) {
  event.completed({ allowEvent: true });
}

/** Blocks the send; the Smart Alerts dialog shows `message` with the options of the manifest's send mode. */
function deny(event, message) {
  event.completed({ allowEvent: false, errorMessage: message });
}

/**
 * The user-facing rule: no popup on success, an honest non-technical message on failure. Technical detail goes to
 * the console for diagnostics, never into the dialog.
 */
async function handleMessageSend(event) {
  const settings = loadSettings();
  const item = currentItem();
  if (!settings.enabled || settings.outgoingDifficulty <= 0 || !item) {
    allow(event);
    return;
  }

  const capabilities = detectCapabilities();
  if (!capabilities.canSetInternetHeaders || !capabilities.canRunSha256Pow) {
    // Honest degradation: this runtime cannot generate ESF (no header write or no crypto randomness). Never fake it.
    console.warn("[esf] runtime cannot generate ESF", capabilities);
    if (settings.onSendFailure === "block") {
      deny(event, "ESF cannot protect email on this Outlook platform. See the ESF settings for details.");
    } else {
      await notify(item, NOTICE_KEY, "Sent without ESF: not supported on this Outlook platform.");
      allow(event);
    }
    return;
  }

  try {
    const [from, to, cc, bcc] = await Promise.all([
      getFromMailbox(item),
      getRecipientMailboxes(item.to),
      getRecipientMailboxes(item.cc),
      getRecipientMailboxes(item.bcc)
    ]);
    const outcome = await mintStamps({
      from,
      to: to.mailboxes,
      cc: cc.mailboxes,
      bcc: bcc.mailboxes,
      settings
    });

    if (outcome.status === "done") {
      const written = await setInternetHeaders(item, { [STANDARD_HEADER_NAME]: outcome.headerValue });
      if (!written) {
        throw new Error("internetHeaders.setAsync failed");
      }
      console.log(`[esf] ${outcome.stampCount} stamp(s), ${outcome.hashes} hashes, ${outcome.elapsedMs} ms`);
      allow(event);
      return;
    }

    if (outcome.status === "timeout") {
      console.warn(`[esf] proof generation timed out after ${outcome.hashes} hashes`);
      if (settings.onSendFailure === "block") {
        deny(event, "ESF could not generate a proof in time. Lower the protection level or try again.");
      } else {
        await notify(item, NOTICE_KEY, "Sent without ESF: the proof took too long to generate.");
        allow(event);
      }
      return;
    }

    // "skipped": no stampable recipients (e.g. Bcc-only message with bccMode "omit"). Nothing to attach.
    allow(event);
  } catch (error) {
    console.error("[esf] proof generation failed", error);
    if (settings.onSendFailure === "block") {
      deny(event, "ESF could not generate a proof. You can retry, or send without ESF via Send Anyway.");
    } else {
      await notify(item, NOTICE_KEY, "Sent without ESF: the proof could not be generated.");
      allow(event);
    }
  }
}

function onMessageSendHandler(event) {
  handleMessageSend(event).catch(error => {
    // Last-resort guard: an unhandled rejection here would leave the send hanging until Outlook's timeout dialog.
    console.error("[esf] unexpected failure, sending without ESF", error);
    allow(event);
  });
}

globalThis.onMessageSendHandler = onMessageSendHandler;
if (globalThis.Office && globalThis.Office.actions && typeof globalThis.Office.actions.associate === "function") {
  globalThis.Office.actions.associate("onMessageSendHandler", onMessageSendHandler);
}
