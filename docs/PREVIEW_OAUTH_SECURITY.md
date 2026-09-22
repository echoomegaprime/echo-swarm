# Preview OAuth credential boundary

## Current source contract

- Preview and deployed OAuth secrets are resolved only from runtime environment
  variables.
- The repository contains public client metadata, not a client secret.
- Deployed credentials are treated as an atomic id/secret pair and are never
  mixed with preview credentials.
- When sign-in is enabled but the selected credential pair is incomplete,
  server authorization fails closed and does not use the shared development
  user.
- `scripts/auth-secret-boundary.test.mjs` protects this contract.

## Remediation status

A preview OAuth credential that predated this review was removed from the
current source tree. Its value is intentionally not reproduced in this record.
The current tree passes a redacted Gitleaks directory scan.

Removal from the current tree does not revoke a previously exposed credential
and does not remove it from existing Git history. Before enabling preview OAuth
for production use, the credential owner must:

1. revoke or rotate the affected broker credential;
2. inject the replacement through the approved runtime secret store;
3. verify a real preview sign-in and callback without logging the secret;
4. decide whether coordinated history remediation is required under repository
   ownership and non-force-update policy; and
5. rerun current-tree, artifact, and hosted secret scanning.

Until those checks pass, preview OAuth activation remains blocked. This record
does not claim revocation, hosted scan success, certification, or production
readiness.
