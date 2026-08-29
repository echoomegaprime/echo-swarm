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
            "Interactive multi-lab LLM council with the recovered Echo Swarm Brain, asynchronous Maximalist Fusion output, and voice-enabled chat. OAuth rides paid subs where supported. Free-tier, FORGE, and TEMPER seats are supported.",
          description_for_model:
            "Call swarm_convene to bring Grok, GPT, Claude, Gemini, DeepSeek, GitHub Copilot, free-tier providers, FORGE Qwen3.8 27B, and TEMPER Qwen Image into the current chat for brainstorm, debate, build, review, validate, certify, plan, or report work. Call swarm_brain_* for the separately recovered sovereign Trinity and hybrid routes. For deep asynchronous fusion, call swarm_maximalist_health, swarm_maximalist_start, then swarm_maximalist_result; completed output preserves dissent, uncertainty, confidence, and provenance. Prefer OAuth tokens from Claude Code, Codex, Grok, DeepSeek, and `gh auth token` where supported. Certification-purpose output is advisory unless an exact-SHA CertForge and Certification Forge receipt is supplied.",
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
                seats: ["grok", "gpt", "claude", "gemini", "deepseek", "qwen", "qwenimg", "github"],
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
