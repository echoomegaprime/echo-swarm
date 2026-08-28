import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer as createViteServer } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("swarm_convene brings model work back as chat-ready structured output", async (t) => {
  let providerCalls = 0;
  const providerModels = [];
  const provider = createHttpServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    providerCalls += 1;
    providerModels.push(body.model);
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
  const agentHeaders = {
    "content-type": "application/json",
    "x-echo-agent": "acceptance-test",
  };

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
    headers: agentHeaders,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  assert.equal(listResponse.status, 200);
  const listBody = await listResponse.json();
  const collaborationTool = listBody.result.tools.find(
    (candidate) => candidate.name === "swarm_convene",
  );
  assert(collaborationTool, "tools/list must advertise swarm_convene");
  assert.equal(collaborationTool.outputSchema.type, "object");
  assert.deepEqual(collaborationTool.annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  });

  const { createCollaborationPlan, formatCollaborationResult } = await vite.ssrLoadModule(
    "/src/lib/swarm/mcp-collaboration.ts",
  );
  const { FORGE_DEFAULT_MODEL, FORGE_DEFAULT_URL, MODELS } = await vite.ssrLoadModule(
    "/src/lib/swarm/catalog.ts",
  );
  const { resolveSeat } = await vite.ssrLoadModule("/src/lib/swarm/engine.server.ts");
  assert.equal(FORGE_DEFAULT_URL, "http://127.0.0.1:11438/v1");
  assert.equal(FORGE_DEFAULT_MODEL, "c3po-code:echo-qwen38-abliterated-256k");
  assert.equal(MODELS.qwen.name, "Qwen3.8 27B");
  const forgeSeat = resolveSeat("qwen", {}, {}, {});
  assert.equal(forgeSeat?.url, "http://127.0.0.1:11438/v1/chat/completions");
  assert.equal(forgeSeat?.model, "c3po-code:echo-qwen38-abliterated-256k");
  const allPurposeModes = {
    brainstorm: "parallel",
    debate: "debate",
    build: "buildheavy",
    review: "roundtable",
    plan: "conductor",
    report: "conductor",
  };
  for (const [purpose, expectedMode] of Object.entries(allPurposeModes)) {
    const plan = createCollaborationPlan("Map this request", purpose);
    assert.equal(plan.error, undefined, `${purpose} should create a valid plan`);
    assert.equal(plan.mode, expectedMode, `${purpose} should map to ${expectedMode}`);
  }

  const abortedPlan = createCollaborationPlan("Ask the live model", "brainstorm");
  const aborted = formatCollaborationResult(abortedPlan, {
    ok: true,
    turns: [
      {
        modelId: "qwen",
        model: "local-test-model",
        content: "",
        error: "This operation was aborted",
        traces: [],
      },
    ],
    insights: [],
    skipped: [],
  });
  assert.equal(aborted.isError, true, "all-aborted model work must not report MCP success");
  assert.equal(aborted.structuredContent.ok, false);
  assert.equal(aborted.structuredContent.turns[0].modelId, "qwen");
  assert.match(aborted.content[0].text, /no selected model returned usable output/i);

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
        ...agentHeaders,
        "x-forge-url": forgeUrl,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: id++,
        method: "tools/call",
        params: {
          name: "swarm_convene",
          arguments: {
            task: `Handle this ${purpose} request`,
            purpose,
            models: ["qwen"],
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
  assert.ok(providerModels.length >= Object.keys(expectedModes).length);
  assert.equal(
    providerModels.every((model) => model === "c3po-code:echo-qwen38-abliterated-256k"),
    true,
    `qwen MCP calls used unexpected models: ${providerModels.join(", ")}`,
  );

  const invalidResponse = await fetch(endpoint, {
    method: "POST",
    headers: agentHeaders,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: id++,
      method: "tools/call",
      params: {
        name: "swarm_convene",
        arguments: { task: "   ", purpose: "brainstorm", models: ["qwen"] },
      },
    }),
  });
  const invalidBody = await invalidResponse.json();
  assert.equal(invalidBody.result.isError, true);
  assert.match(invalidBody.result.content[0].text, /task/i);
});
