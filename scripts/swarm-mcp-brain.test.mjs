import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer as createViteServer } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function jsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
}

test("Echo Swarm exposes the recovered sovereign brain through bounded MCP tools", async (t) => {
  const calls = [];
  const fakeSecret = ["Bearer", "brain-integration-token"].join(" ");
  const brain = createHttpServer(async (request, response) => {
    const body = await jsonBody(request);
    calls.push({ method: request.method, url: request.url, body });
    response.setHeader("content-type", "application/json");
    if (request.method === "GET" && request.url === "/health") {
      response.end(
        JSON.stringify({
          ok: true,
          status: "ok",
          service: "echo-swarm-brain",
          version: "3.2.0-perf",
          dependencies: { postgres: true, alpha_llm: true },
        }),
      );
      return;
    }
    if (request.method === "POST" && request.url === "/swarm/think") {
      response.end(
        JSON.stringify({
          ok: true,
          answer: `Recovered hive synthesis. ${fakeSecret}`,
          swarm_size: body.agents,
        }),
      );
      return;
    }
    if (request.method === "POST" && request.url === "/trinity/consult") {
      response.end(
        JSON.stringify({
          ok: true,
          consultation: { analysis: `${body.voice} consultation`, model_used: body.voice },
        }),
      );
      return;
    }
    if (request.method === "POST" && request.url === "/trinity/decide") {
      response.end(
        JSON.stringify({ ok: true, decision: { final: "Trinity synthesis", voices: {} } }),
      );
      return;
    }
    if (request.method === "POST" && request.url === "/llm/hybrids/run") {
      response.end(JSON.stringify({ ok: true, method: body.method, result: "Hybrid synthesis" }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });
  brain.listen(0, "127.0.0.1");
  await once(brain, "listening");
  t.after(() => brain.close());
  const address = brain.address();
  assert(address && typeof address === "object");
  const previousBase = process.env.SWARM_BRAIN_BASE;
  process.env.SWARM_BRAIN_BASE = `http://127.0.0.1:${address.port}`;
  t.after(() => {
    if (previousBase === undefined) delete process.env.SWARM_BRAIN_BASE;
    else process.env.SWARM_BRAIN_BASE = previousBase;
  });

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
  const headers = { "content-type": "application/json", "x-echo-agent": "codex" };

  async function rpc(id, name, args = {}) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    assert.equal(response.status, 200);
    return response.json();
  }

  const listResponse = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  const listText = await listResponse.text();
  assert.equal(listResponse.status, 200, listText);
  const listBody = JSON.parse(listText);
  const tools = new Map(listBody.result.tools.map((tool) => [tool.name, tool]));
  for (const name of [
    "swarm_brain_health",
    "swarm_brain_think",
    "swarm_brain_trinity_consult",
    "swarm_brain_trinity_decide",
    "swarm_brain_hybrid",
  ]) {
    assert(tools.has(name), `tools/list must advertise ${name}`);
    assert.equal(tools.get(name).outputSchema.type, "object");
  }

  const health = await rpc(2, "swarm_brain_health");
  assert.equal(health.result.structuredContent.service, "echo-swarm-brain");
  assert.match(health.result.content[0].text, /3\.2\.0-perf|echo swarm brain/i);

  const thought = await rpc(3, "swarm_brain_think", {
    question: "Synthesize the evidence",
    context: "bounded context",
    agents: 75,
    brain_url: "https://attacker.invalid",
  });
  assert.equal(thought.result.structuredContent.swarm_size, 75);
  assert.match(thought.result.content[0].text, /Recovered hive synthesis/);
  assert.doesNotMatch(thought.result.content[0].text, /brain-integration-token/);
  assert.doesNotMatch(JSON.stringify(thought.result.structuredContent), /brain-integration-token/);
  const thinkCall = calls.find((call) => call.url === "/swarm/think");
  assert.deepEqual(thinkCall.body, {
    question: "Synthesize the evidence",
    context: "bounded context",
    agents: 75,
  });

  const consulted = await rpc(4, "swarm_brain_trinity_consult", {
    question: "Check risk",
    voice: "thorne",
  });
  assert.match(consulted.result.content[0].text, /THORNE consultation/);

  const decided = await rpc(5, "swarm_brain_trinity_decide", {
    question: "Render a decision",
    debate_rounds: 4,
  });
  assert.match(decided.result.content[0].text, /Trinity synthesis/);

  const hybrid = await rpc(6, "swarm_brain_hybrid", {
    method: "ensemble",
    prompt: "Cross-check the answer",
    models: ["gpt", "claude"],
    options: { temperature: 0.2, max_tokens: 1200 },
  });
  assert.match(hybrid.result.content[0].text, /Hybrid synthesis/);

  const callsBeforeInvalid = calls.length;
  const invalid = await rpc(7, "swarm_brain_think", { question: "", agents: 50 });
  assert.equal(invalid.result.isError, true);
  assert.equal(calls.length, callsBeforeInvalid, "invalid input must fail before fetch");
});
