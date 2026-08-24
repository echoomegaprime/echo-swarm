import { createFileRoute } from "@tanstack/react-router";
import { MODEL_IDS } from "@/lib/swarm/catalog";
import { runSwarm } from "@/lib/swarm/engine.server";
import { authorizePluginRequest } from "@/lib/swarm/mcp-auth";
import { parseSwarmBody, PLUGIN_CORS as cors } from "@/lib/swarm/plugin-input";

export const Route = createFileRoute("/api/plugin/swarm")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      GET: async () =>
        Response.json(
          {
            name: "Swarm",
            description:
              "POST a brief. SSE at /api/plugin/stream. MCP at /api/plugin/mcp. OpenAPI at /api/plugin/openapi.json.",
            body: {
              prompt: "string",
              mode: "parallel | roundtable | debate | conductor | buildheavy",
              host: MODEL_IDS.join(" | "),
              seats: "ModelId[]",
            },
            auth: {
              headers: ["x-echo-agent", "Authorization: Bearer <SWARM_MCP_TOKEN when set>"],
            },
          },
          { headers: cors },
        ),
      POST: async ({ request }) => {
        const auth = authorizePluginRequest(request);
        if (!auth.ok) {
          return Response.json(
            { ok: false, error: auth.error },
            { status: auth.status, headers: cors },
          );
        }
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400, headers: cors });
        }
        if (!body || typeof body !== "object") {
          return Response.json({ ok: false, error: "Expected object" }, { status: 400, headers: cors });
        }
        const input = parseSwarmBody(body as Record<string, unknown>, request);
        const result = await runSwarm(input);
        return Response.json({ ...result, agent: auth.agent }, { headers: cors });
      },
    },
  },
});
