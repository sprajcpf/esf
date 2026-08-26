# addons.thunderbird.net listing

Everything needed to submit the Thunderbird client to the official add-on site, so the submission is copy-and-paste
rather than composition. Update this file when the listing changes, so the two never drift.

The upload itself needs a Thunderbird account with a signed Developer Agreement, which is why it is not automated.

---

## Submission steps

1. Sign in at <https://addons.thunderbird.net/developers/> and accept the Developer Agreement if this is the first
   submission.
2. **Submit a New Add-on** → *On this site* (a listed add-on; choose *On your own* only for an unlisted build).
3. Upload `dist/esf-thunderbird-<version>.xpi` — build it with `npm run package`, or take the asset from the
   [matching GitHub release](https://github.com/sprajcpf/esf/releases). The validator should report no errors: the
   add-on contains no minified code, no remote code and no dynamic evaluation.
4. Compatibility: Thunderbird **128.0** and newer. This comes from `strict_min_version` in the manifest; do not
   narrow it by hand.
5. Paste the metadata below.
6. Paste the **reviewer notes** into *Notes for Reviewers*. They exist because a send-path add-on gets a careful
   look, and the notes answer the questions a reviewer will otherwise have to ask.
7. Upload screenshots (see below) and submit.

---

## Metadata

**Name**

```text
ESF — End Spam Forever
```

**Summary** (shown in search results; keep under 250 characters)

```text
Attaches a proof-of-work stamp to your outgoing mail, one per recipient, and verifies stamps on incoming mail as a
green, yellow or red signal. Makes bulk mail expensive to send without making normal mail complicated.
```

**Description**

```text
ESF adds a small proof of work to the mail you send: your computer spends about a second of real computing time for
each recipient, and the result travels as one extra header field. Receiving software can check that work for the cost
of a single hash — a few microseconds. That asymmetry is the whole idea. For you it is a second. For someone sending
a million messages it is a million seconds of hardware they have to pay for.

On incoming mail the add-on shows what it found, and nothing more than that:

  • green — a valid stamp, computed for your address
  • yellow — real work, but weaker than you asked for, or a work profile this version cannot check
  • red — no stamp, or a stamp that did not hold up

Almost no mail carries a stamp today, so a missing stamp is treated as what it is: no information. Nothing is
filtered, moved or flagged unless you switch that on yourself.

What ESF is not
ESF does not authenticate anyone. A valid stamp proves that computing time was spent for a recipient — it says
nothing about who sent the message or whether its contents are safe. It does not replace SPF, DKIM, DMARC, S/MIME or
OpenPGP; it answers a different question than any of them. Treat a green light as one weak positive signal among
many, never as permission to trust a message.

Privacy
No network requests, no accounts, no telemetry, no server of ours involved anywhere. Verification is entirely local.
The stamp itself contains no readable address: sender, recipient and message are bound as salted hashes, so a stamp
does not disclose who a message went to — not even for Bcc recipients, which by default get no stamp at all.

Details
Sending computes quietly for a second, then keeps working while the toolbar button shows progress, and asks you only
if it really is taking too long. Difficulty, time budget, worker threads and the incoming policy are all
configurable. Everything is open source, Apache-2.0, with a technical whitepaper, a threat model and shared test
vectors so other clients and mail filters can implement the same protocol:
https://github.com/sprajcpf/esf

This is a prototype and is honest about it. Please report anything that looks wrong.
```

**Categories** — *Privacy and Security*, plus *Message Composition* if two are allowed.

**Tags** — `spam`, `proof-of-work`, `privacy`, `security`, `anti-abuse`

**Homepage** — `https://github.com/sprajcpf/esf`

**Support site** — `https://github.com/sprajcpf/esf/issues`

**Support email** — *decide before submitting.* The listing shows it publicly; a role address is preferable to a
personal one.

**Licence** — Apache License 2.0

**Privacy policy** — a link to `SECURITY.md` and the *Privacy* paragraph above is enough: the add-on collects
nothing and makes no network requests. State that plainly rather than linking a generic policy.

**Version notes** — take them from `CHANGELOG.md` for the version being submitted.

---

## Notes for reviewers

```text
Thank you for reviewing. Points that usually come up with this kind of add-on:

WHAT IT DOES
On send, the add-on computes a hash-based proof of work per recipient and attaches it as one custom header field
(X-ESF-Stamp). On display, it reads that field from incoming messages, recomputes the hash, and shows a
green/yellow/red badge on the message-display button. Nothing else is changed about the message, and nothing is
filtered, moved or deleted.

NO REMOTE OR DYNAMIC CODE
There is no build step: every file in the package is the readable source. No eval, no new Function, no innerHTML, no
remote scripts, no CDN, no network requests of any kind. The only URL in the code is the project link that appears in
the optional footer text. Verification is purely local.

PERMISSIONS
  compose         — compose.onBeforeSend, to attach the header before the message is sent
  messagesRead    — read the stamp header of a displayed message (messages.getHeaders)
  accountsRead    — identities.list, to know which addresses are the user's own; a stamp is bound to one recipient
                    address and can only be verified against the user's own mailboxes
  messagesUpdate  — only used if the user enables the optional junk-flag setting, which is off by default
  storage         — settings and the local replay cache
No host permissions are requested, because nothing is fetched.

THE SEND PATH
onBeforeSend runs a nonce search in Web Workers, never on the UI thread, and is bounded: a quiet phase of one second
by default, then visible progress, and after a patience threshold the user is asked whether to keep going, send
without a stamp, or cancel. Workers are terminated on cancellation. A send is never blocked indefinitely.

BODY MODIFICATION
If the footer setting is on (default), one line naming the project is appended — only to messages that actually
carry a stamp, and only once, checked by looking for the URL already being present. It can be switched off in the
options.

HOW TO TEST QUICKLY
The repository contains a script that builds a throwaway profile with a Local Folders account and thirteen messages
covering every verification outcome, each subject naming the expected result:

  git clone https://github.com/sprajcpf/esf && cd esf/clients/thunderbird
  npm test                      # 169 unit tests, no dependencies, no network
  npm run profile -- /tmp/esf   # throwaway profile, then start Thunderbird with -profile /tmp/esf

Source, whitepaper, threat model and test vectors: https://github.com/sprajcpf/esf
```

---

## Screenshots

Three are enough, and they need real UI, so they are taken by hand in the throwaway profile
(`npm run profile -- /tmp/esf`) — never in a profile with real mail:

1. **A verified message** — a message from the seeded inbox open, the message-display button showing the green badge
   with its bit count.
2. **The detail panel** — that badge clicked, showing profile, difficulty, timestamp and which address the stamp is
   bound to.
3. **The options page** — showing that difficulty, budget and policy are configurable.

A fourth, optional: the compose button mid-computation.

Crop to the Thunderbird window, no desktop background, no real addresses.

The listing also wants a square icon as PNG. The manifest ships `icons/esf.svg`; a 64×64 PNG of the shield mark from
`assets/logo.png` serves for the listing.

---

## After submission

- Review is by humans and takes as long as it takes. Answer questions in the same thread rather than resubmitting.
- ATN signs the package, so an installed copy from the site updates itself. The GitHub `.xpi` stays unsigned and
  needs `xpinstall.signatures.required = false`; keep publishing it for people who prefer it.
- Every later version needs its own upload plus version notes from `CHANGELOG.md`.
