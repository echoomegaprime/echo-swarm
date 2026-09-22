import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough, Writable } from "node:stream";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let vite;
let cli;
let engine;
let catalog;
let responses;
let subscriptions;
before(async () => {
  vite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });
  cli = await vite.ssrLoadModule("/src/lib/swarm/codex-cli.server.ts");
  engine = await vite.ssrLoadModule("/src/lib/swarm/engine.server.ts");
  catalog = await vite.ssrLoadModule("/src/lib/swarm/model-catalog.server.ts");
  responses = await vite.ssrLoadModule("/src/lib/swarm/openai-responses.server.ts");
  subscriptions = await vite.ssrLoadModule("/src/lib/swarm/subscription-cli.server.ts");
});
after(async () => {
  await vite?.close();
});

test("private Grok and Claude use their own official clients instead of copied API/session tokens", () => {
  for (const [id, model] of [
    ["grok", "grok-4.7"],
    ["claude", "claude-fable-5-1"],
  ]) {
    const seat = engine.resolveSeat(
      id,
      { grok: "example-session", anthropic: "example-session" },
      {},
      { [id]: model },
    );
    assert.equal(seat.via, "subscription-cli");
    assert.equal(seat.key, "");
    const args = subscriptions.subscriptionArguments(id, model, "/isolated/prompt.txt");
    assert.equal(args[args.indexOf("--tools") + 1], "");
    assert.equal(args[args.indexOf("--model") + 1], model);
    assert.ok(!args.includes("--dangerously-skip-permissions"));
    assert.throws(() => subscriptions.subscriptionArguments(id, "--help", "test"));
  }
});

test("CLI adapters require completed turns and retain route attribution", () => {
  const grok = subscriptions.parseSubscriptionOutput(
    "grok",
    "grok-4.7",
    JSON.stringify({ text: "GROK", stopReason: "end_turn", modelUsage: { "grok-4.7": {} } }),
    0,
  );
  assert.equal(grok.ok, true);
  assert.equal(grok.route, "grok-build-subscription");
  const claude = subscriptions.parseSubscriptionOutput(
    "claude",
    "claude-fable-5-1",
    JSON.stringify({ result: "CLAUDE", subtype: "success", is_error: false }),
    0,
  );
  assert.equal(claude.ok, true);
  assert.equal(claude.route, "claude-code-subscription");
  assert.equal(
    subscriptions.parseSubscriptionOutput(
      "grok",
      "grok-4.7",
      JSON.stringify({ text: "partial", stopReason: "max_tokens" }),
      0,
    ).ok,
    false,
  );
  assert.equal(
    subscriptions.parseSubscriptionOutput(
      "claude",
      "claude-fable-5-1",
      JSON.stringify({ result: "partial", subtype: "error_max_turns" }),
      0,
    ).ok,
    false,
  );
});

test("live catalog accepts only text models and excludes batch-only routes and malformed IDs", () => {
  const variants = catalog.parsePublicModels({
    data: [
      { id: "openai/gpt-6-astra", name: "Astra", architecture: { output_modalities: ["text"] } },
      {
        id: "openai/gpt-6-astra:batch",
        name: "Batch",
        architecture: { output_modalities: ["text"] },
      },
      { id: "image/model", architecture: { output_modalities: ["image"] } },
      { id: "invalid;command", architecture: { output_modalities: ["text"] } },
      { id: "openai/gpt-6-astra", name: "Astra", architecture: { output_modalities: ["text"] } },
    ],
  });
  assert.deepEqual(variants, [{ id: "openai/gpt-6-astra", label: "Astra" }]);
});

test("private GPT selects Codex even when API and GitHub credentials are supplied", () => {
  const seat = engine.resolveSeat(
    "gpt",
    { openai: "example-key", github: "example-token" },
    { openai: "key" },
    { gpt: "gpt-6-astra" },
  );
  assert.equal(seat.via, "codex-cli");
  assert.equal(seat.model, "gpt-6-astra");
  assert.equal(seat.key, "");
  assert.equal(seat.url, "");
});

test("CLI preserves the model ID and keeps prompts and provider secrets out of arguments/environment", () => {
  const args = cli.codexArguments("gpt-6-astra");
  assert.equal(args[args.indexOf("--model") + 1], "gpt-6-astra");
  assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
  assert.equal(args.at(-1), "-");
  assert.ok(args.includes("--ephemeral"));
  assert.ok(!args.some((value) => value.includes("bypass")));
  assert.throws(() => cli.codexArguments("gpt-6-astra;whoami"));
  assert.throws(() => cli.codexArguments("--help"));
  const env = cli.codexEnvironment({
    PATH: "safe-path",
    HOME: "/official-client-home",
    OPENAI_API_KEY: "secret",
    ANTHROPIC_API_KEY: "secret",
    GITHUB_TOKEN: "secret",
    NODE_OPTIONS: "--require evil",
  });
  assert.deepEqual(env, { PATH: "safe-path", HOME: "/official-client-home" });
});

test("partial or failed CLI turns cannot become successful model responses", () => {
  const partial = JSON.stringify({
    type: "item.completed",
    item: { type: "agent_message", text: "partial" },
  });
  assert.equal(cli.parseCodexOutput(partial, "gpt-6-astra").ok, false);
  const failed =
    partial +
    "\n" +
    JSON.stringify({ type: "turn.failed", error: { message: "usage limit: fake-private-detail" } });
  const result = cli.parseCodexOutput(failed, "gpt-6-astra");
  assert.equal(result.ok, false);
  assert.equal(result.fallbackEligible, false);
  assert.match(result.error, /subscription usage/);
  assert.doesNotMatch(result.error, /fake-private-detail/);
});

test("a complete CLI answer carries the requested model and observed token usage", () => {
  const output = [
    { type: "item.completed", item: { type: "agent_message", text: "READY" } },
    {
      type: "turn.completed",
      usage: { input_tokens: 12, cached_input_tokens: 4, output_tokens: 2 },
    },
  ]
    .map(JSON.stringify)
    .join("\n");
  const result = cli.parseCodexOutput(output, "gpt-6-astra");
  assert.equal(result.ok, true);
  assert.equal(result.text, "READY");
  assert.equal(result.route, "codex-cli-subscription");
  assert.equal(result.model, "gpt-6-astra");
  assert.deepEqual(result.usage, { prompt: 12, completion: 2 });
});

test("council GPT uses stdin and cannot bill an API using a session token after quota failure", async (t) => {
  const calls = [];
  t.mock.method(childProcess, "spawn", (file, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let prompt = "";
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        prompt += chunk.toString();
        callback();
      },
      final(callback) {
        calls.push({ file, args, options, prompt });
        setImmediate(() => {
          if (args[0] === "login") {
            child.stderr.write("Logged in using ChatGPT\n");
            child.emit("close", 0);
          } else {
            child.stdout.write(
              JSON.stringify({
                type: "turn.failed",
                error: { message: "You've hit your usage limit." },
              }) + "\n",
            );
            child.emit("close", 1);
          }
        });
        callback();
      },
    });
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  let httpCalls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    httpCalls += 1;
    throw new Error("Unexpected API fallback");
  });
  const result = await engine.runSwarm({
    prompt: "SUBPROCESS_NONCE",
    mode: "parallel",
    host: "gpt",
    seats: ["gpt"],
    keys: { openai: "example-key", github: "example-token" },
    auth: {},
    picks: { gpt: "gpt-6-astra" },
    history: [],
    insights: [],
  });
  assert.equal(result.ok, true);
  assert.equal(result.turns[0].content, "");
  assert.match(result.turns[0].error, /subscription usage/);
  assert.equal(httpCalls, 0);
  assert.equal(calls.length, 2);
  const invocation = calls[1];
  assert.equal(invocation.options.shell, false);
  assert.match(invocation.prompt, /SUBPROCESS_NONCE/);
  assert.ok(!invocation.args.some((value) => value.includes("SUBPROCESS_NONCE")));
});

function mockCodex(t, events, calls = []) {
  t.mock.method(childProcess, "spawn", (file, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
      final(callback) {
        calls.push({ file, args, options });
        setImmediate(() => {
          if (args[0] === "login") child.stderr.write("Logged in using ChatGPT\n");
          else for (const event of events) child.stdout.write(JSON.stringify(event) + "\n");
          child.emit("close", 0);
        });
        callback();
      },
    });
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
}

function gptRequest() {
  return {
    prompt: "ROUTE_CHECK",
    mode: "parallel",
    host: "gpt",
    seats: ["gpt"],
    keys: { openai: "sk-example-test-only" },
    auth: { openai: "key" },
    picks: { gpt: "gpt-6-astra" },
    history: [],
    insights: [],
  };
}

test("a successful CLI answer wins even when a paid API fallback is configured", async (t) => {
  mockCodex(t, [
    { type: "item.completed", item: { type: "agent_message", text: "SUBSCRIPTION" } },
    { type: "turn.completed" },
  ]);
  let apiCalls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    apiCalls++;
    throw Error("unexpected API");
  });
  const result = await engine.runSwarm(gptRequest());
  assert.equal(result.turns[0].content, "SUBSCRIPTION");
  assert.equal(result.turns[0].route, "codex-cli-subscription");
  assert.equal(apiCalls, 0);
});

test("an explicit API key enables one Responses request after a known CLI quota rejection", async (t) => {
  const calls = [];
  mockCodex(t, [{ type: "turn.failed", error: { message: "usage limit" } }], calls);
  let apiCalls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(calls.length, 2, "the official CLI must run before API billing");
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(options.redirect, "error");
    const body = JSON.parse(options.body);
    assert.equal(body.model, "gpt-6-astra");
    assert.equal(body.store, false);
    assert.equal(body.reasoning.effort, "low");
    assert.equal(body.temperature, undefined);
    assert.equal(body.max_tokens, undefined);
    apiCalls++;
    return Response.json({
      status: "completed",
      model: "gpt-6-astra-2026-09-01",
      output: [{ type: "message", content: [{ type: "output_text", text: "API_READY" }] }],
      usage: { input_tokens: 8, output_tokens: 3 },
    });
  });
  const events = [];
  const result = await engine.runSwarm(gptRequest(), (event) => events.push(event));
  assert.equal(apiCalls, 1);
  assert.equal(result.turns[0].route, "openai-api");
  assert.equal(result.turns[0].content, "API_READY");
  assert.equal(result.turns[0].model, "gpt-6-astra-2026-09-01");
  assert.equal(events.find((event) => event.type === "turn").turn.route, "openai-api");
});

test("partial CLI output blocks paid fallback even if a quota error follows", async (t) => {
  mockCodex(t, [
    { type: "item.completed", item: { type: "agent_message", text: "PARTIAL" } },
    { type: "turn.failed", error: { message: "usage limit" } },
  ]);
  let apiCalls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    apiCalls++;
    throw Error("unexpected API");
  });
  const result = await engine.runSwarm(gptRequest());
  assert.ok(result.turns[0].error);
  assert.equal(apiCalls, 0);
});

test("incomplete API answers and provider error details never become successful output", async (t) => {
  let apiCalls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    apiCalls++;
    return apiCalls === 1
      ? Response.json({
          status: "incomplete",
          output: [{ type: "message", content: [{ type: "output_text", text: "PARTIAL" }] }],
        })
      : Response.json({ error: { message: "private-project-value" } }, { status: 429 });
  });
  const options = {
    key: "sk-test",
    model: "gpt-6-astra",
    system: "test",
    messages: [{ role: "user", content: "check" }],
  };
  assert.equal((await responses.completeOpenAIResponses(options)).ok, false);
  const failed = await responses.completeOpenAIResponses(options);
  assert.equal(failed.ok, false);
  assert.match(failed.error, /HTTP 429/);
  assert.doesNotMatch(failed.error, /private-project-value/);
  assert.equal(apiCalls, 2, "a failed call is not retried");
});

test("Responses preserves the matching function call before returning a plugin result", () => {
  const input = responses.responsesInput([
    {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "call_1", name: "calculate", args: { expr: "2+2" } }],
    },
    { role: "tool", toolCallId: "call_1", content: "4" },
  ]);
  assert.equal(input[0].type, "function_call");
  assert.equal(input[1].type, "function_call_output");
  assert.equal(input[0].call_id, input[1].call_id);
});

test("public builds ignore private CLI sessions and managed API keys", async (t) => {
  const priorEdition = process.env.ECHO_SWARM_EDITION;
  const priorKey = process.env.TOGETHER_API_KEY;
  process.env.ECHO_SWARM_EDITION = "public-api";
  process.env.TOGETHER_API_KEY = "example-managed-key";
  const publicVite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });
  t.after(async () => {
    await publicVite.close();
    if (priorEdition === undefined) delete process.env.ECHO_SWARM_EDITION;
    else process.env.ECHO_SWARM_EDITION = priorEdition;
    if (priorKey === undefined) delete process.env.TOGETHER_API_KEY;
    else process.env.TOGETHER_API_KEY = priorKey;
  });
  const publicEngine = await publicVite.ssrLoadModule("/src/lib/swarm/engine.server.ts");
  for (const provider of ["gpt", "grok", "claude", "together"])
    assert.equal(publicEngine.resolveSeat(provider, {}, {}), undefined);
  const seat = publicEngine.resolveSeat(
    "gpt",
    { openai: "sk-caller-test" },
    { openai: "key" },
    { gpt: "gpt-6-astra" },
  );
  assert.equal(seat.via, undefined);
  assert.equal(seat.key, "sk-caller-test");
  assert.equal(seat.model, "gpt-6-astra");
});
