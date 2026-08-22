import { createFileRoute } from "@tanstack/react-router";
import { MODEL_IDS } from "@/lib/swarm/catalog";
import { PLUGIN_CORS as cors } from "@/lib/swarm/plugin-input";

export const Route = createFileRoute("/api/plugin/openapi.json")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const origin = `${url.protocol}//${url.host}`;
        return Response.json(
          {
            openapi: "3.1.0",
            info: {
              title: "Swarm",
              version: "1.0.0",
              description:
                "Multi-lab LLM council. POST a brief. OAuth rides paid subs. FORGE and TEMPER are local metal.",
            },
            servers: [{ url: origin }],
            paths: {
              "/api/plugin/swarm": {
                post: {
                  operationId: "swarmBrief",
                  summary: "Brief the council",
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
                  },
                },
              },
              "/api/plugin/stream": {
                post: {
                  operationId: "swarmStream",
                  summary: "SSE stream of council events",
                  responses: { "200": { description: "text/event-stream" } },
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
