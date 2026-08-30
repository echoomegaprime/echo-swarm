# Signed release certificates

`/certificate` is the human-readable certificate ceremony and `/api/certificate` is its machine-readable envelope. `/api/certificate.svg` renders the downloadable graphic directly from that envelope.

The certificate is complete only when all three independent checks pass:

1. **AI Builder** — the exact release SHA and Certification Forge receipt digest are signed by an Ed25519 builder key stored outside the repository.
2. **AI Certifier** — ECHO Certification Forge's original Ed25519 receipt is fetched from its public verification URL and verified locally. Its `PRODUCTION_READY`, `COMPLETE`, expiry, key id, and evidence Merkle root are fail-closed gates.
3. **Commander** — the allowlisted Commander completes GitHub OAuth device authorization, explicitly approves the displayed exact SHA, and signs the certificate digest with a non-extractable P-256 browser key. The server verifies both the GitHub identity and ES256 signature before persisting it.

The SVG embeds the public certificate envelope as metadata, but appearance is never treated as proof. Independent verification uses the JSON envelope, public keys, detached signatures, exact SHA, and official Certification Forge receipt.

The Commander private key is generated non-extractable by Web Crypto and stored as a structured-clone `CryptoKey` in IndexedDB. It is not uploaded. Losing the browser profile loses that private key; a new authorized ceremony can replace the signature for the same certificate.

Required private-deployment settings are documented in `.env.private.example`. Never put the builder private key in the repository or deployment archive.

