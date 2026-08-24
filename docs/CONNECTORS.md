# Connectors — Grok, GPT, Claude, Codex, Gemini

Shared source: [echoomegaprime/echo-swarm](https://github.com/echoomegaprime/echo-swarm). Canonical HTTPS origin: `https://swarm-app.echo-op.com`.

## GitHub apps (code)

| Model | Connector | Action |
| --- | --- | --- |
| Grok | [Grok (by xAI)](https://github.com/apps/grok-by-xai) | [Install](https://github.com/apps/grok-by-xai/installations/new) on `echo-swarm` |
| ChatGPT / Codex | [ChatGPT Codex Connector](https://github.com/apps/chatgpt-codex-connector) | [Install](https://github.com/apps/chatgpt-codex-connector/installations/new) on `echo-swarm` |
| Claude | [Claude](https://github.com/apps/claude) | [Install](https://github.com/apps/claude/installations/new) on `echo-swarm` |

## Runtime MCP

| Client | Transport | Caller header |
| --- | --- | --- |
| Grok | HTTP `/api/plugin/mcp` | `x-echo-agent: grok` |
| GPT | Custom GPT Action + MCP | `x-echo-agent: chatgpt` |
| Claude Desktop / Code | HTTP `type: http` | `x-echo-agent: claude` |
| Codex | Streamable HTTP `url` in `config.toml` | `x-echo-agent: codex` |
| Gemini CLI | `httpUrl` in `settings.json` | `x-echo-agent: gemini` |

Install walkthrough: [INSTALL.md](./INSTALL.md)
