import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { getSql } from "@/lib/db";
import { PRIVATE_OAUTH_EDITION, SWARM_EDITION } from "@/lib/swarm/edition";
import { stableJson } from "./canonical";
import type {
  BuilderStatement,
  CertForgeVerification,
  CommanderSignatureSubmission,
  CommanderStatement,
  DigitalSignatureBlock,
  ReleaseCertificateSnapshot,
} from "./types";

const PROGRAM = "Echo Swarm" as const;
const SHA_RE = /^[0-9a-f]{40,64}$/u;
const HEX_64_RE = /^[0-9a-f]{64}$/u;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/u;
const globalCert = globalThis as typeof globalThis & {
  __echoCertificatePromise__?: Promise<ReleaseCertificateSnapshot>;
  __echoCertificateAt__?: number;
};

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function keyId(publicKey: ReturnType<typeof createPublicKey>, algorithm: string): string {
  const der = publicKey.export({ type: "spki", format: "der" });
  return `${algorithm}:${sha256(der).slice(0, 32)}`;
}

function releaseSha(): string {
  const value = env("ECHO_RELEASE_SHA") ?? env("VERCEL_GIT_COMMIT_SHA") ?? "UNCONFIGURED";
  return SHA_RE.test(value.toLowerCase()) ? value.toLowerCase() : "UNCONFIGURED";
}

function commanderName(): string {
  return env("ECHO_COMMANDER_DISPLAY_NAME") ?? "Bobby Don McWilliams II";
}

function validReceiptShape(value: unknown): value is CertForgeVerification {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<CertForgeVerification>;
  const payload = item.payload as Partial<CertForgeVerification["payload"]> | undefined;
  return Boolean(
    typeof item.verification_id === "string" &&
      typeof item.valid === "boolean" &&
      Array.isArray(item.reasons) &&
      payload &&
      typeof payload.run_id === "string" &&
      typeof payload.release_verdict === "string" &&
      typeof payload.run_outcome === "string" &&
      typeof payload.evidence_merkle_root === "string" &&
      typeof payload.issued_at === "string" &&
      typeof payload.expires_at === "string" &&
      typeof item.signature_b64 === "string" &&
      typeof item.key_id === "string" &&
      typeof item.public_key_pem === "string",
  );
}

async function fetchOfficialReceipt(url: string): Promise<CertForgeVerification> {
  const target = new URL(url);
  if (target.protocol !== "https:") throw new Error("certification_verification_url_must_be_https");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const response = await fetch(target, {
      headers: { Accept: "application/json", "User-Agent": "echo-swarm-certificate/1.0" },
      signal: ctrl.signal,
    });
    if (!response.ok) throw new Error(`certification_http_${response.status}`);
    const value: unknown = await response.json();
    if (!validReceiptShape(value)) throw new Error("certification_receipt_schema_invalid");
    return value;
  } finally {
    clearTimeout(timer);
  }
}

function verifyOfficialReceipt(receipt: CertForgeVerification): boolean {
  try {
    if (!receipt.valid) return false;
    if (receipt.payload.release_verdict !== "PRODUCTION_READY") return false;
    if (receipt.payload.run_outcome !== "COMPLETE") return false;
    if (receipt.key_id !== receipt.payload.signing_key_id) return false;
    if (Date.parse(receipt.payload.expires_at) <= Date.now()) return false;
    if (!HEX_64_RE.test(receipt.payload.evidence_merkle_root)) return false;
    return verify(
      null,
      Buffer.from(stableJson(receipt.payload)),
      createPublicKey(receipt.public_key_pem),
      Buffer.from(receipt.signature_b64, "base64"),
    );
  } catch {
    return false;
  }
}

async function builderSignature(
  statement: BuilderStatement,
): Promise<DigitalSignatureBlock | undefined> {
  const path = env("ECHO_BUILDER_SIGNING_KEY_FILE");
  if (!path) return undefined;
  const privateKey = createPrivateKey(await readFile(path, "utf8"));
  const publicKey = createPublicKey(privateKey);
  const signature = sign(null, Buffer.from(stableJson(statement)), privateKey);
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  return {
    role: "ai_builder",
    name: statement.builderName,
    organization: env("ECHO_BUILDER_ORGANIZATION") ?? "OpenAI",
    algorithm: "Ed25519",
    keyId: keyId(publicKey, "ed25519"),
    publicKey: publicPem,
    signatureB64: signature.toString("base64"),
    signedAt: statement.attestedAt,
    verified: verify(null, Buffer.from(stableJson(statement)), publicKey, signature),
  };
}

function certifierSignature(receipt: CertForgeVerification): DigitalSignatureBlock {
  return {
    role: "ai_certifier",
    name: "ECHO Certification Forge",
    organization: "ECHO OMEGA PRIME",
    algorithm: "Ed25519",
    keyId: receipt.key_id,
    publicKey: receipt.public_key_pem,
    signatureB64: receipt.signature_b64,
    signedAt: receipt.payload.issued_at,
    verified: verifyOfficialReceipt(receipt),
  };
}

interface CommanderRow {
  statement: CommanderStatement;
  public_key_jwk: JsonWebKey;
  signature_b64: string;
  github_login: string;
  github_id: number;
}

function verifyCommanderRow(row: CommanderRow, digest: string): DigitalSignatureBlock | undefined {
  try {
    if (row.statement.certificateDigest !== digest) return undefined;
    const publicKey = createPublicKey({
      key: row.public_key_jwk as import("node:crypto").JsonWebKey,
      format: "jwk",
    });
    const signature = Buffer.from(row.signature_b64, "base64");
    const ok = verify(
      "sha256",
      Buffer.from(stableJson(row.statement)),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      signature,
    );
    if (!ok) return undefined;
    return {
      role: "commander",
      name: row.statement.signerName,
      organization: "ECHO OMEGA PRIME",
      algorithm: "ES256",
      keyId: keyId(publicKey, "es256"),
      publicKey: row.public_key_jwk,
      signatureB64: row.signature_b64,
      signedAt: row.statement.signedAt,
      verified: true,
      identity: { provider: "github", login: row.github_login, id: row.github_id },
    };
  } catch {
    return undefined;
  }
}

async function commanderSignature(digest: string): Promise<DigitalSignatureBlock | undefined> {
  try {
    const sql = await getSql();
    const rows = await sql.query<CommanderRow>(
      "select statement, public_key_jwk, signature_b64, github_login, github_id from echo_certificate_signatures where certificate_digest = $1 limit 1",
      [digest],
    );
    return rows[0] ? verifyCommanderRow(rows[0], digest) : undefined;
  } catch (error) {
    if (env("NODE_ENV") !== "test") {
      console.error("[certificate] commander signature lookup failed", error instanceof Error ? error.message : "unknown");
    }
    return undefined;
  }
}

function baseSnapshot(message: string): ReleaseCertificateSnapshot {
  return {
    schemaVersion: "1.0.0",
    status: "unconfigured",
    complete: false,
    program: PROGRAM,
    edition: SWARM_EDITION,
    releaseSha: releaseSha(),
    certificateDigest: "",
    commanderDisplayName: commanderName(),
    message,
    signatures: {},
  };
}

async function calculateCertificate(): Promise<ReleaseCertificateSnapshot> {
  const verificationUrl = env("ECHO_CERTFORGE_VERIFICATION_URL");
  const sha = releaseSha();
  if (!verificationUrl) return baseSnapshot("Official Certification Forge verification URL is not configured.");
  if (sha === "UNCONFIGURED") return baseSnapshot("The exact deployed release SHA is not configured.");

  let receipt: CertForgeVerification;
  try {
    receipt = await fetchOfficialReceipt(verificationUrl);
  } catch (error) {
    return {
      ...baseSnapshot(error instanceof Error ? error.message : "Certification receipt unavailable."),
      status: "invalid",
      verificationUrl,
    };
  }

  const certifier = certifierSignature(receipt);
  if (!certifier.verified) {
    return {
      ...baseSnapshot("Certification Forge signature or release verdict is invalid."),
      status: "invalid",
      verificationUrl,
      officialReceipt: receipt,
      signatures: { certifier },
    };
  }

  const receiptDigest = sha256(stableJson(receipt));
  const builderStatement: BuilderStatement = {
    schemaVersion: "1.0.0",
    action: "build-release",
    program: PROGRAM,
    edition: SWARM_EDITION,
    releaseSha: sha,
    certificationRunId: receipt.payload.run_id,
    certificationReceiptDigest: receiptDigest,
    evidenceMerkleRoot: receipt.payload.evidence_merkle_root,
    builderName: env("ECHO_BUILDER_NAME") ?? "OpenAI Codex / Sol",
    builderModel: env("ECHO_BUILDER_MODEL") ?? "GPT-5",
    attestedAt: env("ECHO_BUILDER_AT") ?? receipt.payload.issued_at,
  };
  const builder = await builderSignature(builderStatement);
  const digestInput = {
    schemaVersion: "1.0.0",
    program: PROGRAM,
    edition: SWARM_EDITION,
    releaseSha: sha,
    officialReceipt: receipt,
    builderStatement,
    builderSignature: builder,
  };
  const digest = sha256(stableJson(digestInput));
  const commander = await commanderSignature(digest);
  const complete = Boolean(builder?.verified && commander?.verified);
  return {
    schemaVersion: "1.0.0",
    status: !builder?.verified ? "awaiting_builder" : complete ? "complete" : "awaiting_commander",
    complete,
    program: PROGRAM,
    edition: SWARM_EDITION,
    releaseSha: sha,
    certificateDigest: digest,
    commanderDisplayName: commanderName(),
    message: !builder?.verified
      ? "Certification is valid; the AI Builder signing key is not configured."
      : complete
        ? "Builder, independent certifier, and Commander signatures are cryptographically verified."
        : "Builder and independent certifier signatures are verified; Commander approval is required.",
    verificationUrl,
    officialReceipt: receipt,
    builderStatement,
    signatures: { builder, certifier, commander },
  };
}

export function invalidateCertificateCache(): void {
  globalCert.__echoCertificatePromise__ = undefined;
  globalCert.__echoCertificateAt__ = undefined;
}

export function getReleaseCertificate(): Promise<ReleaseCertificateSnapshot> {
  const fresh = globalCert.__echoCertificateAt__ && Date.now() - globalCert.__echoCertificateAt__ < 15_000;
  if (!fresh || !globalCert.__echoCertificatePromise__) {
    globalCert.__echoCertificateAt__ = Date.now();
    globalCert.__echoCertificatePromise__ = calculateCertificate().catch((error) => ({
      ...baseSnapshot(error instanceof Error ? error.message : "Certificate generation failed."),
      status: "invalid",
    }));
  }
  return globalCert.__echoCertificatePromise__;
}

async function githubIdentity(token: string): Promise<{ login: string; id: number }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "echo-swarm-commander-signature/1.0",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: ctrl.signal,
    });
    if (!response.ok) throw new Error("github_oauth_identity_invalid");
    const body = (await response.json()) as { login?: unknown; id?: unknown };
    if (typeof body.login !== "string" || typeof body.id !== "number") {
      throw new Error("github_oauth_identity_invalid");
    }
    return { login: body.login, id: body.id };
  } finally {
    clearTimeout(timer);
  }
}

function allowedCommander(login: string): boolean {
  const allow = (env("ECHO_COMMANDER_GITHUB_LOGINS") ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (!allow.length) throw new Error("commander_github_allowlist_not_configured");
  return allow.includes(login.toLowerCase());
}

function validateCommanderStatement(
  statement: CommanderStatement,
  certificate: ReleaseCertificateSnapshot,
  login: string,
): void {
  if (statement.schemaVersion !== "1.0.0" || statement.action !== "approve-release-certificate") {
    throw new Error("commander_statement_contract_invalid");
  }
  if (statement.program !== PROGRAM || statement.signerRole !== "Commander") {
    throw new Error("commander_statement_role_invalid");
  }
  if (
    statement.certificateDigest !== certificate.certificateDigest ||
    statement.certificateId !== certificate.officialReceipt?.payload.run_id ||
    statement.releaseSha !== certificate.releaseSha
  ) {
    throw new Error("commander_statement_release_mismatch");
  }
  if (statement.signerName !== certificate.commanderDisplayName) {
    throw new Error("commander_statement_name_mismatch");
  }
  if (statement.githubLogin.toLowerCase() !== login.toLowerCase()) {
    throw new Error("commander_statement_identity_mismatch");
  }
  const signedAt = Date.parse(statement.signedAt);
  if (!Number.isFinite(signedAt) || Math.abs(Date.now() - signedAt) > 15 * 60_000) {
    throw new Error("commander_statement_time_invalid");
  }
}

function validatePublicJwk(jwk: JsonWebKey): void {
  if (
    jwk.kty !== "EC" ||
    jwk.crv !== "P-256" ||
    typeof jwk.x !== "string" ||
    typeof jwk.y !== "string" ||
    jwk.d !== undefined
  ) {
    throw new Error("commander_public_key_invalid");
  }
}

export async function submitCommanderSignature(
  submission: CommanderSignatureSubmission,
  githubOAuthToken: string,
): Promise<ReleaseCertificateSnapshot> {
  if (!PRIVATE_OAUTH_EDITION) throw new Error("commander_signing_private_edition_only");
  if (!githubOAuthToken || githubOAuthToken.length < 20) throw new Error("github_oauth_required");
  if (!BASE64_RE.test(submission.signatureB64) || submission.signatureB64.length > 512) {
    throw new Error("commander_signature_invalid");
  }
  validatePublicJwk(submission.publicKeyJwk);
  const certificate = await getReleaseCertificate();
  if (!certificate.signatures.builder?.verified || !certificate.signatures.certifier?.verified) {
    throw new Error("certificate_not_ready_for_commander");
  }
  const identity = await githubIdentity(githubOAuthToken);
  if (!allowedCommander(identity.login)) throw new Error("commander_identity_not_allowed");
  validateCommanderStatement(submission.statement, certificate, identity.login);

  const publicKey = createPublicKey({
    key: submission.publicKeyJwk as import("node:crypto").JsonWebKey,
    format: "jwk",
  });
  const verified = verify(
    "sha256",
    Buffer.from(stableJson(submission.statement)),
    { key: publicKey, dsaEncoding: "ieee-p1363" },
    Buffer.from(submission.signatureB64, "base64"),
  );
  if (!verified) throw new Error("commander_signature_verification_failed");

  const sql = await getSql();
  await sql.query(
    `insert into echo_certificate_signatures
      (certificate_digest, certificate_id, release_sha, signer_name, signer_role,
       github_login, github_id, statement, public_key_jwk, signature_b64, signed_at)
     values ($1,$2,$3,$4,'Commander',$5,$6,$7::jsonb,$8::jsonb,$9,$10)
     on conflict (certificate_digest) do update set
       signer_name=excluded.signer_name,
       github_login=excluded.github_login,
       github_id=excluded.github_id,
       statement=excluded.statement,
       public_key_jwk=excluded.public_key_jwk,
       signature_b64=excluded.signature_b64,
       signed_at=excluded.signed_at`,
    [
      certificate.certificateDigest,
      certificate.officialReceipt?.payload.run_id,
      certificate.releaseSha,
      submission.statement.signerName,
      identity.login,
      identity.id,
      JSON.stringify(submission.statement),
      JSON.stringify(submission.publicKeyJwk),
      submission.signatureB64,
      submission.statement.signedAt,
    ],
  );
  invalidateCertificateCache();
  return getReleaseCertificate();
}
