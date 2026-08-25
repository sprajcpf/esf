/** Options page. Saves on every change; no explicit save button. */

import { DEFAULTS, loadSettings, resolveWorkerCount, saveSettings } from "../utils/settings.js";
import { buildPreimageBase, searchNonce } from "../protocol/pow.js";

const form = document.getElementById("form");
const savedEl = document.getElementById("saved");
const benchmarkResult = document.getElementById("benchmarkResult");

function applyToForm(settings) {
  for (const element of form.elements) {
    if (!element.name || !(element.name in settings)) {
      continue;
    }
    if (element.type === "checkbox") {
      element.checked = settings[element.name] === true;
    } else {
      element.value = String(settings[element.name]);
    }
  }
}

function readForm() {
  const patch = {};
  for (const element of form.elements) {
    if (!element.name) {
      continue;
    }
    if (element.type === "checkbox") {
      patch[element.name] = element.checked;
    } else if (element.type === "number" || element.tagName === "SELECT" && /^\d+$/.test(element.value)) {
      patch[element.name] = Number(element.value);
    } else {
      patch[element.name] = element.value;
    }
  }
  return patch;
}

let savedTimer = null;

async function persist() {
  const settings = await saveSettings(readForm());
  applyToForm(settings);
  savedEl.textContent = "Saved";
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    savedEl.textContent = "";
  }, 1500);
}

form.addEventListener("change", () => {
  persist().catch(error => console.error("[ESF:options]", error));
});

document.getElementById("reset").addEventListener("click", async () => {
  const settings = await saveSettings(DEFAULTS);
  applyToForm(settings);
});

/**
 * Measures the local hash rate and translates it into an expected duration per difficulty, so the difficulty choice
 * is an informed one rather than a guess.
 */
document.getElementById("benchmark").addEventListener("click", async () => {
  const button = document.getElementById("benchmark");
  button.disabled = true;
  benchmarkResult.textContent = "Measuring…";
  try {
    const settings = await loadSettings();
    const base = buildPreimageBase({
      recipient: "benchmark@example.invalid",
      timestamp: "20260101T000000Z",
      messageId: "benchmark",
      salt: "00".repeat(16)
    });
    const started = performance.now();
    const sample = 60000;
    // bits: 32 is unreachable within the sample, so this runs exactly `sample` hashes.
    await searchNonce({ base, bits: 32, maxCandidates: sample, batchSize: 10000 });
    const perSecond = sample / ((performance.now() - started) / 1000);
    const workers = resolveWorkerCount(settings);
    const estimates = [18, 20, 22, 24, 26]
      .map(bits => `${bits} bits ≈ ${formatSeconds(2 ** bits / (perSecond * workers))}`)
      .join(" · ");
    benchmarkResult.textContent =
      `${Math.round(perSecond).toLocaleString()} hashes/s on this thread, ${workers} worker(s): ${estimates}`;
  } catch (error) {
    benchmarkResult.textContent = `Benchmark failed: ${error}`;
  } finally {
    button.disabled = false;
  }
});

function formatSeconds(seconds) {
  if (seconds < 1) {
    return `${Math.round(seconds * 1000)} ms`;
  }
  if (seconds < 90) {
    return `${seconds.toFixed(1)} s`;
  }
  return `${(seconds / 60).toFixed(1)} min`;
}

loadSettings().then(applyToForm);
