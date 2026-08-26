/**
 * Turning search progress into something honest to show a waiting user.
 *
 * The awkward property this module exists for: the nonce search is **memoryless**. Every candidate has the same
 * independent chance of succeeding, so having tried a million of them tells you nothing about how many are left. The
 * expected remaining work after ten seconds is exactly the expected remaining work at the start.
 *
 * That rules out a percentage and a filling progress bar: both would claim knowledge nobody has, and they would be
 * wrong in the one direction that annoys people - promising completion that does not arrive. What can be shown
 * honestly is the *typical* duration for this difficulty on this machine, the time spent so far, and the fact that
 * one send in ten takes more than twice as long as usual.
 */

/**
 * Observed hashes per second, or 0 while nothing is measurable yet.
 *
 * @param {number} hashes
 * @param {number} elapsedMs
 */
export function hashRate(hashes, elapsedMs) {
  if (!Number.isFinite(hashes) || !Number.isFinite(elapsedMs) || elapsedMs <= 0 || hashes <= 0) {
    return 0;
  }
  return (hashes / elapsedMs) * 1000;
}

/**
 * Expected seconds for one stamp at this difficulty and rate: 2^difficulty candidates on average.
 *
 * This is the expected *total*, and because the search is memoryless it is also the expected *remaining* time at any
 * point. Presenting it as "usually about X" rather than "X left" is the difference between an estimate and a promise.
 *
 * @param {number} difficulty leading zero bits
 * @param {number} rate hashes per second
 * @returns {number} seconds, or Infinity when the rate is unknown
 */
export function expectedSeconds(difficulty, rate) {
  if (!Number.isFinite(difficulty) || difficulty <= 0 || !Number.isFinite(rate) || rate <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return 2 ** difficulty / rate;
}

/**
 * Probability that a search still running after `elapsedSeconds` finishes within the next `withinSeconds`.
 *
 * Exponential, again because of memorylessness: 1 - e^(-t / expected). Used for the honest phrasing of how unusual
 * the current wait already is.
 *
 * @param {number} withinSeconds
 * @param {number} expected expected total seconds
 */
export function chanceWithin(withinSeconds, expected) {
  if (!Number.isFinite(expected) || expected <= 0 || !Number.isFinite(withinSeconds) || withinSeconds <= 0) {
    return 0;
  }
  return 1 - Math.exp(-withinSeconds / expected);
}

/**
 * Short, human duration. Deliberately coarse: a wait of a few seconds does not need decimals, and false precision
 * invites people to watch the number instead of getting on with their day.
 *
 * @param {number} seconds
 */
export function formatSeconds(seconds) {
  if (!Number.isFinite(seconds)) {
    return "unknown";
  }
  if (seconds < 1) {
    return "under a second";
  }
  if (seconds < 10) {
    return `${Math.round(seconds)} seconds`;
  }
  if (seconds < 90) {
    return `${Math.round(seconds / 5) * 5} seconds`;
  }
  const minutes = seconds / 60;
  return minutes < 10 ? `${minutes.toFixed(1)} minutes` : `${Math.round(minutes)} minutes`;
}

/** Compact rate for the details view: 280k/s rather than 280417.3 hashes per second. */
export function formatRate(rate) {
  if (!Number.isFinite(rate) || rate <= 0) {
    return "measuring…";
  }
  if (rate >= 1e6) {
    return `${(rate / 1e6).toFixed(1)}M hashes/s`;
  }
  if (rate >= 1000) {
    return `${Math.round(rate / 1000)}k hashes/s`;
  }
  return `${Math.round(rate)} hashes/s`;
}

/**
 * Everything the progress window needs, derived from one compose state.
 *
 * @param {object} state as published by ComposeSigner
 * @param {number} [now]
 * @returns {{elapsedSeconds: number, rate: number, expected: number, typical: string, spent: string,
 *            recipients: string|null, unusual: boolean}}
 */
export function describeProgress(state, now = Date.now()) {
  // Number.isFinite, not a truthiness check: a startedAt of 0 is a valid instant, and treating it as
  // "missing" silently reported every wait as zero seconds long.
  const elapsedMs = Number.isFinite(state.startedAt) ? Math.max(0, now - state.startedAt) : 0;
  const rate = hashRate(state.hashes, elapsedMs);
  const expected = expectedSeconds(state.difficulty, rate);
  const elapsedSeconds = elapsedMs / 1000;
  return {
    elapsedSeconds,
    rate,
    expected,
    typical: formatSeconds(expected),
    spent: formatSeconds(elapsedSeconds),
    recipients: state.recipientCount > 1
      ? `recipient ${Math.min(state.recipientCount, (state.completed || 0) + 1)} of ${state.recipientCount}`
      : null,
    // Past roughly twice the expected duration, saying "usually about X" alone starts to feel like a lie.
    unusual: Number.isFinite(expected) && elapsedSeconds > 2 * expected
  };
}
