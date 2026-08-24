# Swarm

Multi-LLM council. Grok, GPT, Claude, Gemini, DeepSeek, Groq, OpenRouter, GitHub Models, local FORGE Qwen, TEMPER Qwen Image — one table, shared plugin bus, paid-sub OAuth first.

**Live:** [https://swarm-app.echo-op.com](https://swarm-app.echo-op.com)  
**Install all surfaces:** [docs/INSTALL.md](docs/INSTALL.md)

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:8080`. Connect labs, pick a mode, brief the table.

Production unit on FORGE: `echo-swarm.service` → `:8365` → Cloudflare `swarm-app.echo-op.com`.

## Modes

| Mode | What it does |
|---|---|
| Parallel | Every live seat answers at once |
| Roundtable | Seats speak in order; host keeps plugins |
| Debate | Affirm vs dissent, then rebuttal |
| Conductor | Host summons peers with `call_peer` |
| Build Heavy | Spec → implement → review → merge on the whole swarm |

## Connect

Connect → **Pull CLIs** (`gh auth token`, Claude Code, Codex, xAI env) or **GitHub device**. Paste OAuth or an API key. FORGE/TEMPER take a base URL.

Tokens stay in the browser (`localStorage`). Never commit them.

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
