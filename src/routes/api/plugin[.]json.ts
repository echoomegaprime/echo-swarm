import { createFileRoute } from "@tanstack/react-router";
import { editionCredentialSummary } from "@/lib/swarm/plugin-input";
import { publicOriginForRequest } from "@/lib/swarm/public-origin";

export const Route = createFileRoute("/api/plugin.json")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = publicOriginForRequest(request);
        const edition = editionCredentialSummary();
        return Response.json({
          schema_version: "v1",
          name_for_human: "Swarm",
          name_for_model: "swarm_council",
          description_for_human:
            "Interactive multi-lab LLM council with recovered Echo Swarm Brain, Maximalist Fusion, voice chat, and a graphical release certificate signed by the AI Builder, independent AI Certifier, and Commander.",
          description_for_model:
            "Call swarm_convene for visible multi-model collaboration, swarm_brain_* for recovered sovereign routes, swarm_maximalist_* for deep fused output, and swarm_certificate_* to verify or download the signed exact-release certificate. Certification-purpose model output is advisory; official status comes only from the verified certificate envelope.",
          edition,
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
          certificate: {
            page: `${origin}/certificate`,
            json: `${origin}/api/certificate`,
            svg: `${origin}/api/certificate.svg`,
          },
          endpoints: {
            run: {
              method: "POST",
              url: `${origin}/api/plugin/swarm`,
              body: {
                prompt: "string",
                mode: "parallel | roundtable | debate | conductor | buildheavy",
                host: "grok | gpt | claude | gemini | deepseek | mistral | openrouter | groq | together | samba | cerebras | fireworks | perplexity | cohere | qwen | qwenimg | github",
                seats: ["grok", "gpt", "claude", "gemini", "deepseek", "qwen", "qwenimg", "github"],
                credential_policy: edition,
              },
            },
          },
        });
      },
    },
  },
});
