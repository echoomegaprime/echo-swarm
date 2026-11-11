import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { oauthAutoRegisterPlugin } from "./oauth-autoregister-plugin.mjs";

test("Meta AI Hatch registers only its exact HTTPS callback over HTTP", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "swarm-meta-oauth-"));
  const previousTokenFile = process.env.SWARM_OAUTH_TOKENS_FILE;
  process.env.SWARM_OAUTH_TOKENS_FILE = path.join(dir, "tokens.json");
  const store = await import(`../src/lib/swarm/oauth-store.ts?test=${crypto.randomUUID()}`);

  let middleware;
  oauthAutoRegisterPlugin().configureServer({
    ssrLoadModule: async () => store,
    middlewares: { use(fn) { middleware = fn; } },
    config: { logger: { info() {} } },
  });
  const server = createServer((req, res) =>
    middleware(req, res, () => {
      res.statusCode = 404;
      res.end();
    }),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (previousTokenFile === undefined) delete process.env.SWARM_OAUTH_TOKENS_FILE;
    else process.env.SWARM_OAUTH_TOKENS_FILE = previousTokenFile;
    await rm(dir, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${server.address().port}`;
  const register = (redirectUri) =>
    fetch(base + "/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: [redirectUri] }),
    });

  const callback = "https://agent.meta.ai/api/hatch/oauth/callback";
  const accepted = await register(callback);
  assert.equal(accepted.status, 201);
  const client = await accepted.json();
  assert.match(client.client_id, /^swarm-[0-9a-f]{32}$/);
  assert.deepEqual(client.redirect_uris, [callback]);

  for (const bad of [
    "http://agent.meta.ai/api/hatch/oauth/callback",
    "https://other.meta.ai/api/hatch/oauth/callback",
    "https://agent.meta.ai.evil.example/api/hatch/oauth/callback",
    "https://agent.meta.ai/api/hatch/oauth/callback/",
    "https://agent.meta.ai/api/hatch/oauth/callback?next=evil",
    "https://agent.meta.ai:444/api/hatch/oauth/callback",
  ]) {
    const rejected = await register(bad);
    assert.equal(rejected.status, 400, bad);
    assert.equal((await rejected.json()).error, "invalid_redirect_uri");
  }

  for (const existing of [
    "https://chatgpt.com/oauth/callback",
    "https://claude.ai/api/mcp/auth_callback",
    "http://127.0.0.1:49152/callback",
  ]) {
    assert.equal((await register(existing)).status, 201, existing);
  }
});
