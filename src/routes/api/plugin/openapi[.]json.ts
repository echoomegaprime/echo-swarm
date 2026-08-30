import { createFileRoute } from "@tanstack/react-router";
import { MODEL_IDS } from "@/lib/swarm/catalog";
import { PLUGIN_CORS as cors } from "@/lib/swarm/plugin-input";
import { SWARM_EDITION } from "@/lib/swarm/edition";

export const Route = createFileRoute("/api/plugin/openapi.json")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const origin = `${url.protocol}//${url.host}`;
        const agentParam = {
          name: "x-echo-agent",
          in: "header" as const,
          required: true,
          schema: {
            type: "string",
            enum: ["chatgpt", "grok", "claude", "codex", "gemini", "echo"],
          },
        };
        return Response.json(
          {
            openapi: "3.1.0",
            info: {
              title: "Echo Swarm",
              version: "1.4.0",
              description:
                `Echo Swarm ${SWARM_EDITION}: multi-model council, recovered Brain, Maximalist Fusion, and signed release-certificate tools. Surface identity via x-echo-agent; optional Bearer when SWARM_MCP_TOKEN is set.`,
            },
            servers: [{ url: origin, description: "Deployed Swarm origin" }],
            paths: {
              "/api/plugin/swarm": {
                post: {
                  operationId: "swarmBrief",
                  summary: "Brief the council",
                  parameters: [agentParam],
                  requestBody: {
                    required: true,
                    content: {
                      "application/json": {
                        schema: {
                          type: "object",
                          required: ["prompt"],
                          properties: {
                            prompt: { type: "string" },
                            mode: {
                              type: "string",
                              enum: ["parallel", "roundtable", "debate", "conductor", "buildheavy"],
                            },
                            host: { type: "string", enum: [...MODEL_IDS] },
                            seats: {
                              type: "array",
                              items: { type: "string", enum: [...MODEL_IDS] },
                            },
                          },
                        },
                      },
                    },
                  },
                  responses: {
                    "200": { description: "Council turns" },
                    "401": { description: "Missing agent or bearer" },
                  },
                },
              },
              "/api/plugin/stream": {
                post: {
                  operationId: "swarmStream",
                  summary: "SSE stream of council events",
                  parameters: [agentParam],
                  responses: { "200": { description: "text/event-stream" } },
                },
              },
              "/api/plugin/mcp": {
                get: {
                  operationId: "listSwarmMcp",
                  summary: "List MCP tools (requires x-echo-agent)",
                  parameters: [agentParam],
                  responses: { "200": { description: "Tool catalog" } },
                },
                post: {
                  operationId: "swarmMcpCall",
                  summary: "JSON-RPC initialize, tools/list, tools/call",
                  parameters: [agentParam],
                  requestBody: {
                    required: true,
                    content: {
                      "application/json": {
                        schema: {
                          type: "object",
                          properties: {
                            jsonrpc: { type: "string", enum: ["2.0"] },
                            id: {},
                            method: {
                              type: "string",
                              enum: ["initialize", "tools/list", "tools/call", "ping"],
                            },
                            params: { type: "object" },
                          },
                          required: ["jsonrpc", "method"],
                        },
                      },
                    },
                  },
                  responses: { "200": { description: "JSON-RPC result" } },
                },
              },
              "/api/certificate": {
                get: {
                  operationId: "getEchoSwarmCertificate",
                  summary: "Get the machine-verifiable signed release certificate",
                  responses: { "200": { description: "Certificate envelope and signature state" } },
                },
              },
              "/api/certificate.svg": {
                get: {
                  operationId: "getEchoSwarmCertificateGraphic",
                  summary: "Get the graphical SVG release certificate",
                  responses: { "200": { description: "image/svg+xml certificate" } },
                },
              },
            },
          },
          { headers: cors },
        );
      },
    },
  },
});
