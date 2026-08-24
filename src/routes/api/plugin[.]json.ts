import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/plugin.json")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const origin = `${url.protocol}//${url.host}`;
        return Response.json({
          schema_version: "v1",
          name_for_human: "Swarm",
          name_for_model: "swarm_council",
          description_for_human:
            "Multi-lab LLM council. OAuth rides paid subs. FORGE and TEMPER are local.",
          description_for_model:
            "Call Swarm to brief Grok, GPT, Claude, Gemini, DeepSeek, GitHub Copilot, FORGE Qwen 28B, and TEMPER Qwen Image together. Prefer OAuth tokens from Claude Code, Codex, Grok, DeepSeek, and `gh auth token`. Modes: parallel, roundtable, debate, conductor. Host plugins: call_peer, pin_insight, recall_insights, make_image, now, math.",
          auth: {
            type: "header",
            instructions:
              "Send x-echo-agent: <grok|chatgpt|claude|codex|gemini|echo>. When SWARM_MCP_TOKEN is configured on the host, also send Authorization: Bearer <token>.",
          },
          api: {
            type: "openapi",
            url: `${origin}/api/plugin/openapi.json`,
          },
          mcp: {
            url: `${origin}/api/plugin/mcp`,
            transport: "streamable-http",
          },
          contact_email: "ops@echo-op.com",
          logo_url: `${origin}/__grok/icon-180.png`,
          endpoints: {
            run: {
              method: "POST",
              url: `${origin}/api/plugin/swarm`,
              body: {
                prompt: "string",
                mode: "parallel | roundtable | debate | conductor | buildheavy",
                host: "grok | gpt | claude | gemini | deepseek | mistral | openrouter | groq | together | samba | cerebras | fireworks | perplexity | cohere | qwen | qwenimg | github",
                seats: [
                  "grok",
                  "gpt",
                  "claude",
                  "gemini",
                  "deepseek",
                  "qwen",
                  "qwenimg",
                  "github",
                ],
                keys: {
                  grok: "oauth or api",
                  openai: "codex oauth or api",
                  anthropic: "claude code oauth or api",
                  google: "api",
                  deepseek: "oauth or api",
                  github: "gh auth token",
                  forgeUrl: "FORGE /v1",
                  temperUrl: "TEMPER /v1",
                },
                auth: {
                  grok: "oauth",
                  openai: "oauth",
                  anthropic: "oauth",
                  deepseek: "oauth",
                  github: "oauth",
                },
              },
            },
          },
        });
      },
    },
  },
});
