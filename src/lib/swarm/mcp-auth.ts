/** Surface identity + optional bearer gate for Swarm MCP / plugin HTTP. */

export const APPROVED_AGENTS = new Set([
  "grok",
  "chatgpt",
  "claude",
  "codex",
  "gemini",
  "echo",
  "echo-agent",
  "acceptance-test",
]);

export type McpAuthOk = { ok: true; agent: string };
export type McpAuthErr = { ok: false; status: number; error: string };
export type McpAuthResult = McpAuthOk | McpAuthErr;

export function agentFromHeaders(headers: Headers): string {
  return (
    headers.get("x-echo-agent") ||
    headers.get("x-echo-caller") ||
    headers.get("x-swarm-agent") ||
    ""
  )
    .trim()
    .toLowerCase();
}

export function bearerFromHeaders(headers: Headers): string | undefined {
  const auth = headers.get("authorization")?.trim() || "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    const tok = auth.slice(7).trim();
    return tok || undefined;
  }
  const alt = headers.get("x-swarm-token")?.trim();
  return alt || undefined;
}

export function expectedSwarmToken(): string | undefined {
  const t = process.env.SWARM_MCP_TOKEN?.trim();
  return t && t.length >= 8 ? t : undefined;
}

/**
 * Fail closed when SWARM_MCP_TOKEN is set (Bearer / x-swarm-token).
 * Always require an allowlisted x-echo-agent surface identity.
 */
export function authorizePluginRequest(request: Request): McpAuthResult {
  const agent = agentFromHeaders(request.headers);
  if (!agent) {
    return {
      ok: false,
      status: 401,
      error: "missing_x_echo_agent",
    };
  }
  if (!APPROVED_AGENTS.has(agent)) {
    return {
      ok: false,
      status: 403,
      error: "agent_not_allowed",
    };
  }

  const expected = expectedSwarmToken();
  if (expected) {
    const got = bearerFromHeaders(request.headers);
    if (!got || got !== expected) {
      return {
        ok: false,
        status: 401,
        error: "unauthorized",
      };
    }
  }

  return { ok: true, agent };
}
