import {
  MODEL_IDS,
  MODES,
  type AuthMode,
  type AuthModes,
  type ModelId,
  type Picks,
  type ProviderKeys,
  type SwarmMode,
} from "./catalog";
import type { SwarmTurnInput } from "./types";
import {
  authModesForEdition,
  providerKeysForEdition,
  PUBLIC_API_EDITION,
} from "./edition";

function isModelId(v: unknown): v is ModelId {
  return typeof v === "string" && (MODEL_IDS as readonly string[]).includes(v);
}

function isMode(v: unknown): v is SwarmMode {
  return typeof v === "string" && (MODES as readonly string[]).includes(v);
}

function isAuth(v: unknown): v is AuthMode {
  return v === "oauth" || v === "key";
}

function headerOr(request: Request | undefined, name: string, bodyVal: unknown): string | undefined {
  const h = request?.headers.get(name)?.trim();
  if (h) return h;
  if (typeof bodyVal === "string" && bodyVal.trim()) return bodyVal.trim();
  return undefined;
}

export function parseSwarmBody(rec: Record<string, unknown>, request?: Request): SwarmTurnInput {
  const prompt = typeof rec.prompt === "string" ? rec.prompt : "";
  const mode = isMode(rec.mode) ? rec.mode : "parallel";
  const host = isModelId(rec.host) ? rec.host : "grok";
  const seats = Array.isArray(rec.seats) ? rec.seats.filter(isModelId) : (["grok"] as ModelId[]);
  const keysRaw = rec.keys && typeof rec.keys === "object" ? (rec.keys as Record<string, unknown>) : {};
  const parsedKeys: ProviderKeys = {
    grok: headerOr(request, "x-grok-key", keysRaw.grok),
    openai: headerOr(request, "x-openai-key", keysRaw.openai),
    anthropic: headerOr(request, "x-anthropic-key", keysRaw.anthropic),
    google: headerOr(request, "x-google-key", keysRaw.google),
    deepseek: headerOr(request, "x-deepseek-key", keysRaw.deepseek),
    mistral: headerOr(request, "x-mistral-key", keysRaw.mistral),
    openrouter: headerOr(request, "x-openrouter-key", keysRaw.openrouter),
    groq: headerOr(request, "x-groq-key", keysRaw.groq),
    together: headerOr(request, "x-together-key", keysRaw.together),
    samba: headerOr(request, "x-samba-key", keysRaw.samba),
    cerebras: headerOr(request, "x-cerebras-key", keysRaw.cerebras),
    fireworks: headerOr(request, "x-fireworks-key", keysRaw.fireworks),
    perplexity: headerOr(request, "x-perplexity-key", keysRaw.perplexity),
    cohere: headerOr(request, "x-cohere-key", keysRaw.cohere),
    github: headerOr(request, "x-github-token", keysRaw.github),
    forgeUrl: headerOr(request, "x-forge-url", keysRaw.forgeUrl),
    forge: typeof keysRaw.forge === "string" ? keysRaw.forge : undefined,
    forgeModel: typeof keysRaw.forgeModel === "string" ? keysRaw.forgeModel : undefined,
    temperUrl: headerOr(request, "x-temper-url", keysRaw.temperUrl),
    temper: typeof keysRaw.temper === "string" ? keysRaw.temper : undefined,
    temperModel: typeof keysRaw.temperModel === "string" ? keysRaw.temperModel : undefined,
  };
  const authRaw = rec.auth && typeof rec.auth === "object" ? (rec.auth as Record<string, unknown>) : {};
  const parsedAuth: AuthModes = {
    grok: isAuth(authRaw.grok) ? authRaw.grok : "oauth",
    openai: isAuth(authRaw.openai) ? authRaw.openai : "oauth",
    anthropic: isAuth(authRaw.anthropic) ? authRaw.anthropic : "oauth",
    deepseek: isAuth(authRaw.deepseek) ? authRaw.deepseek : "oauth",
    github: isAuth(authRaw.github) ? authRaw.github : "oauth",
  };
  const keys = providerKeysForEdition(parsedKeys);
  const auth = authModesForEdition(parsedAuth);
  const picksRaw = rec.picks && typeof rec.picks === "object" ? (rec.picks as Record<string, unknown>) : {};
  const picks: Picks = {};
  for (const [k, v] of Object.entries(picksRaw)) {
    if (isModelId(k) && typeof v === "string" && v.trim()) picks[k] = v.trim();
  }
  const histRaw = Array.isArray(rec.history) ? rec.history : [];
  const history = histRaw
    .filter((h): h is Record<string, unknown> => !!h && typeof h === "object")
    .slice(0, 24)
    .map((h) => ({
      role: h.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: typeof h.content === "string" ? h.content : "",
      modelId: isModelId(h.modelId) ? h.modelId : undefined,
    }));
  const insightsRaw = Array.isArray(rec.insights) ? rec.insights : [];
  const insights = insightsRaw
    .filter((i): i is Record<string, unknown> => !!i && typeof i === "object")
    .slice(0, 40)
    .map((i) => ({
      id: typeof i.id === "string" ? i.id : crypto.randomUUID(),
      title: typeof i.title === "string" ? i.title : "",
      body: typeof i.body === "string" ? i.body : "",
      from: isModelId(i.from) ? i.from : host,
    }));
  return {
    prompt,
    mode,
    host,
    seats: seats.length ? seats : ["grok"],
    keys,
    auth,
    picks,
    history,
    insights,
  };
}

export const PLUGIN_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "content-type, authorization, x-echo-agent, x-echo-caller, x-swarm-agent, x-swarm-token, x-openai-key, x-anthropic-key, x-google-key, x-deepseek-key, x-grok-key, x-github-token, x-forge-url, x-temper-url, x-groq-key, x-together-key, x-openrouter-key, x-samba-key, x-cohere-key, x-perplexity-key, x-mistral-key, x-cerebras-key, x-fireworks-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function editionCredentialSummary() {
  return PUBLIC_API_EDITION
    ? {
        edition: "public-api" as const,
        credentialMode: "caller-api-keys" as const,
        serverRemoteCredentials: false,
      }
    : {
        edition: "private-oauth" as const,
        credentialMode: "oauth-and-signed-sessions" as const,
        serverRemoteCredentials: true,
      };
}
