/**
 * Task pane: the traffic light on read items, a short protection summary on compose items, and the settings.
 *
 * UI hierarchy per the ESF design rules: primary is 🟢/🟡/🔴, secondary is one human sentence, and everything
 * technical (algorithm, difficulty, timestamps, reasons) stays behind "Details". A green light means "sufficient
 * computational work was demonstrated" - never "this email is safe" and never sender authentication.
 */

import { Reason, SELECTABLE_DIFFICULTY, Signal, StampState } from "../esf-core.js";
import { detectCapabilities } from "../outlook-api/capabilities.js";
import { currentItem } from "../outlook-api/office.js";
import { DEFAULTS, loadSettings, saveSettings } from "../settings/settings.js";
import { verifyCurrentMessage } from "../read/verifyCurrentMessage.js";

const LIGHTS = { [Signal.GREEN]: "🟢", [Signal.YELLOW]: "🟡", [Signal.RED]: "🔴" };

const TITLES = {
  [StampState.STRONG]: "ESF protected",
  [StampState.WEAK]: "ESF proof is weak",
  [StampState.UNSUPPORTED]: "ESF proof not checkable",
  [StampState.MISSING]: "No ESF proof",
  [StampState.INVALID]: "ESF proof rejected"
};

/** One honest human sentence per machine reason; details stay in the advanced panel. */
const EXPLANATIONS = {
  [Reason.OK]: "The sender demonstrated sufficient computational work for this email.",
  [Reason.NO_STAMP]: "This email carries no ESF proof. Most email does not, yet.",
  [Reason.MALFORMED]: "The ESF proof on this email is unreadable.",
  [Reason.UNSUPPORTED_VERSION]: "The ESF proof uses a newer protocol version than this add-in understands.",
  [Reason.UNSUPPORTED_ALGORITHM]: "The ESF proof uses a work profile this add-in cannot check yet.",
  [Reason.DIFFICULTY_OUT_OF_RANGE]: "The ESF proof declares an unacceptable difficulty.",
  [Reason.BELOW_POLICY]: "The proof is valid but below the level your settings require.",
  [Reason.STALE]: "The ESF proof is older than the absolute limit set in your settings.",
  [Reason.STAMP_TOO_OLD]: "The ESF proof was made long before this email - it does not belong to it.",
  [Reason.FUTURE_TIMESTAMP]: "The ESF proof is dated in the future.",
  [Reason.WRONG_RECIPIENT]: "The ESF proof was made for a different recipient.",
  [Reason.SENDER_MISMATCH]: "The ESF proof was made for a different sender.",
  [Reason.MESSAGE_MISMATCH]: "The ESF proof belongs to a different message.",
  [Reason.INSUFFICIENT_WORK]: "The ESF proof does not contain the work it claims.",
  [Reason.REPLAY]: "This ESF proof was already used on another email."
};

function el(id) {
  return document.getElementById(id);
}

function isReadMode(item) {
  return Boolean(item && typeof item.getAllInternetHeadersAsync === "function");
}

async function renderReadStatus(item, settings) {
  const section = el("status");
  section.hidden = false;
  el("statusLight").textContent = "…";
  el("statusTitle").textContent = "Checking ESF";
  el("statusText").textContent = "";
  try {
    const result = await verifyCurrentMessage(item, settings);
    section.classList.remove("green", "yellow", "red");
    section.classList.add(result.signal);
    el("statusLight").textContent = LIGHTS[result.signal] || "🔴";
    el("statusTitle").textContent = TITLES[result.state] || "ESF";
    el("statusText").textContent = EXPLANATIONS[result.reason] ||
      "The ESF proof could not be evaluated.";
    renderDetails(result);
  } catch (error) {
    el("statusLight").textContent = "⚪";
    el("statusTitle").textContent = "ESF unavailable";
    el("statusText").textContent = "This message's headers could not be read on this Outlook platform.";
    console.error("[esf] verification failed", error);
  }
}

function renderDetails(result) {
  const toggle = el("detailsToggle");
  const panel = el("detailsPanel");
  const best = result.best;
  const lines = [
    `state: ${result.state} (${result.reason})`,
    `stamp headers: ${result.headerCount}${result.skipped ? `, skipped: ${result.skipped}` : ""}`
  ];
  if (best && best.stamp) {
    lines.push(
      `algorithm: ${best.stamp.algorithm}`,
      `work level: ${best.leadingZeroBits ?? "n/a"} (declared ${best.stamp.difficulty}` +
        `${best.requiredDifficulty ? `, required ${best.requiredDifficulty}` : ""})`,
      `timestamp: ${new Date(best.stamp.timestamp * 1000).toISOString()}`
    );
  }
  if (best && best.detail) {
    lines.push(`detail: ${best.detail}`);
  }
  panel.textContent = lines.join("\n");
  toggle.hidden = false;
  toggle.onclick = () => {
    panel.hidden = !panel.hidden;
    toggle.textContent = panel.hidden ? "Details" : "Hide details";
  };
}

function renderComposeInfo(settings, capabilities) {
  el("composeInfo").hidden = false;
  const parts = [];
  if (!settings.enabled || settings.outgoingDifficulty <= 0) {
    parts.push("ESF protection is off. This email will be sent without a proof.");
  } else if (!capabilities.canInterceptSend) {
    parts.push("This Outlook cannot run ESF automatically on send. The email will be sent without a proof.");
  } else {
    parts.push(`This email will be protected automatically when you press Send (level ` +
      `${settings.outgoingDifficulty}).`);
  }
  el("composeText").textContent = parts.join(" ");
}

function renderSettings(settings, capabilities) {
  const difficulty = el("setDifficulty");
  difficulty.innerHTML = "";
  for (const value of SELECTABLE_DIFFICULTY) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = value === 0 ? "Off" : value === DEFAULTS.outgoingDifficulty ? `Standard (${value})` :
      String(value);
    difficulty.appendChild(option);
  }
  el("setEnabled").checked = settings.enabled;
  difficulty.value = String(settings.outgoingDifficulty);
  el("setBudget").value = String(settings.askAfterSeconds);
  el("setMinIncoming").value = String(settings.minIncomingDifficulty);
  el("setStampWindow").value = String(settings.maxStampToMessageHours);
  el("setMaxAge").value = String(settings.maxStampAgeDays);
  el("setOnFailure").value = settings.onSendFailure;
  el("setBccMode").value = settings.bccMode;
  el("setAliases").value = settings.aliasMailboxes.join("\n");
  el("capabilities").textContent = `Platform: ${capabilities.host} — automatic send protection ` +
    `${capabilities.canInterceptSend ? "available" : "not available"}, header access ` +
    `${capabilities.canReadInternetHeaders ? "available" : "not available"}.`;

  el("advancedToggle").onclick = () => {
    const advanced = el("advanced");
    advanced.hidden = !advanced.hidden;
  };

  const persist = async () => {
    const next = await saveSettings({
      enabled: el("setEnabled").checked,
      outgoingDifficulty: Number(difficulty.value),
      askAfterSeconds: Number(el("setBudget").value),
      minIncomingDifficulty: Number(el("setMinIncoming").value),
      maxStampToMessageHours: Number(el("setStampWindow").value),
      maxStampAgeDays: Number(el("setMaxAge").value),
      onSendFailure: el("setOnFailure").value,
      bccMode: el("setBccMode").value,
      aliasMailboxes: el("setAliases").value.split("\n").map(line => line.trim()).filter(Boolean)
    });
    el("saveState").textContent = "Saved.";
    setTimeout(() => { el("saveState").textContent = ""; }, 1500);
    return next;
  };
  for (const id of ["setEnabled", "setDifficulty", "setBudget", "setMinIncoming", "setStampWindow", "setMaxAge",
    "setOnFailure", "setBccMode", "setAliases"]) {
    el(id).addEventListener("change", persist);
  }
}

globalThis.Office?.onReady(() => {
  const settings = loadSettings();
  const capabilities = detectCapabilities();
  const item = currentItem();
  renderSettings(settings, capabilities);
  if (isReadMode(item)) {
    renderReadStatus(item, settings);
  } else if (item) {
    renderComposeInfo(settings, capabilities);
  }
});
