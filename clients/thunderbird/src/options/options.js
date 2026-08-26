/** Options page. Saves on every change; no explicit save button. */

import { DEFAULTS, loadSettings, resolveWorkerCount, saveSettings } from "../utils/settings.js";
import { buildWorkBase, generateSalt, searchNonce, unixSeconds } from "../protocol/stamp.js";
import { footerPreview } from "../utils/footer.js";

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
  reflectMode();
  persist().catch(error => console.error("[ESF:options]", error));
});

/** The fixed difficulty and the time budget are mutually irrelevant; grey out whichever does not apply. */
function reflectMode() {
  const automatic = form.elements.difficultyMode.value === "auto";
  form.elements.outgoingDifficulty.disabled = automatic;
  form.elements.autoTargetSeconds.disabled = !automatic;
}

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
    const workBase = buildWorkBase({
      algorithm: "sha256",
      difficulty: 32,
      timestamp: unixSeconds(),
      sid: "A".repeat(43),
      rid: "B".repeat(43),
      mid: "C".repeat(43),
      salt: generateSalt(),
      profileParams: {}
    });
    const started = performance.now();
    const sample = 60000;
    // Difficulty 32 is unreachable within the sample, so this runs exactly `sample` hashes.
    await searchNonce({ workBase, difficulty: 32, maxCandidates: sample, batchSize: 10000 });
    const perSecond = sample / ((performance.now() - started) / 1000);
    const workers = resolveWorkerCount(settings);
    const estimates = [18, 20, 22, 24, 26]
      .map(difficulty => `${difficulty} bits ≈ ${formatSeconds(2 ** difficulty / (perSecond * workers))}`)
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

document.getElementById("footerPreview").textContent = footerPreview(browser.i18n.getUILanguage());

loadSettings().then(settings => {
  applyToForm(settings);
  reflectMode();
});
