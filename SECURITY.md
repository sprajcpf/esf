# Security policy

ESF is a **prototype**. Two reference clients exist, the protocol has not been through independent review, and no
part of it has been standardised. Treat it accordingly: it is worth attacking, and it is not yet worth depending on.

## Two kinds of report

Please say which one you are filing, because they are handled differently.

**Implementation flaw** — the code does not do what the specification says: a parser that accepts what it should
reject, a verifier that returns the wrong state, a crash, a resource exhaustion, a leak of something the design says
stays local.

**Protocol flaw** — the code does exactly what the specification says, and the specification is wrong: work that can
be reused, avoided, shifted between messages or recipients, or made asymmetric in the attacker's favour. These are
the more valuable reports, and the ones that change the whitepaper rather than a file.

## How to report

Use **GitHub's private vulnerability reporting** on
[sprajcpf/esf](https://github.com/sprajcpf/esf/security/advisories/new). If that is not available to you, open a
normal issue containing **no exploit detail** — just the area affected and a request for a private channel — and a
maintainer will provide one.

Please include, as far as you can:

- which client and version, or that it is the protocol itself (`clients/thunderbird` reports the version in its
  manifest; `docs/` carries the whitepaper version)
- for a protocol flaw: the attack as a sequence of steps, what the attacker controls, what a verifier accepts that it
  should not, and roughly what the attack costs compared to doing the work honestly
- a stamp or `.eml` that demonstrates it — `node clients/thunderbird/tools/verify-eml.mjs message.eml` prints the
  verifier's own view and is the quickest way to show a disagreement
- what you think the correct behaviour is

There is no bug bounty. Findings are credited in the fix and in the whitepaper's threat model unless you prefer
otherwise.

## What we will do

1. Acknowledge the report and say whether we consider it an implementation or a protocol flaw — if we disagree with
   your classification, we will say why.
2. Assess it against the threat model in the whitepaper (section 12) and tell you which of these it is: confirmed,
   already-known limitation, accepted risk with rationale, or not a vulnerability.
3. Fix confirmed implementation flaws with a test that fails without the fix.
4. For confirmed protocol flaws: change the design, update the whitepaper and the vectors, and update both clients.
   This may take longer than a code fix, and we will say so rather than sit on it.
5. Publish. Coordinated disclosure timing is negotiable; indefinite silence is not.

## Scope

**In scope:** the protocol and its specification; the shared core (`clients/thunderbird/src/protocol/`); the
Thunderbird and Outlook clients; the verification, replay and policy logic; the packaging tools; the test vectors.

**Out of scope:** Thunderbird, Outlook, Office.js and Node themselves (report those upstream); third-party mail
infrastructure; the security of a mail account, server or network that happens to be running ESF; anything requiring
control of the victim's machine or mail profile, since an attacker who already has that does not need ESF.

## What is not a vulnerability

These are properties of the design, stated in the whitepaper. Reporting them is welcome as discussion, but they will
not be treated as security issues:

- **A stamp does not authenticate the sender.** It proves computing time was spent for a recipient. Anyone may
  produce one for any recipient. This is the single most common misreading of proof of work.
- **A missing stamp is not flagged.** Almost no mail carries one, so absence is deliberately neutral. That behaviour
  is opt-in to change and stays that way.
- **A valid stamp says nothing about content safety.** Phishing with a valid stamp is still phishing; ESF is one
  input to filtering, never a verdict.
- **A determined, well-resourced sender can pay the cost.** ESF raises a floor for bulk senders; it does not stop a
  funded attacker. See whitepaper 7.4 for what the work actually costs per hardware class.

## Known limitations

Documented, not hidden. If you can make any of these materially worse than stated, that *is* a finding.

| Limitation | Where |
|---|---|
| SHA-256 is compute-bound: specialised hardware evaluates it far cheaper than a client. No single difficulty is both bearable for a laptop and expensive for an ASIC. | whitepaper 7.2, 7.4 |
| The Argon2id profile, which narrows that gap, is defined by ESF v1 but **implemented by no client**. It is reported as `unsupported` and never executed. | roadmap Stage 0/1 |
| Replay detection is per installation and bounded in retention. Cross-device and cross-user replay detection needs a server-side verifier. | whitepaper 6.8, D.8 |
| In Bcc `token` mode the salted recipient token can be tested against a guessed address. Default is to omit Bcc stamps entirely. | whitepaper 6.9, D.7 |
| The message binding (`mid`) is an opaque identifier the sender mints, because the real Message-ID does not exist yet at send time. The stamp therefore does not bind message content. | whitepaper 6.7a, D.3 |
| Contemporaneity is measured against a receiver-produced timestamp where one exists, and against the sender-controlled `Date` header otherwise. Where only `Date` is available, a back-dated message can carry an older stamp. | whitepaper 6.7a |
| Client-side verification is per user. A gateway sees more and can enforce more. | whitepaper 10.2 |
| No signed releases and no CI yet. | roadmap Stage 1, 4 |

## Where to look first

If you want to attack the protocol rather than the code, these are the questions an independent review is expected to
answer (roadmap Stage 8), and the fastest routes into something interesting:

- **Replay:** can one stamp earn credit twice — across folders, devices, users or domains?
- **Stockpiling:** does the contemporaneity window really bind work to a message when the reference timestamp is
  absent or forged?
- **Recipient substitution:** can a stamp for one mailbox verify for another — aliases, plus-addressing,
  internationalised local-parts, Unicode normalisation?
- **Forwarding and mailing lists:** what state does a valid stamp end up in after a forwarder or list expander, and
  is that state honest?
- **Downgrade:** can a sender steer a verifier into a weaker or unimplemented profile for a better outcome?
- **Verifier cost:** what does a message stuffed with maximal stamps cost, measured, per profile? The parser is
  bounded by construction — prove otherwise.
- **Privacy:** does a stamp disclose anything about sender, recipients or infrastructure that the message did not
  already?

The test vectors in `clients/thunderbird/test/vectors.json` and `tools/verify-eml.mjs` are the intended tools for
demonstrating a disagreement precisely.
