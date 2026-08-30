import { createFileRoute } from "@tanstack/react-router";
import {
  getReleaseCertificate,
  submitCommanderSignature,
} from "@/lib/certificate/server";
import type { CommanderSignatureSubmission } from "@/lib/certificate/types";

const PUBLIC_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Cache-Control": "no-store",
};

function oauthBearer(request: Request): string {
  const value = request.headers.get("authorization")?.trim() ?? "";
  return value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : "";
}

function errorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "certificate_signature_failed";
  const status =
    message.includes("oauth") || message.includes("identity")
      ? 401
      : message.includes("not_allowed") || message.includes("private_edition")
        ? 403
        : 400;
  return Response.json({ ok: false, error: message }, { status, headers: PUBLIC_HEADERS });
}

export const Route = createFileRoute("/api/certificate")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: PUBLIC_HEADERS }),
      GET: async ({ request }) => {
        const certificate = await getReleaseCertificate();
        const download = new URL(request.url).searchParams.get("download") === "1";
        return Response.json(certificate, {
          headers: {
            ...PUBLIC_HEADERS,
            ...(download
              ? {
                  "Content-Disposition": `attachment; filename="echo-swarm-certificate-${certificate.releaseSha.slice(0, 12)}.json"`,
                }
              : {}),
          },
        });
      },
      POST: async ({ request }) => {
        try {
          const raw: unknown = await request.json();
          if (!raw || typeof raw !== "object") throw new Error("commander_submission_invalid");
          const certificate = await submitCommanderSignature(
            raw as CommanderSignatureSubmission,
            oauthBearer(request),
          );
          return Response.json({ ok: true, certificate }, { headers: PUBLIC_HEADERS });
        } catch (error) {
          return errorResponse(error);
        }
      },
    },
  },
});

