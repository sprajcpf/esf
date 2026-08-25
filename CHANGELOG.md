# Changelog

All notable changes to ESF. The protocol version (`v=1` in a stamp) is independent of these release numbers; a change
that would stop existing stamps from verifying moves the protocol version, not just this file.

## v0.2.0

First release with installable packages for both clients. Stamps minted by either client verify in the other.

### Protocol

- **Freshness is contemporaneity, not expiry.** A stamp must have been minted within a bounded window before the
  message it arrives with — 24 hours by default, configurable. This is what keeps a sender paying as they go:
  stamps produced weeks earlier on idle hardware, or lifted off another message, are refused as `stamp-too-old`.
  An absolute expiry is now separate, optional and **off by default** — a proof of work does not become untrue with
  age, and an absolute window made correctly delivered mail unverifiable later.
- **The reference instant is when the message arrived**, taken from the topmost `Received` field, which the receiving
  infrastructure writes and the sender cannot choose. `Date` is the fallback. Verification never uses the moment of
  reading: doing so turned every archived message stale, reversing a verdict that was correct on arrival.
- Replay retention is its own bounded value, since it can no longer follow an acceptance window.
- Whitepaper: new section 6.7a for the above, with matching updates to 6.2, 6.7, 6.8, 8, 12 and appendix B. Cost
  figures in section 7.4 are now stated in USD with the rented-capacity and energy assumptions written out.

### Sending

- **With ESF enabled, a message gets a stamp.** The compute budget is no longer a give-up deadline: the search runs
  quietly for one second (default), then keeps running while the compose button shows progress, and only after a
  patience threshold (15 s default) asks whether to keep going, send without, or cancel. When the question cannot be
  put to the user, it keeps working rather than silently sending unstamped.
- Default difficulty is **18 bits**, chosen to fit the one-second quiet phase: at 22 bits roughly one send in
  fourteen would finish in time, which left most messages unstamped.
- Up to four worker shards by default, always leaving two cores to the machine.

### Clients

- Thunderbird: Manifest V3, Thunderbird 128+, verified on 153. Installable `.xpi`.
- Outlook: Office.js add-in, requirement set 1.12+ for the send hook. Installable package with the manifest, the
  static files and install instructions for both sideloading and admin deployment.
- Both share one protocol core and one set of test vectors.

### Fixed

- MV3 removed `messageDisplay.onMessageDisplayed` and `getDisplayedMessage`; the singular forms silently killed the
  whole background script on Thunderbird 153. The plural forms are now used.
- `compose.customHeaders` keeps only one field per name, so one stamp per recipient could not travel as repeated
  fields. All stamps of a message now travel in one field as a comma separated list; repeated fields are still
  accepted on receipt.
- `background.scripts` with `"type": "module"` did not start on Thunderbird 153; the background is a page loading an
  ES module.

### Repository

- `CONTRIBUTING.md`, `SECURITY.md` and an adoption roadmap with ordered stages and explicit exit criteria.
- Whitepaper renders (HTML, ODT, DOCX) generated from the Markdown and verified against it.
- Reproducible packaging for both clients: fixed timestamps and forward-slashed archive entries.
- Command-line verifier for saved messages: `clients/thunderbird/tools/verify-eml.mjs`.

### Known limitations

Unchanged from `SECURITY.md`, and worth repeating: a stamp does not authenticate the sender, the Argon2id profile is
defined by ESF v1 but implemented by no client yet, replay detection is per installation, and no single SHA-256
difficulty is both bearable for a laptop and expensive for specialised hardware.

## v0.1.0

Initial prototype: SHA-256 work profile, Thunderbird client, shared protocol core, test vectors. Superseded by
v0.2.0, which changed the wire format's freshness semantics and the default difficulty.
