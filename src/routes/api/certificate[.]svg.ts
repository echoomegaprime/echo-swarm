import { createFileRoute } from "@tanstack/react-router";
import { getReleaseCertificate } from "@/lib/certificate/server";
import { renderCertificateSvg } from "@/lib/certificate/svg";

export const Route = createFileRoute("/api/certificate.svg")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const certificate = await getReleaseCertificate();
        const download = new URL(request.url).searchParams.get("download") === "1";
        return new Response(renderCertificateSvg(certificate), {
          headers: {
            "Content-Type": "image/svg+xml; charset=utf-8",
            "Cache-Control": "no-store",
            "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
            ...(download
              ? {
                  "Content-Disposition": `attachment; filename="echo-swarm-certificate-${certificate.releaseSha.slice(0, 12)}.svg"`,
                }
              : {}),
          },
        });
      },
    },
  },
});

