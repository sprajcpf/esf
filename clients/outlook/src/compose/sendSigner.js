/**
 * Outgoing side: mints one ESF stamp per recipient for a message about to be sent.
 *
 * This module is pure protocol-plus-policy and takes plain data, so it is shared by the OnMessageSend event handler
 * and the tests; everything Office-specific stays in src/events/launchevent.js. The flow mirrors the Thunderbird
 * ComposeSigner (clients/thunderbird/src/background/composeSigner.js) so both clients emit identical stamps.
 *
 * Bcc (whitepaper 6.9): a header field is visible to every recipient, so a Bcc recipient's binding token must not be
 * exposed unless it is safe. Outlook, like Thunderbird, cannot create a separate message copy per Bcc recipient from
 * the send hook, so the same two honest options apply: "omit" (default, no stamp for Bcc) or "token" (include the
 * salted rid, which a determined observer with a guess list can test).
 */

import {
  ALGORITHM_SHA256,
  PROTOCOL_VERSION,
  autoDifficulty,
  buildWorkBase,
  canonicalMailbox,
  generateSalt,
  hashRate,
  messageIdToken,
  probeWorkBase,
  randomHex,
  recipientToken,
  resolveOutgoingDifficulty,
  searchNonce,
  senderToken,
  serializeStampList,
  unixSeconds
} from "../esf-core.js";
import { isStale } from "./calibration.js";

/**
 * How long to measure the machine when nothing is known about it yet. Long enough to be representative, short enough
 * to be invisible next to the send it precedes - and far below the ~5 s after which Outlook starts telling the user
 * that the add-in is still working.
 */
export const PROBE_MS = 250;

/**
 * Measures this machine's hash rate with a short unwinnable search.
 *
 * Uses probeWorkBase(), and that matters more than it looks: SHA-256 processes 64 byte blocks, and a real ESF work
 * input is four of them where an improvised short string is one. Measuring with a short input overestimates the
 * achievable rate by roughly 1.8x, so a difficulty chosen from it would make every send take about 1.8x longer than
 * the user asked for - the exact failure automatic mode exists to prevent.
 *
 * @param {{probeMs?: number}} [options]
 * @returns {Promise<number>} hashes per second, 0 when nothing was measurable
 */
export async function probeHashRate({ probeMs = PROBE_MS } = {}) {
  try {
    const startedAt = Date.now();
    const deadline = startedAt + Math.max(1, probeMs);
    // Difficulty 64 is unreachable, so the search runs exactly until the deadline: a pure rate measurement that
    // cannot accidentally succeed early and report a rate from a two-hash sample.
    const result = await searchNonce({
      workBase: probeWorkBase(),
      difficulty: 64,
      shouldStop: () => Date.now() > deadline
    });
    return hashRate(result.hashes, Date.now() - startedAt);
  } catch (error) {
    console.warn("[esf] rate probe failed", error);
    return 0;
  }
}

/**
 * The difficulty to use on this machine in automatic mode.
 *
 * Prefers the rate learned from previous sends. With nothing stored - the first send after installation - it probes
 * rather than guessing, because guessing low makes the first stamp weak and guessing high makes the first send the
 * slow one people remember.
 *
 * @param {object} options
 * @param {object} options.settings normalized settings
 * @param {import("./calibration.js").Calibration|null} [options.calibration] stored rate, read by the caller
 * @param {number} [options.probeMs]
 * @param {number} [options.now]
 * @returns {Promise<{difficulty: number, rate: number, probedRate: number, source: "stored"|"probe"|"floor"}>}
 */
export async function resolveAutoDifficulty({ settings, calibration, probeMs = PROBE_MS, now = Date.now() }) {
  // floor/ceiling are the shared defaults, spelled out so the reason is visible here: below 18 bits a stamp starts
  // being refused as too weak, above 26 the extra work buys nothing a receiver asks for today.
  const options = { targetSeconds: settings.autoTargetSeconds, floor: 18, ceiling: 26 };
  if (calibration && calibration.rate > 0 && !isStale(calibration, now)) {
    return { difficulty: autoDifficulty(calibration.rate, options), rate: calibration.rate, probedRate: 0,
      source: "stored" };
  }
  const probed = await probeHashRate({ probeMs });
  if (probed > 0) {
    return { difficulty: autoDifficulty(probed, options), rate: probed, probedRate: probed, source: "probe" };
  }
  // Nothing measurable: autoDifficulty(0) is the floor, which is the safe answer, and the next send will know better.
  return { difficulty: autoDifficulty(0, options), rate: 0, probedRate: 0, source: "floor" };
}

/**
 * Deduplicates and canonicalises raw recipient strings. Unusable entries are counted, never silently dropped.
 *
 * @param {string[]} rawMailboxes
 * @returns {{mailboxes: string[], unresolved: number}}
 */
export function canonicalRecipients(rawMailboxes) {
  const mailboxes = [];
  let unresolved = 0;
  for (const raw of rawMailboxes || []) {
    const mailbox = canonicalMailbox(raw);
    if (mailbox) {
      mailboxes.push(mailbox);
    } else {
      unresolved++;
    }
  }
  return { mailboxes: [...new Set(mailboxes)], unresolved };
}

/**
 * Mints the stamps for one outgoing message.
 *
 * The stamp binds a message identifier minted here (uuid-style @esf.invalid): Outlook assigns the real Message-ID
 * only when Exchange accepts the message, long after this hook. Same prototype semantics as Thunderbird; receivers
 * verify with messageId undefined (see verifier context in both clients).
 *
 * @param {object} input
 * @param {string} input.from sending mailbox
 * @param {string[]} input.to raw To mailboxes
 * @param {string[]} input.cc raw Cc mailboxes
 * @param {string[]} input.bcc raw Bcc mailboxes
 * @param {object} input.settings normalized settings (settings/settings.js)
 * @param {import("./calibration.js").Calibration|null} [input.calibration] stored hash rate for automatic mode; the
 *        caller reads it, because reading it is the one part that touches Office
 * @param {number} [input.probeMs] probe length when automatic mode has no usable stored rate
 * @param {number} [input.now] injectable clock for tests
 * @param {() => boolean} [input.shouldStop] external cancellation, consulted between hash batches
 * @returns {Promise<{status: "done"|"skipped"|"timeout", headerValue: string|null, stampCount: number,
 *                    recipientCount: number, skippedBcc: number, unresolved: number, hashes: number,
 *                    elapsedMs: number, timedOutRecipient: string|null, difficulty: number, automatic: boolean,
 *                    rate: number, probedRate: number, rateSource: string|null}>}
 */
export async function mintStamps({ from, to, cc, bcc, settings, calibration = null, probeMs = PROBE_MS,
  now = Date.now(), shouldStop }) {
  const visible = canonicalRecipients([...(to || []), ...(cc || [])]);
  const hidden = canonicalRecipients(bcc || []);
  const targets = visible.mailboxes.slice();
  const bccIncluded = settings.bccMode === "token";
  let skippedBcc = 0;
  for (const mailbox of hidden.mailboxes) {
    if (visible.mailboxes.includes(mailbox)) {
      continue;
    }
    if (bccIncluded) {
      targets.push(mailbox);
    } else {
      skippedBcc++;
    }
  }
  const unresolved = visible.unresolved + hidden.unresolved;
  const base = {
    status: "skipped",
    headerValue: null,
    stampCount: 0,
    recipientCount: targets.length,
    skippedBcc,
    unresolved,
    hashes: 0,
    elapsedMs: 0,
    timedOutRecipient: null,
    difficulty: 0,
    automatic: settings.difficultyMode === "auto",
    /** Hashes per second measured on this send, for the caller to fold back into the calibration. */
    rate: 0,
    probedRate: 0,
    rateSource: null
  };
  if (targets.length === 0) {
    return base;
  }

  const startedAt = Date.now();
  // Automatic mode: pick the difficulty from what this machine measurably does, so the user never chooses a number and
  // never waits much longer than they asked to. Resolved before the tokens, so a probe is not counted as search time.
  const auto = settings.difficultyMode === "auto"
    ? await resolveAutoDifficulty({ settings, calibration, probeMs, now })
    : null;
  const calibrated = auto ? auto.difficulty : null;
  const messageId = `${randomHex(16)}@esf.invalid`;
  const timestamp = unixSeconds(now);
  const sid = await senderToken(from);
  const mid = await messageIdToken(messageId);

  const stamps = [];
  let hashes = 0;
  // Only the nonce searches count towards the measured rate: token hashing, the probe and the Office round trips are
  // real time but not hashing time, and including them would understate the machine and lower every later difficulty.
  let searchMs = 0;
  // Per recipient the search runs up to askAfterSeconds - the quiet maxComputeSeconds phase has no visible effect in
  // an event handler, so the hard bound is the one that matters here. The overall deadline keeps a many-recipient
  // send safely below the ~5 minute Smart Alerts runtime limit; what happens on timeout is the caller's policy.
  const overallDeadline = startedAt + Math.min(240_000, targets.length * (settings.askAfterSeconds ?? 15) * 1000);
  for (const mailbox of targets) {
    const { difficulty } = resolveOutgoingDifficulty({ recipient: mailbox, recipientCount: targets.length, settings,
      calibrated });
    if (difficulty <= 0) {
      continue;
    }
    const salt = generateSalt();
    const stamp = {
      version: PROTOCOL_VERSION,
      algorithm: ALGORITHM_SHA256,
      difficulty,
      timestamp,
      sid,
      rid: await recipientToken(mailbox, salt),
      mid,
      salt,
      profileParams: {}
    };
    const deadline = Math.min(Date.now() + (settings.askAfterSeconds ?? 15) * 1000, overallDeadline);
    const searchStartedAt = Date.now();
    const result = await searchNonce({
      workBase: buildWorkBase(stamp),
      difficulty,
      shouldStop: () => Date.now() > deadline || Boolean(shouldStop && shouldStop())
    });
    searchMs += Date.now() - searchStartedAt;
    hashes += result.hashes;
    if (!result.found) {
      // One recipient exhausting its budget aborts the whole attempt: a partially stamped message would show red at
      // exactly the recipients the sender ran out of time for, which is worse than an honest "sent without ESF".
      // Still a measurement: a search that ran out of budget hashed at some rate, and recording it is how a machine
      // that turned out too slow ends up with a lower difficulty next time instead of timing out again.
      return { ...base, ...measured(auto, hashes, searchMs), status: "timeout", hashes,
        elapsedMs: Date.now() - startedAt, timedOutRecipient: mailbox };
    }
    stamps.push({ ...stamp, nonce: result.nonce });
  }

  if (stamps.length === 0) {
    return { ...base, ...measured(auto, hashes, searchMs), hashes, elapsedMs: Date.now() - startedAt };
  }
  // Like Thunderbird, all stamps of a message travel in one header field value (accepted forms: one field per stamp
  // or a comma separated list; see the core parser).
  return {
    ...base,
    ...measured(auto, hashes, searchMs),
    status: "done",
    headerValue: serializeStampList(stamps),
    stampCount: stamps.length,
    hashes,
    elapsedMs: Date.now() - startedAt
  };
}

/** The calibration-relevant part of an outcome: which difficulty was used, and what the send itself measured. */
function measured(auto, hashes, searchMs) {
  return {
    difficulty: auto ? auto.difficulty : 0,
    rate: hashRate(hashes, searchMs),
    probedRate: auto ? auto.probedRate : 0,
    rateSource: auto ? auto.source : null
  };
}
