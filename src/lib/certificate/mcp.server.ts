import { getReleaseCertificate } from "./server";

export const CERTIFICATE_MCP_TOOLS = [
  {
    name: "swarm_certificate_status",
    description:
      "Verify the current exact-release certificate and report the AI Builder, independent AI Certifier, and Commander digital-signature state.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "swarm_certificate_artifact",
    description:
      "Return links to the human-readable SVG certificate, printable certificate page, and machine-verifiable signed JSON envelope for the current release.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
] as const;

export function isCertificateToolName(value: string): boolean {
  return value === "swarm_certificate_status" || value === "swarm_certificate_artifact";
}

export async function handleCertificateTool(name: string, origin: string) {
  const certificate = await getReleaseCertificate();
  if (name === "swarm_certificate_status") {
    const summary = {
      ok: certificate.status !== "invalid" && certificate.status !== "unconfigured",
      status: certificate.status,
      complete: certificate.complete,
      edition: certificate.edition,
      release_sha: certificate.releaseSha,
      certificate_digest: certificate.certificateDigest,
      signatures: {
        ai_builder: certificate.signatures.builder?.verified === true,
        ai_certifier: certificate.signatures.certifier?.verified === true,
        commander: certificate.signatures.commander?.verified === true,
      },
      message: certificate.message,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(summary) }],
      structuredContent: summary,
    };
  }
  const base = origin.replace(/\/+$/u, "");
  const result = {
    ok: certificate.status !== "invalid" && certificate.status !== "unconfigured",
    status: certificate.status,
    certificate_page: `${base}/certificate`,
    svg_download: `${base}/api/certificate.svg?download=1`,
    signed_json: `${base}/api/certificate?download=1`,
    independent_verification: certificate.verificationUrl,
  };
  return {
    content: [
      { type: "text", text: JSON.stringify(result) },
      {
        type: "resource_link",
        name: "Echo Swarm signed release certificate",
        title: "Echo Swarm Certificate",
        uri: result.certificate_page,
        description: "View, print, sign, and download the current release certificate.",
        mimeType: "text/html",
      },
    ],
    structuredContent: result,
  };
}

