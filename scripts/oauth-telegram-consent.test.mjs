import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { oauthAutoRegisterPlugin } from "./oauth-autoregister-plugin.mjs";

// Runs the real HTTP middleware, OAuth store, Python adapter and reviewed
// Commander-consent dependency. The outbox and database are private temp files;
// no Telegram API or production approval store is used.
const modulePath = process.env.SWARM_TEST_CONSENT_MODULE;
const originalEnv = { ...process.env };
after(() => {
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

async function fixture(t, enabled = true) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "swarm-consent-test-"));
  Object.assign(process.env, {
    SWARM_TELEGRAM_CONSENT: enabled ? "1" : "0",
    SWARM_CONSENT_MODULE_PATH: modulePath || path.join(dir, "missing.py"),
    SWARM_CONSENT_PYTHON: process.env.SWARM_TEST_PYTHON || "python",
    SWARM_MCP_TOKEN: crypto.randomBytes(32).toString("hex"),
    SWARM_OAUTH_TOKENS_FILE: path.join(dir, "tokens.json"),
    UMB_STATE_DIR: dir,
    ECHO_MCP_CONSENT_DB: path.join(dir, "oauth_consent.sqlite3"),
    ECHO_MCP_CONSENT_PAGE_DIR: path.join(dir, "consent-pages"),
  });
  const store = await import(`../src/lib/swarm/oauth-store.ts?test=${crypto.randomUUID()}`);
  let middleware;
  oauthAutoRegisterPlugin().configureServer({
    ssrLoadModule: async () => store,
    middlewares: {
      use: (fn) => {
        middleware = fn;
      },
    },
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
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url, options) => fetch(base + url, { ...options, redirect: "manual" });
  const registration = await request("/oauth/register", {
    method: "POST",
    body: JSON.stringify({ redirect_uris: ["http://localhost:47911/callback"] }),
  });
  assert.equal(registration.status, 201);
  const client = await registration.json();
  const verifier = crypto.randomBytes(32).toString("base64url");
  const q = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: client.redirect_uris[0],
    scope: "swarm.read offline_access",
    code_challenge: crypto.createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state: "fixture-state",
    resource: "https://swarm-app.echo-op.com/api/plugin/mcp",
  });
  return { dir, request, client, verifier, q, store };
}

async function pending(f) {
  const response = await f.request("/oauth/authorize?" + f.q);
  assert.equal(response.status, 302, "first authorization must queue a Commander request");
  const location = response.headers.get("location");
  assert.equal(location?.startsWith("/oauth/approve?request="), true);
  const page = await f.request(location);
  assert.equal(page.status, 200);
  assert.equal((await page.text()).includes("Commander approval required"), true);
  const files = await readdir(path.join(f.dir, "consent-pages"));
  const queue = JSON.parse(await readFile(path.join(f.dir, "consent-pages", files[0]), "utf8"));
  const link = /https:\/\/swarm-app\.echo-op\.com\/oauth\/consent#t=([^\s]+)/.exec(queue.text);
  const otp = /or type code ([A-Z2-9]+-[A-Z2-9]+)/.exec(queue.text);
  assert.equal(
    Boolean(link && otp),
    true,
    "queued fixture must contain a Swarm review link and code",
  );
  assert.equal(queue.text.includes(process.env.SWARM_MCP_TOKEN), false);
  return {
    location,
    rid: new URL(location, "https://swarm-app.echo-op.com").searchParams.get("request"),
    token: link[1],
    otp: otp[1],
  };
}

async function decide(f, p, action = "approve") {
  const response = await f.request("/oauth/consent", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://swarm-app.echo-op.com" },
    body: JSON.stringify({ t: p.token, action }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
}

const integration = {
  skip: !modulePath && "Set SWARM_TEST_CONSENT_MODULE to the reviewed Commander module",
};

test(
  "Telegram approval reaches a PKCE-bound token exchange and cannot be replayed",
  integration,
  async (t) => {
    const f = await fixture(t);
    const p = await pending(f);
    const status = await f.request("/oauth/approval-status?request=" + p.rid);
    assert.equal((await status.json()).status, "pending");
    const unapproved = await f.request(p.location);
    assert.equal(unapproved.headers.has("location"), false);
    await decide(f, p);
    const done = await f.request(p.location);
    assert.equal(done.status, 302);
    const callback = new URL(done.headers.get("location"));
    assert.equal(callback.origin + callback.pathname, "http://localhost:47911/callback");
    assert.equal(callback.searchParams.get("state"), "fixture-state");
    const exchanged = await f.request("/oauth/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: callback.searchParams.get("code"),
        client_id: f.client.client_id,
        redirect_uri: f.q.get("redirect_uri"),
        code_verifier: f.verifier,
      }),
    });
    assert.equal(exchanged.status, 200);
    const tokens = await exchanged.json();
    assert.equal(f.store.validateToken(tokens.access_token), true);
    assert.equal((await f.request(p.location)).status, 410);
    const later = await f.request("/oauth/authorize?" + f.q);
    assert.equal(later.status, 302);
    assert.equal(
      later.headers.get("location").startsWith("http://localhost:47911/callback?"),
      true,
    );
    assert.equal((await readdir(path.join(f.dir, "consent-pages"))).length, 1);
    f.q.set("scope", "swarm.read swarm.write offline_access");
    const expanded = await f.request("/oauth/authorize?" + f.q);
    assert.equal(expanded.headers.get("location").startsWith("/oauth/approve?request="), true);
    assert.equal((await readdir(path.join(f.dir, "consent-pages"))).length, 2);
  },
);

test("denial returns access_denied and never creates an OAuth code", integration, async (t) => {
  const f = await fixture(t);
  const p = await pending(f);
  await decide(f, p, "deny");
  const callback = new URL((await f.request(p.location)).headers.get("location"));
  assert.equal(callback.searchParams.get("error"), "access_denied");
  assert.equal(callback.searchParams.has("code"), false);
});

test(
  "wrong code stays pending, correct code completes, unknown requests stay closed",
  integration,
  async (t) => {
    const f = await fixture(t);
    const p = await pending(f);
    const wrong = await f.request("/oauth/approve", {
      method: "POST",
      body: new URLSearchParams({ request: p.rid, code: "wrong-fixture-code" }),
    });
    assert.equal(wrong.status, 401);
    const correct = await f.request("/oauth/approve", {
      method: "POST",
      body: new URLSearchParams({ request: p.rid, code: p.otp }),
    });
    assert.equal(correct.status, 303);
    assert.equal(new URL(correct.headers.get("location")).searchParams.has("code"), true);
    assert.equal((await f.request("/oauth/approve?request=unknown")).status, 410);
  },
);

test("an unavailable consent dependency fails closed and does not reveal paths or credentials", async (t) => {
  const f = await fixture(t);
  process.env.SWARM_CONSENT_MODULE_PATH = path.join(f.dir, "missing.py");
  const response = await f.request("/oauth/authorize?" + f.q);
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.equal(body.includes(process.env.SWARM_MCP_TOKEN), false);
  assert.equal(body.includes(f.dir), false);
  assert.equal(response.headers.has("location"), false);
});

test("disabled Telegram mode preserves the existing owner-key gate", async (t) => {
  const f = await fixture(t, false);
  const response = await f.request("/oauth/authorize?" + f.q);
  assert.equal(response.status, 200);
  assert.equal((await response.text()).includes('name="owner_key"'), true);
  const denied = await f.request("/oauth/authorize", {
    method: "POST",
    body: new URLSearchParams({ ...Object.fromEntries(f.q), owner_key: "invalid-fixture" }),
  });
  assert.equal(denied.status, 401);
  const approved = await f.request("/oauth/authorize", {
    method: "POST",
    body: new URLSearchParams({
      ...Object.fromEntries(f.q),
      owner_key: process.env.SWARM_MCP_TOKEN,
    }),
  });
  assert.equal(approved.status, 302);
  assert.equal(new URL(approved.headers.get("location")).searchParams.has("code"), true);
});

test(
  "invalid PKCE method, scope and resource cannot queue approval requests",
  integration,
  async (t) => {
    const f = await fixture(t);
    for (const [field, value] of [
      ["code_challenge_method", "plain"],
      ["scope", "unrelated.write"],
      ["resource", "https://unrelated.invalid/mcp"],
    ]) {
      const q = new URLSearchParams(f.q);
      q.set(field, value);
      assert.equal((await f.request("/oauth/authorize?" + q)).status, 400);
    }
    const files = await readdir(path.join(f.dir, "consent-pages")).catch(() => []);
    assert.equal(files.length, 0);
  },
);

test(
  "cross-origin decisions fail and a wrong PKCE verifier cannot exchange an approved code",
  integration,
  async (t) => {
    const f = await fixture(t);
    const p = await pending(f);
    const csrf = await f.request("/oauth/consent", {
      method: "POST",
      headers: { origin: "https://unrelated.invalid" },
      body: JSON.stringify({ t: p.token, action: "approve" }),
    });
    assert.equal(csrf.status, 403);
    assert.equal(
      (await (await f.request("/oauth/approval-status?request=" + p.rid)).json()).status,
      "pending",
    );
    await decide(f, p);
    const callback = new URL((await f.request(p.location)).headers.get("location"));
    const denied = await f.request("/oauth/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: callback.searchParams.get("code"),
        client_id: f.client.client_id,
        redirect_uri: f.q.get("redirect_uri"),
        code_verifier: "wrong-fixture-verifier",
      }),
    });
    assert.equal(denied.status, 400);
    assert.equal((await denied.json()).error, "invalid_grant");
  },
);
