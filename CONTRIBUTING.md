# Contributing to ESF

ESF is a proof-of-work layer for email: a sender spends measurable computing time for one specific recipient, and the
receiver verifies it for the cost of a single hash. The project is a working prototype with two interoperable clients
and a shared protocol core — see the [Adoption Roadmap](docs/ESF_End_Spam_Forever_Adoption_Roadmap.md) for what is
implemented and what is not.

Contributions are welcome, and a few kinds are worth far more than others (see
[What helps most](#what-helps-most)).

## Non-negotiables

These are not style preferences. A change that breaks one of them will be rejected on principle, however good the
code is.

1. **The protocol core stays free of client APIs.** Everything in `clients/thunderbird/src/protocol/` must run in
   plain Node with no mail client present. That is what lets other clients, gateways and filters reuse it, and it is
   why the test suite can exercise the protocol without Thunderbird.
2. **The test vectors are the contract.** `clients/thunderbird/test/vectors.json` defines canonicalisation, token
   derivation, the canonical work input and the difficulty measure. Changing them changes the wire format — see
   [Changing the protocol](#changing-the-protocol).
3. **A missing stamp stays neutral.** Almost no mail carries a stamp. No default may treat absence as evidence of
   abuse. Punitive behaviour is opt-in, and stays opt-in.
4. **No central ESF service.** Verification must work with no network access at all. Anything that requires a
   project-operated server to function does not belong in ESF.
5. **No dependencies in the protocol core or the Thunderbird client.** Both ship with zero runtime and zero build
   dependencies today, and that is a feature: it is what makes the core auditable and portable.
6. **Proof of work is not authentication.** No code, comment, string or document may imply that a valid stamp says
   anything about who sent a message or whether it is safe.

## Repository layout

```text
docs/                                   whitepaper and roadmap; Markdown is canonical, other formats are generated
assets/                                 brand assets
clients/thunderbird/
  src/protocol/                         the shared ESF core — no client APIs, fully unit tested
  src/background/                       Thunderbird glue: send hook, verification, worker pool, badge
  src/compose|messageDisplay|options/   UI surfaces
  src/workers/                          nonce search
  test/                                 unit tests and the shared vectors
  tools/                                vectors, packaging, renderers, test profile, .eml verifier
clients/outlook/
  src/esf-core.js                       single re-export surface of the shared core (no second copy)
  src/outlook-api|compose|read|ui/      Office.js adapter
  test/                                 unit tests, including the shared vectors through the Outlook read path
```

The Outlook client currently imports the core out of the Thunderbird tree. Extracting it to `packages/esf-core` is
Stage 2 of the roadmap; until then, do not add a second copy of any protocol file.

## Getting set up

Node 20 or newer. Nothing else for the Thunderbird client.

```bash
cd clients/thunderbird
npm test                    # unit tests: protocol, parser, verifier, vectors, glue
npm run vectors             # regenerate test/vectors.json (deliberate act — see below)
npm run package             # build an installable .xpi
npm run package -- --out ~/Downloads
npm run docs                # re-render whitepaper and roadmap, then check the renders match the Markdown
npm run profile -- /tmp/esf # throwaway Thunderbird profile with an inbox covering every verification outcome
```

```bash
cd clients/outlook
npm install                 # esbuild, for bundling the event handler
npm test
npm run build
```

### Testing against a real client

```bash
cd clients/thunderbird
npm run profile -- /tmp/esf-profile
cp dist/esf-thunderbird-*.xpi /tmp/esf-profile/extensions/esf@powerfolder.com.xpi
thunderbird -no-remote -profile /tmp/esf-profile     # click the Inbox once to index the seeded messages
```

The generated profile has a Local Folders account and thirteen messages whose subjects name the expected verification
outcome. Never test against your own mail profile: the add-on hooks the send path.

To check a real message that has been through actual SMTP:

```bash
node tools/verify-eml.mjs "some-message.eml"
```

## Code conventions

Match the surrounding code; where the surrounding code is silent, these hold:

- ES modules everywhere, `async`/`await`, no transpilation.
- **120 character lines.** Not 80.
- JSDoc on exported functions: what it does, parameters, return shape.
- Comments explain **why**, not what. A comment that restates the code will be asked about in review; a comment
  recording a decision, a constraint or a platform bug is valuable and should stay.
- Reference the whitepaper section a rule comes from when implementing a protocol rule, so the next reader can check
  the code against the specification.
- Names spell things out. `maxStampToMessageHours`, not `mstm`.

## Changing the protocol

A change is a **wire-format change** if it touches canonicalisation, the `sid`/`rid`/`mid` derivation, the canonical
work input, the field grammar, the difficulty measure, or the verification state machine. For those:

1. Say in the pull request what breaks and why the break is worth it.
2. Regenerate the vectors (`npm run vectors`) as a **separate, explicit commit**, never as a side effect. A vector
   diff that nobody intended is a bug.
3. Update **both** clients and both test suites. An interoperability break between the two reference clients is the
   one failure mode this project exists to avoid.
4. Update the whitepaper Markdown — including which section — and re-render with `npm run docs`.
5. If existing stamps in the wild would stop verifying, the protocol version has to move, not just the vectors.

For everything else: tests, and a clear description of the behaviour before and after.

## Tests

- New behaviour needs a test. Bug fixes need the test that would have caught the bug.
- Security-relevant behaviour needs a test that fails without the fix: forged stamps, replay, wrong recipient,
  stockpiled work, over-declared difficulty, malformed and oversized input, header flooding.
- Both suites must pass. There is no CI yet (roadmap Stage 1), so run them yourself and say so in the pull request.
- Do not weaken a test to make a change pass. If a test is wrong, fix the test in its own commit and explain why.

## Documentation

- `docs/*.md` is the source. `*.html`, `*.odt` and `*.docx` are generated — never edit them by hand; run
  `npm run docs`, which also verifies that every format carries the same content.
- Client READMEs document the client's own APIs, limitations and platform findings. Platform limitations discovered
  the hard way belong in writing, with the version they were measured on.

## What helps most

In rough order of value to the project:

1. **An independent implementation** — a verifier in another language that passes the published vectors. This is the
   difference between a protocol and one project's product. Ambiguities you hit while writing it are the most useful
   bug reports this project can receive.
2. **Filter and gateway integration** — Rspamd, SpamAssassin, gateways, MTAs. Receiver-side verification is the half
   of adoption that can move without waiting for senders.
3. **Attacks.** Ways to make a verifier accept work that was not done, reuse work, or spend more than one hash. See
   [SECURITY.md](SECURITY.md).
4. **Measurements.** Hash rates, generation and verification latency, memory cost, per platform and per profile. The
   whitepaper's cost model currently carries estimates that it marks as needing replacement.
5. **The Argon2id profile**, which ESF v1 defines and no client yet implements.

## What will not be accepted

- Anything requiring a service operated by this project.
- Making a missing stamp punitive by default.
- A second copy of the protocol core.
- Dependencies added to the protocol core or the Thunderbird client without a compelling, stated reason.
- Claims that ESF authenticates senders, proves safety, or replaces SPF, DKIM, DMARC, S/MIME or OpenPGP.

## Licence

By contributing you agree that your contribution is licensed under the [Apache License 2.0](LICENSE), like the rest
of the project — including its patent grant. If you are contributing on behalf of an employer, make sure you are
allowed to.
