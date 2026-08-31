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

test("Echo Swarm exposes the live Maximalist Fusion worker as an async MCP workflow", async (t) => {
  const workerCalls = [];
  const fakeBearer = ["Bearer", "maximalist-integration-token"].join(" ");
  const fakeApiKey = ["API_KEY", "maximalist-integration-key"].join("=");
  let historicalParity = false;
  const worker = createHttpServer(async (request, response) => {
    const body = await jsonBody(request);
    workerCalls.push({ method: request.method, url: request.url, body });
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && request.url === "/health") {
      response.end(
        JSON.stringify({
          ok: true,
          service: "echo-fusion-worker",
          version: "0.2.0",
          profile: "MAXIMALIST_RECONSTRUCTED",
          historical_parity: historicalParity,
          core_version: "0.3.0",
          core_sha: "d1e68e2f263d93648e494c5419852693fdd03fe0",
          provider_mode: "live",
          runtime: "anvil_live",
          configured_seat_count: 40,
          trinity_separate: true,
          ready: true,
          planner_ready: true,
          ready_swarm_seats: 40,
          ready_trinity_seats: 3,
          credential_values_exposed: false,
          seats_fingerprint: "63374b318f846f51",
          active_runs: 0,
        }),
      );
      return;
    }
    if (request.method === "POST" && request.url === "/run") {
      response.statusCode = 202;
      response.end(JSON.stringify({ run_id: "run_acceptance", phase: "running" }));
      return;
    }
    if (request.method === "GET" && request.url === "/runs/run_acceptance") {
      response.end(
        JSON.stringify({
          run_id: "run_acceptance",
          phase: "done",
          done: true,
          error: null,
          result: {
            run_id: "run_acceptance",
            answer: `Verified fused answer. ${fakeBearer} ${fakeApiKey}`,
            confidence: 0.91,
            abstained: false,
            major_findings: [{ claim: "Evidence-backed finding", confidence: 0.93 }],
            dissent: [{ claim: "Preserved minority position", confidence: 0.62 }],
            unresolved: ["One bounded uncertainty"],
            provenance: {
              profile: "MAXIMALIST_RECONSTRUCTED",
              historical_parity: false,
              core_version: "0.3.0",
              core_sha: "d1e68e2f263d93648e494c5419852693fdd03fe0",
              trinity_separate: true,
            },
          },
        }),
      );
      return;
    }
    if (request.method === "POST" && request.url === "/resume") {
      response.statusCode = 202;
      response.end(JSON.stringify({ run_id: "run_acceptance", phase: "resuming" }));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ detail: `not found ${fakeBearer}` }));
  });
  worker.listen(0, "127.0.0.1");
  await once(worker, "listening");
  t.after(() => worker.close());
  const workerAddress = worker.address();
  assert(workerAddress && typeof workerAddress === "object");
  const previousWorkerBase = process.env.FUSION_WORKER_BASE;
  process.env.FUSION_WORKER_BASE = `http://127.0.0.1:${workerAddress.port}`;
  t.after(() => {
    if (previousWorkerBase === undefined) delete process.env.FUSION_WORKER_BASE;
    else process.env.FUSION_WORKER_BASE = previousWorkerBase;
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
  const headers = { "content-type": "application/json", "x-echo-agent": "acceptance-test" };

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
  assert.equal(listResponse.status, 200);
  const listBody = await listResponse.json();
  const tools = new Map(listBody.result.tools.map((tool) => [tool.name, tool]));
  for (const existingName of ["swarm_convene", "swarm_brief", "swarm_ping"]) {
    assert(tools.has(existingName), `existing tool ${existingName} must remain available`);
  }
  for (const maximalistName of [
    "swarm_maximalist_health",
    "swarm_maximalist_start",
    "swarm_maximalist_result",
    "swarm_maximalist_resume",
  ]) {
    assert(tools.has(maximalistName), `tools/list must advertise ${maximalistName}`);
    assert.equal(tools.get(maximalistName).outputSchema.type, "object");
  }
  assert.deepEqual(tools.get("swarm_maximalist_start").annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  });
  assert.deepEqual(tools.get("swarm_maximalist_result").annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });

  const health = await rpc(2, "swarm_maximalist_health");
  assert.equal(health.result.structuredContent.ok, true);
  assert.equal(health.result.structuredContent.profile, "MAXIMALIST_RECONSTRUCTED");
  assert.equal(health.result.structuredContent.historical_parity, false);
  assert.equal(health.result.structuredContent.core_version, "0.3.0");
  assert.equal(
    health.result.structuredContent.core_sha,
    "d1e68e2f263d93648e494c5419852693fdd03fe0",
  );
  assert.equal(health.result.structuredContent.configured_seat_count, 40);
  assert.equal(health.result.structuredContent.trinity_separate, true);
  assert.equal(health.result.structuredContent.seats_fingerprint, "63374b318f846f51");
  assert.match(health.result.content[0].text, /Maximalist Fusion/i);

  const started = await rpc(3, "swarm_maximalist_start", {
    objective: "Reconcile the architecture evidence",
    context: { source: "acceptance-test" },
    budget: { max_calls: 99_999, max_cost_usd: 999, max_wall_s: 99_999 },
    idempotency_key: "maximalist-acceptance-v1",
    worker_url: "https://attacker.invalid/fusion",
  });
  assert.equal(started.result.structuredContent.ok, true);
  assert.equal(started.result.structuredContent.run_id, "run_acceptance");
  assert.match(started.result.content[0].text, /swarm_maximalist_result/);
  const startCall = workerCalls.find((call) => call.method === "POST" && call.url === "/run");
  assert(startCall, "the plugin must call the fixed Fusion worker /run endpoint");
  assert.equal(startCall.body.objective, "Reconcile the architecture evidence");
  assert.deepEqual(startCall.body.context, { source: "acceptance-test" });
  assert.equal(startCall.body.budget.max_calls, 120);
  assert.equal(startCall.body.budget.max_cost_usd, 5);
  assert.equal(startCall.body.budget.max_wall_s, 420);
  assert.equal(startCall.body.worker_url, undefined, "callers cannot override the worker origin");

  const completed = await rpc(4, "swarm_maximalist_result", { run_id: "run_acceptance" });
  assert.equal(completed.result.structuredContent.ok, true);
  assert.equal(completed.result.structuredContent.done, true);
  assert.equal(completed.result.structuredContent.result.confidence, 0.91);
  assert.match(completed.result.content[0].text, /Verified fused answer/);
  assert.match(completed.result.content[0].text, /Preserved minority position/);
  assert.doesNotMatch(completed.result.content[0].text, /maximalist-integration-token/);
  assert.doesNotMatch(completed.result.content[0].text, /maximalist-integration-key/);
  assert.doesNotMatch(
    JSON.stringify(completed.result.structuredContent),
    /maximalist-integration-token|maximalist-integration-key/,
  );

  const resumed = await rpc(5, "swarm_maximalist_resume", { run_id: "run_acceptance" });
  assert.equal(resumed.result.structuredContent.phase, "resuming");

  historicalParity = true;
  const rejectedIdentity = await rpc(6, "swarm_maximalist_health");
  assert.equal(rejectedIdentity.result.isError, true);
  assert.match(rejectedIdentity.result.content[0].text, /identity/i);
  historicalParity = false;

  const callsBeforeInvalid = workerCalls.length;
  const invalid = await rpc(7, "swarm_maximalist_result", { run_id: "../../etc/passwd" });
  assert.equal(invalid.result.isError, true);
  assert.match(invalid.result.content[0].text, /run_id/i);
  assert.equal(workerCalls.length, callsBeforeInvalid, "invalid run ids must fail before fetch");
});
