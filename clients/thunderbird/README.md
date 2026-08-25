# ESF for Thunderbird

A Thunderbird MailExtension that attaches a **Proof-of-Work (PoW)** header to outgoing mail and verifies it on
incoming mail.

> **Proof-of-Work does not authenticate the sender. It only proves that computational work was performed for the
> email.**

It is not a replacement for DKIM, SPF, DMARC, S/MIME or OpenPGP, and it is not related to them. Those mechanisms
answer *who sent this and was it modified*. PoW answers a different question: *did the sender spend real CPU time on
this specific message and this specific recipient*. The two are complementary — a signed message can still be bulk
spam, and a proof of work says nothing about identity.

---

## Purpose

Sending email is essentially free, which is what makes bulk spam viable. A proof of work makes each *recipient* of
each *message* cost the sender a measurable amount of CPU time. For a person writing a handful of mails a day the
cost is invisible; for someone sending a million messages it is not.

ESF gives you:

- one proof per recipient on outgoing mail, computed off the UI thread and cancellable,
- verification of incoming proofs with a colour-coded badge and a detail panel,
- an optional (default: off) junk-flag policy for mail without a valid proof.

## Threat model

What PoW in this design **does** protect against:

| Attack | Mitigation |
|---|---|
| Bulk sending | Cost scales linearly with recipients × messages; the sender cannot amortise one proof over many. |
| Reusing one proof for many recipients | The recipient address is part of the hash preimage. |
| Precomputing proofs for a known address | A fresh 128-bit random salt per proof makes precomputation useless. |
| Replaying a proof on a later message | Timestamp window (default 7 days) plus a local replay ledger keyed on recipient + digest. |
| Claiming work that was not done | The verifier recomputes the digest and counts leading zero bits itself. |
| Claiming an absurd difficulty | `bits` is capped at `MAX_ACCEPTED_DIFFICULTY = 30`; verification cost is one hash regardless. |
| Header-based DoS on the verifier | Bounded header length (512 B), bounded field count, at most 8 proof headers per message, no backtracking regexes. |
| Bcc address disclosure | Bcc recipients are bound by `rid=sha256(salt‖address)`, never by plaintext address. |

What it explicitly does **not** protect against:

- **Identity.** Anyone can compute a proof for any recipient. A valid proof means "someone burned CPU", not
  "this is really Alice".
- **A well-funded attacker.** 22 bits is roughly 4 million hashes: a few seconds on a laptop, milliseconds on rented
  GPUs or an ASIC. PoW raises the floor for casual bulk senders; it does not stop a determined one.
- **Message content.** The proof is not bound to the body (see *Limitations*), so a valid header proves work was done
  for you as a recipient at a point in time, not that this exact text was the message that carried it.
- **Missing proofs.** Practically no mail carries a proof today. A missing proof is a non-signal, and the UI says so.

## How the proof works

For every recipient the sender searches for a `nonce` such that

```
SHA256( version | recipient | timestamp | messageId | salt | nonce )
```

has at least `bits` **leading zero bits**. Fields are UTF-8, joined by `|` so no field can be shifted into its
neighbour. `recipient` is lowercased with the display name and angle brackets removed, `timestamp` is the compact UTC
form, `nonce` is a decimal integer.

Difficulty is counted in *bits*, not in hexadecimal zero characters — `000f…` and `0008…` are both twelve zero
bits, while `0018…` is only eleven.

The result travels as a header:

```
X-Email-PoW: v=1; alg=sha256; bits=22; ts=20260825T103800Z; rcpt=user@example.com;
             mid=6f1a…@esf.invalid; nonce=839274829374; salt=8f2c1d4ea7b3906512c0de77a15be340
```

| Field | Meaning |
|---|---|
| `v` | Protocol version (`1`) |
| `alg` | Hash algorithm (`sha256`) |
| `bits` | Declared difficulty in leading zero bits |
| `ts` | UTC timestamp, `YYYYMMDDTHHMMSSZ` |
| `rcpt` | Recipient address the proof is bound to (To/Cc) |
| `rid` | *Instead of* `rcpt`: `sha256(salt‖address)` for Bcc recipients |
| `mid` | Message identifier the proof was computed for |
| `nonce` | The discovered nonce |
| `salt` | 16 random bytes, hex, fresh per proof |

Multiple recipients produce multiple `X-Email-PoW` headers, one per recipient. A receiving client verifies the one
bound to its own address and ignores the rest.

**Cost asymmetry.** Generating a 22-bit proof takes ~4.2 million hashes. Verifying it takes exactly **one** hash,
whatever the sender declares.

### Bcc

A header is visible to *every* recipient of a message, so writing a Bcc address into `rcpt` would leak it. Bcc
recipients are therefore bound by `rid=sha256(salt‖address)`:

- the Bcc'd recipient can still verify — they know their own address,
- other recipients see an opaque digest.

The residual exposure is honest to state: someone who *already suspects* a specific address can test that guess
against `rid`. The salt prevents precomputed tables, not targeted guessing. If that matters to you, set Bcc handling
to *No proof for Bcc recipients* in the options.

## Installation

Requires **Thunderbird 128 or newer** (Manifest V3 support).

Temporary install, for testing:

1. Tools → Developer Tools → **Debug Add-ons**
2. **Load Temporary Add-on…**
3. select `manifest.json` in this repository

Permanent install: zip the repository contents (with `manifest.json` at the **root** of the archive) and install the
`.zip`/`.xpi` via Add-ons Manager → gear icon → *Install Add-on From File*. Unsigned add-ons need
`xpinstall.signatures.required = false` in the Config Editor, or Thunderbird Daily/Beta.

```bash
zip -r esf.zip manifest.json icons src -x "*.md"
```

## Development setup

```bash
npm test          # 114 unit tests, no dependencies, no network
npm run vectors   # regenerate test/vectors.json
```

The test suite runs on plain Node ≥ 20 with `node:test` — the entire `src/protocol/` tree is free of Thunderbird
APIs by design, so the protocol can be tested without a mail client. `src/background/` and the UI need Thunderbird;
the parts of them that are testable in isolation (recipient flattening, the raw-header fallback parser, settings
normalisation, difficulty policy) are covered in `test/integration.test.mjs`.

Debug logging: enable it in the add-on options, then watch Tools → Developer Tools → Error Console.

## Architecture

```
src/
  protocol/            no Thunderbird APIs, fully unit tested
    constants.js       protocol constants and hard verification limits
    sha256.js          synchronous SHA-256 for the search loop
    hash.js            digests, hex, countLeadingZeroBits()
    pow.js             canonicalisation, preimage, searchNonce(), generateProof()
    parser.js          parseProofHeader() / serializeProof(), strict and bounded
    verifier.js        verifyProof() / verifyMessageHeaders()
    policy.js          difficulty policy, the hook for adaptive rules
  workers/
    powWorker.js       one nonce-space shard per worker
  background/
    background.js      event wiring, badges, messaging
    solver.js          worker pool, progress, cancellation
    composeSigner.js   compose.onBeforeSend → headers
    verificationService.js  header reading, verification cache, replay ledger
  compose/             compose popup (progress, cancel, timeout decision)
  messageDisplay/      verification detail popup
  options/             settings page
  ui/common.css        shared styling, light and dark
  utils/               settings, logging
```

Two deliberate structural choices:

- **The protocol does not know Thunderbird exists.** Everything mail-client specific lives outside
  `src/protocol/`, which is what makes the interesting logic testable in a plain Node process.
- **Difficulty is decided by a policy function**, not inline in the send path. `resolveOutgoingBits()` today returns
  the configured value for everyone; adaptive rules (address book, reputation, bulk detection) plug in there
  without touching `composeSigner.js`.

### Why a hand-written SHA-256

`crypto.subtle.digest()` is promise-based: one microtask per candidate caps the search at a few tens of thousands of
hashes per second, which makes a 22-bit proof take minutes. The synchronous implementation in `sha256.js` reaches
~270k hashes/s per worker on a mid-range laptop — a 22-bit proof in a few seconds across two workers. The test
suite asserts digest-identical output against `crypto.subtle` for a range of inputs, and `crypto.subtle` remains in
use for one-shot hashing.

## Thunderbird APIs used

| API | Use | Notes |
|---|---|---|
| `compose.onBeforeSend` | Hook the send, compute proofs, inject headers | Async listeners are supported; returning `{details}` is equivalent to `setComposeDetails()` |
| `ComposeDetails.customHeaders` | Add the `X-Email-PoW` headers | Thunderbird 100+; names must start with `X-` |
| `composeAction` | Compose-window indicator, progress and the timeout dialog | `openPopup()` requires TB 113+ |
| `messageDisplay.onMessageDisplayed` | Verify on open | |
| `messageDisplayAction` | Badge (`setBadgeText`, `setBadgeBackgroundColor`) and detail popup | |
| `messages.getHeaders` | Read the proof headers | TB 147+; falls back to `getFull()`, then `getRaw()` |
| `messages.onNewMailReceived` | Optional junk policy on arrival | Needs `accountsRead` + `messagesRead` |
| `messages.update` | Optional junk flag | Needs `messagesUpdate` |
| `identities.list` | The addresses a proof may be bound to | Needs `accountsRead` |
| `storage.local` | Settings and replay ledger | |
| Web Workers (ES modules) | Nonce search off the UI thread | |

Manifest V3, `background.scripts` with `"type": "module"` (Thunderbird uses event pages, not service workers).

## API limitations we had to design around

1. **The Message-ID is not available at compose time.** Thunderbird assigns it after `onBeforeSend` returns, and
   `customHeaders` cannot set a non-`X-` header. The proof is therefore bound to a random `mid` we generate and
   publish in the header. Consequence: the proof binds *recipient + time + salt + mid*, not the message body. The
   replay ledger compensates by refusing a digest that reappears on a different message.
2. **Headers are per-message, not per-recipient.** SMTP delivers the same header block to everybody, which is the
   whole reason Bcc needs the hashed `rid` form.
3. **Header names are normalised to `Http-Header-Case`.** `X-Email-PoW` may come back as `X-Email-Pow`; all
   comparisons are case-insensitive.
4. **Address-book contacts and mailing lists** arrive in `ComposeDetails` as `{id, type}` nodes, not addresses.
   Expanding them would need the `addressBooks` permission; for now they are counted and skipped, and the popup
   reports how many recipients got no proof.
5. **No message-header row.** MailExtensions cannot add a row to the message header pane without a legacy
   experiment, so the verification result lives on the `messageDisplayAction` button (badge + popup).
6. **`onBeforeSend` is a user-input event.** A long computation delays the send; that is why the compute budget is
   bounded and the user is asked what to do when it is exceeded.

## Performance

- The nonce search never runs on the UI thread. Workers are shards of the nonce space (`startNonce + k·stride`), so
  no two workers try the same candidate.
- Default worker count is `min(2, cores − 1)` — the machine stays usable while a proof is computed. Configurable.
- Cancellation is `worker.terminate()`: CPU work stops in the same tick, not at the next checkpoint.
- Cancelling the send, or the compute budget expiring, stops the search immediately.
- Verification is one hash per header, at most 8 headers per message, with per-message result caching.
- The options page has a *Measure my hash rate* button that turns your machine's throughput into expected durations
  per difficulty setting.

Rough guide (270k hashes/s per worker, 2 workers):

| Difficulty | Expected hashes | Expected time |
|---|---|---|
| 18 bits | 262 k | ~0.5 s |
| 20 bits | 1.0 M | ~2 s |
| 22 bits | 4.2 M | ~8 s |
| 24 bits | 16.8 M | ~31 s |
| 26 bits | 67 M | ~2 min |

Expected time is a *mean*: the search is memoryless, so individual sends vary widely.

## Privacy implications

- The header publishes a recipient address (for To/Cc — already visible in those headers), a timestamp with
  second precision, a random salt, a nonce and a random message identifier. It contains no information about the
  sender, the body, the machine or the add-on's configuration.
- Bcc addresses never appear in plaintext; see *Bcc* above for the residual guessing exposure.
- The timestamp discloses when the proof was computed, which is roughly when the mail was sent — the `Date` header
  already says that.
- Everything stays local. The add-on makes no network requests of its own, contacts no service, and sends no
  telemetry. The replay ledger (recipient + digest, capped at 2000 entries) and your settings live in
  `storage.local` in your profile.

## Settings

| Setting | Default |
|---|---|
| Enable Proof of Work | on |
| Outgoing difficulty | 22 bits |
| Maximum computation time | 5 s |
| When the time limit is reached | ask (continue / send without / cancel) |
| Bcc recipients | hashed binding |
| Worker threads | automatic, `min(2, cores − 1)` |
| Accept proofs up to | 7 days |
| Minimum accepted difficulty | 18 bits |
| Show verification badge | on |
| Mark messages without a valid proof as junk | **off** |
| Debug logging | off |

## Status indicators

| Badge | Meaning |
|---|---|
| green, bit count | Valid proof, bound to one of your addresses |
| yellow `-` | No proof — the normal case for almost all mail, and not a spam signal |
| red `!` | A proof is present but does not hold up (wrong digest, expired, wrong recipient, replayed, malformed) |

Clicking the button shows algorithm, difficulty, timestamp, recipient, verification time and the digest.

## Roadmap

Phases 1–3 of the design are implemented (protocol + workers + tests, outgoing integration, incoming verification
and badge) and most of phase 4 (cancellation, budget dialog, worker configuration, benchmark). Not done yet:

- adaptive difficulty driven by the address book (`policy.js` is ready for it, `classifyRecipient()` is a stub)
- expanding address-book contacts and mailing lists into addresses
- a localisation pass (`_locales/`) — all strings are currently inline English

## Licence

Apache-2.0, as for the rest of the ESF project.
