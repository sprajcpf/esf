/**
 * The send-time progress window: what the add-on is doing, roughly how long it usually takes, and - only once the
 * add-on has genuinely run out of patience - the choice of what to do about it.
 *
 * Kept deliberately small. Someone who pressed Send wants to get on with their day, not read about hashes; the
 * numbers live behind Details for whoever is curious.
 */

import { describeProgress, formatRate } from "../utils/estimate.js";
import { HEADLINES, MEMORYLESS_EXPLANATION, WORK_EXPLANATION } from "../ui/strings.js";

const headlineEl = document.getElementById("headline");
const summaryEl = document.getElementById("summary");
const spinnerEl = document.getElementById("spinner");
const barEl = document.getElementById("bar");
const actionsEl = document.getElementById("actions");
const fasterButton = document.getElementById("faster");
const keepGoingButton = document.getElementById("keepGoing");
const detailsEl = document.getElementById("details");
const disclosure = document.getElementById("disclosure");

document.getElementById("explanation").textContent = WORK_EXPLANATION;
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
  // Visibility through the class, not the hidden attribute: `.actions { display: flex }` overrides the browser's
  // rule for [hidden], which left the buttons on screen during phases where nothing was waiting for an answer -
  // so they looked broken. This bit is why every button appeared dead.
  const working = state.phase === "computing" || asking;
  barEl.classList.toggle("hidden", state.phase !== "computing");
  actionsEl.classList.toggle("hidden", !working);
  // "Keep going" only means something once the add-on has actually stopped to ask.
  keepGoingButton.classList.toggle("hidden", !asking);
  // Offering a faster send would be a lie at the floor difficulty, where there is nothing left to give up.
  fasterButton.classList.toggle("hidden", state.canSendFaster === false);

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
    if (state.reason === "faster" && state.difficulty) {
      parts.push(`Now working at ${state.difficulty} bits.`);
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
  row("Difficulty", state.difficulty
    ? `${state.difficulty} leading zero bits${state.automatic ? " (chosen for this computer)" : ""}`
    : "unknown");
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
  actionsEl.classList.add("hidden");
  await browser.runtime.sendMessage({ type: "esf:composeDecision", tabId: composeTabId, decision });
});

browser.runtime.onMessage.addListener(message => {
  if (message && message.type === "esf:composeState" && message.state.tabId === composeTabId) {
    render(message.state);
  }
});

// The window is opened by the background script, which then keeps it updated; this is only the first paint.
browser.runtime.sendMessage({ type: "esf:getComposeState", tabId: composeTabId })
  .then(response => {
    render(response.state);
    fitWindow();
  })
  .catch(() => {});

// Keep the elapsed time honest between progress messages.
setInterval(() => {
  if (latest && (latest.phase === "computing" || latest.phase === "asking")) {
    render(latest);
  }
}, 1000);

disclosure.addEventListener("toggle", () => {
  disclosure.querySelector("summary").textContent = disclosure.open ? "Hide details" : "Details";
  fitWindow();
});

/**
 * Grows the window to fit its content, and shrinks it back when the details are collapsed again.
 *
 * A popup window has a fixed size, so expanding the details would otherwise just add a scrollbar inside a box that
 * is too small to read.
 */
let baseHeight = 0;
async function fitWindow() {
  try {
    const current = await browser.windows.getCurrent();
    const chrome = Math.max(0, window.outerHeight - window.innerHeight);
    const wanted = Math.min(720, Math.ceil(document.documentElement.scrollHeight + chrome + 12));
    if (!baseHeight) {
      baseHeight = current.height || wanted;
    }
    const height = Math.max(baseHeight, wanted);
    if (Math.abs((current.height || 0) - height) > 8) {
      await browser.windows.update(current.id, { height });
    }
  } catch {
    // Not fatal: a window that cannot be resized still shows everything the summary line says.
  }
}
