/**
 * Message-display popup: the ESF traffic light plus an optional details view.
 *
 * Whitepaper 4.2 / 11: the primary experience is the colour. Algorithm, difficulty and timestamps are diagnostics
 * behind a disclosure, never a prerequisite for understanding the result.
 */

const statusEl = document.getElementById("status");
const statusText = document.getElementById("statusText");
const hintEl = document.getElementById("hint");
const detailsEl = document.getElementById("details");
const disclosure = document.getElementById("disclosure");
const suggestButton = document.getElementById("suggest");
const suggestNote = document.getElementById("suggestNote");
let current = null;

import { MINIMUM_FEEDBACK_MS, atLeast } from "../utils/timing.js";

const HEADLINE = {
  green: "Proof of work verified",
  yellow: "Weak proof of work",
  red: "No accepted proof of work"
};

const STATE_TEXT = {
  strong: "This sender spent measurable computing time for your address.",
  weak: "A valid proof is present, but below what you ask for.",
  unsupported: "The proof uses a work profile this add-on does not implement.",
  missing: "This message carries no ESF stamp, which is not a sign of spam.",
  invalid: "A stamp is present but was not accepted."
};

const REASON_TEXT = {
  ok: "",
  "no-stamp": "",
  malformed: "The stamp could not be parsed.",
  "unsupported-version": "The stamp uses a newer ESF protocol version.",
  "unsupported-algorithm": "Unsupported work profile — no work was performed to check it.",
  "difficulty-out-of-range": "The declared difficulty is outside the accepted range.",
  "below-policy": "Real work was done, but less than your configured minimum.",
  stale: "The stamp is older than your acceptance window.",
  "stamp-too-old": "The work was done long before this message — a stamp has to belong to the " +
    "message it arrives with.",
  "future-timestamp": "The stamp is dated in the future.",
  "wrong-recipient": "The stamp is not bound to any of your addresses.",
  "sender-mismatch": "The stamp was not minted for this sender.",
  "message-mismatch": "The stamp references a different message.",
  "insufficient-work": "The digest does not have the claimed number of leading zero bits.",
  replay: "This exact stamp was already seen on another message (replay)."
};

function row(term, value) {
  const dt = document.createElement("dt");
  dt.textContent = term;
  const dd = document.createElement("dd");
  dd.textContent = value;
  detailsEl.append(dt, dd);
}

function render(result) {
  current = result;
  const signal = result.signal || "red";
  statusEl.className = `status ${signal}`;
  const best = result.best;
  const difficulty = best && best.difficulty;
  statusText.textContent = signal === "green" && difficulty
    ? `${HEADLINE.green} — ${difficulty} bits`
    : HEADLINE[signal];
  hintEl.textContent = REASON_TEXT[result.reason] || STATE_TEXT[result.state] || "";

  detailsEl.textContent = "";
  row("ESF state", `${result.state}${result.reason && result.reason !== "ok" ? ` (${result.reason})` : ""}`);
  if (best && best.algorithm) {
    row("Work profile", best.algorithm === "sha256" ? "SHA-256" : best.algorithm);
  }
  if (best && best.difficulty) {
    const found = best.leadingZeroBits !== undefined ? `, ${best.leadingZeroBits} found` : "";
    row("Difficulty", `${best.difficulty} bits claimed${found}`);
  }
  if (best && best.requiredDifficulty) {
    row("Your minimum", `${best.requiredDifficulty} bits`);
  }
  if (best && best.timestampMs) {
    row("Stamped", new Date(best.timestampMs).toLocaleString());
  }
  if (best && best.matchedRecipient) {
    row("Bound to", best.matchedRecipient);
  }
  if (best && best.senderBound !== null && best.senderBound !== undefined) {
    row("Sender binding", best.senderBound ? "matches From" : "does not match From");
  }
  if (best && typeof best.verificationMs === "number") {
    row("Verification time", `${best.verificationMs} ms`);
  }
  if (best && best.detail) {
    row("Detail", String(best.detail));
  }
  renderSuggestion(result);
  row("Stamps examined", `${result.stampCount ?? 0} in ${result.headerCount ?? 0} header field(s)`);
  if (result.skipped > 0) {
    row("Ignored", `${result.skipped} beyond the parser limits`);
  }
}

async function verify(tabId, force) {
  const result = await browser.runtime.sendMessage({ type: "esf:getVerification", tabId, force });
  return result && result.state ? result : { state: "missing", signal: "red", reason: "no-stamp" };
}

async function currentTabId() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs.length > 0 ? tabs[0].id : null;
}

/**
 * Offers to tell the sender about ESF, but only where that makes sense.
 *
 * Withheld for mailing lists, automated senders and no-reply addresses, because there is nobody at the other end to
 * ask. Where it is offered, the note underneath says the thing the interface must not hide: replying proves to an
 * unknown sender that the address is real, which is fine for correspondence and exactly wrong for spam - and a
 * missing stamp looks identical in both cases.
 */
function renderSuggestion(result) {
  const red = (result.signal || "red") === "red";
  const sender = result.sender || {};
  const offer = red && sender.replyable === true;
  suggestButton.classList.toggle("hidden", !offer);
  suggestButton.disabled = false;
  suggestButton.textContent = result.state === "invalid" ? "Tell sender it failed" : "Tell sender about ESF";
  const note = offer
    ? "Opens a reply you can read and edit; nothing is sent for you. Only worth it for senders you know — a reply " +
      "tells a stranger the address is real."
    : red && sender.reason
      ? sender.reason
      : "";
  suggestNote.textContent = note;
  suggestNote.classList.toggle("hidden", note === "");
}

document.getElementById("suggest").addEventListener("click", async () => {
  suggestButton.disabled = true;
  const response = await browser.runtime.sendMessage({
    type: "esf:suggestEsf",
    tabId: (await browser.tabs.query({ active: true, currentWindow: true }))[0]?.id,
    state: current && current.state
  });
  if (response && response.ok) {
    window.close();
    return;
  }
  suggestNote.textContent = `Could not open a reply: ${response && response.reason ? response.reason : "unknown"}`;
  suggestNote.classList.remove("hidden");
  suggestButton.disabled = false;
});

async function load() {
  render(await verify(await currentTabId(), false));
}

/**
 * Re-verify on request, with visible feedback.
 *
 * The result is replaced by "Verifying…" and the details are dimmed, so it is obvious that the old verdict is being
 * recomputed rather than merely redisplayed - and the new verdict is held back until that has been on screen long
 * enough to see. Only this path has the floor: adding it to opening the popup would make the popup feel slow for no
 * gain, because "Checking…" is what it shows on open anyway.
 */
async function recheck() {
  const button = document.getElementById("recheck");
  button.disabled = true;
  statusEl.className = "status";
  statusText.textContent = "Verifying…";
  hintEl.textContent = "";
  detailsEl.classList.add("refreshing");
  try {
    render(await atLeast(verify(await currentTabId(), true), MINIMUM_FEEDBACK_MS));
  } catch (error) {
    statusEl.className = "status red";
    statusText.textContent = "Could not verify";
    hintEl.textContent = String(error && error.message ? error.message : error);
  } finally {
    detailsEl.classList.remove("refreshing");
    button.disabled = false;
  }
}

document.getElementById("recheck").addEventListener("click", () => recheck());
document.getElementById("options").addEventListener("click", () => {
  browser.runtime.openOptionsPage();
  window.close();
});
disclosure.addEventListener("toggle", () => {
  disclosure.querySelector("summary").textContent = disclosure.open ? "Hide details" : "Details";
});

load();
