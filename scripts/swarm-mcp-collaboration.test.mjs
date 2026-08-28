import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer as createViteServer } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("swarm_collaborate brings model work back as chat-ready structured output", async (t) => {
  let providerCalls = 0;
  const provider = createHttpServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    providerCalls += 1;
    const fakeBearer = ["Bearer", "collaboration-test-token"].join(" ");
    const fakeApiKey = ["API_KEY", "collaboration-test-key"].join("=");
    const fakeGoogleKey = `AI${"za"}${"A".repeat(35)}`;
    const content =
      `Qwen contribution ${providerCalls} ` + `${fakeBearer} ${fakeApiKey} ${fakeGoogleKey}`;

    if (body.stream) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n` +
          `data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 3, completion_tokens: 4 } })}\n\n` +
          "data: [DONE]\n\n",
      );
      return;
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 3, completion_tokens: 4 },
      }),
    );
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  t.after(() => provider.close());
  const providerAddress = provider.address();
  assert(providerAddress && typeof providerAddress === "object");
  const forgeUrl = `http://127.0.0.1:${providerAddress.port}/v1`;

  const vite = await createViteServer({
    root,
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0 },
  });
  await vite.listen();
  t.after(() => vite.close());
  const baseUrl = vite.resolvedUrls?.local[0];
  assert(baseUrl, "Vite did not expose a local URL");
  const endpoint = new URL("api/plugin/mcp", baseUrl);

  const listResponse = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  assert.equal(listResponse.status, 200);
  const listBody = await listResponse.json();
  const collaborationTool = listBody.result.tools.find(
    (candidate) => candidate.name === "swarm_collaborate",
  );
  assert(collaborationTool, "tools/list must advertise swarm_collaborate");
  assert.equal(collaborationTool.outputSchema.type, "object");
  assert.deepEqual(collaborationTool.annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  });

  const expectedModes = {
    brainstorm: "parallel",
    build: "buildheavy",
    report: "conductor",
  };
  let id = 10;
  for (const [purpose, expectedMode] of Object.entries(expectedModes)) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forge-url": forgeUrl,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: id++,
        method: "tools/call",
        params: {
          name: "swarm_collaborate",
          arguments: {
            task: `Handle this ${purpose} request`,
            purpose,
            host: "qwen",
            seats: ["qwen"],
          },
        },
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.result.isError, undefined);
    assert.equal(body.result.structuredContent.purpose, purpose);
    assert.equal(body.result.structuredContent.mode, expectedMode);
    assert.equal(body.result.structuredContent.ok, true);
    assert.match(body.result.content[0].text, /^# Swarm Collaboration/m);
    assert.match(body.result.content[0].text, /Qwen contribution/);
    assert.doesNotMatch(body.result.content[0].text, /collaboration-test-token/);
    assert.doesNotMatch(body.result.content[0].text, /collaboration-test-key/);
    assert.doesNotMatch(body.result.content[0].text, /AIzaA{35}/);
    assert.doesNotMatch(
      JSON.stringify(body.result.structuredContent),
      /collaboration-test-token|collaboration-test-key|AIzaA{35}/,
    );
  }

  const invalidResponse = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: id++,
      method: "tools/call",
      params: {
        name: "swarm_collaborate",
        arguments: { task: "   ", purpose: "brainstorm", host: "qwen", seats: ["qwen"] },
      },
    }),
  });
  const invalidBody = await invalidResponse.json();
  assert.equal(invalidBody.result.isError, true);
  assert.match(invalidBody.result.content[0].text, /task/i);
});
