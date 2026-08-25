/** Message-display popup: the detailed verification report behind the badge. */

const statusEl = document.getElementById("status");
const statusText = document.getElementById("statusText");
const hintEl = document.getElementById("hint");
const detailsEl = document.getElementById("details");

const HEADLINE = {
  valid: "✓ Proof of Work verified",
  invalid: "⚠ Invalid Proof of Work",
  missing: "No Proof of Work"
};

const REASON_TEXT = {
  ok: "",
  "no-header": "This message carries no X-Email-PoW header. Most mail does not — this is not a sign of spam.",
  malformed: "The header could not be parsed.",
  "unsupported-version": "The proof uses a protocol version this add-on does not know.",
  "unsupported-algorithm": "The proof uses an unsupported hash algorithm.",
  "difficulty-out-of-range": "The declared difficulty is outside the accepted range.",
  "difficulty-too-low": "The proof is weaker than your configured minimum.",
  expired: "The proof is older than your acceptance window.",
  "future-timestamp": "The proof is timestamped in the future.",
  "recipient-mismatch": "The proof is not bound to any of your addresses.",
  "message-id-mismatch": "The proof references a different message.",
  "insufficient-work": "The hash does not have the claimed number of leading zero bits.",
  replay: "This exact proof was already seen on another message (replay)."
};

function row(term, value) {
  const dt = document.createElement("dt");
  dt.textContent = term;
  const dd = document.createElement("dd");
  dd.textContent = value;
  detailsEl.append(dt, dd);
}

function formatTimestamp(compact) {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(compact || "");
  if (!match) {
    return compact || "—";
  }
  const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`;
  return new Date(iso).toLocaleString();
}

function render(result) {
  const status = result.status || "missing";
  statusEl.className = `status ${status}`;
  const bits = result.best && result.best.bits;
  statusText.textContent = status === "valid" ? `${HEADLINE.valid} — ${bits}-bit PoW` : HEADLINE[status];
  hintEl.textContent = REASON_TEXT[result.reason] || "";

  detailsEl.textContent = "";
  const best = result.best;
  if (best && best.algorithm) {
    row("Algorithm", best.algorithm === "sha256" ? "SHA-256" : best.algorithm);
  }
  if (best && best.bits) {
    row("Difficulty", `${best.bits} bits (found ${best.leadingZeroBits} leading zero bits)`);
  }
  if (best && best.timestamp) {
    row("Timestamp", formatTimestamp(best.timestamp));
  }
  if (best && best.matchedRecipient) {
    row("Recipient", best.matchedRecipient);
  }
  if (best && typeof best.verificationMs === "number") {
    row("Verification time", `${best.verificationMs} ms`);
  }
  if (best && best.hash) {
    const dt = document.createElement("dt");
    dt.textContent = "Digest";
    const dd = document.createElement("dd");
    dd.className = "mono";
    dd.textContent = `${best.hash.slice(0, 32)}…`;
    detailsEl.append(dt, dd);
  }
  row("Headers found", String(result.headerCount ?? 0));
  if (result.skippedHeaders > 0) {
    row("Headers ignored", String(result.skippedHeaders));
  }
  if (!detailsEl.children.length) {
    detailsEl.classList.add("hidden");
  }
}

async function load(force) {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs.length > 0 ? tabs[0].id : null;
  const result = await browser.runtime.sendMessage({ type: "esf:getVerification", tabId, force });
  render(result || { status: "missing", reason: "no-header" });
}

document.getElementById("recheck").addEventListener("click", () => load(true));
document.getElementById("options").addEventListener("click", () => {
  browser.runtime.openOptionsPage();
  window.close();
});

load(false);
