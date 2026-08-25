# ESF for Outlook

An Office.js add-in that attaches an **ESF Proof-of-Work stamp** to outgoing mail before Outlook releases it and
verifies stamps on incoming mail, shown as a simple traffic light:

```text
🟢 ESF protected          sufficient computational work was demonstrated
🟡 ESF proof is weak      valid work, but below your policy (or a profile this client cannot check)
🔴 No / invalid ESF proof
```

🟢 means *work was done for this recipient and message* — it is **not** sender authentication and **not** "this
email is safe". Technical detail (algorithm, difficulty, timestamps) lives behind *Details*; normal users never need
it.

## Architecture

The protocol implementation is shared with the Thunderbird client and is free of any client API usage:

```text
clients/thunderbird/src/protocol/   ← shared ESF core (constants, stamp, parser, verifier, policy, sha256)
clients/outlook/
    src/esf-core.js                 ← single re-export surface of the shared core (no duplication)
    src/outlook-api/                ← Office.js wrappers, MIME header handling, capability detection
    src/compose/sendSigner.js       ← outgoing flow (pure data in/out, shared by event handler and tests)
    src/events/launchevent.js       ← OnMessageSend entry point (bundled self-contained for the JS-only runtime)
    src/read/verifyCurrentMessage.js← incoming flow incl. replay ledger
    src/ui/taskpane.*               ← traffic light + settings
    src/settings/settings.js        ← RoamingSettings-backed, mirrors the Thunderbird defaults
    manifest/manifest.xml           ← add-in only (XML) manifest
```

When the core is extracted to `packages/esf-core`, only the import paths in `src/esf-core.js` change.

Both clients emit and accept identical stamps; `test/vectors.test.mjs` verifies the shared vectors from
`clients/thunderbird/test/vectors.json` through the Outlook read path. No client-specific protocol variants.

## Verified platform compatibility matrix

Verified against the Microsoft documentation as of 2026-08 (internet headers, Smart Alerts / event-based activation,
requirement set client support — see links below).

| Feature | Web | New Windows | Classic Windows | Mac (new UI) | iOS / Android |
| --- | --- | --- | --- | --- | --- |
| Generate ESF on Send (`OnMessageSend`, Mailbox 1.12) | ✅ | ✅ | ✅ (≥ 2206) | ✅ (≥ 16.65) | ❌ not supported by Microsoft |
| Add internet header (`internetHeaders.setAsync`, 1.8) | ✅ | ✅ | ✅ | ✅ | ✅ (≥ 4.2405.0) |
| Read ESF header (`getAllInternetHeadersAsync`, 1.8) | ✅ | ✅ | ✅ | ✅ | ✅ (≥ 4.2405.0) |
| Automatic send hook without admin deployment | ❌ | ❌ | ❌ | ❌ | ❌ |
| ESF task pane UI | ✅ | ✅ | ✅ | ✅ | ⚠️ limited add-in UI |
| Highest Mailbox requirement set | 1.16 | 1.16 | 1.16 (M365) | 1.14 | 1.5 (+ selected later APIs) |

Platform constraints this implementation is built around:

- **Persistent internet headers need Mailbox 1.8**; on read, ESF stamps are located in the full MIME header block
  returned by `getAllInternetHeadersAsync` (folded lines are unfolded, both `ESF-Stamp` and `X-ESF-Stamp` accepted).
- **`OnMessageSend` needs Mailbox 1.12+** and does not run on Outlook mobile. Event-based add-ins have a runtime
  limit of ~5 minutes and show a "taking long" dialog after ~5 seconds — the per-recipient bound (default 15 s) and
  an overall cap of 240 s keep ESF safely below the hard limit.
- **Classic Outlook on Windows runs event handlers in a JavaScript-only runtime**: no DOM, no `Office.onReady`, no
  module imports, exactly one script file. `dist/launchevent.js` is therefore a self-contained IIFE bundle, and the
  shared core's SHA-256 falls back to the bundled pure-JS implementation when `crypto.subtle` is absent. If
  `crypto.getRandomValues` is missing too, generation is *refused* (no crypto-random salt → precomputation risk),
  never silently weakened.
- **Event-based activation only auto-runs when the add-in is admin-deployed** (Microsoft 365 admin center →
  Integrated apps) or acquired via a qualifying Marketplace listing. A sideloaded/user-installed add-in still offers
  read verification and the task pane; the automatic send hook stays dark. This is a Microsoft platform rule, not an
  ESF limitation — documented, not worked around.
- `SendMode="PromptUser"` keeps the add-in Marketplace-publishable (`Block` would not be) and gives the user
  *Send Anyway* when `onSendFailure` is set to "block".
- The **unified Microsoft 365 manifest is not used**: it does not run on Outlook Mac or mobile. The add-in only XML
  manifest covers every platform that event-based activation covers.

Sources: [Internet headers](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/internet-headers),
[Smart Alerts / OnMessageSend](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/onmessagesend-onappointmentsend-events),
[Event-based activation](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/event-based-activation),
[Requirement set client support](https://learn.microsoft.com/en-us/javascript/api/requirement-sets/outlook/outlook-api-requirement-sets).

## Outgoing flow

```text
User presses Send
    → OnMessageSend (Smart Alerts)
    → read From / To / Cc / Bcc
    → one stamp per recipient: sid/rid/mid tokens, salt, SHA-256 nonce search (cooperative, budgeted)
    → internetHeaders.setAsync({ "ESF-Stamp": <stamp list> })
    → event.completed({ allowEvent: true })
```

No popup on success. With ESF enabled a message is meant to carry a stamp, so the search does not give up early: it
keeps working up to the per-recipient bound (default 15 s). Only then does the configured policy apply — **ask**
(default: the Smart Alerts dialog offers *Send Anyway* / *Don't Send*, and pressing Send again retries with a fresh
budget; this is the Outlook equivalent of Thunderbird's "quiet second, keep going, ask last") or **send without ESF**
(informational notice on the item). All computation is local; no content, recipient, header or telemetry ever leaves
the machine.

- **Recipient binding**: `rid = SHA256("to:" || mailbox || 0x00 || salt)` — a stamp for one recipient is useless for
  another, and **no recipient address appears in the header**.
- **Bcc**: default `omit` (no stamp for Bcc, per the whitepaper fallback) or `token` (salted rid only — a determined
  observer with a guess list can test it, which is why it is opt-in). Never a plaintext Bcc address in a header.
- **Message binding**: the stamp binds a sender-minted identifier (`…@esf.invalid`), because Outlook — like
  Thunderbird — assigns the real Message-ID only after the hook. Same prototype semantics in both clients; receivers
  verify with the carrier Message-ID unchecked. Tracked as a protocol issue, not shortcut differently per client.
- **Header name**: `ESF-Stamp` is sent (Office.js does not force an `X-` prefix); both `ESF-Stamp` and `X-ESF-Stamp`
  are accepted on receipt for prototype interop with Thunderbird, whose compose API forces the `X-` name.

## Incoming flow

```text
getAllInternetHeadersAsync → unfold MIME headers → collect ESF-Stamp / X-ESF-Stamp
    → shared-core parse + verify (bounded: length, count, declared difficulty — sender parameters are never trusted)
    → replay ledger (localStorage, freshness-window pruning)
    → 🟢 / 🟡 / 🔴 in the task pane
```

Verification cost is one SHA-256 regardless of declared difficulty; all anti-DoS bounds come from the shared core.
Stamp freshness is bound to the message, not to the clock on the wall: a stamp must be minted within a configurable
window (default 24 h) before the message came into being — referenced by the topmost `Received` field, which the
receiving infrastructure writes, with the sender-controlled `Date` header only as fallback. Stamps never expire by
default (an optional absolute window exists, off by default), and replay retention is its own bounded value.
Local mailboxes for the rid check are the signed-in address plus any aliases configured under *Advanced* (Office.js
cannot enumerate aliases). The conservative default policy only ever *displays* — nothing is deleted or moved.

## Algorithms

- **SHA-256**: implemented; WebCrypto where available, digest-identical bundled pure-JS fallback otherwise.
- **Argon2id**: registered ESF v1 profile, **not implemented yet in any client** (the shared core maps it to
  "unsupported" → 🟡, never invalid, and never a silent downgrade to SHA-256). Implementing it (bundled WASM where
  runtimes allow, capability-gated elsewhere) is Phase 4 for both clients and belongs in the shared core first.

## Optional: Outlook categories (not implemented)

Color categories ("ESF Green/Yellow/Red") could surface the status in the message list, but they require the
`ReadWriteMailbox` permission, pollute the user's category list and roam server-side. If added, it stays an opt-in
setting and never touches unrelated user categories. The manifest deliberately stays at `ReadWriteItem` until then.

## Development

```powershell
npm install
npm test          # node --test: adapter units + shared-vector interop
npm run build     # esbuild → dist/ (launchevent.js as one self-contained file)
npx office-addin-dev-certs install   # once: trusted https certs for localhost
npm run serve     # serves dist/ on https://localhost:3000
```

Sideload `manifest/manifest.xml` (Outlook Web: *Get add-ins → My add-ins → Add a custom add-in*; new/classic Windows
pick this up via the same account). For the automatic send hook, upload the manifest in the Microsoft 365 admin
center under *Integrated apps → Upload custom apps*.

The decisive integration test is not `setAsync` reporting success but the exact `ESF-Stamp` header arriving in the
recipient's raw MIME (Outlook → Gmail/Thunderbird/Outlook, and Thunderbird → Outlook verifying green). That
end-to-end check requires a real tenant and is the Phase-2/6 acceptance gate.

## Status / phases

- ✅ Phase 1 — skeleton: manifest, task pane, settings, capability layer, shared-core integration
- ✅ Phase 2 — SHA-256 on send via `OnMessageSend` (code complete; real-tenant MIME delivery check pending)
- ✅ Phase 3 — incoming verification with 🟢🟡🔴
- ⬜ Phase 4 — Argon2id (shared core first; bundled, benchmarked, capability-gated)
- ⬜ Phase 5 — polish: optional categories, trust-aware policy, benchmark tooling
- ⬜ Phase 6 — cross-client interop runs against a live tenant
