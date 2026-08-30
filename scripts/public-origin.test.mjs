import assert from "node:assert/strict";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("the canonical public origin prevents reverse-proxy HTTPS downgrades", async (t) => {
  const original = process.env.ECHO_PUBLIC_BASE_URL;
  t.after(() => {
    if (original === undefined) delete process.env.ECHO_PUBLIC_BASE_URL;
    else process.env.ECHO_PUBLIC_BASE_URL = original;
  });

  const vite = await createViteServer({ root, logLevel: "silent" });
  t.after(() => vite.close());
  const { publicOriginForRequest } = await vite.ssrLoadModule(
    "/src/lib/swarm/public-origin.ts",
  );
  const internalRequest = new Request("http://swarm-app.echo-op.com/api/plugin/mcp");

  process.env.ECHO_PUBLIC_BASE_URL = "https://swarm-app.echo-op.com/";
  assert.equal(publicOriginForRequest(internalRequest), "https://swarm-app.echo-op.com");

  delete process.env.ECHO_PUBLIC_BASE_URL;
  assert.equal(publicOriginForRequest(internalRequest), "http://swarm-app.echo-op.com");

  for (const invalid of [
    "ftp://swarm-app.echo-op.com",
    "https://user:password@swarm-app.echo-op.com",
    "https://swarm-app.echo-op.com/not-an-origin",
    "https://swarm-app.echo-op.com/?redirect=other",
  ]) {
    process.env.ECHO_PUBLIC_BASE_URL = invalid;
    assert.throws(() => publicOriginForRequest(internalRequest), /ECHO_PUBLIC_BASE_URL/);
  }
});

test("all generated external surfaces use the canonical public-origin helper", async () => {
  const { readFile } = await import("node:fs/promises");
  const files = await Promise.all([
    readFile(new URL("../src/routes/api/plugin[.]json.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/routes/api/plugin/openapi[.]json.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/routes/api/plugin/mcp.ts", import.meta.url), "utf8"),
  ]);
  for (const source of files) {
    assert.match(source, /publicOriginForRequest\(request\)/);
  }
});
