import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { PUBLIC_API_EDITION } from "./edition";

const exec = promisify(execFile);
const GH_CLI_CLIENT = "Iv1.b507a08c87ecfe98";

function githubClientId(): string {
  return process.env.GITHUB_CLIENT_ID?.trim() || process.env.GH_CLIENT_ID?.trim() || GH_CLI_CLIENT;
}

export interface CliTokens {
  github?: string;
  openai?: string;
  anthropic?: string;
  grok?: string;
  sources: string[];
}

function pickStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 8 ? v.trim() : undefined;
}

async function readJson(path: string): Promise<unknown | undefined> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

async function ghToken(): Promise<string | undefined> {
  try {
    const { stdout } = await exec("gh", ["auth", "token"], { timeout: 5000 });
    const t = stdout.trim();
    return t.length > 8 ? t : undefined;
  } catch {
    return undefined;
  }
}

export async function pullCliAuth(): Promise<CliTokens> {
  if (PUBLIC_API_EDITION) {
    return { sources: [] };
  }
  const sources: string[] = [];
  const home = homedir();
  let github = await ghToken();
  if (github) sources.push("gh auth token");

  const claudePaths = [
    join(home, ".claude", ".credentials.json"),
    join(home, ".claude", "credentials.json"),
    join(home, ".config", "claude", "credentials.json"),
    join(home, ".config", "claude-code", "credentials.json"),
  ];
  let anthropic: string | undefined;
  for (const p of claudePaths) {
    const j = await readJson(p);
    if (!j || typeof j !== "object") continue;
    const rec = j as Record<string, unknown>;
    const nested =
      rec.claudeAiOauth && typeof rec.claudeAiOauth === "object"
        ? (rec.claudeAiOauth as Record<string, unknown>)
        : rec;
    anthropic =
      pickStr(nested.accessToken) ||
      pickStr(nested.access_token) ||
      pickStr(rec.accessToken) ||
      pickStr(rec.access_token);
    if (anthropic) {
      sources.push(p.replace(home, "~"));
      break;
    }
  }

  let openai: string | undefined;
  const codex = await readJson(join(home, ".codex", "auth.json"));
  if (codex && typeof codex === "object") {
    const rec = codex as Record<string, unknown>;
    const tokens = rec.tokens && typeof rec.tokens === "object" ? (rec.tokens as Record<string, unknown>) : rec;
    openai = pickStr(tokens.access_token) || pickStr(rec.access_token) || pickStr(rec.OPENAI_API_KEY);
    if (openai) sources.push("~/.codex/auth.json");
  }

  const grok = pickStr(process.env.XAI_OAUTH_TOKEN);
  if (grok) sources.push("XAI_OAUTH_TOKEN");
  if (!github) {
    github = pickStr(process.env.GITHUB_TOKEN) || pickStr(process.env.GH_TOKEN);
    if (github) sources.push("GITHUB_TOKEN");
  }

  return { github, openai, anthropic, grok, sources };
}

interface DeviceStart {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export async function startGithubDevice(): Promise<
  { ok: true; data: DeviceStart } | { ok: false; error: string }
> {
  return startGithubDeviceWithScope("read:user gist copilot");
}

export async function startCommanderGithubDevice(): Promise<
  { ok: true; data: DeviceStart } | { ok: false; error: string }
> {
  return startGithubDeviceWithScope("read:user");
}

async function startGithubDeviceWithScope(
  scope: string,
): Promise<{ ok: true; data: DeviceStart } | { ok: false; error: string }> {
  if (PUBLIC_API_EDITION) {
    return { ok: false, error: "OAuth device authorization is disabled in the public API-key edition." };
  }
  const clientId = githubClientId();
  const body = new URLSearchParams({
    client_id: clientId,
    scope,
  });
  try {
    const res = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const json = (await res.json()) as DeviceStart & { error?: string; error_description?: string };
    if (!res.ok || !json.device_code) {
      return { ok: false, error: json.error_description || json.error || `GitHub device HTTP ${res.status}` };
    }
    return {
      ok: true,
      data: {
        device_code: json.device_code,
        user_code: json.user_code,
        verification_uri: json.verification_uri || "https://github.com/login/device",
        expires_in: json.expires_in ?? 900,
        interval: json.interval ?? 5,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "GitHub device start failed." };
  }
}

export async function pollGithubDevice(
  deviceCode: string,
): Promise<{ ok: true; token: string } | { ok: false; error: string; pending?: boolean }> {
  if (PUBLIC_API_EDITION) {
    return { ok: false, error: "OAuth device authorization is disabled in the public API-key edition." };
  }
  const clientId = githubClientId();
  const body = new URLSearchParams({
    client_id: clientId,
    device_code: deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  });
  try {
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const json = (await res.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };
    if (json.access_token) return { ok: true, token: json.access_token };
    if (json.error === "authorization_pending" || json.error === "slow_down") {
      return { ok: false, error: json.error, pending: true };
    }
    return { ok: false, error: json.error_description || json.error || "GitHub device denied." };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "GitHub poll failed." };
  }
}
