# Swarm

Interactive multi-LLM council. Grok, GPT, Claude, Gemini, DeepSeek, Groq, OpenRouter, GitHub Models, free-tier providers, local FORGE Qwen3.8 27B (abliterated, 256K context), and TEMPER Qwen Image — one visible table, shared plugin bus, paid-sub OAuth first.

**Live:** [https://swarm-app.echo-op.com](https://swarm-app.echo-op.com)  
**Install all surfaces:** [docs/INSTALL.md](docs/INSTALL.md)

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:8080`. Connect labs, select a purpose and mode, brief the table, and optionally enable Fusion and voice readback.

## Interactive chat

- Purpose controls bring models into the visible conversation for brainstorm, debate, build, review, evidence validation, advisory certification review, planning, and reporting.
- Every seat remains independently attributable and can be replied to, copied, or read aloud.
- **Fusion on** sends the completed council evidence to the loopback Echo Fusion Worker and inserts the fused result back into the same chat as a separate `MAXIMALIST_RECONSTRUCTED` message.
- The microphone fills the composer through the browser Web Speech API. Readback can speak any reply or automatically speak completed fused output when the browser exposes speech synthesis.
- “Certify” is an evidence-gated advisory review. It never claims to replace CertForge plus the Certification Forge GitHub App exact-SHA receipts.

Production unit on FORGE: `echo-swarm.service` → `:8365` → Cloudflare `swarm-app.echo-op.com`.

## Modes

| Mode        | What it does                                         |
| ----------- | ---------------------------------------------------- |
| Parallel    | Every live seat answers at once                      |
| Roundtable  | Seats speak in order; host keeps plugins             |
| Debate      | Affirm vs dissent, then rebuttal                     |
| Conductor   | Host summons peers with `call_peer`                  |
| Build Heavy | Spec → implement → review → merge on the whole swarm |

## Connect

Connect → **Pull CLIs** (`gh auth token`, Claude Code, Codex, xAI env) or **GitHub device**. Paste OAuth or an API key. FORGE/TEMPER take a base URL.

OAuth is preferred for GPT/Codex, Claude, Grok, DeepSeek, and GitHub when the corresponding local login or environment token exists. Gemini currently uses Google AI Studio API-key authentication in this runtime. Free-tier and local seats remain available through Mistral, Groq, OpenRouter/GitHub Models where the account permits them, and FORGE/TEMPER. Tokens stay in the browser (`localStorage`). Never commit them.

## Host plugin

Other chats POST the same contract:

- Manifest: `/api/plugin.json`
- OpenAPI: `/api/plugin/openapi.json`
- Run: `POST /api/plugin/swarm`
- SSE: `POST /api/plugin/stream`
- MCP: `/api/plugin/mcp`
- Apply files: `POST /api/plugin/apply`
- Icon: `/__grok/icon-180.png`

Auth headers: **`x-echo-agent: <surface>`** (required). When `SWARM_MCP_TOKEN` is set on the host, also `Authorization: Bearer <token>`.

Lab key headers: `x-grok-key`, `x-openai-key`, `x-anthropic-key`, `x-github-token`, `x-forge-url`, `x-temper-url`, plus the other lab keys.

### Maximalist Fusion Brain

The MCP endpoint also exposes the asynchronous `MAXIMALIST_RECONSTRUCTED` workflow backed by the loopback Fusion worker. The clean FORGE source tree for that worker and its engine is preserved at [`systems/echo_maximalist_fusion`](systems/echo_maximalist_fusion), bound to its source Git SHA and per-file hashes:

1. `swarm_maximalist_health` verifies the worker profile and seat registry.
2. `swarm_maximalist_start` starts a bounded deep-fusion run and returns a `run_id` immediately.
3. `swarm_maximalist_result` polls that run and returns a chat-ready fused answer with confidence, preserved dissent, unresolved uncertainty, and structured provenance.
4. `swarm_maximalist_resume` resumes persisted run state after a worker interruption.

Set `FUSION_WORKER_BASE` to the worker's loopback origin (default `http://127.0.0.1:8157`). Non-loopback origins and caller-supplied worker addresses are rejected.

### Recovered Echo Swarm Brain

The HAMMER-recovered sovereign brain is preserved under [`systems/echo_swarm_brain`](systems/echo_swarm_brain) and exposed as a separate fixed-loopback MCP family:

1. `swarm_brain_health`
2. `swarm_brain_think`
3. `swarm_brain_trinity_consult`
4. `swarm_brain_trinity_decide`
5. `swarm_brain_hybrid`

Set `SWARM_BRAIN_BASE` to its loopback origin (default `http://127.0.0.1:8260`). The recovered 3.2.0 source retains its original comic-research and CGC-grading specialization, Postgres artifact dependency, and ALPHA model dependency; the plugin does not relabel it as the newer Maximalist Fusion Worker.

## Build Heavy artifacts

Implementers write path-tagged fences:

````
```ts src/lib/foo.ts
export const x = 1
```
````

**Zip** downloads them. **Apply** writes `/workspace/swarm-out/<session>/`.

## Stack

TanStack Start, Vite, Zustand, Tailwind. Node 22+.

Echo Prime Technologies.
