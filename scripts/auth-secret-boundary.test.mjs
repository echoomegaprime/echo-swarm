import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

test("preview OAuth secrets are runtime-only and missing credentials fail closed", () => {
  const preview = read("src/lib/auth/preview.ts");
  const server = read("src/lib/auth/server.ts");
  const verifier = read("src/lib/auth/verify.server.ts");

  assert.doesNotMatch(preview, /export\s+const\s+PREVIEW_CLIENT_SECRET/u);
  assert.doesNotMatch(preview, /[a-f0-9]{64}/u);
  assert.match(server, /env\("GROK_PREVIEW_CLIENT_SECRET"\)/u);
  assert.match(server, /deployedClientRequested/u);
  assert.match(server, /authCredentialPairComplete/u);
  assert.match(verifier, /!authExplicitlyDisabled/u);
  assert.match(verifier, /credential pair is incomplete/u);
});
