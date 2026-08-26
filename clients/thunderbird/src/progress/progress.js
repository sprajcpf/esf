/**
 * The send-time progress window: what the add-on is doing, roughly how long it usually takes, and - only once the
 * add-on has genuinely run out of patience - the choice of what to do about it.
 *
 * Kept deliberately small. Someone who pressed Send wants to get on with their day, not read about hashes; the
 * numbers live behind Details for whoever is curious.
 */

import { describeProgress, formatRate } from "../utils/estimate.js";
import { HEADLINES, MEMORYLESS_EXPLANATION, MINING_EXPLANATION } from "../ui/strings.js";

const headlineEl = document.getElementById("headline");
const summaryEl = document.getElementById("summary");
const spinnerEl = document.getElementById("spinner");
const barEl = document.getElementById("bar");
const actionsEl = document.getElementById("actions");
const detailsEl = document.getElementById("details");
const disclosure = document.getElementById("disclosure");

document.getElementById("mining").textContent = MINING_EXPLANATION;
document.getElementById("memoryless").textContent = MEMORYLESS_EXPLANATION;

const composeTabId = Number(new URLSearchParams(window.location.search).get("tabId"));
let latest = null;

const SPINNER_CLASS = { done: "done", skipped: "warn", cancelled: "stop", asking: "warn" };

function row(term, value) {
  const dt = document.createElement("dt");
  dt.textContent = term;
  const dd = document.createElement("dd");
  dd.textContent = value;
  detailsEl.append(dt, dd);
}

function render(state) {
  latest = state;
  const info = describeProgress(state);
  const asking = state.phase === "asking";

  headlineEl.textContent = HEADLINES[state.phase] || HEADLINES.computing;
  spinnerEl.className = `spinner ${SPINNER_CLASS[state.phase] || ""}`;
  barEl.hidden = state.phase !== "computing";
  actionsEl.hidden = !asking;

  const parts = [];
  if (state.phase === "computing" || asking) {
    parts.push(Number.isFinite(info.expected)
      ? `Usually about ${info.typical} on this computer.`
      : "Measuring how fast this computer is…");
    if (info.elapsedSeconds >= 1) {
      parts.push(`Running for ${info.spent}.`);
    }
    if (info.unusual) {
      parts.push("This one is unlucky rather than stuck — every attempt is an independent roll of the dice.");
    }
    if (info.recipients) {
      parts.push(`Working on ${info.recipients}.`);
    }
  } else if (state.phase === "done") {
    parts.push(`Attached to ${state.completed === 1 ? "the message" : `${state.completed} recipients`}` +
      `${info.elapsedSeconds >= 1 ? ` after ${info.spent}` : ""}. Sending now.`);
  } else if (state.phase === "skipped") {
    parts.push("The message is on its way without a proof of work.");
  } else if (state.phase === "cancelled") {
    parts.push("Nothing was sent.");
  }
  summaryEl.textContent = parts.join(" ");

  detailsEl.textContent = "";
  row("Difficulty", state.difficulty ? `${state.difficulty} leading zero bits` : "unknown");
  row("Work profile", "SHA-256");
  row("Speed", formatRate(info.rate));
  row("Attempts so far", (state.hashes || 0).toLocaleString());
  row("Worker threads", String(state.workerCount || 1));
  if (state.recipientCount) {
    row("Recipients", `${state.completed || 0} of ${state.recipientCount} done`);
  }
  if (Number.isFinite(info.expected)) {
    row("Typical duration", info.typical);
  }
  if (state.skippedBcc) {
    row("Bcc without a stamp", String(state.skippedBcc));
  }
  if (state.reason) {
    row("Reason", state.reason);
  }
}

actionsEl.addEventListener("click", async event => {
  const decision = event.target.dataset.decision;
  if (!decision) {
    return;
  }
  actionsEl.hidden = true;
  await browser.runtime.sendMessage({ type: "esf:composeDecision", tabId: composeTabId, decision });
});

browser.runtime.onMessage.addListener(message => {
  if (message && message.type === "esf:composeState" && message.state.tabId === composeTabId) {
    render(message.state);
  }
});

// The window is opened by the background script, which then keeps it updated; this is only the first paint.
browser.runtime.sendMessage({ type: "esf:getComposeState", tabId: composeTabId })
  .then(response => render(response.state))
  .catch(() => {});

// Keep the elapsed time honest between progress messages.
setInterval(() => {
  if (latest && (latest.phase === "computing" || latest.phase === "asking")) {
    render(latest);
  }
}, 1000);

disclosure.addEventListener("toggle", () => {
  disclosure.querySelector("summary").textContent = disclosure.open ? "Hide details" : "Details";
});
