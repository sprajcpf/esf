/**
 * Background entry point: wires the send hook, the display verification and the UI surfaces together.
 *
 * All listeners are registered synchronously at module scope, so Thunderbird can restart the event page without
 * losing events.
 */

import { Signal, StampState } from "../protocol/constants.js";
import { ComposePhase, ComposeSigner } from "./composeSigner.js";
import { PowSolver } from "./solver.js";
import { VerificationService } from "./verificationService.js";
import { loadSettings, onSettingsChanged } from "../utils/settings.js";
import { createLogger, setDebugLogging } from "../utils/log.js";

const log = createLogger("background");

/**
 * The traffic light (whitepaper 11). The badge shows the signal colour; the glyph still distinguishes a message with
 * no stamp from one with a bad stamp, because those are not the same thing for the user or for automation.
 */
const BADGE = {
  [Signal.GREEN]: { color: "#1a7f37", text: result => String(result.best?.difficulty ?? "") || "ok" },
  [Signal.YELLOW]: { color: "#b58105", text: () => "~" },
  [Signal.RED]: { color: "#b42318", text: result => (result.state === StampState.MISSING ? "–" : "!") }
};

let settingsCache = null;

async function getSettings() {
  if (!settingsCache) {
    settingsCache = await loadSettings();
    setDebugLogging(settingsCache.debugLogging);
  }
  return settingsCache;
}

onSettingsChanged(next => {
  settingsCache = next;
  setDebugLogging(next.debugLogging);
  log.debug("settings updated", next);
});

const solver = new PowSolver();

const verificationService = new VerificationService({ getSettings });

const composeSigner = new ComposeSigner({
  solver,
  getSettings,
  onStateChange: (tabId, state) => {
    updateComposeButton(tabId, state).catch(error => log.warn("compose button update failed", error));
    // Best effort: only delivered while a popup is listening.
    browser.runtime.sendMessage({ type: "esf:composeState", state }).catch(() => {});
  },
  askUser: async tabId => {
    await browser.composeAction.openPopup({ tabId });
  },
  resolveFrom: async details => {
    if (typeof details.from === "string" && details.from) {
      return details.from;
    }
    try {
      const identity = await browser.identities.get(details.identityId);
      return identity ? identity.email : "";
    } catch (error) {
      log.warn("cannot resolve the sending identity", error);
      return "";
    }
  }
});

/* ------------------------------------------------------------------ outgoing */

browser.compose.onBeforeSend.addListener((tab, details) => composeSigner.handleBeforeSend(tab, details));

async function updateComposeButton(tabId, state) {
  const label = {
    [ComposePhase.IDLE]: "",
    [ComposePhase.COMPUTING]: "…",
    [ComposePhase.ASKING]: "?",
    [ComposePhase.DONE]: String(state.difficulty || ""),
    [ComposePhase.SKIPPED]: "–",
    [ComposePhase.CANCELLED]: "–"
  }[state.phase] ?? "";
  const color = state.phase === ComposePhase.DONE ? "#1a7f37" : "#5b6472";
  await browser.composeAction.setBadgeText({ tabId, text: label });
  await browser.composeAction.setBadgeBackgroundColor({ tabId, color });
}

/* ------------------------------------------------------------------ incoming */

// MV3 replaced onMessageDisplayed with the plural form; a tab can show several selected messages at once.
browser.messageDisplay.onMessagesDisplayed.addListener(async (tab, displayedMessages) => {
  const message = (displayedMessages.messages || [])[0];
  const settings = await getSettings();
  if (!message || !settings.showBadge) {
    await browser.messageDisplayAction.setBadgeText({ tabId: tab.id, text: "" });
    return;
  }
  try {
    const result = await verificationService.verifyMessage(message);
    const badge = BADGE[result.signal] || BADGE[Signal.RED];
    await browser.messageDisplayAction.setBadgeText({ tabId: tab.id, text: badge.text(result) });
    await browser.messageDisplayAction.setBadgeBackgroundColor({ tabId: tab.id, color: badge.color });
    await browser.messageDisplayAction.setTitle({ tabId: tab.id, title: summaryTitle(result) });
  } catch (error) {
    log.error("verification failed", error);
    await browser.messageDisplayAction.setBadgeText({ tabId: tab.id, text: "?" });
  }
});

browser.messages.onNewMailReceived.addListener(async (_folder, messages) => {
  const settings = await getSettings();
  if (!settings.junkOnRed) {
    return;
  }
  for (const message of messages.messages) {
    try {
      const result = await verificationService.verifyMessage(message);
      await verificationService.applyJunkPolicy(message, result);
    } catch (error) {
      log.warn("new mail verification failed", error);
    }
  }
});

// Optional events: never let API drift take the whole background script down with it.
for (const event of [browser.accounts?.onCreated, browser.accounts?.onDeleted, browser.accounts?.onUpdated]) {
  try {
    event?.addListener(() => verificationService.invalidateIdentities());
  } catch (error) {
    log.warn("cannot observe account changes", error);
  }
}

function summaryTitle(result) {
  if (result.signal === Signal.GREEN) {
    return `ESF: proof of work verified (${result.best.difficulty} bits)`;
  }
  if (result.signal === Signal.YELLOW) {
    return "ESF: weak or unsupported proof of work";
  }
  return result.state === StampState.MISSING ? "ESF: no proof of work" : "ESF: proof of work not accepted";
}

/* ------------------------------------------------------------------ messaging */

browser.runtime.onMessage.addListener((message, _sender) => {
  if (!message || typeof message.type !== "string") {
    return undefined;
  }
  switch (message.type) {
    case "esf:getComposeState":
      return getSettings().then(settings => ({ state: composeSigner.getState(message.tabId), settings }));

    case "esf:composeDecision":
      return Promise.resolve({ handled: composeSigner.resolveDecision(message.tabId, message.decision) });

    case "esf:abortCompose":
      composeSigner.abort(message.tabId);
      return Promise.resolve({ ok: true });

    case "esf:getVerification":
      return getVerificationForTab(message.tabId, message.force === true);

    default:
      return undefined;
  }
});

async function getVerificationForTab(tabId, force) {
  const displayed = await browser.messageDisplay.getDisplayedMessages(tabId);
  const message = (displayed.messages || [])[0];
  if (!message) {
    return { state: null };
  }
  const result = await verificationService.verifyMessage(message, { force });
  return { ...result, subject: message.subject, author: message.author, settings: await getSettings() };
}

getSettings().then(settings => log.info(`ESF ready (outgoing difficulty ${settings.outgoingDifficulty})`));
