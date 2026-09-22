# Echo Swarm editions

Echo Swarm ships from one reviewed source tree as two explicit builds. An edition is selected at process/build start; it cannot be switched by a caller, request header, query string, or model prompt.

## Private OAuth edition

`ECHO_SWARM_EDITION=private-oauth`

Set `ECHO_PUBLIC_BASE_URL` to the canonical HTTPS origin when the service runs
behind a reverse proxy; generated manifests and certificate links never infer a
public scheme from proxy transport when this value is present.

- This is the authoritative ECHO deployment.
- GPT invokes the official signed-in Codex CLI first. Its ChatGPT authentication stays inside that client.
- Grok and Claude invoke their signed-in official CLIs, with bounded requests and no host tools. Their subscription credentials stay inside those clients.
- Managed provider keys, including `TOGETHER_API_KEY`, resolve from approved service environment configuration. This does not grant the app permission to enumerate or export vault secrets.
- A caller-entered OpenAI API key or managed `OPENAI_API_KEY` enables paid GPT fallback after a known CLI authentication, model-access, or quota rejection. A timeout, partial answer, or uncertain failure does not trigger fallback.
- The UI accepts API keys for GPT fallback and API providers. Private browser keys are session-only and are excluded from persisted state. OAuth/session tokens are never accepted as GPT API fallback keys.
- MCP request bodies and headers cannot inject provider secrets, local-node URLs, model ids, or routing hints; the authoritative service resolves them from its approved runtime.
- GitHub OAuth device authorization is available for the Commander certificate-signature ceremony.
- Local FORGE and TEMPER seats remain private server-controlled resources.

Build it with `npm run build:private`. The default `npm run build` also builds this edition.

## Public API-key edition

`ECHO_SWARM_EDITION=public-api`

- Each caller supplies their own remote-provider API keys.
- CLI credential harvesting and OAuth device authorization are disabled.
- Private server-side remote-provider environment variables are ignored.
- Commander signing is disabled; only the authoritative private edition can carry the Commander approval.
- A public deployment should still configure `SWARM_MCP_TOKEN`, rate limiting, resource quotas, and its own hostname.

Build it with `npm run build:public`. Templates are under `public/install/public/` and intentionally contain a host placeholder until a real public deployment exists.

## Secret boundary

Neither edition commits credentials. The private edition leaves Codex authentication inside the official client and resolves other approved connections from their supported runtime stores. Caller keys travel only to the chosen deployment for the requested provider call. Certificate JSON and graphics never contain model credentials.
