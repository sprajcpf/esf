# ESF for Thunderbird

A Thunderbird MailExtension that mints an **ESF-Stamp** (proof of work) for every recipient of an outgoing message
and verifies incoming stamps, showing the result as a green / yellow / red traffic light.

This is the *Phase 1 client prototype* of the ESF deployment roadmap: see
[`docs/ESF_End_Spam_Forever_Technical_Whitepaper.md`](../../docs/ESF_End_Spam_Forever_Technical_Whitepaper.md) ([HTML](../../docs/ESF_End_Spam_Forever_Technical_Whitepaper.html)) for the protocol it implements.

> **Proof of work is not authentication.** A valid stamp proves that measurable computing time was spent for a
> specific recipient. It says nothing about *who* sent the message, whether the content is safe, or whether the mail
> is wanted. ESF complements SPF, DKIM, DMARC, S/MIME and OpenPGP — it does not replace or resemble them.

---

## What it does

- **Outgoing:** hooks `compose.onBeforeSend`, mints one stamp per recipient off the UI thread, and attaches them as
  a single `X-ESF-Stamp` header field. With ESF enabled a message is meant to *carry* a stamp, so the search runs in
  two stages: quiet for the first second, then visibly (still running, never abandoned), and only after the patience
  threshold does it ask whether to keep going, send without, or cancel.
- **Incoming:** verifies every stamp of a displayed message against your own mailboxes and shows the traffic light
  on the message-display button, with details behind a disclosure.
- **Optional:** feed a red result into Thunderbird's junk flag (off by default).

## The stamp

```text
X-ESF-Stamp: v=1; alg=sha256; d=22; t=1787651400; sid=6wSaI0IDIy_r5NvA5k1QSCe8Y6m3j5K5qdYxjEzV_qg;
             rid=tuCnpNbrXzseXq1aJFYyQDTUiObR8jfL87ZLdyS_PMg; mid=E6_RwO9y3KaChgtK5WN3Qye94zi9SeK3l9oIeD0fO9c;
             salt=8f2c1d4ea7b3906512c0de77a15be340; nonce=19d82c
```

| Field | Meaning |
|---|---|
| `v` | Protocol version (`1`) |
| `alg` | Work profile — `sha256` here; ESF v1 also names `argon2id` |
| `d` | Declared difficulty in leading zero **bits** |
| `t` | Stamp creation time, Unix seconds UTC |
| `sid` | `BASE64URL(SHA256("from:" ‖ canonical_from))` — sender binding |
| `rid` | `BASE64URL(SHA256("to:" ‖ canonical_recipient ‖ 0x00 ‖ salt))` — recipient binding |
| `mid` | `BASE64URL(SHA256("mid:" ‖ normalized_message_id))` — message binding |
| `salt` | 128 random bits, hex, fresh per stamp |
| `nonce` | The discovered nonce, hex |

The work function (whitepaper 6.4):

```text
work = UTF8("ESF1\n" + "alg=…\n" + [profile params] + "d=…\n" + "t=…\n" + "sid=…\n" + "rid=…\n" + "mid=…\n" +
            "salt=…\n" + "nonce=…\n")
valid iff leading_zero_bits(SHA256(work)) >= d
```

Difficulty counts **bits**, not hexadecimal zeros: `000f…` and `0008…` are both twelve zero bits, `0018…` is only
eleven. Generating a 22-bit stamp costs ~4.2 million hashes; verifying one costs exactly **one** hash, whatever the
sender declares.

**No mailbox appears in clear text.** Recipients are bound by a salted token, so To, Cc and Bcc addresses are all
equally unexposed. A receiver recomputes the token for its own mailboxes; a third party who already *suspects* an
address can test that guess, which is why Bcc stamps are opt-in (see below).

## Traffic light

Worth saying plainly: the end state ESF aims at has **no user interface at all** — the verification result feeds the
spam filtering that already decides where mail lands (whitepaper 4.2). The traffic light in this client exists
because almost no mail carries a stamp yet and both receivers and implementers need to see what verification
produced. Treat it as an adoption-phase affordance; the junk-flag setting below is the first step towards the
filter-only end state.

The colour is a policy result, not a cryptographic primitive (whitepaper 11):

| Badge | Internal state | Meaning |
|---|---|---|
| green + bit count | `strong` | Valid stamp bound to one of your mailboxes, at or above your minimum |
| yellow `~` | `weak` | Real work, but below your configured minimum |
| yellow `~` | `unsupported` | A registered ESF profile this client does not implement (e.g. argon2id) — never executed |
| red `–` | `missing` | No stamp. Almost no mail carries one today; this is **not** evidence of abuse |
| red `!` | `invalid` | Malformed, minted too long before the message, future-dated, wrong recipient, insufficient, replayed — or stale, if you set an absolute expiry |

`missing` and `invalid` share the red light but stay distinct internally, because automation must be able to tell a
legacy sender from a forged stamp.

## Installation

Requires **Thunderbird 128 or newer** (Manifest V3). Verified on Thunderbird 153.

1. Tools → Developer Tools → **Debug Add-ons**
2. **Load Temporary Add-on…**
3. select `manifest.json` in this directory

For a permanent install, build the package and install it via Add-ons Manager → gear icon → *Install Add-on From
File*. Unsigned add-ons need `xpinstall.signatures.required = false` in the Config Editor.

```bash
npm run package                              # -> dist/esf-thunderbird-<version>.xpi
npm run package -- --out ~/Downloads         # or straight into a directory of your choice
```

`tools/package.mjs` writes the archive itself rather than shelling out to a zip tool: entry names are always
forward-slashed (PowerShell's `Compress-Archive` writes backslashes, which Thunderbird cannot read) and timestamps
are fixed, so the same sources always produce a byte-identical `.xpi`.

## Development

```bash
npm test                    # 148 unit tests, no dependencies, no network
npm run package             # build the installable .xpi
npm run vectors             # regenerate test/vectors.json
npm run whitepaper          # re-render the whitepaper HTML, ODT and DOCX from the Markdown, then verify them
npm run check:whitepaper    # verify the renders match the Markdown without re-rendering
npm run profile -- <dir>    # build a throwaway test profile with a seeded inbox
```

The whole of `src/protocol/` is free of Thunderbird APIs, so the protocol runs and is tested in plain Node ≥ 20 —
the whitepaper asks for exactly that (4.1: one reusable core and one set of test vectors for every client, gateway
and filter). `test/vectors.json` is the interoperability contract: mailboxes, salt, timestamp and the *first*
solution nonce are all fixed, so any implementation that reproduces it agrees on canonicalisation, token derivation,
the canonical work input and the difficulty measure.

Manual testing against a real Thunderbird:

```bash
npm run profile -- /tmp/esf-profile
thunderbird -no-remote -profile /tmp/esf-profile   # click the Inbox once to index the seeded messages
```

The generated profile has a Local Folders account (`esf-test@example.com`) and thirteen messages covering every
verification outcome, each subject naming the expected result.

## Architecture

```
src/
  protocol/            no Thunderbird APIs, fully unit tested
    constants.js       protocol constants, verification bounds, state/signal mapping
    sha256.js          synchronous SHA-256 for the search loop
    hash.js            digests, hex, base64url, countLeadingZeroBits()
    stamp.js           canonicalisation, sid/rid/mid tokens, canonical work input, searchNonce()
    parser.js          parseStamp/parseStampList, serializeStamp/serializeStampList
    verifier.js        verifyStamp/verifyMessageStamps, stampId() for the replay cache
    policy.js          difficulty policy (trust-aware hook) and receiver policy
  workers/powWorker.js one nonce-space shard per worker
  background/
    background.js      event wiring, traffic-light badge, messaging
    solver.js          worker pool, progress, cancellation
    composeSigner.js   compose.onBeforeSend → stamps
    verificationService.js  header reading, verification cache, replay ledger
  compose/             compose popup (progress, cancel, time-budget decision)
  messageDisplay/      traffic light and details
  options/             settings page with a local hash-rate benchmark
```

Two deliberate choices:

- **The protocol does not know Thunderbird exists.** Everything client-specific lives outside `src/protocol/`.
- **Difficulty is a policy function**, not inline in the send path. `resolveOutgoingDifficulty()` currently returns
  the configured baseline for everyone; the trust-aware classes of whitepaper 7.3 (known contact, replied-to,
  authenticated organisation, suspicious, consented bulk) plug into `classifyRecipient()` without touching the send
  path.

### Why a hand-written SHA-256

`crypto.subtle.digest()` is promise-based: one microtask per candidate caps the search at a few tens of thousands of
hashes per second, so a 22-bit stamp would take minutes. `sha256.js` reaches ~270k hashes/s per worker on a
mid-range laptop — an 18-bit stamp in well under a second across two workers, measured inside Thunderbird. The test
suite asserts digest-identical output against `crypto.subtle`, which remains in use for one-shot hashing.

## Thunderbird APIs used

| API | Use | Notes |
|---|---|---|
| `compose.onBeforeSend` | Hook the send, mint stamps, attach the field | Async listeners supported; returning `{details}` equals `setComposeDetails()` |
| `ComposeDetails.customHeaders` | Attach `X-ESF-Stamp` | TB 100+; names must start with `X-` |
| `composeAction` | Compose indicator, progress, time-budget dialog | `openPopup()` needs TB 113+ |
| `messageDisplay.onMessagesDisplayed` | Verify on open | MV3 name; the singular form was removed |
| `messageDisplayAction` | Traffic-light badge and details popup | |
| `messages.getHeaders` | Read the stamp fields | TB 147+, falls back to `getFull()` then `getRaw()` |
| `messages.onNewMailReceived` | Optional junk policy on arrival | needs `accountsRead` + `messagesRead` |
| `messages.update` | Optional junk flag | needs `messagesUpdate` |
| `identities.list` | The mailboxes a stamp may bind to | needs `accountsRead` |
| `storage.local` | Settings and replay ledger | |
| ES module Web Workers | Nonce search off the UI thread | |

Manifest V3 with a background **page** (`src/background/background.html`) loading an ES module. Thunderbird uses
event pages rather than service workers, and `background.scripts` + `"type": "module"` did not start reliably on
TB 153, so the page form is used deliberately.

## API limitations designed around

1. **`customHeaders` keeps only one field per name.** Setting three `X-ESF-Stamp` fields leaves only the last one
   (measured on TB 153). The whitepaper's one-field-per-recipient form is therefore folded into a comma separated
   list inside a single field; both forms are accepted on receipt.
2. **The Message-ID does not exist yet at compose time.** Thunderbird assigns it after the send hook, and
   `customHeaders` cannot set a non-`X-` field, so `mid` binds an identifier this client mints. The consequence is
   honest: the stamp binds recipient + sender + time + salt + that identifier, not the message body. The receiver's
   replay ledger (keyed on `SHA256(canonical stamp)`) closes the reuse gap.
3. **Bcc cannot get its own message copy.** The whitepaper prefers one message copy per Bcc recipient, which a
   MailExtension cannot create from the send hook. The default is therefore to omit Bcc stamps; the alternative
   (include the salted token) is one setting away and documented as guessable by someone who already suspects the
   address.
4. **Header names normalise to `Http-Header-Case`** — `X-ESF-Stamp` comes back as `X-Esf-Stamp`, so all comparisons
   are case-insensitive.
5. **Address-book contacts and mailing lists** arrive as `{id, type}` nodes, not mailboxes. Expanding them needs the
   `addressBooks` permission; for now they are counted and reported rather than silently skipped.
6. **No message-header row.** MailExtensions cannot add one without a legacy experiment, so the result lives on the
   `messageDisplayAction` button.
7. **`onBeforeSend` is a user-input event.** A long computation delays the send, which is why the budget is bounded
   and the user is asked when it is exceeded.

## Performance

- The nonce search never runs on the UI thread. Workers take disjoint shards (`start + k·stride`).
- Default worker count is `min(4, cores − 2)`: shards shorten the wait proportionally, but the machine keeps two
  cores for Thunderbird and everything else (whitepaper 13).
- Cancellation is `worker.terminate()` — CPU work stops in the same tick, not at the next checkpoint.
- Verification is one hash per stamp, at most 8 header fields and 16 stamps per message, with per-message caching.
- Freshness has two parts. The stamp must be **contemporaneous with its message** — minted within 24 h of it by
  default — which is what stops anyone minting stamps for months on idle hardware and dumping them in one campaign.
  An absolute expiry is separate, optional and off: a proof of work does not become untrue with age. Both are
  measured against when the message *arrived* (the topmost `Received` field, which the sender does not control,
  falling back to `Date`), never against the moment it is opened — so an archived message keeps the verdict it had
  on arrival instead of turning red weeks later.
- *Measure my hash rate* in the options turns local throughput into expected durations per difficulty.

Difficulty and the time budget belong together, because work is exponential. Measured inside Thunderbird at roughly
300k hashes/s across two workers (four shards on a machine with cores to spare roughly halves these times):

| Difficulty | Expected hashes | Expected time | Stamped within a 1 s budget |
|---|---|---|---|
| 18 bits | 262 k | ~0.9 s | ~68 % |
| 20 bits | 1.0 M | ~3.5 s | ~25 % |
| 22 bits | 4.2 M | ~14 s | ~7 % |
| 24 bits | 16.8 M | ~56 s | ~2 % |

The search is memoryless, so the *expected* time says little about a single send: one message may be stamped in
200 ms and the next not at all. That is why the default pairs 18 bits with a one-second budget and sends unstamped
when the budget runs out — rather than making the user wait for an average.

## Privacy

- A stamp publishes three opaque 43-character tokens, a random salt, a nonce, a difficulty and a timestamp. No
  mailbox, no subject, no body, no machine identifier, no configuration.
- The timestamp discloses when the stamp was minted, roughly when the mail was sent — which `Date` already says.
- Everything stays local: no network requests, no service, no telemetry. Settings and the replay ledger (stamp
  digest + a message key, capped and pruned to the freshness window) live in `storage.local` in your profile.

## Status

Implemented: SHA-256 profile, worker pool, compose integration, incoming verification, traffic light, replay cache,
settings, test vectors. Not yet: the argon2id profile (recognised and reported as unsupported, never executed), DNS
policy discovery, trust-aware classification, mailing-list/forwarding handling, and localisation (`_locales/`).

## Licence

Apache-2.0, as for the rest of the ESF project.
