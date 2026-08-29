# Install Echo Swarm Brain + Fusion on Grok, GPT, Claude, Codex, Gemini

Repo: [echoomegaprime/echo-swarm](https://github.com/echoomegaprime/echo-swarm)

Canonical public origin (Cloudflare tunnel → FORGE `:8365`):

**`https://swarm-app.echo-op.com`**

Note: `swarm.echo-op.com` is the separate swarm-_monitor_ product. `echo-swarm.echo-op.com` / `council.echo-op.com` are owned by other remote-tunnel ingresses — do not point clients at them for this council MCP.

Icon (Grok requirement): [`public/__grok/icon-180.png`](../public/__grok/icon-180.png) — 180×180 PNG.

Auth on plugin/MCP routes:

| Header                          | Required                        | Values                                                           |
| ------------------------------- | ------------------------------- | ---------------------------------------------------------------- |
| `x-echo-agent`                  | **yes**                         | `grok` \| `chatgpt` \| `claude` \| `codex` \| `gemini` \| `echo` |
| `Authorization: Bearer <token>` | when host has `SWARM_MCP_TOKEN` | same token as server env                                         |

Lab keys for briefs stay on the request (`x-grok-key`, `x-openai-key`, …) or in the JSON body — never commit them.

```bash
git clone https://github.com/echoomegaprime/echo-swarm.git
cd echo-swarm
npm install
# optional local: npm run dev  → http://localhost:8080
```

## 1. Grok (xAI)

### GitHub app (code access)

1. Open [Grok (by xAI)](https://github.com/apps/grok-by-xai/installations/new)
2. Grant **echoomegaprime/echo-swarm**
3. In Grok: connect GitHub if it is not already on this account

### MCP (remote HTTP)

- URL: `https://swarm-app.echo-op.com/api/plugin/mcp`
- Header: `x-echo-agent: grok`
- Icon: `https://swarm-app.echo-op.com/__grok/icon-180.png`
- Copy [public/install/grok.json](../public/install/grok.json)

Probe: `swarm_ping`, `swarm_convene`, and `swarm_maximalist_health`. After the recovered brain service is routed beside the app, also probe `swarm_brain_health`.

**Manual step if Grok custom-connector UI needs browser automation:** paste the URL + header + icon in the Grok connector dialog (no CLI equivalent on FORGE).

## 2. GPT (ChatGPT / Custom GPT Actions)

### GitHub app

1. Open [ChatGPT Codex Connector](https://github.com/apps/chatgpt-codex-connector/installations/new)
2. Grant **echoomegaprime/echo-swarm**

### Custom GPT Action

1. ChatGPT → GPTs → create / edit → **Actions**
2. Import OpenAPI from `public/install/chatgpt.openapi.json` (or live `https://swarm-app.echo-op.com/api/plugin/openapi.json`)
3. Server URL = `https://swarm-app.echo-op.com`
4. Auth: API key header `x-echo-agent` = `chatgpt`

### ChatGPT MCP / Developer Mode

- Connector URL: `https://swarm-app.echo-op.com/api/plugin/mcp`
- Header: `x-echo-agent: chatgpt`

## 3. Claude (Desktop, Code, Cowork)

### GitHub app

1. Open [Claude](https://github.com/apps/claude/installations/new)
2. Grant **echoomegaprime/echo-swarm**

### Claude Desktop

Edit `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "echo-swarm": {
      "type": "http",
      "url": "https://swarm-app.echo-op.com/api/plugin/mcp",
      "headers": {
        "x-echo-agent": "claude"
      }
    }
  }
}
```

Restart Claude Desktop. Tools include **swarm_ping**, **swarm_convene**, **swarm_brain_**_, and \**swarm_maximalist_**_.

Copy-ready file: [public/install/claude_desktop.json](../public/install/claude_desktop.json).

### Claude Code

Committed [`.mcp.json`](../.mcp.json) uses native `type: "http"` against the public tunnel (no `mcp-remote` shim).

```bash
claude mcp add --transport http echo-swarm https://swarm-app.echo-op.com/api/plugin/mcp \
  --header "x-echo-agent: claude"
```

Or rely on the project `.mcp.json` when the working directory is this repo.

## 4. Codex CLI

Committed [`.codex/config.toml`](../.codex/config.toml) and/or user `~/.codex/config.toml`:

```toml
[mcp_servers.echo-swarm]
url = "https://swarm-app.echo-op.com/api/plugin/mcp"
http_headers = { "x-echo-agent" = "codex" }
tool_timeout_sec = 120
```

```bash
codex mcp list
# or
codex mcp add echo-swarm --url https://swarm-app.echo-op.com/api/plugin/mcp
```

If `SWARM_MCP_TOKEN` is set on the host, add:

```toml
bearer_token_env_var = "SWARM_MCP_TOKEN"
```

## 5. Gemini CLI

Docs (2026): Gemini reads `mcpServers` from `~/.gemini/settings.json` or project `.gemini/settings.json`. Current CLI accepts `type`/`url` (and still understands `httpUrl`). **Folder trust is required** — without `~/.gemini/trustedFolders.json` marking the cwd `TRUST_FOLDER`, Gemini disables MCP with “folder is untrusted”.

Committed [`.gemini/settings.json`](../.gemini/settings.json):

```json
{
  "mcpServers": {
    "echo-swarm": {
      "url": "https://swarm-app.echo-op.com/api/plugin/mcp",
      "type": "http",
      "headers": {
        "x-echo-agent": "gemini"
      }
    }
  }
}
```

```bash
# trust this tree (once)
# ~/.gemini/trustedFolders.json → { "/ABS/PATH/TO/echo-swarm": "TRUST_FOLDER" }

gemini mcp add --transport http echo-swarm https://swarm-app.echo-op.com/api/plugin/mcp \
  --header "x-echo-agent: gemini" --scope user
gemini mcp list
# expect: ✓ echo-swarm ... Connected
```

**Blocked without API auth:** interactive `gemini -p` needs `GEMINI_API_KEY` / Vertex / GCA. MCP registration itself does not.

## 6. Echo Desktop (echoomegaprime.com / echo.echo-op.com)

Marketplace signed-manifest install is tracked separately (`echoomegaprime-com-marketplace-plugin-signing`). Until that signing blocker lands, register Swarm as a remote MCP/OpenAPI plugin using `/api/plugin.json` + `/api/plugin/mcp` with `x-echo-agent: echo`.

## Authentication and provider seats

Echo Swarm prefers already-authorized user subscriptions where the provider exposes a usable OAuth/CLI credential:

| Seat                    | Preferred authentication                                                              | Fallback                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| GPT / Codex             | Codex or ChatGPT OAuth from the local Codex login                                     | OpenAI API key                                                                               |
| Claude                  | Claude Code OAuth/setup token                                                         | Anthropic API key                                                                            |
| Grok                    | xAI OAuth token when available                                                        | xAI API key                                                                                  |
| DeepSeek                | DeepSeek OAuth token when available                                                   | DeepSeek API key                                                                             |
| GitHub Models / Copilot | `gh auth token` or GitHub device OAuth                                                | GitHub token                                                                                 |
| Gemini                  | Google AI Studio key in the current runtime                                           | Gemini CLI MCP registration controls the plugin connection, not the provider seat credential |
| Free / local            | Provider free tiers where enabled; FORGE and TEMPER local OpenAI-compatible endpoints | API keys for the selected router/speed lab                                                   |

Provider credentials are never committed. The app does not claim OAuth for a provider whose current API path only supports a key.

## Smoke check

```bash
curl -sS https://swarm-app.echo-op.com/api/plugin/mcp \
  -H 'content-type: application/json' \
  -H 'x-echo-agent: claude' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"swarm_ping","arguments":{}}}'
```

Expect JSON-RPC `result.content[0].text` with `forge: true` when the local FORGE OpenAI-compatible seat is up.

## Run the console

```bash
npm run dev      # UI + plugin/MCP on :8080 (prod unit uses :8365)
npm test
```
