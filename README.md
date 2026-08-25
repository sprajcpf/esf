<p align="center"><img src="assets/logo.png" alt="ESF — End Spam Forever" width="420"></p>

# End Spam Forever (ESF)

ESF – End Spam Forever aims to make email spam economically unviable through Proof-of-Work. It is an open-source
framework with integrations for multiple email clients and servers, a vendor-neutral protocol specification, an RFC
proposal, and a technical whitepaper.

> A valid ESF stamp proves that a sender spent measurable computing time for one specific recipient. It is a
> scarce-resource signal — not sender authentication, not a reputation score, and not a verdict on content. ESF
> complements SPF, DKIM and DMARC rather than replacing them.

## Documentation

| Document | |
|---|---|
| [Technical Whitepaper (Markdown)](docs/whitepaper.md) | **Canonical source.** Problem, prior art, architecture, the ESF-Stamp protocol, work profiles, policy, threat model, roadmap, RFC path, and Appendix D with the reference-client learnings |
| [Technical Whitepaper (HTML)](docs/whitepaper.html) | Rendered for reading and printing |
| [Technical Whitepaper (ODT)](docs/whitepaper.odt) | Rendered as an editable ODF text document |
| [Technical Whitepaper (DOCX)](docs/whitepaper.docx) | The original v1.0 document the Markdown was derived from |

The HTML and ODT renders are generated from the Markdown, dependency-free:
`cd clients/thunderbird && npm run whitepaper`.

## Clients

| Client | Status | Summary |
|---|---|---|
| [Thunderbird](clients/thunderbird/) | Working prototype — Manifest V3, Thunderbird 128+, verified on 153 | Mints one `X-ESF-Stamp` per recipient on send, verifies incoming stamps, green/yellow/red traffic light, 148 unit tests plus shared test vectors |

A client's protocol core (`clients/thunderbird/src/protocol/`) is deliberately free of client-specific APIs, so the
same implementation and the same [test vectors](clients/thunderbird/test/vectors.json) can be reused by other mail
clients, gateways and filters — an explicit requirement of the whitepaper (section 4.1).

## The stamp in one glance

```text
X-ESF-Stamp: v=1; alg=sha256; d=22; t=1787651400; sid=…; rid=…; mid=…; salt=…; nonce=19d82c

work  = UTF8("ESF1\n" + "alg=sha256\n" + "d=…\n" + "t=…\n" + "sid=…\n" + "rid=…\n" + "mid=…\n" +
             "salt=…\n" + "nonce=…\n")
valid iff leading_zero_bits(SHA256(work)) >= d
```

`sid`, `rid` and `mid` are salted BASE64URL digests binding the stamp to the sender, to one recipient and to the
message, so no mailbox appears in clear text. Generating a 22-bit stamp costs about 4.2 million hashes; verifying one
costs exactly one hash, whatever the sender declares. That asymmetry is the whole mechanism.

## Licence

Apache-2.0.
