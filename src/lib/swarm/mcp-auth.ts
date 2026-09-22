/** Surface identity + optional bearer gate for Swarm MCP / plugin HTTP. */

import { timingSafeEqual } from "node:crypto";

import { validateToken as isValidOAuthToken } from "./oauth-store";

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

function tokensEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

export function expectedSwarmToken(): string | undefined {
  const t = process.env.SWARM_MCP_TOKEN?.trim();
  return t && t.length >= 8 ? t : undefined;
}

/**
 * Valid OAuth bearer, or allowlisted x-echo-agent plus SWARM_MCP_TOKEN
 * (Bearer / x-swarm-token). Fails closed when SWARM_MCP_TOKEN is unset.
 * Always require an allowlisted x-echo-agent surface identity.
 */
export function authorizePluginRequest(request: Request): McpAuthResult {
  const agent = agentFromHeaders(request.headers);
  const oauthBearer = bearerFromHeaders(request.headers);
  if (oauthBearer && isValidOAuthToken(oauthBearer)) {
    return { ok: true, agent: agent || "grok" };
  }
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

  // Fail closed: header-only surfaces must present SWARM_MCP_TOKEN. An unset
  // token previously left the public endpoint open to any allowlisted header.
  const expected = expectedSwarmToken();
  if (!expected) {
    return {
      ok: false,
      status: 503,
      error: "swarm_token_unconfigured",
    };
  }
  const got = bearerFromHeaders(request.headers);
  if (!got || !tokensEqual(got, expected)) {
    return {
      ok: false,
      status: 401,
      error: "unauthorized",
    };
  }

  return { ok: true, agent };
}
