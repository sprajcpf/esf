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
| [Technical Whitepaper (Markdown)](docs/ESF_End_Spam_Forever_Technical_Whitepaper.md) | **Canonical source.** Problem, prior art, architecture, the ESF-Stamp protocol, work profiles, policy, threat model, roadmap, RFC path, and Appendix D with the reference-client learnings |
| [Technical Whitepaper (HTML)](docs/ESF_End_Spam_Forever_Technical_Whitepaper.html) | Rendered for reading and printing |
| [Technical Whitepaper (ODT)](docs/ESF_End_Spam_Forever_Technical_Whitepaper.odt) | Rendered as an editable ODF text document |
| [Technical Whitepaper (DOCX)](docs/ESF_End_Spam_Forever_Technical_Whitepaper.docx) | Rendered as a Word document |
| [Adoption Roadmap](docs/ESF_End_Spam_Forever_Adoption_Roadmap.md) ([HTML](docs/ESF_End_Spam_Forever_Adoption_Roadmap.html), [ODT](docs/ESF_End_Spam_Forever_Adoption_Roadmap.odt), [DOCX](docs/ESF_End_Spam_Forever_Adoption_Roadmap.docx)) | How ESF gets from working prototype to ecosystem adoption: ordered stages with explicit exit criteria, no dates |

All renders are generated from the Markdown and then checked against it, dependency-free:
`cd clients/thunderbird && npm run docs`. The check compares headings, tables, code blocks and key
wording, so a format cannot silently drift out of sync again.

## Clients

| Client | Status | Summary |
|---|---|---|
| [Thunderbird](clients/thunderbird/) | Working prototype — MailExtension, Manifest V3, Thunderbird 128+, verified on 153 | Mints one stamp per recipient in `compose.onBeforeSend`, verifies on display, traffic light on the message button, 148 unit tests |
| [Outlook](clients/outlook/) | Working prototype — Office.js add-in, Mailbox 1.12+ (Web, new and classic Windows, Mac) | Mints stamps in `OnMessageSend` before Outlook releases the mail, reads stamps from the internet-header block, traffic light in the task pane, 22 unit tests |

Both clients run the **same protocol core** — `clients/thunderbird/src/protocol/`, which is free of any client API
usage — and both check the same [test vectors](clients/thunderbird/test/vectors.json), so a stamp minted by one
verifies in the other. The whitepaper asks for exactly that (section 4.1): one reusable core and one set of vectors
for every client, gateway and filter, with no client-specific protocol variants.

Platform notes worth knowing before picking a client: Outlook's send hook needs Mailbox requirement set 1.12, is not
available on Outlook mobile at all, and the automatic variant needs admin deployment; classic Outlook on Windows runs
event handlers in a JavaScript-only runtime, so that entry point ships as a self-contained bundle. Thunderbird has no
such restriction, but folds all stamps of a message into one header field because its `customHeaders` API keeps only
one field per name. Details are in each client's README and in the whitepaper's Appendix D.

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
