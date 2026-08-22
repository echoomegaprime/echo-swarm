import { createFileRoute } from "@tanstack/react-router";
import { runSwarm } from "@/lib/swarm/engine.server";
import { parseSwarmBody, PLUGIN_CORS as cors } from "@/lib/swarm/plugin-input";
import type { SwarmEvent } from "@/lib/swarm/types";

export const Route = createFileRoute("/api/plugin/stream")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      POST: async ({ request }) => {
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
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            const send = (event: SwarmEvent) => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            };
            try {
              const result = await runSwarm(input, send);
              send({ type: "done", result });
            } catch (err) {
              send({
                type: "done",
                result: {
                  ok: false,
                  error: err instanceof Error ? err.message : "Stream failed.",
                },
              });
            } finally {
              controller.close();
            }
          },
        });
        return new Response(stream, {
          headers: {
            ...cors,
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});
