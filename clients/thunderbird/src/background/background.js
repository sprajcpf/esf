/**
 * Background entry point: wires the send hook, the display verification and the UI surfaces together.
 *
 * All listeners are registered synchronously at module scope so the event page can be restarted by Thunderbird
 * without losing events.
 */

import { VerificationStatus } from "../protocol/constants.js";
import { ComposePhase, ComposeSigner } from "./composeSigner.js";
import { PowSolver } from "./solver.js";
import { VerificationService } from "./verificationService.js";
import { loadSettings, onSettingsChanged } from "../utils/settings.js";
import { createLogger, setDebugLogging } from "../utils/log.js";

const log = createLogger("background");

const BADGE = {
  [VerificationStatus.VALID]: { color: "#1a7f37", text: bits => String(bits) },
  [VerificationStatus.INVALID]: { color: "#b42318", text: () => "!" },
  [VerificationStatus.MISSING]: { color: "#b58105", text: () => "-" }
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
    // Best effort: only delivered when a popup is actually listening.
    browser.runtime.sendMessage({ type: "esf:composeState", state }).catch(() => {});
  },
  askUser: async tabId => {
    await browser.composeAction.openPopup({ tabId });
  }
});

/* ------------------------------------------------------------------ outgoing */

browser.compose.onBeforeSend.addListener((tab, details) => composeSigner.handleBeforeSend(tab, details));

async function updateComposeButton(tabId, state) {
  const label = {
    [ComposePhase.IDLE]: "",
    [ComposePhase.COMPUTING]: "…",
    [ComposePhase.ASKING]: "?",
    [ComposePhase.DONE]: String(state.bits || ""),
    [ComposePhase.SKIPPED]: "-",
    [ComposePhase.CANCELLED]: "-"
  }[state.phase] ?? "";
  const color = state.phase === ComposePhase.DONE ? "#1a7f37" : "#5b6472";
  await browser.composeAction.setBadgeText({ tabId, text: label });
  await browser.composeAction.setBadgeBackgroundColor({ tabId, color });
}

/* ------------------------------------------------------------------ incoming */

browser.messageDisplay.onMessageDisplayed.addListener(async (tab, message) => {
  const settings = await getSettings();
  if (!settings.showBadge) {
    await browser.messageDisplayAction.setBadgeText({ tabId: tab.id, text: "" });
    return;
  }
  try {
    const result = await verificationService.verifyMessage(message);
    const badge = BADGE[result.status];
    const bits = result.best && result.best.bits ? result.best.bits : "";
    await browser.messageDisplayAction.setBadgeText({ tabId: tab.id, text: badge.text(bits) });
    await browser.messageDisplayAction.setBadgeBackgroundColor({ tabId: tab.id, color: badge.color });
    await browser.messageDisplayAction.setTitle({ tabId: tab.id, title: summaryTitle(result) });
  } catch (error) {
    log.error("verification failed", error);
    await browser.messageDisplayAction.setBadgeText({ tabId: tab.id, text: "?" });
  }
});

browser.messages.onNewMailReceived.addListener(async (_folder, messages) => {
  const settings = await getSettings();
  if (!settings.markMissingAsJunk) {
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

browser.accounts.onCreated.addListener(() => verificationService.invalidateIdentities());
browser.accounts.onDeleted.addListener(() => verificationService.invalidateIdentities());

function summaryTitle(result) {
  if (result.status === VerificationStatus.VALID) {
    return `Proof of Work verified (${result.best.bits} bits)`;
  }
  if (result.status === VerificationStatus.MISSING) {
    return "No Proof of Work";
  }
  return "Invalid Proof of Work";
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
  const message = await browser.messageDisplay.getDisplayedMessage(tabId);
  if (!message) {
    return { status: null };
  }
  const result = await verificationService.verifyMessage(message, { force });
  return {
    ...result,
    subject: message.subject,
    author: message.author,
    settings: await getSettings()
  };
}

getSettings().then(settings => log.info(`ESF ready (outgoing ${settings.outgoingBits} bits)`));
