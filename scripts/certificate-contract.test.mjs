import assert from "node:assert/strict";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

const stableJson = (value) => JSON.stringify(stable(value));

const certForgeFixture = {
  payload: {
    environment_identity_digest: "8e6466d2d285f4e1c8ba3e83258fd097b384d4e9ae7dd723436d449728ccfcb6",
    evidence_merkle_root: "2291da2b0790feaba24b62bbe44645baf6135560d949cca5c3f54ce94fc832b2",
    expires_at: "2026-09-05T17:27:59.546269Z",
    issued_at: "2026-08-29T17:27:59.546269Z",
    reasons: ["all_mandatory_rules_verified"],
    release_verdict: "PRODUCTION_READY",
    rule_manifest_digest: "7dc98e0e95e6dd2c000ec069a8c46c4d1d49a4fe869ad4eae25e059d103644f4",
    rule_manifest_id: "certforge.release-strict.v2",
    run_id: "cert_cac699653fb9e4a00860e55c7612310c0f3c9577",
    run_outcome: "COMPLETE",
    schema_version: "1.0.0",
    signing_key_id: "ed25519:a07f417e23d6ef50e316f046c115b9fc",
    target_identity_digest: "ba93e7f74926845f14274e698ad57fc9e5bccd262bfb645fb868be1c11d6ba09",
    tenant_id: "org-echo-sovereign",
  },
  signature:
    "alDkPXKgO1FRfRJYagXPmbOZwEMq8uhaJ6Wx4tFkjgLOKAfiD1ieyJxhfezMylvW9h8pPFvokByEyozMtRuIBg==",
  publicKey:
    "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAS2yqeZBgec9zIwmQ4qFdY2uC7f15G53dKwaq3ay37VA=\n-----END PUBLIC KEY-----\n",
};

test("the real Certification Forge fixture verifies from canonical compact JSON", () => {
  assert.equal(
    verify(
      null,
      Buffer.from(stableJson(certForgeFixture.payload)),
      certForgeFixture.publicKey,
      Buffer.from(certForgeFixture.signature, "base64"),
    ),
    true,
  );
});

test("builder Ed25519 and Commander ES256 signatures verify and fail after mutation", () => {
  const builder = generateKeyPairSync("ed25519");
  const builderStatement = {
    action: "build-release",
    releaseSha: "a".repeat(40),
    certificationRunId: "cert_example",
  };
  const builderSignature = sign(null, Buffer.from(stableJson(builderStatement)), builder.privateKey);
  assert.equal(verify(null, Buffer.from(stableJson(builderStatement)), builder.publicKey, builderSignature), true);
  assert.equal(
    verify(null, Buffer.from(stableJson({ ...builderStatement, releaseSha: "b".repeat(40) })), builder.publicKey, builderSignature),
    false,
  );

  const commander = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const commanderStatement = {
    action: "approve-release-certificate",
    certificateDigest: "c".repeat(64),
    signerRole: "Commander",
  };
  const commanderSignature = sign(
    "sha256",
    Buffer.from(stableJson(commanderStatement)),
    { key: commander.privateKey, dsaEncoding: "ieee-p1363" },
  );
  assert.equal(
    verify(
      "sha256",
      Buffer.from(stableJson(commanderStatement)),
      { key: commander.publicKey, dsaEncoding: "ieee-p1363" },
      commanderSignature,
    ),
    true,
  );
});

test("certificate graphic, private key boundary, OAuth ceremony, and edition gates are wired", async () => {
  const [svg, commanderKey, certificateServer, edition, engine, mcp, migration] = await Promise.all([
    readFile(new URL("../src/lib/certificate/svg.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/certificate/commander-key.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/certificate/server.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/swarm/edition.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/swarm/engine.server.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/routes/api/plugin/mcp.ts", import.meta.url), "utf8"),
    readFile(new URL("../migrations/0002_certificate_signatures.sql", import.meta.url), "utf8"),
  ]);
  assert.match(svg, /Certificate of Certified Release/);
  assert.match(svg, /AI BUILDER/);
  assert.match(svg, /AI CERTIFIER/);
  assert.match(svg, /COMMANDER/);
  assert.match(svg, /A visual certificate is not proof by itself/);
  assert.match(commanderKey, /namedCurve: "P-256"/);
  assert.match(commanderKey, /false,\s*\["sign", "verify"\]/);
  assert.doesNotMatch(commanderKey, /exportKey\("jwk", pair\.privateKey/);
  assert.match(certificateServer, /github\.com\/user/);
  assert.match(certificateServer, /ECHO_COMMANDER_GITHUB_LOGINS/);
  assert.match(certificateServer, /ECHO_CERTFORGE_TARGET_IDENTITY_DIGEST/);
  assert.match(
    certificateServer,
    /receipt\.payload\.target_identity_digest !== expectedTargetIdentityDigest/,
  );
  assert.match(certificateServer, /HEX_64_RE\.test\(expectedTargetIdentityDigest\)/);
  assert.match(certificateServer, /dsaEncoding: "ieee-p1363"/);
  assert.match(edition, /private-oauth/);
  assert.match(edition, /public-api/);
  assert.match(engine, /allowsServerRemoteCredentials/);
  assert.match(mcp, /swarm_certificate_\*/);
  assert.match(migration, /certificate_digest text primary key/);
});

test("public installer templates are valid JSON and never contain concrete secrets", async () => {
  const names = [
    "codex.mcp.template.json",
    "claude_desktop.template.json",
    "chatgpt.template.json",
    "grok.template.json",
  ];
  for (const name of names) {
    const raw = await readFile(new URL(`../public/install/public/${name}`, import.meta.url), "utf8");
    assert.doesNotThrow(() => JSON.parse(raw));
    assert.match(raw, /YOUR-ECHO-SWARM-PUBLIC-HOST/);
    assert.doesNotMatch(raw, /(?:sk-|xai-|ghp_|github_pat_)[A-Za-z0-9]/);
  }
});
