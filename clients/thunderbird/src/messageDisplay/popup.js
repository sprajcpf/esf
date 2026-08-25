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

const HEADLINE = {
  green: "Proof of work verified",
  yellow: "Weak proof of work",
  red: "No accepted proof of work"
};

const STATE_TEXT = {
  strong: "This sender spent measurable computing time for your address.",
  weak: "A valid proof is present, but below what you ask for.",
  unsupported: "The proof uses a work profile this add-on does not implement.",
  missing: "This message carries no ESF stamp. Almost no mail does today — this is not a sign of spam.",
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
  row("Stamps examined", `${result.stampCount ?? 0} in ${result.headerCount ?? 0} header field(s)`);
  if (result.skipped > 0) {
    row("Ignored", `${result.skipped} beyond the parser limits`);
  }
}

async function load(force) {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs.length > 0 ? tabs[0].id : null;
  const result = await browser.runtime.sendMessage({ type: "esf:getVerification", tabId, force });
  render(result && result.state ? result : { state: "missing", signal: "red", reason: "no-stamp" });
}

document.getElementById("recheck").addEventListener("click", () => load(true));
document.getElementById("options").addEventListener("click", () => {
  browser.runtime.openOptionsPage();
  window.close();
});
disclosure.addEventListener("toggle", () => {
  disclosure.querySelector("summary").textContent = disclosure.open ? "Hide details" : "Details";
});

load(false);
