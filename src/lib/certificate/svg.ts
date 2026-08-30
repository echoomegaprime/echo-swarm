import { stableJson } from "./canonical";
import type { DigitalSignatureBlock, ReleaseCertificateSnapshot } from "./types";

function xml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function short(value: string | undefined, length = 24): string {
  if (!value) return "—";
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

function date(value: string | undefined): string {
  if (!value) return "Awaiting signature";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
        timeZoneName: "short",
      });
}

function signerCard(
  x: number,
  title: string,
  signature: DigitalSignatureBlock | undefined,
  pendingName: string,
): string {
  const ok = signature?.verified === true;
  const accent = ok ? "#54E6A7" : "#E6BE54";
  return `<g transform="translate(${x} 650)">
    <rect width="410" height="190" rx="18" fill="#11131B" stroke="${accent}" stroke-opacity=".55"/>
    <circle cx="52" cy="52" r="27" fill="none" stroke="${accent}" stroke-width="2"/>
    <path d="M40 52l8 8 17-19" fill="none" stroke="${accent}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="${ok ? 1 : 0.2}"/>
    <text x="92" y="44" class="label">${xml(title)}</text>
    <text x="92" y="69" class="status" fill="${accent}">${ok ? "DIGITALLY VERIFIED" : "SIGNATURE REQUIRED"}</text>
    <text x="28" y="112" class="name">${xml(signature?.name ?? pendingName)}</text>
    <text x="28" y="139" class="detail">${xml(signature ? `${signature.algorithm} · ${short(signature.keyId, 31)}` : "No signature recorded")}</text>
    <text x="28" y="165" class="detail">${xml(date(signature?.signedAt))}</text>
  </g>`;
}

export function renderCertificateSvg(certificate: ReleaseCertificateSnapshot): string {
  const receipt = certificate.officialReceipt?.payload;
  const metadata = xml(stableJson(certificate));
  const status = certificate.complete ? "CERTIFIED · FULLY SIGNED" : certificate.status.replaceAll("_", " ").toUpperCase();
  const statusColor = certificate.complete ? "#54E6A7" : "#E6BE54";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000" role="img" aria-labelledby="title description">
  <title id="title">Echo Swarm Certificate of Certified Release</title>
  <desc id="description">A machine-verifiable release certificate with AI Builder, independent AI Certifier, and Commander digital signature status.</desc>
  <metadata>${metadata}</metadata>
  <defs>
    <radialGradient id="glow" cx="50%" cy="0%" r="90%"><stop offset="0" stop-color="#5738A6" stop-opacity=".36"/><stop offset="1" stop-color="#090A0F" stop-opacity="0"/></radialGradient>
    <linearGradient id="line" x1="0" x2="1"><stop stop-color="#8B5CF6"/><stop offset=".5" stop-color="#54E6A7"/><stop offset="1" stop-color="#D8B4FE"/></linearGradient>
    <filter id="shadow"><feDropShadow dx="0" dy="18" stdDeviation="28" flood-color="#000" flood-opacity=".55"/></filter>
    <style>
      .serif{font-family:Georgia,'Times New Roman',serif}.sans{font-family:Inter,Arial,sans-serif}.mono{font-family:'IBM Plex Mono',Consolas,monospace}
      .eyebrow{font:600 17px Inter,Arial,sans-serif;letter-spacing:5px;fill:#A8AABA}.title{font:400 74px Georgia,'Times New Roman',serif;fill:#F6F3FF}.subtitle{font:400 27px Georgia,'Times New Roman',serif;font-style:italic;fill:#CBC6D9}.label{font:600 15px Inter,Arial,sans-serif;letter-spacing:2px;fill:#D7D3E5}.status{font:700 13px Inter,Arial,sans-serif;letter-spacing:1.5px}.name{font:500 22px Georgia,'Times New Roman',serif;fill:#F4F0FB}.detail{font:400 14px 'IBM Plex Mono',Consolas,monospace;fill:#9B9DAD}.hash{font:400 18px 'IBM Plex Mono',Consolas,monospace;fill:#D8D4E4}.small{font:400 13px Inter,Arial,sans-serif;fill:#8E90A0}
    </style>
  </defs>
  <rect width="1600" height="1000" fill="#090A0F"/>
  <rect width="1600" height="1000" fill="url(#glow)"/>
  <rect x="48" y="48" width="1504" height="904" rx="30" fill="#0C0E14" stroke="#50475E" filter="url(#shadow)"/>
  <rect x="66" y="66" width="1468" height="868" rx="22" fill="none" stroke="url(#line)" stroke-width="2"/>
  <path d="M112 118h220M1268 118h220M112 882h220M1268 882h220" stroke="#716880" stroke-width="1"/>
  <text x="800" y="143" text-anchor="middle" class="eyebrow">ECHO OMEGA PRIME · EXACT-SHA RELEASE</text>
  <text x="800" y="245" text-anchor="middle" class="title">Certificate of Certified Release</text>
  <text x="800" y="294" text-anchor="middle" class="subtitle">This certifies that Echo Swarm passed its required release gates.</text>
  <rect x="594" y="329" width="412" height="50" rx="25" fill="${statusColor}" fill-opacity=".10" stroke="${statusColor}"/>
  <text x="800" y="361" text-anchor="middle" class="status" fill="${statusColor}">${xml(status)}</text>
  <g transform="translate(152 410)">
    <text class="label" y="0">PROGRAM</text><text class="hash" y="34">${xml(certificate.program)}</text>
    <text class="label" x="440" y="0">EDITION</text><text class="hash" x="440" y="34">${xml(certificate.edition)}</text>
    <text class="label" x="880" y="0">CERTIFICATION RUN</text><text class="hash" x="880" y="34">${xml(short(receipt?.run_id, 38))}</text>
    <text class="label" y="82">CERTIFIED RELEASE SHA</text><text class="hash" y="116">${xml(certificate.releaseSha)}</text>
    <text class="label" x="880" y="82">EVIDENCE MERKLE ROOT</text><text class="hash" x="880" y="116">${xml(short(receipt?.evidence_merkle_root, 38))}</text>
    <text class="label" y="164">CERTIFICATE DIGEST</text><text class="hash" y="198">${xml(certificate.certificateDigest || "Not available")}</text>
  </g>
  ${signerCard(115, "AI BUILDER", certificate.signatures.builder, "OpenAI Codex / Sol")}
  ${signerCard(595, "AI CERTIFIER", certificate.signatures.certifier, "ECHO Certification Forge")}
  ${signerCard(1075, "COMMANDER", certificate.signatures.commander, certificate.commanderDisplayName)}
  <text x="800" y="900" text-anchor="middle" class="small">Verify JSON and detached signatures at ${xml(certificate.verificationUrl ?? "/api/certificate")}</text>
  <text x="800" y="924" text-anchor="middle" class="small">A visual certificate is not proof by itself; the embedded envelope and public keys are the proof.</text>
</svg>`;
}
