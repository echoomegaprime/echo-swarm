/**
 * Self-contained OAuth2 + RFC 7591 dynamic-client-registration store for the
 * Swarm MCP plugin, so remote MCP clients (Grok, ChatGPT, Claude) auto-register
 * instead of hitting a manual "OAuth Credentials Required" form.
 *
 * Access tokens are persisted to a small JSON file so the OAuth middleware
 * (vite-config realm) and the MCP auth gate (SSR realm) validate against the
 * same source of truth. Clients + codes live in memory (register -> authorize
 * -> token all run in the middleware realm).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const OAUTH_SCOPES = ["swarm.read", "swarm.write", "offline_access"];

const TOKENS_FILE =
  process.env.SWARM_OAUTH_TOKENS_FILE || path.join(os.tmpdir(), "swarm_oauth_tokens.json");

type Client = { client_id: string; redirect_uris: string[]; created: number };
type Code = {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string;
  exp: number;
};
type TokenRec = { exp: number; scope: string; client_id: string; refresh: boolean };

const clients = new Map<string, Client>();
const codes = new Map<string, Code>();

function loadTokens(): Record<string, TokenRec> {
  try {
    return JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8")) as Record<string, TokenRec>;
  } catch {
    return {};
  }
}
function saveTokens(t: Record<string, TokenRec>): void {
  try {
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(t));
  } catch {
    /* best effort */
  }
}

/** Host+path-pinned redirect allowlist — mirrors the echo-unified-mcp-bridge. */
export function redirectAllowed(u: string): boolean {
  try {
    const p = new URL(u);
    const host = (p.hostname || "").toLowerCase();
    if (p.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(host)) return true;
    if (p.protocol !== "https:") return false;
    if (["chatgpt.com", "chat.openai.com"].includes(host)) return true;
    if (["claude.ai", "claude.com"].includes(host) && p.pathname === "/api/mcp/auth_callback")
      return true;
    if (
      ["grok.com", "www.grok.com"].includes(host) &&
      ["/oauth/callback", "/connectors-oauth-exchange-code/"].includes(p.pathname)
    )
      return true;
    if (
      (host.endsWith(".grok.com") || host.endsWith(".grok-sandbox.com")) &&
      p.pathname === "/oauth/callback"
    )
      return true;
    if (["x.ai", "www.x.ai"].includes(host) && p.pathname === "/oauth/callback") return true;
    return false;
  } catch {
    return false;
  }
}

export function registerClient(redirect_uris: string[]): Client {
  const valid = (redirect_uris || []).filter(redirectAllowed);
  if (!valid.length) throw new Error("invalid_redirect_uri");
  const client_id = "swarm-" + crypto.randomBytes(16).toString("hex");
  const c: Client = { client_id, redirect_uris: valid, created: Date.now() };
  clients.set(client_id, c);
  return c;
}

export function getClient(id: string | null): Client | undefined {
  return id ? clients.get(id) : undefined;
}

export function issueCode(
  client_id: string,
  redirect_uri: string,
  code_challenge: string,
  scope: string,
): string {
  const code = crypto.randomBytes(24).toString("base64url");
  codes.set(code, {
    client_id,
    redirect_uri,
    code_challenge,
    scope: scope || OAUTH_SCOPES.join(" "),
    exp: Date.now() + 300_000,
  });
  return code;
}

function pkceOk(verifier: string, challenge: string): boolean {
  if (!challenge || !verifier) return false;
  const h = crypto.createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(h);
  const b = Buffer.from(challenge);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function newToken(client_id: string, scope: string, ttlMs: number, refresh: boolean): string {
  const tok = crypto.randomBytes(32).toString("base64url");
  const t = loadTokens();
  t[tok] = { exp: Date.now() + ttlMs, scope, client_id, refresh };
  saveTokens(t);
  return tok;
}

export function exchangeCode(
  code: string,
  verifier: string,
  redirect_uri: string,
  client_id: string,
): { error?: string; access?: string; refresh?: string; scope?: string } {
  const item = codes.get(code);
  if (item) codes.delete(code);
  if (!item || item.exp < Date.now()) return { error: "invalid_grant" };
  if (item.client_id !== client_id) return { error: "invalid_grant" };
  if (item.redirect_uri !== redirect_uri) return { error: "invalid_grant" };
  if (!pkceOk(verifier, item.code_challenge)) return { error: "invalid_grant" };
  const access = newToken(client_id, item.scope, 3_600_000, false);
  const refresh = newToken(client_id, item.scope, 30 * 86_400_000, true);
  return { access, refresh, scope: item.scope };
}

export function refreshToken(
  refresh: string,
  _client_id: string,
): { error?: string; access?: string; scope?: string } {
  const t = loadTokens();
  const rec = t[refresh];
  if (!rec || !rec.refresh || rec.exp < Date.now()) return { error: "invalid_grant" };
  const access = newToken(rec.client_id, rec.scope, 3_600_000, false);
  return { access, scope: rec.scope };
}

/** True iff `tok` is a live, non-refresh access token. Used by the MCP gate. */
export function validateToken(tok: string | undefined): boolean {
  if (!tok) return false;
  const rec = loadTokens()[tok];
  if (!rec || rec.refresh) return false;
  return rec.exp >= Date.now();
}
