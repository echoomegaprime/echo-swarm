import { createFileRoute } from "@tanstack/react-router";
import { writeSwarmFiles } from "@/lib/swarm/apply.server";
import { PLUGIN_CORS as cors } from "@/lib/swarm/plugin-input";

export const Route = createFileRoute("/api/plugin/apply")({
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
        const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
        const slug = typeof rec.slug === "string" ? rec.slug : "session";
        const filesRaw = Array.isArray(rec.files) ? rec.files : [];
        const files = filesRaw
          .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
          .map((f) => ({
            path: typeof f.path === "string" ? f.path : "",
            content: typeof f.content === "string" ? f.content : "",
          }))
          .filter((f) => f.path && f.content);
        const result = await writeSwarmFiles(files, slug);
        return Response.json(result, { headers: cors, status: result.ok ? 200 : 400 });
      },
    },
  },
});
