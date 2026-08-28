import { createFileRoute } from "@tanstack/react-router";
import { MODEL_IDS } from "@/lib/swarm/catalog";
import { pingNodes, runSwarm } from "@/lib/swarm/engine.server";
import { authorizePluginRequest } from "@/lib/swarm/mcp-auth";
import { createCollaborationPlan, formatCollaborationResult } from "@/lib/swarm/mcp-collaboration";
import { parseSwarmBody, PLUGIN_CORS as cors } from "@/lib/swarm/plugin-input";

const tools = [
  {
    name: "swarm_collaborate",
    description:
      "Use this when the user asks to bring other models into the current chat for brainstorming, build assistance, or a consolidated report. Runs the selected live seats and returns chat-ready Markdown plus structured results; it does not apply generated files.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        task: {
          type: "string",
          minLength: 1,
          maxLength: 12000,
          description: "The bounded question, build brief, or evidence set for the invited models.",
        },
        purpose: {
          type: "string",
          enum: ["brainstorm", "build", "report"],
          description:
            "brainstorm runs parallel peers, build runs Build Heavy, and report uses the conductor.",
        },
        host: { type: "string", enum: [...MODEL_IDS] },
        seats: {
          type: "array",
          minItems: 1,
          maxItems: 18,
          uniqueItems: true,
          items: { type: "string", enum: [...MODEL_IDS] },
        },
      },
      required: ["task", "purpose"],
    },
    outputSchema: {
      type: "object",
      properties: {
        ok: { type: "boolean" },
        purpose: { type: "string", enum: ["brainstorm", "build", "report"] },
        mode: {
          type: "string",
          enum: ["parallel", "roundtable", "debate", "conductor", "buildheavy"],
        },
        turns: { type: "array", items: { type: "object" } },
        insights: { type: "array", items: { type: "object" } },
        skipped: { type: "array", items: { type: "object" } },
        error: { type: "string" },
        truncated: { type: "boolean" },
      },
      required: ["ok", "purpose", "mode", "turns", "insights", "skipped"],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: "swarm_brief",
    description:
      "Brief the Swarm council. Modes: parallel, roundtable, debate, conductor, buildheavy. Seats ride the user's OAuth/API keys plus local FORGE/TEMPER.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        mode: {
          type: "string",
          enum: ["parallel", "roundtable", "debate", "conductor", "buildheavy"],
        },
        host: { type: "string", enum: [...MODEL_IDS] },
        seats: { type: "array", items: { type: "string", enum: [...MODEL_IDS] } },
      },
      required: ["prompt"],
    },
  },
  {
    name: "swarm_ping",
    description: "Ping live labs and local FORGE/TEMPER nodes.",
    inputSchema: { type: "object", properties: {} },
  },
];

function unauthorized(auth: { status: number; error: string }, id: unknown) {
  return Response.json(
    {
      jsonrpc: "2.0",
      id: id ?? null,
      error: { code: -32001, message: auth.error },
    },
    { status: auth.status, headers: cors },
  );
}

export const Route = createFileRoute("/api/plugin/mcp")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      GET: async ({ request }) => {
        const auth = authorizePluginRequest(request);
        if (!auth.ok) {
          return Response.json(
            { ok: false, error: auth.error },
            { status: auth.status, headers: cors },
          );
        }
        return Response.json(
          {
            protocol: "mcp",
            name: "echo-swarm",
            version: "1.1.0",
            transport: "streamable-http",
            agent: auth.agent,
            tools,
          },
          { headers: cors },
        );
      },
      POST: async ({ request }) => {
        const auth = authorizePluginRequest(request);
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json(
            { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" } },
            { status: 400, headers: cors },
          );
        }
        const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
        const id = "id" in rec ? rec.id : undefined;
        const method = typeof rec.method === "string" ? rec.method : "";
        const params =
          rec.params && typeof rec.params === "object"
            ? (rec.params as Record<string, unknown>)
            : {};
        // JSON-RPC notifications (no id) — acknowledge without auth hard-fail body for init handshake
        if (method.startsWith("notifications/")) {
          if (!auth.ok) {
            return new Response(null, { status: auth.status, headers: cors });
          }
          return new Response(null, { status: 204, headers: cors });
        }

        if (!auth.ok) {
          return unauthorized(auth, id ?? null);
        }

        if (method === "initialize") {
          return Response.json(
            {
              jsonrpc: "2.0",
              id,
              result: {
                protocolVersion: "2025-03-26",
                capabilities: { tools: {} },
                serverInfo: { name: "echo-swarm", version: "1.1.0" },
                instructions:
                  "Multi-LLM council. Call swarm_ping first, then use swarm_collaborate for chat-ready brainstorming, build help, or reports; swarm_brief remains available for raw council runs.",
              },
            },
            { headers: cors },
          );
        }
        if (method === "tools/list" || method === "tools/listChanged") {
          return Response.json({ jsonrpc: "2.0", id, result: { tools } }, { headers: cors });
        }
        if (method === "ping") {
          return Response.json({ jsonrpc: "2.0", id, result: {} }, { headers: cors });
        }
        if (method === "tools/call") {
          const name = typeof params.name === "string" ? params.name : "";
          const args =
            params.arguments && typeof params.arguments === "object"
              ? (params.arguments as Record<string, unknown>)
              : {};
          if (name === "swarm_ping") {
            const ping = await pingNodes({});
            return Response.json(
              {
                jsonrpc: "2.0",
                id,
                result: {
                  content: [
                    {
                      type: "text",
                      text: JSON.stringify({ ...ping, agent: auth.agent }),
                    },
                  ],
                },
              },
              { headers: cors },
            );
          }
          if (name === "swarm_brief") {
            const input = parseSwarmBody({ ...args }, request);
            const result = await runSwarm(input);
            return Response.json(
              {
                jsonrpc: "2.0",
                id,
                result: { content: [{ type: "text", text: JSON.stringify(result) }] },
              },
              { headers: cors },
            );
          }
          if (name === "swarm_collaborate") {
            const plan = createCollaborationPlan(args.task, args.purpose);
            if ("error" in plan) {
              return Response.json(
                {
                  jsonrpc: "2.0",
                  id,
                  result: {
                    isError: true,
                    content: [{ type: "text", text: plan.error }],
                    structuredContent: {
                      ok: false,
                      purpose:
                        args.purpose === "build" || args.purpose === "report"
                          ? args.purpose
                          : "brainstorm",
                      mode:
                        args.purpose === "build"
                          ? "buildheavy"
                          : args.purpose === "report"
                            ? "conductor"
                            : "parallel",
                      turns: [],
                      insights: [],
                      skipped: [],
                      error: plan.error,
                    },
                  },
                },
                { headers: cors },
              );
            }
            const input = parseSwarmBody(
              { ...args, prompt: plan.prompt, mode: plan.mode },
              request,
            );
            const result = await runSwarm(input);
            return Response.json(
              {
                jsonrpc: "2.0",
                id,
                result: formatCollaborationResult(plan, result),
              },
              { headers: cors },
            );
          }
          return Response.json(
            { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool ${name}` } },
            { headers: cors },
          );
        }
        return Response.json(
          { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method ${method}` } },
          { headers: cors },
        );
      },
    },
  },
});
