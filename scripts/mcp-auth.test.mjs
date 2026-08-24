import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Mirror of src/lib/swarm/mcp-auth.ts for Node test without TS loader.
 * Keep in sync when changing the allowlist / gate.
 */
const APPROVED_AGENTS = new Set([
  "grok",
  "chatgpt",
  "claude",
  "codex",
  "gemini",
  "echo",
  "echo-agent",
  "acceptance-test",
]);

function agentFromHeaders(headers) {
  return (
    headers.get("x-echo-agent") ||
    headers.get("x-echo-caller") ||
    headers.get("x-swarm-agent") ||
    ""
  )
    .trim()
    .toLowerCase();
}

function bearerFromHeaders(headers) {
  const auth = headers.get("authorization")?.trim() || "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    const tok = auth.slice(7).trim();
    return tok || undefined;
  }
  const alt = headers.get("x-swarm-token")?.trim();
  return alt || undefined;
}

function authorize(headers, expectedToken) {
  const agent = agentFromHeaders(headers);
  if (!agent) return { ok: false, status: 401, error: "missing_x_echo_agent" };
  if (!APPROVED_AGENTS.has(agent)) return { ok: false, status: 403, error: "agent_not_allowed" };
  if (expectedToken) {
    const got = bearerFromHeaders(headers);
    if (!got || got !== expectedToken) return { ok: false, status: 401, error: "unauthorized" };
  }
  return { ok: true, agent };
}

describe("swarm mcp-auth", () => {
  it("rejects missing agent", () => {
    const r = authorize(new Headers(), undefined);
    assert.equal(r.ok, false);
    assert.equal(r.error, "missing_x_echo_agent");
  });

  it("rejects unknown agent", () => {
    const r = authorize(new Headers({ "x-echo-agent": "evil" }), undefined);
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
  });

  it("accepts allowlisted surfaces", () => {
    for (const a of ["grok", "chatgpt", "claude", "codex", "gemini"]) {
      const r = authorize(new Headers({ "x-echo-agent": a }), undefined);
      assert.equal(r.ok, true);
      assert.equal(r.agent, a);
    }
  });

  it("enforces bearer when token configured", () => {
    const h = new Headers({ "x-echo-agent": "claude" });
    assert.equal(authorize(h, "secret-token-here").ok, false);
    h.set("authorization", "Bearer secret-token-here");
    const r = authorize(h, "secret-token-here");
    assert.equal(r.ok, true);
  });

  it("accepts x-swarm-token alternate", () => {
    const h = new Headers({
      "x-echo-agent": "codex",
      "x-swarm-token": "secret-token-here",
    });
    assert.equal(authorize(h, "secret-token-here").ok, true);
  });
});
