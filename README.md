# End Spam Forever (ESF)
ESF – End Spam Forever aims to make email spam economically unviable through Proof-of-Work. It is an open-source framework with integrations for multiple email clients and servers, a vendor-neutral protocol specification, an RFC proposal, and a technical whitepaper.

## Clients

- [`clients/thunderbird/`](clients/thunderbird/) — Thunderbird MailExtension (Manifest V3, Thunderbird 128+):
  computes one `X-Email-PoW` proof per recipient on send and verifies incoming proofs. See its
  [README](clients/thunderbird/README.md) for the protocol description, threat model and setup.
