import type { SwarmEdition } from "@/lib/swarm/edition";

export interface CertForgePayload {
  environment_identity_digest: string;
  evidence_merkle_root: string;
  expires_at: string;
  issued_at: string;
  reasons: string[];
  release_verdict: string;
  rule_manifest_digest: string;
  rule_manifest_id: string;
  run_id: string;
  run_outcome: string;
  schema_version: string;
  signing_key_id: string;
  target_identity_digest: string;
  tenant_id: string;
}

export interface CertForgeVerification {
  verification_id: string;
  valid: boolean;
  reasons: string[];
  payload: CertForgePayload;
  signature_b64: string;
  key_id: string;
  public_key_pem: string;
}

export interface DigitalSignatureBlock {
  role: "ai_builder" | "ai_certifier" | "commander";
  name: string;
  organization: string;
  algorithm: "Ed25519" | "ES256";
  keyId: string;
  publicKey: string | JsonWebKey;
  signatureB64: string;
  signedAt: string;
  verified: boolean;
  identity?: {
    provider: "github";
    login: string;
    id: number;
  };
}

export interface BuilderStatement {
  schemaVersion: "1.0.0";
  action: "build-release";
  program: "Echo Swarm";
  edition: SwarmEdition;
  releaseSha: string;
  certificationRunId: string;
  certificationReceiptDigest: string;
  evidenceMerkleRoot: string;
  builderName: string;
  builderModel: string;
  attestedAt: string;
}

export interface CommanderStatement {
  schemaVersion: "1.0.0";
  action: "approve-release-certificate";
  program: "Echo Swarm";
  certificateDigest: string;
  certificateId: string;
  releaseSha: string;
  signerName: string;
  signerRole: "Commander";
  githubLogin: string;
  signedAt: string;
}

export interface ReleaseCertificateSnapshot {
  schemaVersion: "1.0.0";
  status: "unconfigured" | "invalid" | "awaiting_builder" | "awaiting_commander" | "complete";
  complete: boolean;
  program: "Echo Swarm";
  edition: SwarmEdition;
  releaseSha: string;
  certificateDigest: string;
  commanderDisplayName: string;
  message: string;
  verificationUrl?: string;
  officialReceipt?: CertForgeVerification;
  builderStatement?: BuilderStatement;
  signatures: {
    builder?: DigitalSignatureBlock;
    certifier?: DigitalSignatureBlock;
    commander?: DigitalSignatureBlock;
  };
}

export interface CommanderSignatureSubmission {
  statement: CommanderStatement;
  publicKeyJwk: JsonWebKey;
  signatureB64: string;
}

