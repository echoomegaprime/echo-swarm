import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("OAuth refresh grants require original client identity", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "swarm-refresh-client-"));
  const file = path.join(dir, "tokens.json");
  const previous = process.env.SWARM_OAUTH_TOKENS_FILE;
  process.env.SWARM_OAUTH_TOKENS_FILE = file;
  t.after(async () => {
    if (previous === undefined) delete process.env.SWARM_OAUTH_TOKENS_FILE;
    else process.env.SWARM_OAUTH_TOKENS_FILE = previous;
    await rm(dir, { recursive: true, force: true });
  });
  const { refreshToken, validateToken } = await import(
    "../src/lib/swarm/oauth-store.ts?test=" + crypto.randomUUID()
  );
  const now = Date.now();
  await writeFile(file, JSON.stringify({
    "valid-refresh": { exp: now + 3600000, scope: "swarm.read", client_id: "client-A", refresh: true },
    "expired-refresh": { exp: now - 1, scope: "swarm.read", client_id: "client-A", refresh: true },
    "access-only": { exp: now + 3600000, scope: "swarm.read", client_id: "client-A", refresh: false }
  }));
  const before = await readFile(file, "utf8");
  assert.equal(refreshToken("valid-refresh", "client-B").error, "invalid_grant");
  assert.equal(refreshToken("valid-refresh", "").error, "invalid_grant");
  assert.equal(await readFile(file, "utf8"), before, "mismatches must not mint tokens");
  assert.equal(refreshToken("expired-refresh", "client-A").error, "invalid_grant");
  assert.equal(refreshToken("access-only", "client-A").error, "invalid_grant");
  assert.equal(refreshToken("missing", "client-A").error, "invalid_grant");
  const matched = refreshToken("valid-refresh", "client-A");
  assert.ok(matched.access);
  assert.equal(matched.scope, "swarm.read");
  assert.equal(validateToken(matched.access), true);
});
