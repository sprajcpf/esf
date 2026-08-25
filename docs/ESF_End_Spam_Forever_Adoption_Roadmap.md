<!--
  Adoption, distribution, integration and standardization roadmap for ESF.
  Deliberately free of dates, quarters and duration estimates: every stage is gated on the exit criteria of the one
  before it. Render alongside the whitepaper: npm run whitepaper (from clients/thunderbird/).
-->

<p align="center"><img src="../assets/logo.png" alt="ESF — End Spam Forever" width="380"></p>

# ESF — Adoption Roadmap

## From working prototype to email-ecosystem adoption

**Companion document to the [Technical Whitepaper](ESF_End_Spam_Forever_Technical_Whitepaper.md).** The whitepaper
says what ESF *is*; this document says in what order it can become something the email ecosystem actually uses.

**Objective.** Make large-scale unsolicited email economically expensive while keeping legitimate email simple.

> **No dates.** Every stage is expressed as a dependency, not a schedule. A stage begins when the exit criteria of
> its prerequisites are met — not when a quarter starts. Where a stage cannot be entered, that is information about
> the previous stage, not a reason to skip ahead.

---

## The adoption problem, stated honestly

Before planning adoption it is worth naming why this has not already happened, because the answer shapes every stage
below.

**Verifiers are not the bottleneck.** Apache SpamAssassin has shipped
[`Mail::SpamAssassin::Plugin::Hashcash`](https://spamassassin.apache.org/full/3.1.x/doc/Mail_SpamAssassin_Plugin_Hashcash.html)
for roughly two decades, complete with double-spend tracking of tokens. A receiver-side proof-of-work check for email
has therefore been available, packaged and documented since before most current mail infrastructure was deployed, and
it is used by almost nobody — because almost nobody sends stamps. The scarce resource in this ecosystem is not
verification code; it is **senders who stamp** and **receivers who let a stamp change an outcome**.

**That is a two-sided deadlock**, and it defines the shape of this roadmap: no stage may depend on both sides moving
at once. Every stage must be useful to whichever side adopts it first.

- A sender that stamps into a world of unaware receivers loses nothing measurable (one second of CPU) and gains
  nothing yet.
- A receiver that verifies into a world of unstamped mail gains a signal that is currently almost always absent —
  which is exactly why *absence must stay neutral* (whitepaper 11) and why `junkOnRed` ships off.

**The standing objection is twenty years old and still unanswered by most PoW proposals.** Laurie and Clayton,
[*"Proof-of-Work" Proves Not to Work*](https://www.cl.cam.ac.uk/~rnc1/proofwork2.pdf) (2004), analysed real ISP
traffic and concluded that a difficulty high enough to deter spammers would also block a material fraction of
legitimate senders — with 93.5 % of machines sending fewer than 75 messages a day, they put legitimate collateral
damage at 1–13 %. ESF's own cost model (whitepaper 7.4) reaches a compatible conclusion from the other end: no single
SHA-256 difficulty is simultaneously bearable for a laptop and expensive for an operator with mining hardware.

ESF's answer is not that the objection is wrong. It is that the objection assumes a *uniform, mandatory* difficulty:

| Laurie/Clayton assumption | ESF's structural answer |
|---|---|
| Everyone pays the same difficulty | Trust-aware policy (whitepaper 7.3): known contacts, previous correspondents and authenticated senders pay **zero** |
| A proof is a delivery permit | A stamp is one input to existing filtering; absence is neutral (whitepaper 11) |
| Compute-bound work only | Algorithm agility: a memory-hard profile narrows the client-to-attacker gap by orders of magnitude (7.2, 7.4) |
| Total work is the cost | Contemporaneity (6.7a) turns a stockpiled one-off expense into a required sustained *rate* |

**Whether that answer holds is an empirical question, and it is the single most important thing this roadmap has to
settle.** It is settled in Stage 8 (independent review) and Stage 10 (pilots) — not by argument.

---

## Stage 0 — Baseline: what actually exists

Not a stage to plan; the measured starting point. Determined by inspecting the repository, not from the whitepaper's
claims.

| Component | State | Evidence |
|---|---|---|
| Protocol core (constants, canonicalisation, tokens, parser, verifier, policy) | **Implemented**, free of client APIs | `clients/thunderbird/src/protocol/` |
| SHA-256 work profile | **Implemented**, both clients | `protocol/sha256.js`, `protocol/stamp.js` |
| Argon2id work profile | **Not implemented.** Recognised, reported `unsupported`, never executed | `IMPLEMENTED_ALGORITHMS` vs `KNOWN_ALGORITHMS` in `protocol/constants.js` |
| Strict verification limits (size, count, difficulty cap, bounded parsing) | **Implemented** | `protocol/parser.js`, `protocol/verifier.js` |
| Replay ledger | **Implemented**, per installation, bounded retention | `background/verificationService.js` |
| Contemporaneity + optional expiry | **Implemented** | `verifier.js`, whitepaper 6.7a |
| Bcc privacy handling | **Implemented**: `omit` default, `token` opt-in; no clear-text mailbox in any header | `background/composeSigner.js` |
| Thunderbird client | **Implemented and verified on Thunderbird 153** | `clients/thunderbird/`, 161 tests |
| Outlook client | **Implemented** (Office.js, `OnMessageSend`, internet headers) | `clients/outlook/`, 22 tests |
| Shared test vectors | **Implemented**, checked by both suites | `clients/thunderbird/test/vectors.json` |
| Real-world end-to-end proof | **Achieved once**: a stamped message delivered through ordinary SMTP verified green on receipt | `clients/thunderbird/tools/verify-eml.mjs` |
| Standalone core package | **Not done.** Outlook imports the core out of the Thunderbird tree | `clients/outlook/src/esf-core.js` |
| Normative protocol specification | **Not done.** Whitepaper only | `docs/` |
| Server-side / filter verifier | **Not done** | — |
| CI, `CONTRIBUTING.md`, `SECURITY.md`, release artefacts | **Not done** | repository root |
| DNS policy discovery | **Proposed only** | whitepaper 8 |
| ESF-SMTP profile | **Proposed only** | whitepaper 9 |

**Two clients exist and share one core, which is further than most protocol proposals get. What does not yet exist is
anything a third party can adopt without reading this project's source tree.** That gap is Stages 1–3.

---

## The sequence

```text
Stage 0   Baseline: two clients, one core, no third-party surface   [achieved]
   ↓
Stage 1   Reference implementation stability
   ↓
Stage 2   Extract the core: one package, one specification
   ↓
Stage 3   Developer-adoptable package
   ↓
Stage 4   Client distribution through official channels
   ↓
Stage 5   Standalone verifier and spam-filter integration
   ↓
Stage 6   Outreach to those who already thought about this
   ↓            ↘
Stage 7   Independent implementations        Stage 8   Independent security review
   ↓            ↙
Stage 9   Mail operator engagement
   ↓
Stage 10  Real-world pilots: observe → verify → measure
   ↓
Stage 11  Normative specification and Internet-Draft
   ↓
Stage 12  Registration, provider adoption, ESF-SMTP
```

Stages 7 and 8 are deliberately parallel: an independent implementation is itself a form of review, and a security
review of a single implementation cannot distinguish a protocol flaw from a coding mistake. Everything after Stage 9
depends on both.

---

## Stage 1 — Reference implementation stability

**Prerequisite:** Stage 0.

**Purpose:** make the reference behaviour something a second implementer can trust as *the* behaviour, rather than
one project's current state.

Work:

- **Close the argon2id gap.** The whitepaper defines ESF v1 as a two-profile family, and no client implements the
  memory-hard profile — which is precisely the profile the cost model says the mechanism needs. Until it exists,
  "algorithm agile" is a claim, not a demonstrated property.
- **Publish a benchmark harness**, not benchmark prose: a runnable measurement of hash rate, generation latency and
  verification latency per profile and per machine class. Whitepaper 7.4 currently carries estimates that it itself
  marks as requiring replacement.
- **Adversarial input suite.** The parser is bounded by construction; that needs demonstrating with a fuzzer over
  header values, not only with hand-written malformed cases.
- **Continuous integration** running both client suites and the vector check on every change.
- **Cross-client interoperability as an automated test**, not a manual claim.

Exit criteria:

```text
A stamp generated by Thunderbird verifies in Outlook
AND a stamp generated by Outlook verifies in Thunderbird
AND both agree on every state: strong / weak / missing / invalid / unsupported
AND both refuse the same malformed, replayed, stockpiled and over-declared inputs
AND every published difficulty figure is reproducible by a documented benchmark run
AND CI enforces all of the above
```

**Falsification signal:** if the two clients disagree on any vector, the vectors are not yet a specification.

---

## Stage 2 — Extract the core: one package, one specification

**Prerequisite:** Stage 1.

Today the Outlook client imports the protocol out of `clients/thunderbird/src/protocol/`. The code comments already
anticipate the move (`clients/outlook/src/esf-core.js`). This matters beyond tidiness: **no external implementer will
take a dependency on another client's source directory**, and the layout currently implies Thunderbird is
privileged, which contradicts vendor neutrality.

Work:

- Move the core to `packages/esf-core` with its own tests, version and changelog; both clients consume it.
- Extract the wire format into a **standalone specification document**, separate from the whitepaper: field grammar,
  canonicalisation, token derivation, canonical work input, verification order, bounds, state machine. Normative
  language, no rationale, no marketing.
- Promote the test vectors to a **versioned artefact** with a stable schema, published independently of any client.
- State the protocol's stability policy: what may change in v1, what requires v2.

Exit criteria:

```text
The core has no import from any client directory
AND both clients depend on the same released core version
AND the specification document is sufficient to implement a verifier
AND the vectors are consumable without cloning the repository
```

---

## Stage 3 — Developer-adoptable package

**Prerequisite:** Stage 2.

**Test of this stage:** a competent developer implements a working ESF *verifier* in a language of their choice
without reading the whitepaper and without asking the project a question.

Work:

- Implementation guide, in the order a verifier is actually built: parse → bound → recompute tokens → one work
  operation → replay → state → signal.
- API documentation for the core, and a worked example per direction (mint, verify).
- `CONTRIBUTING.md`, `SECURITY.md` (including how to report a protocol flaw, not only a code flaw),
  `CODE_OF_CONDUCT.md`, `CHANGELOG.md` — none exist today.
- Compatibility matrix: which client, which profile, which platform, which requirement set.
- Profile registry document: how a work profile is added, deprecated and retired without changing the base format.

Exit criteria:

```text
An external developer produces a verifier that passes the published vectors
without contacting the project
```

---

## Stage 4 — Client distribution through official channels

**Prerequisite:** Stage 3 (so that people who find the add-on can find the protocol too).

Work:

- Thunderbird add-on submitted to the official add-on site, through its review process.
- Outlook add-in packaged for organisational deployment; the automatic send hook requires admin deployment, which is
  a documentation problem as much as a packaging one.
- Signed GitHub releases carrying the client artefacts, the core package and the vector set.
- Installation documentation and a short demonstration showing the traffic light on real, delivered mail.

Exit criteria:

```text
Both clients installable by a non-developer from an official channel
AND a stamped message crosses at least one independent mail provider
    and verifies at the far end
```

**Explicitly not a success metric:** download counts. The metric of this stage is *transport survival* — stamps
arriving intact through infrastructure nobody involved controls, including header folding, gateways and forwarders.

---

## Stage 5 — Standalone verifier and spam-filter integration

**Prerequisite:** Stages 2 and 4. This is the highest-leverage adoption stage, because it is the side of the deadlock
that can move alone: a filter can verify stamps usefully before any local user sends one.

Work:

- A standalone verifier usable from a mail pipeline, returning machine-readable states and nothing else:

```text
ESF_STRONG    a stamp satisfies local policy
ESF_WEAK      real work, below policy, or an unimplemented registered profile
ESF_NONE      no stamp present
ESF_INVALID   malformed, insufficient, wrong recipient, stockpiled, replayed
```

- Integrations for Rspamd, SpamAssassin and at least one gateway ecosystem, contributing a **small score
  adjustment**, never a verdict.
- Server-side replay scope: a client ledger is per installation; a filter can offer per-domain replay detection,
  which is strictly stronger, and needs its own retention and privacy discussion.
- Explicit statement of what happens to mail without a stamp: nothing.

Exit criteria:

```text
A filter operator can enable ESF verification from packaged configuration
AND the ESF result is visible in that filter's own reporting
AND enabling it changes no delivery outcome for unstamped mail
AND verification cost is measured under production load, per profile
```

**Constraint carried from the whitepaper:** memory-hard verification is not free. An Argon2id verifier must have
bounded memory before it is exposed to arbitrary senders, or the receiver-side denial-of-service it prevents on one
axis is reintroduced on another.

---

## Stage 6 — Outreach to those who already thought about this

**Prerequisite:** Stages 3 and 5, so that the first question — "is there something I can actually run and read?" —
has an answer.

This stage exists because the people best able to break ESF are the ones who already reasoned about
proof-of-work for email and, in several cases, published why it fails. The tone is single-purposed:

> You arrived at this idea independently, and in some cases argued against it. We have built an interoperable
> implementation with an explicit threat model, and we would value your technical criticism.

Not: *please promote our project.*

### Who, and why they matter

| Person / project | Background | Why ESF is relevant | Likely objection | Role | Channel |
|---|---|---|---|---|---|
| **Richard Clayton** (Cambridge Cybercrime Centre) | Co-author of [*"Proof-of-Work" Proves Not to Work*](https://www.cl.cam.ac.uk/~rnc1/proofwork2.pdf) (2004), the standing empirical refutation | ESF's trust-aware exemption and memory-hard profile are direct responses to his collateral-damage finding; his ISP-traffic method is the right way to test them | The 1–13 % legitimate-sender damage recurs; botnets externalise the cost | **Protocol critic**, research advisor | Institutional page / academic contact |
| **Ben Laurie** | Co-author of the same paper; long career in applied cryptography and transparency systems | Same as above, plus a practitioner's view on what receivers will actually deploy | PoW is the wrong lever; reputation and authentication dominate | Protocol critic, reviewer | Public professional channels |
| **Adam Back** | Author of [Hashcash](http://www.hashcash.org/hashcash.pdf), the design ESF descends from | ESF is the deployment-oriented successor to his cost function: recipient binding, algorithm agility, receiver policy | Difficulty calibration and ASIC economics; hashcash's own adoption history | Reviewer, **amplifier** | Public professional channels |
| **Cynthia Dwork**, **Moni Naor** | *Pricing via Processing or Combatting Junk Mail* (1992); later memory-bound functions | The originators of the pricing argument and of memory-hardness, which is exactly ESF's second profile | Parameter choice needs proof, not benchmarks | Research advisors | Institutional contact |
| **L. Jean Camp**, **Debin Liu** | *Proof of Work can Work* — the counter-analysis to Laurie/Clayton | Already argued the affirmative case; best placed to say which conditions ESF must meet for it to hold | Their conditions may not match ESF's parameters | Research advisors | Institutional contact |
| **Justin Mason** / Apache SpamAssassin | Author of the long-standing SpamAssassin Hashcash plugin with double-spend tracking | The closest existing ancestor of ESF's replay ledger, and the clearest evidence about *why* stamps never arrived | "We shipped this; nobody sent tokens" | **Reviewer**, integration partner | Apache SpamAssassin lists / issue tracker |
| **Vsevolod Stakhov** / Rspamd | Author and maintainer of the most widely deployed open-source filter | Stage 5 lands here first; Rspamd's scoring model is the natural home for a small ESF adjustment | Cost per message under load; another rarely-firing symbol | **Independent implementer**, integration partner | Rspamd GitHub / mailing list |
| **Wietse Venema** / Postfix | Postfix author | ESF-SMTP (whitepaper 9) cannot exist without MTA authors finding it acceptable | Envelope-level work belongs nowhere near the SMTP path | Protocol critic | Postfix mailing list |
| **Stalwart, mailcow and comparable modern stacks** | Actively developed mail servers with room for new checks | Small, fast-moving projects are the realistic first server-side implementers | Maintenance burden for an unadopted protocol | Independent implementers | Project issue trackers |
| **Xe Iaso** / [Anubis](https://en.wikipedia.org/wiki/Anubis_(software)) | Author of the SHA-256 proof-of-work gate now deployed across FOSS infrastructure (GNOME, FFmpeg, Wine, kernel archives) | The strongest current evidence that PoW gating is operationally acceptable *today*, plus hard-won lessons about legitimate-client fallout | Client diversity and accessibility fallout; PoW as an arms race | **Reviewer, amplifier** | Public project channels |
| **Aravinth Manivannan** / mCaptcha | Load-adaptive proof-of-work difficulty | Difficulty as a function of current load is a policy model ESF's `policy.js` seam could adopt for receivers under attack | Fixed difficulty is the wrong control | Contributor, reviewer | Project repository |
| **Thunderbird add-on reviewers**; **Betterbird** | Gatekeepers and close observers of the client platform | Stage 4 passes through them; they see what breaks for real users | Send-path add-ons are risky; UI clutter | Reviewers | Add-on review process / project channels |
| **Mailop**, **M³AAWG** | Operator and anti-abuse communities | The audience that decides whether a signal is worth acting on | "Another header we have to ignore"; forwarding and list breakage | Reviewers, **amplifiers** | Community mailing lists / membership process |

### Rules for this stage

- One message, technically specific, naming the objection the recipient is most likely to raise **before** they raise
  it. No follow-up campaign.
- Every serious objection is recorded in the repository with its status: accepted, mitigated, disputed with reasons,
  or open. An objection list nobody can read is not review.
- Criticism that invalidates a design choice changes the design. If Stage 6 produces no change anywhere, it was
  performed as marketing and must be repeated properly.

Exit criteria:

```text
Substantive technical responses received from more than one independent reviewer
AND every objection recorded with a status
AND at least one design decision changed, or explicitly defended in writing
```

---

## Stage 7 — Independent implementations

**Prerequisite:** Stage 3 (adoptable package), reinforced by Stage 6 (people who might build one).

A protocol only one project can implement is a product. Targets, in rough order of usefulness to adoption: a
server-side verifier in the language of a filter ecosystem (Lua, C, Rust, Go), then library implementations (Python,
Rust, Go, Java) for gateways and webmail.

Exit criteria:

```text
At least one implementation written by people unconnected to this project
passes the published vectors
AND interoperates in both directions with the reference clients
AND its author reports at least one specification ambiguity  ← this is the real deliverable
```

The ambiguity report is the point. A specification that produces no questions on first external use has probably not
been used.

---

## Stage 8 — Independent security review

**Prerequisite:** Stage 2 (a specification to review) and Stage 5 (a server-side attack surface to review). Runs in
parallel with Stage 7.

Scope, stated as the questions the review must answer rather than as areas:

| Area | The question |
|---|---|
| Replay | Can one stamp gain credit twice anywhere in the ecosystem — across folders, devices, users, or domains? |
| Proof reuse / stockpiling | Does contemporaneity (6.7a) actually bind work to a message when the reference timestamp is missing or forged? |
| Recipient substitution | Can a stamp for one mailbox be made to verify for another, including aliases and plus-addressing? |
| Forwarding and mailing lists | What happens to a valid stamp through a forwarder, a list expander and a re-writer — and is the resulting state honest? |
| Bcc | Does `token` mode leak more than the whitepaper claims, given a realistic guess list? |
| Algorithm downgrade | Can a sender force a weaker or unimplemented profile into a favourable outcome? |
| Difficulty | Can a declared value cause a verifier to spend unbounded work, memory or storage? |
| Verifier DoS | What does a message stuffed with maximal stamps cost the receiver, per profile, measured? |
| Privacy | What does a stamp disclose about sender, recipients and infrastructure that the message did not already? |

Exit criteria:

```text
An independent reviewer, not the authors, publishes findings
AND every finding is fixed, mitigated, or documented as accepted with rationale
AND the threat model in the whitepaper is updated to match what the review found
```

---

## Stage 9 — Mail operator engagement

**Prerequisite:** Stages 5, 7 and 8. Approaching operators before there is an independent implementation and a
security review wastes the one chance to be taken seriously.

Purpose: operational feedback, not promotion. What breaks at scale, what an operator would need before letting an
ESF result touch placement, and what they will refuse outright.

Exit criteria:

```text
At least one operator states the conditions under which they would evaluate ESF in production
AND those conditions are documented as protocol or implementation requirements
```

---

## Stage 10 — Real-world pilots: observe → verify → measure

**Prerequisite:** Stage 9.

```text
Observe        stamps are logged, nothing changes
   ↓
Verify         results are computed and reported, still nothing changes
   ↓
Measure        correlate with the filter verdicts the operator already trusts
```

Never, at this stage: reject unstamped mail. The population of stamped mail is small and self-selected; enforcement
on that basis measures nothing and breaks delivery.

Measure, per profile and per platform: adoption share of stamped mail; generation latency; verification latency; CPU
and memory cost; correlation with existing spam verdicts; false positives; false negatives; delivery impact;
legitimate-sender fallout — **the last one is the Laurie/Clayton number, and producing it is the point of the whole
stage.**

Data discipline: aggregate and anonymised, published as methodology plus results. **No central telemetry may become
a protocol dependency** — a receiver must be able to verify with no network access at all, which is already true of
the reference implementation and must stay true.

Exit criteria:

```text
Measured, published evidence of cost asymmetry in production traffic
AND a measured legitimate-sender fallout figure
AND at least one operator willing to let ESF contribute to scoring
```

**This is the stage that can end the project honestly.** If pilots show that stamped mail correlates with nothing
useful, or that fallout matches the 2004 prediction, that is the answer and it should be published as such.

---

## Stage 11 — Normative specification and Internet-Draft

**Prerequisite:** Stage 10. Standardising before deployment evidence exists inverts the order that makes standards
useful.

Work: an Internet-Draft for the ESF-Stamp header field in BCP 14 language, derived from the Stage 2 specification and
corrected by Stages 7, 8 and 10; a work-profile registry with explicit parameter semantics and a retirement process;
separate operational guidance for difficulty policy, allowlists, mailing lists, forwarding and constrained devices.

Exit criteria:

```text
A draft exists that an implementer prefers over this repository's documentation
AND it is submitted for independent review in the relevant IETF venue
AND every deviation of the reference implementations from the draft is a filed issue
```

---

## Stage 12 — Registration, provider adoption, ESF-SMTP

**Prerequisite:** Stage 11.

- Header field registration through the applicable IANA process, and the work-profile registry established.
- Provider adoption, which will be gated on operator economics rather than on protocol quality: the argument that
  reaches a large provider is measured spam reduction per unit of verification cost, from Stage 10.
- The ESF-SMTP profile (whitepaper 9) as an experimental extension. It is last for a reason: it is the strongest
  model — authoritative per-recipient accounting, no Bcc exposure, connection-bound challenges — and the one that
  cannot be adopted incrementally, because it needs both MTAs to move together. It becomes realistic only once
  message-level ESF is common enough that the envelope version is an optimisation rather than an introduction.

Exit criteria:

```text
Registered field and profile registry
AND at least one provider verifying at scale
AND an experimental ESF-SMTP interoperating between independent MTAs
```

---

## Guiding principles

Applied as tie-breakers whenever a stage offers a choice.

**Integrability first.** Every stage must be adoptable at one point in the mail path, alone, and provide value while
everything adjacent remains unaware of ESF. Anything requiring simultaneous adoption is deferred to Stage 12.

**Usability first.** The user-facing surface stays green / yellow / red. No user is required to know what a nonce,
difficulty, memory parameter or hash target is. And the optimum remains no user interface at all: the result belongs
in the filtering that already decides where mail lands (whitepaper 4.2).

**Open and neutral.** Open source, vendor-neutral, patent-free where possible, no dependency on any central ESF
service, locally verifiable, interoperable, algorithm-agile. Concretely: no stage may introduce a component that only
this project can operate. If a stage would require an ESF-run server to work, the stage is wrong.

**Absence stays neutral.** Through every stage up to and including 12, a missing stamp is a non-signal, not evidence
of abuse. This is what makes incremental adoption possible at all, and the first stage that breaks it will end
adoption.

**Evidence over advocacy.** Where this roadmap states a number, it is measured or marked as an estimate to be
replaced. The pilots may falsify the premise; that outcome is published, not buried.

---

## Cross-stage dependencies at a glance

| Stage | Cannot start without | Delivers to |
|---|---|---|
| 1 Stability | Stage 0 | vectors and behaviour others can trust |
| 2 Core + spec | 1 | something implementable without this repository |
| 3 Developer package | 2 | external implementers, filter authors |
| 4 Client distribution | 3 | transport evidence, real users |
| 5 Filter integration | 2, 4 | the receiver side of the deadlock |
| 6 Outreach | 3, 5 | criticism, reviewers, implementers |
| 7 Independent implementation | 3 (+6) | proof it is a protocol, ambiguity reports |
| 8 Security review | 2, 5 | a threat model that survived contact |
| 9 Operator engagement | 5, 7, 8 | deployment conditions |
| 10 Pilots | 9 | the numbers everything after depends on |
| 11 Internet-Draft | 10 | normative text |
| 12 Registration, providers, SMTP | 11 | ecosystem adoption |

## Immediate next actions, in order

Derived from Stage 0 and Stage 1 only — everything further out depends on their outcome.

1. Continuous integration over both client suites and the shared vectors.
2. `CONTRIBUTING.md` and `SECURITY.md`, including how to report a protocol flaw.
3. Extract `packages/esf-core`; both clients consume it; no client-to-client imports remain.
4. Implement the Argon2id profile, or state in the whitepaper that ESF v1 is single-profile until it exists.
5. Publish the benchmark harness that replaces the estimated figures in whitepaper 7.4 and D.10.
6. Split the normative wire format out of the whitepaper into its own specification document.
