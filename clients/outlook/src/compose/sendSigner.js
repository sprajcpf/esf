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
  buildWorkBase,
  canonicalMailbox,
  generateSalt,
  messageIdToken,
  randomHex,
  recipientToken,
  resolveOutgoingDifficulty,
  searchNonce,
  senderToken,
  serializeStampList,
  unixSeconds
} from "../esf-core.js";

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
 * @param {number} [input.now] injectable clock for tests
 * @param {() => boolean} [input.shouldStop] external cancellation, consulted between hash batches
 * @returns {Promise<{status: "done"|"skipped"|"timeout", headerValue: string|null, stampCount: number,
 *                    recipientCount: number, skippedBcc: number, unresolved: number, hashes: number,
 *                    elapsedMs: number, timedOutRecipient: string|null}>}
 */
export async function mintStamps({ from, to, cc, bcc, settings, now = Date.now(), shouldStop }) {
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
    timedOutRecipient: null
  };
  if (targets.length === 0) {
    return base;
  }

  const startedAt = Date.now();
  const messageId = `${randomHex(16)}@esf.invalid`;
  const timestamp = unixSeconds(now);
  const sid = await senderToken(from);
  const mid = await messageIdToken(messageId);

  const stamps = [];
  let hashes = 0;
  // Per recipient the search runs up to askAfterSeconds - the quiet maxComputeSeconds phase has no visible effect in
  // an event handler, so the hard bound is the one that matters here. The overall deadline keeps a many-recipient
  // send safely below the ~5 minute Smart Alerts runtime limit; what happens on timeout is the caller's policy.
  const overallDeadline = startedAt + Math.min(240_000, targets.length * (settings.askAfterSeconds ?? 15) * 1000);
  for (const mailbox of targets) {
    const { difficulty } = resolveOutgoingDifficulty({ recipient: mailbox, recipientCount: targets.length, settings });
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
    const result = await searchNonce({
      workBase: buildWorkBase(stamp),
      difficulty,
      shouldStop: () => Date.now() > deadline || Boolean(shouldStop && shouldStop())
    });
    hashes += result.hashes;
    if (!result.found) {
      // One recipient exhausting its budget aborts the whole attempt: a partially stamped message would show red at
      // exactly the recipients the sender ran out of time for, which is worse than an honest "sent without ESF".
      return { ...base, status: "timeout", hashes, elapsedMs: Date.now() - startedAt, timedOutRecipient: mailbox };
    }
    stamps.push({ ...stamp, nonce: result.nonce });
  }

  if (stamps.length === 0) {
    return { ...base, hashes, elapsedMs: Date.now() - startedAt };
  }
  // Like Thunderbird, all stamps of a message travel in one header field value (accepted forms: one field per stamp
  // or a comma separated list; see the core parser).
  return {
    ...base,
    status: "done",
    headerValue: serializeStampList(stamps),
    stampCount: stamps.length,
    hashes,
    elapsedMs: Date.now() - startedAt
  };
}
