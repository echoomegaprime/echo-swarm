import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { oauthAutoRegisterPlugin } from "./oauth-autoregister-plugin.mjs";

test("HTTP refresh endpoint denies mismatched and missing OAuth client identity", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "swarm-refresh-http-"));
  const file = path.join(dir, "tokens.json");
  const previous = process.env.SWARM_OAUTH_TOKENS_FILE;
  process.env.SWARM_OAUTH_TOKENS_FILE = file;
  const { refreshToken } = await import(
    "../src/lib/swarm/oauth-store.ts?http=" + crypto.randomUUID()
  );
  const token = "synthetic-refresh";
  await writeFile(file, JSON.stringify({
    [token]: { exp: Date.now() + 3600000, scope: "swarm.read", client_id: "client-A", refresh: true }
  }));
  let middleware;
  oauthAutoRegisterPlugin().configureServer({
    ssrLoadModule: async () => ({ refreshToken }),
    middlewares: { use(fn) { middleware = fn; } },
    config: { logger: { info() {} } }
  });
  const server = createServer((req, res) => middleware(req, res, () => {
    res.statusCode = 404;
    res.end();
  }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (previous === undefined) delete process.env.SWARM_OAUTH_TOKENS_FILE;
    else process.env.SWARM_OAUTH_TOKENS_FILE = previous;
    await rm(dir, { recursive: true, force: true });
  });
  const endpoint = "http://127.0.0.1:" + server.address().port + "/oauth/token";
  const post = async (client_id) => {
    const form = new URLSearchParams({
      grant_type: "refresh_token", refresh_token: token, client_id
    });
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString()
    });
    return { status: response.status, body: await response.json() };
  };
  const before = await readFile(file, "utf8");
  const wrong = await post("client-B");
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error, "invalid_grant");
  const missing = await post("");
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error, "invalid_grant");
  assert.equal(await readFile(file, "utf8"), before, "denials must mint no access tokens");
  const valid = await post("client-A");
  assert.equal(valid.status, 200);
  assert.ok(valid.body.access_token);
  assert.equal(valid.body.token_type, "Bearer");
});
