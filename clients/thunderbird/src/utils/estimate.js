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

/**
 * The difficulty to drop to when the user asks for a faster send.
 *
 * Derived from the *measured* rate rather than guessed, so the promise the button makes ("under a few seconds") holds
 * on the machine it was pressed on: 2^d / rate < targetSeconds. Two guard rails:
 *
 *  - never below `floor`. 18 bits is the point where the work is still worth something and still above what a
 *    receiver is likely to require for a green result; going lower would trade a wait for a worthless stamp.
 *  - always at least one bit below the current difficulty, because a button that changes nothing is worse than no
 *    button. When the current difficulty already is the floor, there is nothing to offer - see `canSendFaster`.
 *
 * @param {number} current difficulty being worked on
 * @param {number} rate measured hashes per second, 0 when unknown
 * @param {{targetSeconds?: number, floor?: number}} [options]
 * @returns {number} the difficulty to use instead
 */
export function fasterDifficulty(current, rate, { targetSeconds = 3, floor = 18 } = {}) {
  const ceiling = Number.isInteger(current) ? current - 1 : floor;
  if (!Number.isFinite(rate) || rate <= 0) {
    // No measurement to reason from: fall back to the floor, which is the "im Notfall" case.
    return Math.max(floor, Math.min(ceiling, floor));
  }
  const affordable = Math.floor(Math.log2(targetSeconds * rate));
  return Math.max(floor, Math.min(ceiling, affordable));
}

/**
 * Whether offering a faster send is honest: only when it would actually lower the difficulty.
 *
 * @param {number} current
 * @param {number} [floor]
 */
export function canSendFaster(current, floor = 18) {
  return Number.isInteger(current) && current > floor;
}

/**
 * The difficulty to use in automatic mode: the most work this machine can do inside the target time.
 *
 * The point of automatic mode is that nobody has to know what a bit is. The user states how long a send may take -
 * three seconds by default - and the difficulty follows from what the machine actually manages. A fast machine
 * therefore does *more* work than a slow one, which is the right way round: the whole mechanism is about cost, and a
 * machine that can afford more should pay more.
 *
 * Bounds, both deliberate:
 *  - `floor` (18): below this a stamp starts being refused as too weak by receivers, so a faster send would buy a
 *    worthless stamp. Better to exceed the target slightly than to send something nobody counts.
 *  - `ceiling` (26): past this the extra work buys nothing a receiver asks for today, and the tail of unlucky sends
 *    gets long enough to be annoying.
 *
 * The result is an *expectation*, not a guarantee: the search is memoryless, so individual sends still vary widely.
 * That is exactly why the progress window continues to exist in automatic mode.
 *
 * @param {number} rate measured hashes per second
 * @param {{targetSeconds?: number, floor?: number, ceiling?: number}} [options]
 * @returns {number} difficulty in leading zero bits
 */
export function autoDifficulty(rate, { targetSeconds = 3, floor = 18, ceiling = 26 } = {}) {
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(targetSeconds) || targetSeconds <= 0) {
    return floor;
  }
  const affordable = Math.floor(Math.log2(targetSeconds * rate));
  return Math.max(floor, Math.min(ceiling, affordable));
}

/**
 * Folds a new rate measurement into the stored one.
 *
 * A single send is a poor measurement: the machine may have been busy, thermally throttled, or the sample may be
 * short. An exponential moving average keeps the estimate responsive to a real change - a different machine, a
 * different power profile - without letting one unlucky send halve the difficulty for everybody.
 *
 * @param {number} previous stored rate, 0 when there is none
 * @param {number} sample newly measured rate
 * @param {number} [weight] how much the new sample counts
 */
export function blendRate(previous, sample, weight = 0.3) {
  if (!Number.isFinite(sample) || sample <= 0) {
    return Number.isFinite(previous) && previous > 0 ? previous : 0;
  }
  if (!Number.isFinite(previous) || previous <= 0) {
    return sample;
  }
  return previous * (1 - weight) + sample * weight;
}
