/** Compose-window popup: live state of the ESF stamp computation and the "taking too long" decision. */

const statusEl = document.getElementById("status");
const statusText = document.getElementById("statusText");
const detailsEl = document.getElementById("details");
const progressEl = document.getElementById("progress");
const askActions = document.getElementById("askActions");
const runActions = document.getElementById("runActions");

let composeTabId = null;

const PHASE_TEXT = {
  idle: "Ready — a stamp is minted when you send",
  computing: "Calculating proof of work…",
  asking: "Still calculating — what should happen?",
  done: "ESF stamp attached",
  skipped: "Sent without an ESF stamp",
  cancelled: "Send cancelled"
};

const PHASE_CLASS = {
  done: "green",
  skipped: "yellow",
  cancelled: "red",
  asking: "yellow"
};

async function resolveTabId() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs.length > 0 ? tabs[0].id : null;
}

function row(term, value) {
  const dt = document.createElement("dt");
  dt.textContent = term;
  const dd = document.createElement("dd");
  dd.textContent = value;
  detailsEl.append(dt, dd);
}

function render(state, settings) {
  statusEl.className = `status ${PHASE_CLASS[state.phase] || ""}`;
  statusText.textContent = PHASE_TEXT[state.phase] || state.phase;

  detailsEl.textContent = "";
  const difficulty = state.difficulty || (settings && settings.outgoingDifficulty) || 0;
  row("Difficulty", difficulty > 0 ? `${difficulty} bits` : "disabled");
  if (state.recipientCount) {
    row("Recipients", `${state.completed || 0} of ${state.recipientCount} done`);
  }
  if (state.hashes) {
    row("Hashes tried", state.hashes.toLocaleString());
  }
  if (state.workerCount) {
    row("Workers", String(state.workerCount));
  }
  if (state.elapsedMs) {
    row("Duration", `${(state.elapsedMs / 1000).toFixed(1)} s`);
  }
  if (state.skippedBcc) {
    row("Bcc without a stamp", String(state.skippedBcc));
  }
  if (state.unresolvedRecipients) {
    row("Unresolved recipients", String(state.unresolvedRecipients));
  }
  if (state.reason) {
    row("Reason", state.reason);
  }

  const computing = state.phase === "computing";
  progressEl.classList.toggle("hidden", !computing);
  askActions.classList.toggle("hidden", state.phase !== "asking");
  runActions.classList.toggle("hidden", state.phase === "asking");
  document.getElementById("abort").disabled = !computing;
}

askActions.addEventListener("click", async event => {
  const decision = event.target.dataset.decision;
  if (!decision) {
    return;
  }
  await browser.runtime.sendMessage({ type: "esf:composeDecision", tabId: composeTabId, decision });
  window.close();
});

document.getElementById("abort").addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "esf:abortCompose", tabId: composeTabId });
  window.close();
});

document.getElementById("options").addEventListener("click", () => {
  browser.runtime.openOptionsPage();
  window.close();
});

browser.runtime.onMessage.addListener(message => {
  if (message && message.type === "esf:composeState" && message.state.tabId === composeTabId) {
    render(message.state, null);
  }
});

(async () => {
  composeTabId = await resolveTabId();
  const response = await browser.runtime.sendMessage({ type: "esf:getComposeState", tabId: composeTabId });
  render(response.state, response.settings);
})();
