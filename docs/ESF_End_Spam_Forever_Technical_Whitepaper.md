<!--
  Canonical source of the ESF whitepaper. Originally derived from the v1.0 docx and since amended with
  implementation learnings from the Thunderbird and Outlook reference clients (Appendix D).
  Edit this file, then regenerate HTML and ODT: npm run whitepaper (from clients/thunderbird/).
-->

<p align="center"><img src="../assets/logo.png" alt="ESF — End Spam Forever" width="380"></p>

# ESF — End Spam Forever

## A Proof-of-Work Framework for Email Abuse Resistance

**Technical Whitepaper — Version 1.0.1 (Pre-RFC)** · 25 August 2026 · amended with reference-client learnings (Appendix D)

**Objective.** Make unsolicited bulk email economically unattractive through verifiable per-recipient computational cost - while remaining easy to integrate into existing email infrastructure and nearly invisible to ordinary users.

> **Draft status.** This whitepaper defines the ESF v1.0 reference architecture and initial design direction. It is not an IETF standard. Wire syntax, work-profile parameters, policy discovery and SMTP extension details remain subject to implementation experience, benchmarking, interoperability testing and public standards review.

## Abstract
Email is intentionally cheap to send. That property made email universal, but it also makes high-volume abuse unusually inexpensive. ESF - End Spam Forever - introduces a vendor-neutral Proof-of-Work (PoW) layer for email. An untrusted sender performs a bounded amount of computational work for a specific recipient and message context, attaches the resulting compact proof, and the receiver verifies it at negligible cost relative to generating it. The work is not a payment, identity credential, reputation score, or content classification. It is a scarce-resource signal: the sender demonstrates that sending this message was not computationally free.

ESF is designed around two primary principles: integrability and usability. The initial ESF-Stamp profile can be implemented incrementally by mail clients, plugins, gateways and spam filters without replacing SMTP, while a future ESF-SMTP profile can enforce work per envelope recipient during MTA-to-MTA delivery. The protocol is algorithm-agile from the start: ESF v1 defines a highly portable SHA-256 profile and a memory-hard Argon2id profile, while allowing future work functions to be introduced without changing the core protocol.

ESF complements SPF, DKIM and DMARC rather than replacing them. Those mechanisms establish or align domain authorization; ESF answers a different question: how much scarce computational effort did the sender expend to reach this recipient?

For ordinary users, the cryptography is deliberately abstracted away. A receiver should be able to express ESF primarily as a simple traffic-light signal - green, yellow or red - and use that signal in automatic mail-handling policies. Algorithm, difficulty and timestamp details are diagnostic information, not a usability prerequisite.

> **Core proposition.** A message that costs almost nothing to transmit can be sent millions of times. If an unknown sender must spend a small but non-trivial amount of work per recipient, normal correspondence remains practical while indiscriminate bulk delivery becomes progressively more expensive.

## Document map

| Section | Purpose |
| --- | --- |
| 1-3 | Problem, prior art, resource-security perspective and positioning |
| 4-5 | Integrability, Usability and architecture |
| 6-9 | ESF-Stamp, work profiles, policy and future SMTP enforcement |
| 10-11 | Integration, automation and traffic-light UX |
| 12-13 | Threat model, operations and environmental constraints |
| 14-17 | Deployment, RFC/IANA path, open questions and conclusion |
| Appendices | Wire grammar, validation pseudocode, Thunderbird profile and reference-client learnings |

## 1. The problem ESF is intended to solve
The economic asymmetry of email is the central problem. Creating and transmitting another copy of a message is extremely cheap for the sender, while receiving systems and users incur filtering, storage, attention and security costs. Traditional anti-spam systems therefore attempt to infer intent after the sender has already obtained the right to deliver traffic to the receiver.

Content filters are probabilistic and can be evaded or can generate false positives.

IP and domain reputation are valuable but create bootstrap problems for new senders and can be abused through compromised infrastructure.

SPF, DKIM and DMARC help validate use of domains; they do not make authorized bulk sending expensive.

Rate limits work within a provider or administrative domain but are not a universal end-to-end economic signal.

CAPTCHAs and challenge-response mail systems impose user interaction and create accessibility and backscatter problems.

ESF changes the sender-receiver cost relationship before the proof is treated as a positive delivery signal. The receiver can still use every existing anti-abuse control. ESF simply adds a new, independently measurable property: computational effort targeted at the receiving mailbox or receiving SMTP transaction.
## 2. Prior art
The idea of computational postage for email is not new. Dwork and Naor proposed in 1992 that access to a shared resource, including delivery of junk email, could require a moderately expensive computation that is easy to verify [1]. Adam Back later developed Hashcash, a practical hash-based cost function explicitly motivated by throttling abuse of unmetered resources such as email [2]. Research subsequently examined memory-bound functions because raw CPU-bound functions can be accelerated disproportionately by specialized hardware [3].

ESF does not claim invention of Proof-of-Work for email. Its contribution is a deployment-oriented framework for modern email: current message formats, current authentication mechanisms, client extensions, server filtering, policy discovery, algorithm agility, recipient privacy, replay controls and a concrete path toward an Internet-Draft.
### 2.1 Resource-based security: SOFTWAR and Bitcoin
Most email security controls operate primarily in the logical domain: authenticate identities, validate signatures, classify content, compare reputation, or apply rules. ESF adds a different dimension. It asks an untrusted sender to demonstrate the expenditure of a scarce physical resource before the message receives positive delivery credit. The security property is therefore partly economic and physical, not only algorithmic.

Jason P. Lowery's 2023 MIT thesis SOFTWAR: A Novel Theory on Power Projection and the National Strategic Significance of Bitcoin proposes a much broader interpretation of Proof-of-Work: that coupling digital actions to measurable physical energy expenditure can create a form of physical cost and power projection in cyberspace [14]. ESF treats this as conceptual inspiration, not as an established consensus theory and not as a dependency of the protocol. ESF adopts only the narrower engineering insight that abuse becomes harder to scale when a digital action is bound to scarce computational resources.

Bitcoin is the most prominent large-scale operational example of Proof-of-Work. Its original design uses hash-based work to make the accepted transaction history costly to rewrite and to coordinate agreement without a central authority [15]. ESF does not use a blockchain, cryptocurrency, mining reward or global consensus. It reuses only the underlying scarcity primitive: provable computational work can impose a real marginal cost on an otherwise cheap digital action.

> **Resource-security principle.** ESF deliberately introduces a small, bounded amount of physical resource cost into email delivery. The objective is not maximum computation; it is enough per-recipient friction to change abuse economics while keeping legitimate communication practical.

## 3. Relationship to existing email security

| Mechanism | Primary question | What ESF adds |
| --- | --- | --- |
| SPF | Is this SMTP source authorized to use a domain in the envelope/HELO context? | No replacement; ESF adds sender effort. |
| DKIM | Did a domain sign selected message content and headers? | ESF can use DKIM identity as a trust/exception input. |
| DMARC | Does the visible author domain align with authenticated SPF/DKIM identity and policy? | ESF adds economic friction even when domain use is authorized. |
| ARC | What authentication assessments were observed through intermediaries? | Potential future carriage of ESF assessment through forwarding paths. |
| ESF | Was sufficient computational work performed for this recipient/message context? | A scarce-resource signal, not identity or content safety. |

This separation is important. A DMARC pass, for example, establishes authorized domain use but is not itself a guarantee that a message is desirable or safe; the current DMARC specification explicitly treats such results as inputs to broader receiver policy [8]. ESF follows the same principle: a valid stamp is evidence of work, not evidence of benevolent intent.
## 4. Design principles, goals and non-goals
### 4.1 Integrability
ESF must fit into email as it exists. Adoption cannot depend on a coordinated flag day, replacement of SMTP, a central service, or simultaneous support by every mail provider. A useful implementation must be deployable at one integration point and still provide value when adjacent systems are unaware of ESF.

The first deployment path is therefore deliberately additive: generate or verify a compact stamp in a mail client, webmail application, gateway or spam filter; transport the message through normal SMTP; and expose the result to existing filtering and policy engines. Server-to-server ESF negotiation is a later strengthening step, not a prerequisite.

Implementations SHOULD keep the protocol core independent of any specific mail client or vendor so that the same test vectors and verification library can be reused by Thunderbird, Outlook integrations, webmail, MTAs, Rspamd, SpamAssassin and hosted email services.
### 4.2 Usability
The optimum is no user interface at all. ESF produces a signal for the machinery that already decides where mail lands: the verification result belongs in the existing spam score, filter rules and inbox placement, with nothing for the user to configure and nothing for them to interpret. A receiver who never learns that ESF exists, and whose unwanted mail merely became more expensive to send, is the success case. This also makes the strongest integration points - gateways, spam filters and hosted providers - the ones that need no user-facing work at all.

During adoption, a visible indicator is still worth having. Almost no mail carries a stamp yet, receivers are still calibrating policy, and implementers need to see what verification actually produced. Early clients SHOULD therefore show the result, and MAY expose the underlying detail, while treating both as transitional rather than as the goal.

Where an interface is shown, it must require almost no cryptographic knowledge. The user-facing concept is a traffic light, not a hash algorithm. Green means the message satisfies the receiver's ESF policy, yellow means a valid but weak or non-preferred proof is present, and red means no acceptable ESF proof is available.

Algorithm, difficulty, memory cost, timestamp and verification details MAY be available under an Advanced or Details view for diagnostics and expert users, but they MUST NOT be required to understand or operate ESF.

> **Two first-order requirements.** 1. Integrability: ESF must be incrementally deployable across existing email clients, servers and filters.<br>2. Usability: ideally no user-visible surface at all, because the result feeds existing spam filtering; where something is shown, it must not exceed green, yellow or red plus sensible automatic actions.

### 4.3 Protocol and security goals
Per-recipient cost: bulk delivery should scale approximately with the number of recipients, not only the number of unique message bodies.

Asymmetric verification: producing a proof must be materially more expensive than validating one.

Incremental deployment: useful implementations must be possible before global MTA support exists.

No central authority: the core protocol must not require a global token issuer, payment processor or sender registry.

Algorithm agility: the work function and difficulty policy must be replaceable without redefining the entire protocol.

Privacy awareness: BCC and recipient identifiers must not be unnecessarily exposed.

Compatibility: ESF must coexist with SMTP, MIME, forwarding, mailing lists, DKIM, SPF, DMARC, ARC, S/MIME and OpenPGP.

Fail-safe adoption: absence of ESF should initially be neutral; malformed or fraudulent proofs may be negative signals.
### 4.4 Non-goals
Authenticating the human sender.

Proving that message content is safe, truthful or non-malicious.

Replacing existing anti-spam classifiers or reputation systems.

Eliminating targeted phishing from well-resourced attackers.

Guaranteeing equal computational cost across every hardware class.

Requiring all legitimate bulk mail to perform PoW; authenticated/consented streams can be exempted by receiver policy.
## 5. Architecture
ESF is intentionally layered to maximize integrability. The same proof concept can be generated or consumed at different points in the existing email path, allowing adoption to begin in a single client or filter and later move toward stronger server-side enforcement. Enforcement strength depends on where the proof is created and verified.

Figure 1 - Two deployment modes: message-level ESF-Stamp and future SMTP-envelope enforcement.
### 5.1 Mode A: ESF-Stamp
The sender creates a proof and adds one or more ESF-Stamp header fields to the RFC 5322 message. Receiving clients, gateways or filters verify the stamp. This is the fastest route to a working ecosystem because RFC 5322 permits optional header fields, and current Thunderbird APIs can add custom compose headers and read incoming message headers [5][9].
### 5.2 Mode B: ESF-SMTP
A future SMTP service extension moves the proof into the SMTP envelope. The receiving MTA advertises ESF support through EHLO, and proof material is associated with each RCPT TO transaction. This is the strongest model because the receiver knows the actual envelope recipient, BCC information never needs to be embedded in message headers, and a proof cannot be amortized across recipients without the receiving MTA detecting it. RFC 5321 explicitly provides a service-extension model and permits registered parameters on SMTP commands [4].
## 6. ESF-Stamp protocol proposal (v0.1)

> **Header naming decision.** The standards-track target is ESF-Stamp, not a new X- prefixed permanent field, because RFC 6648 deprecates the X- convention for new application parameters [6]. However, current Thunderbird MailExtension customHeaders require X- names, so X-ESF-Stamp is acceptable as a prototype transport compatibility field until a standards-compliant integration path exists.

### 6.1 Example header
```text
ESF-Stamp: v=1; alg=sha256; d=22; t=1787651400;
           sid=F8Y0...Q9; rid=AP3K...7N; mid=2T1C...ZZ;
           salt=7a12d4b5e6891f20; nonce=000000000019d82c
```

The line folding above is illustrative. A real implementation must serialize the field according to the final ABNF and normal email header folding rules.
### 6.2 Fields

| Field | Meaning | v0.1 requirement |
| --- | --- | --- |
| v | ESF protocol version | MUST be 1. |
| alg | Registered work-function identifier | Initial ESF v1 profiles: sha256 and argon2id. Receivers decide which profiles they accept or prefer. |
| d | Difficulty parameter | Profile-specific target difficulty. Values are not comparable across different algorithms. |
| t | Stamp creation time | Unix time in UTC seconds. Receivers bound it against the message the stamp arrives with, not against their own clock; see 6.7a. |
| sid | Sender binding token | Hash of canonical RFC5322.From mailbox used for anti-reuse binding. |
| rid | Recipient binding token | Salted hash of canonical recipient mailbox; receiver recomputes locally. |
| mid | Message binding token | Hash of normalized Message-ID value. |
| salt | Random per-stamp salt | At least 64 random bits; 128 bits recommended. |
| nonce | Work nonce | Variable searched by sender until target condition is satisfied. |

### 6.3 Canonical identifiers
For the prototype profile, mailbox canonicalization is intentionally conservative: trim surrounding whitespace, parse the addr-spec, lowercase the domain, and preserve the local-part exactly unless an implementation has authoritative provider-specific canonicalization rules. ESF MUST NOT assume that dots, plus tags or case are globally insignificant in local-parts.
```text
sid = BASE64URL(SHA256("from:" || canonical_from))
rid = BASE64URL(SHA256("to:"   || canonical_recipient || 0x00 || salt))
mid = BASE64URL(SHA256("mid:"  || normalized_message_id))
```

The salted recipient token limits casual disclosure compared with placing the clear-text recipient address into the stamp. It does not provide strong anonymity against an observer who can guess the mailbox and test candidates. BCC therefore requires additional handling described below.
### 6.4 Work input and target
The prototype SHA-256 profile constructs a deterministic byte string from all proof fields except the derived hash itself. Fields are length-delimited or encoded in an unambiguous canonical order. A compact reference representation is:
```text
work = UTF8("ESF1\n" +
            "alg=sha256\n" +
            "d="     + d     + "\n" +
            "t="     + t     + "\n" +
            "sid="   + sid   + "\n" +
            "rid="   + rid   + "\n" +
            "mid="   + mid   + "\n" +
            "salt="  + salt  + "\n" +
            "nonce=" + nonce + "\n")

h = SHA256(work)
valid iff leading_zero_bits(h) >= d
```

For difficulty d, a uniformly random hash succeeds with probability 2^-d, so the expected number of nonce trials is 2^d. Difficulty therefore has an exponential scale: increasing d by one approximately doubles expected work.
### 6.5 Algorithm agility and initial work profiles
ESF is algorithm-agile by design. Version 1 starts with two work profiles rather than treating one hash function as permanent: SHA-256 provides maximum portability and a straightforward Hashcash-style baseline; Argon2id provides a memory-hard alternative that ties each attempt to both computation and memory resources. RFC 9106 explicitly specifies Argon2 as a memory-hard function for password hashing and Proof-of-Work applications [13].

The sender includes the selected profile and every profile-specific parameter in the canonical work input. The receiver applies its own local policy for accepted algorithms, parameter bounds and minimum work. A sender therefore cannot downgrade a receiver by declaring a weak algorithm or trivial parameters.

| Profile | Cost model | Initial role |
| --- | --- | --- |
| sha256 | Compute-bound leading-zero target. Extremely portable and cheap to verify. | Baseline interoperability and early deployment profile. Specialized hardware advantage must be accounted for in receiver policy. |
| argon2id | Memory-hard work with bounded memory, iterations and lanes plus a target condition. | Stronger resource-binding profile for receivers that want to reduce the advantage of massively parallel/specialized hardware. |

An illustrative Argon2id stamp may carry profile parameters such as mem=16384, iter=1 and lanes=1 together with d. These numbers are not normative. ESF must benchmark real desktop, mobile and server hardware before standardizing profiles. Difficulty numbers for SHA-256 and Argon2id MUST NOT be compared directly.
```text
ESF-Stamp: v=1; alg=argon2id; mem=16384; iter=1; lanes=1; d=8;
           t=1787651400; sid=F8Y0...Q9; rid=AP3K...7N; mid=2T1C...ZZ;
           salt=7a12d4b5e6891f20; nonce=00000000000003af
```
### 6.6 Generation
Obtain the receiver policy or apply the sender's default ESF difficulty.

Generate timestamp and cryptographically random salt.

Canonicalize sender, intended recipient and Message-ID, then compute sid, rid and mid.

Iterate the nonce in a worker thread or equivalent background execution context.

Stop when the configured target is met or when the user/policy cancels computation.

Serialize and attach the ESF-Stamp field without blocking the compose UI.
### 6.7 Verification
Verification is deliberately ordered from cheapest to more expensive checks to prevent attacker-controlled headers from creating a receiver-side denial of service.
1. Enforce a strict maximum header size and a maximum number of ESF-Stamp fields.
2. Parse version, algorithm and numeric fields using bounded values; reject duplicates or ambiguous syntax.
3. Reject unsupported algorithms before performing cryptographic work.
4. Enforce local minimum and maximum acceptable difficulty; never trust an attacker-supplied difficulty as a reason to perform extra work.
5. Validate the timestamp against the message the stamp arrives with, and against future-skew limits; see 6.7a.
6. Recompute sid, rid and mid for the local message/recipient context.
7. Perform one work-function verification operation and compare the result with the claimed difficulty.
8. Check the replay cache before assigning a positive ESF result.
Figure 2 - Stamp generation, verification and policy use.
### 6.7a Freshness: contemporaneity, not expiry
A stamp should be judged by whether its work belongs to *this* message, not by how much time has passed since it was
produced. Receivers SHOULD therefore require that a stamp was minted within a bounded interval before the message
came into being — a contemporaneity window, for which 24 hours is a reasonable starting value — and MAY additionally
apply an absolute maximum age. The two are independent, and only the first carries a security property.

The contemporaneity requirement is what keeps a sender paying as they go. Without it, an operator with spare capacity
can mint stamps for months on idle hardware, or on cheap off-peak power, and release them in a single campaign: the
total work per recipient is unchanged, but the *rate* at which work must be produced — the property that actually
limits a campaign — disappears. A stockpiled stamp no longer matches the message it is attached to and is refused.

An absolute expiry, by contrast, answers a question ESF does not ask. A proof of work does not become untrue with
age, and a fixed window makes a correctly delivered message unverifiable later: mail delayed in a queue, held for
moderation, or simply read from an archive months afterwards would be downgraded for reasons that have nothing to do
with the sender's effort. Implementations SHOULD default to no absolute expiry and expose it as an option.

Which instant counts as "when the message came into being" matters, because the Date header belongs to the sender.
Receivers SHOULD prefer a timestamp they or their own infrastructure produced — the topmost Received field, or the
delivery time recorded by the receiving system — and fall back to Date only when none is available. With a
receiver-produced reference, back-dating a message to match a stockpiled stamp does not help the sender. Where only
Date is available, a stockpiled stamp can still be smuggled through by back-dating the message, at the cost of the
message presenting itself as old, which is a signal in its own right.

Verification MUST NOT use the moment of *reading* as the reference. A receiver that compares a stamp against its
current clock at display time will turn every stored message stale, reversing a result that was correct on arrival.

### 6.8 Replay resistance
ESF does not need to cryptographically authenticate message content to achieve its principal economic goal, but it must prevent the same successful stamp from being accepted repeatedly for a recipient. Receivers SHOULD cache a compact stamp identifier for an explicit retention period. With no absolute acceptance window (6.7a) that retention cannot simply follow it, so it becomes a value of its own: replay detection is exact within the retention period and best effort beyond it. A suitable identifier is SHA-256 of the canonical ESF-Stamp field. A second use for the same local recipient is classified as replay and receives no positive ESF credit.

Binding to Message-ID makes accidental stamp reuse across messages unlikely and raises the cost of intentional reuse. A future strict profile may additionally bind a DKIM-style canonical body hash; the trade-off is fragility when intermediaries modify content.
### 6.9 Multiple recipients and BCC
Recipient binding is where message-header PoW is inherently weaker than SMTP-envelope PoW. A message addressed to multiple visible To/Cc recipients may carry multiple ESF-Stamp fields, one per recipient. That causes work to scale with recipients, which is desirable. BCC is different: embedding a BCC recipient identifier in a common message can leak information about the hidden recipient.

Preferred: generate a distinct message copy for each BCC recipient and attach only that recipient's private stamp to that copy.

If an MUA cannot safely create per-BCC copies, it SHOULD omit recipient-specific ESF credit for BCC rather than expose the mailbox.

Receivers SHOULD assign lower assurance to domain-scoped or otherwise amortizable proofs.

The future ESF-SMTP profile solves this cleanly because the actual recipient is already known in the RCPT TO transaction and is never carried in the message body or headers.

Implementation note: current client APIs (Thunderbird customHeaders, Outlook internetHeaders) keep at most one header value per field name, so the reference clients serialize all stamps of a message as a comma-separated list inside a single ESF-Stamp field. Receivers MUST accept both forms - one stamp per field and a stamp list within one field - subject to the anti-DoS bounds of section 6.7 (see Appendix D).
## 7. Difficulty and economic model
### 7.1 Difficulty is policy, not a universal constant
A fixed global number is useful for a prototype but is not suitable as a permanent Internet-wide policy. Hardware capability, energy constraints and abuse economics change over time. ESF therefore separates protocol syntax from receiver policy.

For the start of deployment the reference clients default to **20 bits**, and that number is chosen against the send flow rather than in the abstract: it takes a few seconds on an ordinary machine, which a client can absorb by computing past its quiet phase while showing progress, and it costs a bulk sender four times what 18 bits does. It is a starting value to be revised from deployment evidence (section 14), not a recommendation for all time - and a receiver's minimum for a green result is a separate decision from a sender's baseline.

| Difficulty | Expected SHA-256 trials | Relative work |
| --- | --- | --- |
| 18 | 262,144 | 1/4 of the starting default |
| 20 | 1,048,576 | starting default of the reference clients |
| 22 | 4,194,304 | 4x the starting default |
| 24 | 16,777,216 | 16x |
| 26 | 67,108,864 | 64x |

These values describe algorithmic work, not wall-clock time. Wall-clock time depends heavily on implementation, processor, GPU/ASIC availability, thermal limits and parallelism. ESF implementations should calibrate against measured local performance rather than promise a universal number of milliseconds.
### 7.2 Initial profiles: SHA-256 and Argon2id
SHA-256 has excellent interoperability, compact proofs and extremely cheap verification, which makes it ideal for bootstrapping an ecosystem. Its weakness is also clear: GPUs and especially specialized hardware can evaluate it disproportionately efficiently. Argon2id complements it with a memory-hard cost model standardized in RFC 9106 [13]. ESF v1 therefore starts with both profiles and lets receiver policy decide whether SHA-256 is sufficient, weak-but-acceptable, or not accepted for a given context.

Policy thresholds are profile-specific. For example, a receiver may classify a particular SHA-256 proof as yellow while accepting a calibrated Argon2id proof as green. ESF does not define a universal conversion between work functions; operational benchmarking determines their relative policy strength.

> **Protocol requirement.** ESF MUST remain algorithm-agile. The initial interoperable family includes SHA-256 for maximum portability and Argon2id for memory-hard work. Receivers independently define accepted profiles, parameter bounds and minimum strength, and future algorithms can be registered or retired without changing the base ESF message model.

### 7.3 Trust-aware difficulty
The most practical receiver policy does not charge every message equally. ESF is strongest when it acts as a friction mechanism specifically for unknown or low-trust senders.

| Context | Illustrative ESF policy |
| --- | --- |
| Known personal contact | No PoW or minimal work. |
| Previously replied-to correspondent | No PoW or low work. |
| Authenticated trusted organization | No PoW or policy-defined exemption based on DKIM/DMARC identity. |
| Unknown sender | Normal PoW requirement. |
| Low-reputation / suspicious stream | Higher PoW requirement or quarantine. |
| Confirmed opt-in bulk sender | Receiver/provider exemption; do not waste computation merely because mail is bulk. |

### 7.4 Worked example: cost of a mid-size campaign
The following model quantifies the economic effect of both initial profiles on a mid-size bulk campaign of 10 million messages per day, one stamp per recipient. All monetary figures are US dollars and are order-of-magnitude estimates for rented capacity at roughly 0.02 USD per CPU core-hour, 0.35 USD per GPU-hour and 0.10 USD per kWh; they move with hardware and energy prices and MUST be re-derived by the Phase 0 benchmark campaign rather than quoted as results. The single-threaded JavaScript rate is measured with the reference implementation (Appendix D.10); optimized-native, GPU and ASIC rates are literature and benchmark estimates that MUST be replaced by the Phase 0 benchmark campaign before any difficulty value is standardized.

Approximate SHA-256 rates per actor: legitimate client in a JavaScript runtime ~0.2 MH/s per thread (measured), optimized native code with SHA extensions ~10 MH/s per core, one current high-end GPU ~20 GH/s, one commodity hashing ASIC ~100 TH/s.

| SHA-256, d=20 (2^20 ≈ 1.05M trials/recipient) | Sustained load for 10M msg/day | Estimated added cost per day |
| --- | --- | --- |
| Rented cloud CPUs (native, SHA extensions) | ~12 cores | ~6-11 USD |
| One high-end GPU | ~9 minutes of GPU time (&lt;1% utilization) | ~0.02 USD electricity |
| Hashing ASIC | ~0.1 s of device time | negligible |
| Botnet sending natively | throughput drops to ~5 msg/s per bot | victim pays energy; campaign duration x100+ |
| Stolen webmail accounts (JavaScript rate) | ~1 msg per 5 s per bot | throughput reduced x1000 |

The same difficulty costs a legitimate JavaScript client roughly five seconds per recipient. The asymmetry between that client and a GPU is therefore about five orders of magnitude: a compute-bound SHA-256 difficulty high enough to burden a GPU-equipped operator (roughly 34-35 bits for a four-digit USD daily cost at this volume) would require hours per message from legitimate clients. Compute-bound difficulty alone cannot close this gap; it remains valuable as a portable bootstrap profile and as a throughput brake on botnets and abused accounts.

Argon2id changes the picture because every evaluation must fill the configured memory. With the illustrative profile m=16384 (16 MiB), t=1, lanes=1, d=8 (2^8 = 256 expected evaluations per recipient, each touching roughly 32 MB), estimated rates are ~15-25 evaluations/s in a browser/WASM client, ~30-50 per native CPU core, ~300-600 per multi-core server (memory bandwidth, not cores, is the bottleneck) and ~5,000-15,000 for one 24 GB high-end GPU whose advantage is bounded by memory bandwidth and data-dependent addressing. No commodity Argon2id ASIC exists; the theoretical specialized-hardware advantage is bounded by memory cost to an estimated factor of 2-10.

| Argon2id m=16 MiB t=1 d=8, 10M msg/day (~30,000 evals/s sustained) | Sustained load | Estimated added cost per day |
| --- | --- | --- |
| Rented cloud CPUs | ~50-100 servers (bandwidth-bound) | ~550-1,650 USD |
| High-end GPUs | ~2-6 devices permanently | ~22-66 USD |
| Specialized hardware | not commercially available; bounded advantage | capital-intensive, limited gain |
| Botnet sending natively | ~1 msg per 5-8 s per bot; 16 MiB peak RAM per attempt limits parallelism on weak hosts | campaign duration x1000 |

The user-visible cost of this Argon2id profile (~10-15 s per recipient in a WASM client) is comparable to SHA-256 at d=20-22, but the client-to-GPU asymmetry shrinks from ~10^5 to an estimated factor of ~300. Parameters scale the effect linearly: quadrupling memory quadruples attacker cost without forcing a quadrupled user wait, because the receiver policy can lower d in exchange. Two costs must be engineered deliberately: verification of one Argon2id stamp costs the receiver tens of milliseconds and the configured memory rather than microseconds, which makes the bounds of section 6.7 and a memory cap mandatory before any Argon2id verification is attempted (section 16); and constrained devices need the delegation and limit mechanisms of section 13.

## 8. Receiver policy discovery
A sender needs to know what work is useful before transmitting a message. ESF proposes DNS discovery as an optional first-stage mechanism because it is cacheable, decentralized and already familiar to email operators through SPF, DKIM and DMARC. This is a proposal for experimentation, not yet a registered DNS scheme.
```text
_esf.example.org. 300 IN TXT "v=ESF1; p=optional; alg=argon2id,sha256; profile=default; maxage=604800"
```

| Tag | Meaning |
| --- | --- |
| v | Policy version; ESF1. |
| p | Receiver posture: none, optional, prefer, require. |
| alg | Ordered list of accepted work profiles. |
| d | Requested baseline difficulty for unknown senders. |
| maxage | Contemporaneity window in seconds: how long before its message a stamp may have been minted (6.7a). Not an absolute expiry. |
| contact | Optional HTTPS URI for ESF policy documentation; not required for validation. |

DNS policy is advisory in the initial client profile. A receiver always applies local policy at validation time. DNSSEC can protect the discovery record where deployed, but ESF must remain safe when DNS policy is unsigned: an attacker who removes or alters an advisory record must not gain cryptographic authority over receiver validation.
## 9. Future ESF-SMTP profile
RFC 5321 provides a formal SMTP extension mechanism in which servers advertise capabilities using EHLO and extensions can define parameters for MAIL or RCPT commands [4]. ESF can use that architecture to enforce one proof per envelope recipient at MTA-to-MTA time.
```text
S: 220 mx.example.org ESMTP
C: EHLO sender.example
S: 250-mx.example.org
S: 250-ESF v=1 alg=argon2id,sha256 profile=default challenge=R4nd0m...
S: 250 PIPELINING
C: MAIL FROM:<sender@sender.example>
C: RCPT TO:<alice@example.org> ESF=<recipient-proof>
S: 250 2.1.5 Recipient accepted
```

This syntax is illustrative only. A real SMTP extension would require an Internet-Draft defining the registered EHLO keyword, challenge lifetime, recipient parameters, retry semantics, enhanced status codes, relay behavior, maximum command-length impact and interoperability with queueing/retries.

Per-recipient accounting is authoritative because RCPT TO is explicit.

BCC privacy is naturally preserved.

A connection-specific challenge makes precomputation and broad proof reuse harder.

MTAs can reject or defer insufficient work before accepting the message body, reducing downstream storage/filtering cost.

Deployment is slower because sending and receiving MTAs need support; MUA-only plugins cannot perform final MX negotiation through a normal submission relay.
## 10. Integration profiles
Integration is a first-order protocol requirement. ESF is not a replacement mail stack; it is a small generate/transport/verify/policy layer that can be inserted wherever an organization already controls mail flow. The strongest adoption strategy is to support multiple integration depths with the same protocol core.

| Integration point | Generate | Verify | Primary value |
| --- | --- | --- | --- |
| Mail client / plugin | Yes | Yes | Immediate user-visible protection and local automation; no server replacement. |
| Gateway / spam filter | Optional | Yes | Pre-inbox scoring for all users behind the gateway. |
| Webmail / hosted provider | Yes | Yes | Provider-scale generation, validation and placement policies. |
| SMTP MTA extension | Negotiated | Yes | Authoritative per-envelope-recipient enforcement and BCC-safe accounting. |

### 10.1 Mail user agents
MUA implementations generate a stamp before sending, expose non-blocking progress/cancellation, and validate stamps when displaying mail. Thunderbird is a practical reference implementation because current MailExtension APIs expose compose hooks and efficient access to incoming headers [9]. One prototype constraint is important: Thunderbird's current customHeaders API requires extension-defined headers to use an X- prefix. A Thunderbird proof-of-concept should therefore use X-ESF-Stamp internally, while the standards target remains the registrable ESF-Stamp field defined by the future RFC.

Microsoft Outlook is the second reference MUA. Office.js exposes persistent custom internet headers from Mailbox requirement set 1.8 (set on compose, full MIME header access on read) and a supported send interception point (OnMessageSend / Smart Alerts) from requirement set 1.12 [16]. Unlike Thunderbird, the Outlook API preserves header names as given, so the Outlook client already transports the standards-track ESF-Stamp field; both header names are accepted on receipt during the prototype phase. Outlook-specific constraints - the event runtime limit, the JavaScript-only runtime of the classic Windows client and the administrator-deployment requirement for automatic send interception - are recorded in Appendix D.

Computation MUST run off the UI thread, e.g. Worker/WASM worker.

Users SHOULD be able to send without ESF when the receiver does not require it.

A missing stamp MUST NOT be presented as malicious during the adoption phase.

The default UI SHOULD expose only the ESF traffic-light state. Cryptographic details belong in an optional Advanced/Details view, and ESF MUST never label a message as “safe” solely because work was verified.
### 10.2 Gateways and server filters
Server-side integration is operationally more valuable than a client badge because it can incorporate ESF before inbox placement. Gateways can verify ESF once, add a local Authentication-Results-style assessment or internal metadata, and feed the result into existing spam scoring. A future ESF-specific result token could be standardized after deployment experience.
### 10.3 Webmail and hosted providers
Hosted providers can implement ESF at the server, in a web client using workers, or both. Provider-side computation is a policy decision: doing work centrally may weaken the economic linkage to the human sender if a provider subsidizes unlimited proofs. For consumer platforms, rate limits and account reputation should therefore remain complementary controls.
### 10.4 Mailing lists and forwarding
Mailing lists intentionally fan one accepted submission out to many subscribers. Requiring the original author to precompute for unknown final subscribers is impractical and can expose membership. The list operator should instead be treated as a new sending actor: it can receive mail under its own policy and either be trusted by subscribers or generate outgoing ESF proofs per subscriber. Forwarders should preserve valid ESF-Stamp fields but receivers should assess them only for the recipient binding they can verify.
## 11. Receiver scoring and UX semantics
A receiver need not expose ESF at all; where the result only feeds spam scoring and inbox placement, this section does not apply (see 4.2). Where a receiver does surface ESF, the experience should be immediate and low-friction, so ESF deliberately uses a traffic-light model: users do not have to interpret algorithms, bit counts, memory parameters or cryptographic terminology.

The visible color is a policy result, not a cryptographic primitive. Receiver software maps the underlying validation result and local policy to green, yellow or red.

| Signal | Meaning | Default policy behavior |
| --- | --- | --- |
| GREEN | A valid ESF proof satisfies or exceeds the receiver's current policy. | Positive anti-spam signal; normally deliver. Existing malware/phishing/authentication checks still apply. |
| YELLOW | A valid ESF proof exists but is weak, deprecated, below the preferred profile, or otherwise receives limited credit. | Deliver normally or flag depending on policy; do not grant full ESF credit. |
| RED | No acceptable ESF proof is available: typically no ESF stamp, or an unacceptable/invalid result. | Use normal spam filtering; optionally increase score, route to Unverified/Junk, or apply stricter rules for unknown senders. |

> **Security UI rule.** The primary UX is a simple ESF traffic light. GREEN means sufficient work under local policy, YELLOW means valid but weak/limited work, and RED means no acceptable proof. These colors describe ESF work only - never sender identity, truthfulness, malware safety or overall message trustworthiness.

Internally, implementations SHOULD distinguish at least MISSING, INVALID, WEAK and STRONG even if the simplified UI maps both MISSING and unacceptable results to red. This distinction matters for automation: a message from a legacy sender with no ESF support is not equivalent to a message containing a malformed, replayed or deliberately insufficient proof.

Automation is more important than exposing cryptographic telemetry. A default deployment can treat green as a positive spam-scoring signal, yellow as neutral or mildly flagged, and red as an input to existing filtering. Known contacts, previously replied-to correspondents and authenticated trusted organizations can be exempted or override ESF requirements. During early adoption, missing ESF SHOULD NOT by itself trigger automatic deletion.

Technical information such as Algorithm: Argon2id, Difficulty, Required threshold, Generated time and raw verification result is useful for diagnostics and expert users, but it is explicitly nice-to-have. It belongs behind a Details or Advanced disclosure, not in the primary message experience.
### 11.1 Advanced/internal validation states

| Internal ESF state | UI mapping | Recommended interpretation / action |
| --- | --- | --- |
| strong | GREEN | Valid proof satisfies receiver profile and minimum strength. Positive anti-spam signal; never bypass other security checks. |
| weak | YELLOW | Valid proof exists but is below preferred policy or uses a weaker/deprecated profile. Limited or neutral credit. |
| missing | RED | No ESF proof. During adoption, process through existing filters; do not treat absence alone as malicious. |
| invalid | RED | Malformed, stale, wrong-recipient, insufficient, replayed or otherwise unacceptable proof. May be a negative spam signal. |
| unsupported | YELLOW or RED | Locally unsupported profile. Map by policy; never execute unbounded or attacker-selected work. |

## 12. Threat model and security analysis

| Threat | Effect | Mitigation / limitation |
| --- | --- | --- |
| Proof replay | Attacker resends one successful stamp. | Recipient + Message-ID binding and replay cache. |
| Cross-recipient reuse | One proof is sent to many mailboxes. | rid binding; authoritative prevention in ESF-SMTP. |
| Precomputation | Work is generated before a campaign is known. | Random salt, recipient binding and the contemporaneity window, which also denies the slower variant of stockpiling stamps over months; SMTP challenges later. |
| Specialized hardware | Spam operator gets lower cost than normal users. | Algorithm agility; evaluate memory-/bandwidth-hard profiles. |
| Botnets / stolen endpoints | Attacker externalizes computation onto victims. | ESF cannot eliminate this; account/reputation/security controls remain necessary. |
| Header bombing | Many/huge ESF fields consume parser resources. | Strict count/size caps before cryptographic verification. |
| Difficulty DoS | Attacker declares absurd difficulty. | Verifier uses local accepted bounds; verification is one bounded operation. |
| Freshness manipulation | Old proofs are replayed. | Contemporaneity window against a receiver-produced timestamp, plus future-clock-skew checks (6.7a). |
| BCC disclosure | Recipient token can reveal hidden recipient. | Per-BCC message copies; omit credit if unsafe; ESF-SMTP long-term. |
| Malicious but funded sender | Attacker willingly pays work cost. | PoW is friction, not authentication; existing content/reputation controls continue. |
| Forwarding/list mutation | Recipient binding or message context changes. | Trust intermediary, recompute downstream proofs, or treat original stamp as non-applicable. |
| Algorithm downgrade | Weak profile selected intentionally. | Receiver policy defines minimum accepted profile/difficulty; DNS discovery is not authoritative. |

### 12.1 What ESF can realistically reduce
ESF is strongest against broad, low-value, unsolicited campaigns where the attacker depends on near-zero marginal delivery cost. It is weaker against highly targeted abuse, compromised legitimate accounts, well-funded fraud and botnets. “End Spam Forever” is the project goal and brand; the security claim is narrower: impose measurable per-recipient scarcity that current email does not inherently require.
## 13. Operational, accessibility and environmental considerations
Proof-of-Work intentionally consumes computation and therefore ultimately physical energy. That cost is the security mechanism, not an accidental side effect. In the resource-security framing discussed by Lowery, the important shift is from purely logical permission to measurable physical cost [14]. ESF applies that idea in a deliberately bounded form: it does not seek Bitcoin-scale global competition or continuous mining. Work is small, targeted per recipient, and ideally waived for trusted or consensual communication. Mobile devices and battery-powered clients need configurable limits and may delegate computation to the sender's own trusted submission service.

Provide a hard computation timeout and cancellation.

Never consume all logical CPU cores by default.

Defer or reduce work on battery/thermal constraints when receiver policy permits.

Expose deterministic policy to assistive technologies; do not make proof generation depend on visual challenges.

Measure actual hardware performance and publish benchmark methodology for each work profile.

Keep valid-proof verification substantially cheaper than generation and cap all attacker-controlled parsing paths.
## 14. Deployment roadmap

| Phase | Deliverable | Success criterion |
| --- | --- | --- |
| 0 - Research | Whitepaper, threat model, SHA-256 + Argon2id benchmarks, UX policy model. | Demonstrate practical cost asymmetry and usable green/yellow/red semantics. |
| 1 - Client prototype | Thunderbird ESF extension plus reusable protocol library. | Non-blocking generation/verification, traffic-light UX and interoperable stamps between independent implementations. |
| 2 - Filter integration | Rspamd/SpamAssassin/Postfix/Exim or equivalent verifier integrations. | ESF result influences inbox placement without requiring end-user client support. |
| 3 - Policy discovery | Experimental DNS policy and public interoperability test domain. | Senders can discover accepted profiles and avoid useless work. |
| 4 - Multi-client ecosystem | Outlook/webmail/client integrations and SDKs. | Same protocol and policy semantics work across multiple vendors and integration depths. |
| 5 - Internet-Draft | ESF-Stamp registration, profile registry and normative wire specification. | Independent review and IETF discussion. |
| 6 - SMTP profile | Experimental ESF SMTP extension and MTA implementations. | Per-envelope-recipient enforcement across independent MTAs. |
| 7 - Standardization | Refine work profiles, IANA registries, operational and accessibility guidance. | Standards outcome based on deployment evidence, not theoretical assumptions alone. |

## 15. RFC and IANA standardization path
The ESF project should separate the explanatory whitepaper from normative protocol documents. A practical sequence is:
1. Publish the ESF whitepaper and open-source reference implementation.
2. Define a compact “ESF-Stamp for Internet Mail” Internet-Draft using BCP 14 requirement language.
3. Request provisional/permanent registration of the ESF-Stamp message header through the applicable IANA message-header process.
4. Define an ESF work-profile registry. Initial entries should include SHA-256 and Argon2id with explicit parameter semantics, receiver bounds and a process for adding, deprecating or retiring future profiles without changing the base header format.
5. After implementation experience, draft “ESF SMTP Service Extension” with an IANA-registrable EHLO keyword and RCPT parameters.
6. Publish separate operational guidance for difficulty policy, allowlists, mailing lists, mobile constraints and abuse handling.
New experimental header fields should avoid the X- convention because RFC 6648 recommends meaningful non-X names for new parameters [6]. Message header names can be provisionally or permanently registered through the framework established by RFC 3864 [7].
## 16. Open design questions before a standards-track draft
How should the initial SHA-256 and Argon2id profiles be calibrated across desktop, mobile and server hardware, and which profile(s) should eventually be mandatory-to-implement or preferred? The answer must weigh specialized-hardware advantage, memory pressure, verifier DoS cost, proof size, implementation complexity and browser/MUA portability.

Should ESF-Stamp bind only recipient + sender + Message-ID, or define an optional DKIM-style canonical body hash profile?

How should sender and recipient mailbox internationalization (SMTPUTF8 / Unicode) be canonicalized?

What is the safest DNS discovery name and policy grammar, and should DNSSEC change sender behavior?

How should receiving systems expose ESF validation in Authentication-Results or a dedicated result field?

What exact semantics should apply to mailing lists, aliases, forwarding and multi-recipient messages?

How should difficulty be calibrated across mobile, desktop, server, GPU and specialized hardware classes?

Can a memory-hard proof provide sufficiently cheap verification to resist receiver-side DoS at Internet scale?

Which telemetry can measure efficacy without creating new privacy-sensitive reporting channels?
## 17. Conclusion
ESF starts from a simple observation: unsolicited email is cheap because the protocol does not require the sender to spend a scarce resource proportional to the number of recipients. Proof-of-Work can introduce that missing friction without a central payment authority. Dwork/Naor and Hashcash established the computational-postage idea; Bitcoin demonstrated that Proof-of-Work can operate as a durable, large-scale security primitive; and Lowery's SOFTWAR thesis provides a broader conceptual lens in which digital security can be tied to physical resource expenditure rather than relying only on logical controls [1][2][14][15]. ESF applies that insight narrowly and pragmatically to email abuse resistance.

The proposed path is pragmatic: prioritize integrability and usability, ship ESF-Stamp in clients and filters, expose a simple traffic-light result, start with both SHA-256 and Argon2id profiles, measure real-world costs, and use deployment evidence to design a stronger ESF-SMTP profile. ESF should be judged not by whether every spam message disappears, but by whether it materially changes the economics of reaching large numbers of unwilling recipients while preserving the openness and simplicity that made email useful.
## Appendix A - Draft ESF-Stamp grammar
The following ABNF-like grammar is intentionally preliminary. An Internet-Draft should import RFC 5322 / RFC 5234 productions and specify whitespace, folding and error handling precisely.
```abnf
ESF-Stamp = "ESF-Stamp:" OWS stamp *(OWS ";" OWS stamp-param) CRLF
stamp       = "v=1"
stamp-param = alg / difficulty / timestamp / sid / rid / mid / salt / nonce / profile-param
alg         = "alg=" token
difficulty  = "d=" 1*3DIGIT
timestamp   = "t=" 1*DIGIT
sid         = "sid=" b64url
rid         = "rid=" b64url
mid         = "mid=" b64url
salt        = "salt=" 16*64HEXDIG
nonce       = "nonce=" 1*64HEXDIG
profile-param = token "=" token
; Initial profile parameters may include mem, iter and lanes for argon2id.
; The final Internet-Draft must define allowed parameters per registered profile.
```
## Appendix B - Reference verification pseudocode
```text
function verifyEsfStamp(message, localRecipient, stamp, policy):
    messageTime = min(receiverTimestamp(message) or message.date, now)
    if stamp.serializedLength > policy.maxHeaderBytes: return INVALID
    if stamp.version != 1: return UNSUPPORTED
    profile = policy.profile(stamp.algorithm)
    if profile == null: return UNSUPPORTED
    if !profile.parametersWithinBounds(stamp): return INVALID
    if stamp.difficulty < profile.minDifficulty: return WEAK
    if stamp.difficulty > profile.maxDeclaredDifficulty: return INVALID
    if messageTime - stamp.timestamp > policy.maxStampToMessage: return STAMP_TOO_OLD
    if stamp.timestamp - messageTime > policy.clockSkew: return FUTURE
    if policy.maxAge and now - stamp.timestamp > policy.maxAge: return STALE
    expectedSid = senderToken(message.from)
    expectedRid = recipientToken(localRecipient, stamp.salt)
    expectedMid = messageIdToken(message.messageId)
    if !constantTimeEqual(stamp.sid, expectedSid): return INVALID
    if !constantTimeEqual(stamp.rid, expectedRid): return WRONG_RECIPIENT
    if !constantTimeEqual(stamp.mid, expectedMid): return INVALID
    stampId = SHA256(canonicalSerialize(stamp))
    if replayCache.contains(stampId): return REPLAY
    digest = profile.verifyOneBoundedWork(canonicalWorkInput(stamp), stamp)
    if leadingZeroBits(digest) < stamp.difficulty: return INVALID
    replayCache.insert(stampId, expiry=now + policy.replayRetention)
    return STRONG
```
## Appendix C - Reference Thunderbird implementation profile
Use a current Thunderbird MailExtension / WebExtension architecture, not legacy XUL add-ons.

Intercept sending with the supported compose send lifecycle. Because Thunderbird currently restricts extension-defined custom compose headers to X- prefixed names, use X-ESF-Stamp for the Thunderbird prototype; keep ESF-Stamp as the standards-track target field.

Run nonce search in Worker/WASM Worker code and provide cancellation.

Read incoming headers using the most efficient available messages API; current Thunderbird releases expose direct header retrieval as well as full/raw message access [9].

Display the primary GREEN / YELLOW / RED ESF traffic-light state separately from DKIM/DMARC identity indicators; expose algorithm and difficulty only in optional details.

Keep the protocol core in a standalone library with deterministic test vectors so other email clients and server implementations can interoperate.
## Appendix D - Implementation learnings from the reference clients
The Thunderbird MailExtension and the Outlook Office.js add-in are the first two independent implementations of the
shared ESF protocol core. Both emit and verify identical stamps against a common set of deterministic test vectors.
The following findings come from building them and should feed the Internet-Draft; where they conflict with earlier
sections, this appendix reflects the implemented state.

### D.1 Header naming and transport
Thunderbird's compose API only accepts X- prefixed custom headers, so its prototype transports X-ESF-Stamp. Outlook's
internetHeaders API preserves names as given, so the Outlook client already sends the standards-track ESF-Stamp
field. Consequence for every verifier during the prototype phase: accept both names on receipt, prefer emitting
ESF-Stamp wherever the platform allows it, and never make the X- name part of the permanent design (RFC 6648 [6]).

### D.2 One field, many stamps
Both client APIs keep a single value per header name, so all stamps of a message travel as a comma-separated list in
one field (section 6.9). Parsers must bound both axes before any cryptographic work: header length, stamps per field,
fields per message and fields per stamp. The reference bounds (512 bytes per stamp, 16 stamps per header, 8 stamp
fields per message, difficulty cap 30) held up in practice and keep verification at exactly one hash per stamp.

### D.3 Message binding versus Message-ID timing
Neither client knows the final Message-ID at the send hook: Thunderbird assigns it after onBeforeSend returns, and
Outlook assigns it when Exchange accepts the message. Both reference clients therefore mint a random message
identifier (uuid@esf.invalid), bind mid to it and do not transport the raw identifier - which makes mid an opaque
uniqueness/replay component rather than a verifiable binding to the carrier message. This is an open protocol issue
for the Internet-Draft: either carry the minted identifier in the stamp so receivers can verify mid, or redefine the
message binding (for example a body-hash profile, section 6.8) with explicit semantics.

### D.4 Send-time runtime constraints
Outlook's event-based runtime enforces hard platform limits: automatic send interception requires Mailbox 1.12+, is
unavailable on Outlook mobile, shows a "taking long" dialog after roughly five seconds, terminates handlers after
roughly five minutes, and only auto-runs when the add-in is deployed by an organization administrator [16]. Practical
consequences adopted by both clients: a configurable wall-clock work budget per recipient (default five seconds),
cooperative cancellation inside the nonce search, and an explicit failure policy - "send without ESF" (default,
with a visible notice) or "hold the message" - because an event handler cannot ask interactive questions. A partially
stamped multi-recipient message is treated as failure: honest absence beats a stamp set that shows red for exactly
the recipients the sender ran out of budget for.

### D.5 Cryptographic runtime availability
The classic Outlook on Windows event runtime is JavaScript-only: no DOM and no guaranteed WebCrypto. The shared core
therefore requires a bundled pure-JS SHA-256 that is digest-identical to the WebCrypto path. Random salt generation
is different: without a cryptographic RNG the clients refuse to generate a stamp instead of falling back to weak
randomness, because a predictable salt re-enables the precomputation attacks the salt exists to prevent
(section 6.3). Capability detection with explicit degradation proved essential; feature presence must never be
assumed from platform names.

### D.6 Recipient binding at the receiver
Neither client platform can enumerate the mailbox aliases a user owns. The rid check (section 6.7 step 6) therefore
runs against a configurable set of local mailboxes - the signed-in address plus user-declared aliases. Testing rid
against every address in the To/Cc lines would accept stamps bound to other recipients and is explicitly rejected.
Because local-parts are case-sensitive under the conservative canonicalization of section 6.3, a stamp binds the
exact mailbox spelling the sender used; alias handling is receiver configuration, not protocol.

### D.7 Bcc handling as implemented
Both clients implement the section 6.9 fallback as the default ("omit": no stamp for Bcc recipients) plus an opt-in
"token" mode that includes only the salted rid. Neither client can create per-Bcc message copies from its send hook,
confirming that clean Bcc accounting needs the ESF-SMTP profile. In no configuration does a clear-text Bcc address
appear in any header.

### D.8 Replay ledger scope
The reference replay caches are client-local (extension storage in Thunderbird, web storage in Outlook), keyed by the
SHA-256 of the canonical stamp serialization, pruned at the freshness window and bounded in size. A client-side
verifier honestly provides per-installation replay detection only; cross-device and cross-user replay detection is a
server-side integration property (sections 10.2, 9).

### D.9 Interoperability discipline
A single client-neutral protocol core (constants, canonicalization, parser, verifier, policy) shared by both clients,
plus deterministic test vectors checked by both test suites, was the single most effective safeguard against protocol
drift. Client adapters contain no protocol logic. Any future integration (webmail, gateway, MTA) should consume the
same core and vectors rather than reimplementing the wire format.

### D.10 Measured hash rates behind the section 7.4 model
Measured on one mid-range Windows 11 desktop (Node.js 22, single thread, August 2026) with the reference core's own
canonical work input: the bundled pure-JavaScript SHA-256 reaches ~198,000 H/s and per-call native hashing through the
platform crypto API ~280,000 H/s, while WebCrypto's per-call async digest collapses to ~13,000 H/s - which is why the
nonce search uses the synchronous implementation and reserves WebCrypto for one-shot token derivation. Practical
consequence for defaults: at ~0.2 MH/s per thread, d=18 costs ~1.3 s and d=20 ~5 s per recipient, and the success
probability within a budget t is 1 - e^(-t * rate / 2^d). A single one-second budget therefore fails d=18 about half
the time, which is why the reference clients do not treat the budget as a deadline: they compute quietly for a
second, keep computing visibly afterwards, and only ask the user after a patience threshold. That pairing is what
makes a d=20 default work in practice - two shards reach it in ~3.5 s on average, four in ~1.7 s - and it is why
compute budgets, shard counts and baseline difficulty MUST be calibrated together rather than chosen separately. The GPU, ASIC and
Argon2id numbers in section 7.4 are estimates from public benchmarks, not measurements; producing measured values
across desktop, mobile, server and GPU hardware is the Phase 0 deliverable of section 14.

## References
- **[1]** C. Dwork and M. Naor, “Pricing via Processing or Combatting Junk Mail,” CRYPTO 1992, LNCS 740, pp. 139-147.
- **[2]** A. Back, “Hashcash - A Denial of Service Counter-Measure,” 1 August 2002.
- **[3]** C. Dwork, A. Goldberg and M. Naor, “On Memory-Bound Functions for Fighting Spam,” CRYPTO 2003.
- **[4]** J. Klensin, RFC 5321, “Simple Mail Transfer Protocol,” October 2008.
- **[5]** P. Resnick, RFC 5322, “Internet Message Format,” October 2008.
- **[6]** P. Saint-Andre, D. Crocker and M. Nottingham, RFC 6648 / BCP 178, “Deprecating the X- Prefix and Similar Constructs in Application Protocols,” June 2012.
- **[7]** G. Klyne, M. Nottingham and J. Mogul, RFC 3864, “Registration Procedures for Message Header Fields,” September 2004.
- **[8]** T. Herr and J. Levine, RFC 9989, “Domain-Based Message Authentication, Reporting, and Conformance (DMARC),” 2026.
- **[9]** Thunderbird WebExtension API Documentation, compose and messages APIs, accessed August 2026.
- **[10]** D. Crocker, T. Hansen and M. Kucherawy, RFC 6376, “DomainKeys Identified Mail (DKIM) Signatures,” September 2011.
- **[11]** S. Kitterman, RFC 7208, “Sender Policy Framework (SPF) for Authorizing Use of Domains in Email, Version 1,” April 2014.
- **[12]** K. Andersen et al., RFC 8617, “The Authenticated Received Chain (ARC) Protocol,” July 2019.
- **[13]** A. Biryukov et al., RFC 9106, “Argon2 Memory-Hard Function for Password Hashing and Proof-of-Work Applications,” September 2021.
- **[14]** J. P. Lowery, “Softwar: A Novel Theory on Power Projection and the National Strategic Significance of Bitcoin,” Master's thesis, MIT System Design and Management Program, 2023.
- **[15]** S. Nakamoto, “Bitcoin: A Peer-to-Peer Electronic Cash System,” 2008.
- **[16]** Microsoft Office Add-ins documentation: internet headers on Outlook messages, Smart Alerts (OnMessageSend) and event-based activation, accessed August 2026.
