import {
  FORGE_DEFAULT_MODEL,
  FORGE_DEFAULT_URL,
  GITHUB_FALLBACK,
  GITHUB_MODELS_URL,
  MODELS,
  PLUGINS,
  TEMPER_DEFAULT_MODEL,
  chatCompletionsUrl,
  chosenModel,
  type AuthMode,
  type AuthModes,
  type KeyField,
  type ModelDef,
  type ModelId,
  type Picks,
  type ProviderKeys,
  type SwarmMode,
} from "./catalog";
import type {
  BuildPhase,
  Insight,
  SeatTurn,
  SwarmEvent,
  SwarmTurnInput,
  SwarmTurnResult,
  TokenUsage,
  ToolTrace,
} from "./types";

const MAX_TOKENS = 700;
const FETCH_MS = 50_000;
const LOCAL_FETCH_MS = 90_000;
const MAX_TURNS_PER_MINUTE = 10;
const MAX_PEER = 4;
const MAX_TOOL_ROUNDS = 2;

const recentRuns: number[] = [];

function allowRun(): boolean {
  const now = Date.now();
  while (recentRuns.length && now - recentRuns[0]! > 60_000) recentRuns.shift();
  if (recentRuns.length >= MAX_TURNS_PER_MINUTE) return false;
  recentRuns.push(now);
  return true;
}

function sanitize(text: string): string {
  return text
    .replace(/Bearer\s+\S+/gi, "Bearer ***")
    .replace(/sk-[a-zA-Z0-9-._]+/g, "sk-***")
    .replace(/xai-[a-zA-Z0-9-._]+/g, "xai-***")
    .replace(/AIza[a-zA-Z0-9-._]+/g, "AIza***")
    .replace(/gho_[a-zA-Z0-9]+/g, "gho_***")
    .replace(/ghp_[a-zA-Z0-9]+/g, "ghp_***")
    .replace(/github_pat_[a-zA-Z0-9_]+/g, "github_pat_***");
}

function envOf(...names: string[]): string | undefined {
  for (const n of names) {
    const k = process.env[n];
    if (k && k.trim().length > 4) return k.trim();
  }
  return undefined;
}

export function grokIsLive(): boolean {
  return Boolean(envOf("XAI_API_KEY"));
}

export function githubEnvToken(): string | undefined {
  return envOf("GITHUB_TOKEN", "GH_TOKEN");
}

export function forgeEnv() {
  return {
    url: envOf("FORGE_BASE_URL", "FORGE_QWEN_URL"),
    key: envOf("FORGE_API_KEY", "QCODER_LOCAL_API_KEY"),
    model: envOf("FORGE_MODEL"),
  };
}

export function temperEnv() {
  return {
    url: envOf("TEMPER_BASE_URL", "TEMPER_QWEN_URL"),
    key: envOf("TEMPER_API_KEY"),
    model: envOf("TEMPER_MODEL"),
  };
}

export function providerStatus() {
  const env: Partial<Record<KeyField, boolean>> = {};
  for (const id of Object.keys(MODELS) as ModelId[]) {
    const def = MODELS[id];
    if (def.envVars?.some((n) => envOf(n))) env[def.keyField] = true;
  }
  return {
    grok: grokIsLive(),
    github: Boolean(githubEnvToken()),
    forge: Boolean(forgeEnv().url),
    temper: Boolean(temperEnv().url),
    env,
  };
}

function authFor(field: keyof AuthModes, auth: AuthModes): AuthMode {
  return auth[field] ?? "oauth";
}

interface Resolved {
  id: ModelId;
  def: ModelDef;
  key: string;
  url: string;
  model: string;
  kind: ModelDef["kind"];
  auth: AuthMode;
  via?: "github";
  extraHeaders?: Record<string, string>;
}

export function resolveSeat(
  id: ModelId,
  keys: ProviderKeys,
  auth: AuthModes,
  picks?: Picks,
): Resolved | undefined {
  const def = MODELS[id];
  if (!def) return undefined;
  const model = chosenModel(id, picks, keys);

  if (id === "qwen") {
    const env = forgeEnv();
    const url = keys.forgeUrl?.trim() || env.url || FORGE_DEFAULT_URL;
    const key = keys.forge?.trim() || env.key || "local";
    // Local FORGE seat is always armed when a default OpenAI-compatible URL exists.
    const armed = Boolean(url);
    if (!armed) return undefined;
    return { id, def, key, url: chatCompletionsUrl(url), model, kind: "local", auth: "key" };
  }

  if (id === "qwenimg") {
    const env = temperEnv();
    const url = keys.temperUrl?.trim() || env.url;
    const key = keys.temper?.trim() || env.key || "local";
    if (!url) return undefined;
    return { id, def, key, url: chatCompletionsUrl(url), model, kind: "local", auth: "key" };
  }

  if (id === "github") {
    const key = keys.github?.trim() || githubEnvToken();
    if (!key) return undefined;
    return {
      id,
      def,
      key,
      url: GITHUB_MODELS_URL,
      model: chosenModel(id, picks, keys),
      kind: "openai",
      auth: authFor("github", auth),
    };
  }

  if (id === "grok") {
    const key = keys.grok?.trim() || envOf("XAI_API_KEY");
    if (!key) return undefined;
    return {
      id,
      def,
      key,
      url: def.url!,
      model: chosenModel(id, picks, keys),
      kind: "openai",
      auth: authFor("grok", auth),
    };
  }

  if (id === "gpt") {
    if (keys.openai?.trim()) {
      return {
        id,
        def,
        key: keys.openai.trim(),
        url: def.url!,
        model: chosenModel(id, picks, keys),
        kind: "openai",
        auth: authFor("openai", auth),
      };
    }
    const gh = keys.github?.trim() || githubEnvToken();
    if (gh && GITHUB_FALLBACK.gpt) {
      return {
        id,
        def,
        key: gh,
        url: GITHUB_MODELS_URL,
        model: chosenModel(id, picks, keys, true),
        kind: "openai",
        auth: "oauth",
        via: "github",
      };
    }
    return undefined;
  }

  if (id === "claude") {
    if (keys.anthropic?.trim()) {
      return {
        id,
        def,
        key: keys.anthropic.trim(),
        url: "https://api.anthropic.com/v1/messages",
        model: chosenModel(id, picks, keys),
        kind: "anthropic",
        auth: authFor("anthropic", auth),
      };
    }
    const gh = keys.github?.trim() || githubEnvToken();
    if (gh && GITHUB_FALLBACK.claude) {
      return {
        id,
        def,
        key: gh,
        url: GITHUB_MODELS_URL,
        model: chosenModel(id, picks, keys, true),
        kind: "openai",
        auth: "oauth",
        via: "github",
      };
    }
    return undefined;
  }

  if (id === "gemini") {
    const key = keys.google?.trim() || envOf("GOOGLE_API_KEY", "GEMINI_API_KEY");
    if (!key) return undefined;
    return {
      id,
      def,
      key,
      url: "",
      model: chosenModel(id, picks, keys),
      kind: "gemini",
      auth: "key",
    };
  }

  const key =
    keys[def.keyField]?.trim() ||
    (def.envVars?.length ? envOf(...def.envVars) : undefined);
  if (!key || !def.url) return undefined;
  return {
    id,
    def,
    key,
    url: def.url,
    model,
    kind: def.kind === "local" ? "openai" : def.kind,
    auth: def.oauth ? authFor(def.keyField as keyof AuthModes, auth) : "key",
    extraHeaders: def.extraHeaders,
  };
}

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs = FETCH_MS,
): Promise<{ ok: true; body: unknown } | { ok: false; error: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const raw = await res.text();
    let parsed: unknown = raw;
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      parsed = { raw };
    }
    if (!res.ok) {
      const msg =
        typeof parsed === "object" && parsed && "error" in parsed
          ? JSON.stringify((parsed as { error: unknown }).error)
          : raw.slice(0, 280);
      return { ok: false, error: sanitize(`HTTP ${res.status}: ${msg}`) };
    }
    return { ok: true, body: parsed };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "network error";
    return { ok: false, error: sanitize(msg) };
  } finally {
    clearTimeout(timer);
  }
}

interface ChatMsg {
  role: "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
}

interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

interface CompleteOk {
  ok: true;
  text: string;
  toolCalls: ToolCall[];
  usage?: TokenUsage;
}

function parseUsage(body: unknown): TokenUsage | undefined {
  if (!body || typeof body !== "object") return undefined;
  const u = (body as { usage?: Record<string, unknown>; usageMetadata?: Record<string, unknown> }).usage;
  const g = (body as { usageMetadata?: Record<string, unknown> }).usageMetadata;
  const prompt = num(u?.prompt_tokens) ?? num(u?.input_tokens) ?? num(g?.promptTokenCount);
  const completion = num(u?.completion_tokens) ?? num(u?.output_tokens) ?? num(g?.candidatesTokenCount);
  if (prompt == null && completion == null) return undefined;
  return { prompt: prompt ?? 0, completion: completion ?? 0 };
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

async function readSse(
  res: Response,
  onEvent: (json: unknown) => void,
): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        onEvent(JSON.parse(data) as unknown);
      } catch {
        /* ignore */
      }
    }
  }
}

function modelEnum() {
  return [...Object.keys(MODELS)] as ModelId[];
}

function toolProperties() {
  return {
    model: { type: "string", enum: modelEnum() },
    question: { type: "string" },
    title: { type: "string" },
    body: { type: "string" },
    expr: { type: "string" },
    prompt: { type: "string" },
  };
}

function openaiTools() {
  return PLUGINS.map((p) => ({
    type: "function" as const,
    function: {
      name: p.name,
      description: p.description,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: toolProperties(),
      },
    },
  }));
}

function anthropicTools() {
  return PLUGINS.map((p) => ({
    name: p.name,
    description: p.description,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: toolProperties(),
    },
  }));
}

function geminiTools() {
  return [
    {
      functionDeclarations: PLUGINS.map((p) => ({
        name: p.name,
        description: p.description,
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: toolProperties(),
        },
      })),
    },
  ];
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw) as unknown;
      return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  return {};
}

function openaiHeaders(key: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
}

function anthropicHeaders(key: string, auth: AuthMode): Record<string, string> {
  if (auth === "oauth") {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "oauth-2025-04-20",
    };
  }
  return {
    "Content-Type": "application/json",
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
  };
}

async function completeOpenAI(opts: {
  url: string;
  model: string;
  key: string;
  system: string;
  messages: ChatMsg[];
  tools: boolean;
  local?: boolean;
  extraHeaders?: Record<string, string>;
  maxTokens?: number;
  onDelta?: (text: string) => void;
}): Promise<CompleteOk | { ok: false; error: string }> {
  const messages: Record<string, unknown>[] = [
    { role: "system", content: opts.system },
    ...opts.messages.map((m) => {
      if (m.role === "tool") {
        return {
          role: "tool",
          tool_call_id: m.toolCallId ?? "tool",
          content: m.content,
        };
      }
      return { role: m.role, content: m.content };
    }),
  ];
  const body: Record<string, unknown> = {
    model: opts.model,
    messages,
    max_tokens: opts.maxTokens ?? (opts.local ? 1200 : MAX_TOKENS),
    temperature: 0.7,
  };
  if (opts.tools) body.tools = openaiTools();
  if (opts.onDelta && !opts.tools) {
    body.stream = true;
    body.stream_options = { include_usage: true };
    return streamOpenAI(opts, body);
  }

  const got = await fetchJson(
    opts.url,
    {
      method: "POST",
      headers: { ...openaiHeaders(opts.key), ...opts.extraHeaders },
      body: JSON.stringify(body),
    },
    opts.local ? LOCAL_FETCH_MS : FETCH_MS,
  );
  if (!got.ok) return got;

  const data = got.body as {
    choices?: {
      message?: {
        content?: string | null;
        tool_calls?: {
          id?: string;
          function?: { name?: string; arguments?: string };
        }[];
      };
    }[];
  };
  const msg = data.choices?.[0]?.message;
  const toolCalls: ToolCall[] = (msg?.tool_calls ?? []).map((t, i) => ({
    id: t.id || `call_${i}`,
    name: t.function?.name ?? "",
    args: parseArgs(t.function?.arguments),
  }));
  return {
    ok: true,
    text: msg?.content ?? "",
    toolCalls: toolCalls.filter((t) => t.name),
    usage: parseUsage(got.body),
  };
}

async function streamOpenAI(
  opts: {
    url: string;
    key: string;
    extraHeaders?: Record<string, string>;
    local?: boolean;
    onDelta?: (text: string) => void;
  },
  body: Record<string, unknown>,
): Promise<CompleteOk | { ok: false; error: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.local ? LOCAL_FETCH_MS : FETCH_MS);
  try {
    const res = await fetch(opts.url, {
      method: "POST",
      headers: { ...openaiHeaders(opts.key), ...opts.extraHeaders },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const raw = await res.text();
      return { ok: false, error: sanitize(`HTTP ${res.status}: ${raw.slice(0, 280)}`) };
    }
    let text = "";
    let usage: TokenUsage | undefined;
    await readSse(res, (json) => {
      const rec = json as {
        choices?: { delta?: { content?: string | null } }[];
        usage?: unknown;
      };
      const chunk = rec.choices?.[0]?.delta?.content;
      if (chunk) {
        text += chunk;
        opts.onDelta?.(chunk);
      }
      const u = parseUsage(json);
      if (u) usage = u;
    });
    return { ok: true, text, toolCalls: [], usage };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "network error";
    return { ok: false, error: sanitize(msg) };
  } finally {
    clearTimeout(timer);
  }
}

async function completeAnthropic(opts: {
  key: string;
  model: string;
  auth: AuthMode;
  system: string;
  messages: ChatMsg[];
  tools: boolean;
  maxTokens?: number;
  onDelta?: (text: string) => void;
}): Promise<CompleteOk | { ok: false; error: string }> {
  const messages = opts.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content }));
  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens ?? MAX_TOKENS,
    system: opts.system,
    messages,
    temperature: 0.7,
  };
  if (opts.tools) body.tools = anthropicTools();
  if (opts.onDelta && !opts.tools) {
    body.stream = true;
    return streamAnthropic(opts, body);
  }

  const got = await fetchJson("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: anthropicHeaders(opts.key, opts.auth),
    body: JSON.stringify(body),
  });
  if (!got.ok) return got;

  const data = got.body as {
    content?: { type?: string; text?: string; id?: string; name?: string; input?: unknown }[];
  };
  const blocks = data.content ?? [];
  const text = blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n")
    .trim();
  const toolCalls: ToolCall[] = blocks
    .filter((b) => b.type === "tool_use" && b.name)
    .map((b, i) => ({
      id: b.id || `call_${i}`,
      name: b.name ?? "",
      args: parseArgs(b.input),
    }));
  return { ok: true, text, toolCalls, usage: parseUsage(got.body) };
}

async function streamAnthropic(
  opts: { key: string; auth: AuthMode; onDelta?: (text: string) => void },
  body: Record<string, unknown>,
): Promise<CompleteOk | { ok: false; error: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: anthropicHeaders(opts.key, opts.auth),
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const raw = await res.text();
      return { ok: false, error: sanitize(`HTTP ${res.status}: ${raw.slice(0, 280)}`) };
    }
    let text = "";
    let usage: TokenUsage | undefined;
    await readSse(res, (json) => {
      const rec = json as {
        type?: string;
        delta?: { type?: string; text?: string };
        usage?: unknown;
        message?: { usage?: unknown };
      };
      if (rec.delta?.text) {
        text += rec.delta.text;
        opts.onDelta?.(rec.delta.text);
      }
      const u = parseUsage(json) || parseUsage(rec.message);
      if (u) usage = u;
    });
    return { ok: true, text, toolCalls: [], usage };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "network error";
    return { ok: false, error: sanitize(msg) };
  } finally {
    clearTimeout(timer);
  }
}

async function completeGemini(opts: {
  key: string;
  model: string;
  system: string;
  messages: ChatMsg[];
  maxTokens?: number;
  onDelta?: (text: string) => void;
}): Promise<CompleteOk | { ok: false; error: string }> {
  const contents = opts.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
  const payload = {
    system_instruction: { parts: [{ text: opts.system }] },
    contents,
    tools: geminiTools(),
    generationConfig: { maxOutputTokens: opts.maxTokens ?? MAX_TOKENS, temperature: 0.7 },
  };
  if (opts.onDelta) {
    const streamed = await streamGemini(opts, payload);
    if (streamed.ok) return streamed;
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:generateContent?key=${encodeURIComponent(opts.key)}`;
  const got = await fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!got.ok) return got;
  const data = got.body as {
    candidates?: {
      content?: {
        parts?: {
          text?: string;
          functionCall?: { name?: string; args?: unknown };
        }[];
      };
    }[];
  };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? "").join("\n").trim();
  const toolCalls: ToolCall[] = parts
    .filter((p) => p.functionCall?.name)
    .map((p, i) => ({
      id: `call_${i}`,
      name: p.functionCall?.name ?? "",
      args: parseArgs(p.functionCall?.args),
    }));
  return { ok: true, text, toolCalls, usage: parseUsage(got.body) };
}

async function streamGemini(
  opts: { key: string; model: string; onDelta?: (text: string) => void },
  payload: Record<string, unknown>,
): Promise<CompleteOk | { ok: false; error: string }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(opts.key)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, tools: undefined }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const raw = await res.text();
      return { ok: false, error: sanitize(`HTTP ${res.status}: ${raw.slice(0, 280)}`) };
    }
    let text = "";
    let usage: TokenUsage | undefined;
    await readSse(res, (json) => {
      const rec = json as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const chunk = rec.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      if (chunk) {
        text += chunk;
        opts.onDelta?.(chunk);
      }
      const u = parseUsage(json);
      if (u) usage = u;
    });
    return { ok: true, text, toolCalls: [], usage };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "network error";
    return { ok: false, error: sanitize(msg) };
  } finally {
    clearTimeout(timer);
  }
}

async function completeOnce(opts: {
  id: ModelId;
  keys: ProviderKeys;
  auth: AuthModes;
  picks?: Picks;
  system: string;
  messages: ChatMsg[];
  tools: boolean;
  maxTokens?: number;
  onDelta?: (text: string) => void;
}): Promise<CompleteOk | { ok: false; error: string }> {
  const seat = resolveSeat(opts.id, opts.keys, opts.auth, opts.picks);
  if (!seat) {
    return { ok: false, error: `${MODELS[opts.id].name} is not connected.` };
  }
  if (seat.kind === "anthropic") {
    return completeAnthropic({
      key: seat.key,
      model: seat.model,
      auth: seat.auth,
      system: opts.system,
      messages: opts.messages,
      tools: opts.tools,
      maxTokens: opts.maxTokens,
      onDelta: opts.onDelta,
    });
  }
  if (seat.kind === "gemini") {
    return completeGemini({
      key: seat.key,
      model: seat.model,
      system: opts.system,
      messages: opts.messages,
      maxTokens: opts.maxTokens,
      onDelta: opts.onDelta,
    });
  }
  const local = seat.kind === "local";
  const first = await completeOpenAI({
    url: seat.url,
    model: seat.model,
    key: seat.key,
    system: opts.system,
    messages: opts.messages,
    tools: opts.tools,
    local,
    extraHeaders: seat.extraHeaders,
    maxTokens: opts.maxTokens,
    onDelta: opts.onDelta,
  });
  if (first.ok) return first;
  if (opts.tools && seat.kind === "openai") {
    const retry = await completeOpenAI({
      url: seat.url,
      model: seat.model,
      key: seat.key,
      system: opts.system,
      messages: opts.messages,
      tools: false,
      local,
      extraHeaders: seat.extraHeaders,
    });
    if (retry.ok) return retry;
  }
  if (seat.auth === "oauth" && seat.id === "gpt" && !seat.via) {
    const viaResponses = await completeResponses({
      key: seat.key,
      model: seat.model,
      system: opts.system,
      messages: opts.messages,
    });
    if (viaResponses.ok) return viaResponses;
  }
  if (seat.id === "github" || seat.via === "github") {
    const copilot = await completeOpenAI({
      url: "https://api.githubcopilot.com/chat/completions",
      model: seat.via ? seat.model : "gpt-4o",
      key: seat.key,
      system: opts.system,
      messages: opts.messages,
      tools: false,
      extraHeaders: {
        "Editor-Version": "Swarm/1.0.0",
        "Copilot-Integration-Id": "vscode-chat",
      },
    });
    if (copilot.ok) return copilot;
  }
  if (local && opts.tools) {
    return completeOpenAI({
      url: seat.url,
      model: seat.model,
      key: seat.key,
      system: opts.system,
      messages: opts.messages,
      tools: false,
      local: true,
    });
  }
  if (local && MODELS[opts.id].image) {
    const img = await generateImage(seat, opts.messages.at(-1)?.content ?? "");
    if (img.ok) return { ok: true, text: img.text, toolCalls: [] };
  }
  return first;
}

async function completeResponses(opts: {
  key: string;
  model: string;
  system: string;
  messages: ChatMsg[];
}): Promise<CompleteOk | { ok: false; error: string }> {
  const input = [
    { role: "developer", content: opts.system },
    ...opts.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content })),
  ];
  const got = await fetchJson("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: openaiHeaders(opts.key),
    body: JSON.stringify({
      model: opts.model,
      input,
      max_output_tokens: MAX_TOKENS,
      temperature: 0.7,
    }),
  });
  if (!got.ok) return got;
  const data = got.body as {
    output_text?: string;
    output?: { content?: { type?: string; text?: string }[] }[];
  };
  const fromBlocks =
    data.output
      ?.flatMap((o) => o.content ?? [])
      .filter((c) => c.type === "output_text" || c.text)
      .map((c) => c.text ?? "")
      .join("\n")
      .trim() ?? "";
  const text = (data.output_text ?? fromBlocks).trim();
  return { ok: true, text, toolCalls: [], usage: parseUsage(got.body) };
}

async function generateImage(
  seat: Resolved,
  prompt: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const endpoint = seat.url.replace(/\/chat\/completions$/, "/images/generations");
  const got = await fetchJson(
    endpoint,
    {
      method: "POST",
      headers: openaiHeaders(seat.key),
      body: JSON.stringify({
        model: seat.model,
        prompt: prompt.slice(0, 1200),
        n: 1,
        size: "1024x1024",
      }),
    },
    LOCAL_FETCH_MS,
  );
  if (!got.ok) return got;
  const data = got.body as {
    data?: { url?: string; b64_json?: string }[];
  };
  const item = data.data?.[0];
  if (item?.url) return { ok: true, text: `![generated](${item.url})` };
  if (item?.b64_json) {
    return { ok: true, text: `![generated](data:image/png;base64,${item.b64_json})` };
  }
  return { ok: false, error: "Image endpoint returned no still." };
}

function safeMath(expr: string): string {
  const trimmed = expr.replace(/\s/g, "");
  if (!trimmed || trimmed.length > 80) return "Expression too long.";
  if (!/^[0-9+\-*/().]+$/.test(trimmed)) return "Only digits and + - * / ( ) are allowed.";
  try {
    const value = Function(`"use strict"; return (${trimmed})`)() as unknown;
    if (typeof value !== "number" || !Number.isFinite(value)) return "Not a finite number.";
    return String(value);
  } catch {
    return "Could not evaluate.";
  }
}

interface RunCtx {
  keys: ProviderKeys;
  auth: AuthModes;
  picks: Picks;
  insights: Insight[];
  traces: ToolTrace[];
  peerTurns: SeatTurn[];
  peerCalls: number;
  current: ModelId;
  depth: number;
  connected: ModelId[];
  emit?: (event: SwarmEvent) => void;
}

function fire(ctx: RunCtx, event: SwarmEvent) {
  try {
    ctx.emit?.(event);
  } catch {
    /* ignore */
  }
}

function fromComplete(
  id: ModelId,
  r: CompleteOk | { ok: false; error: string },
  phase?: BuildPhase,
): SeatTurn {
  if (!r.ok) return { modelId: id, content: "", traces: [], error: r.error, phase };
  return { modelId: id, content: r.text.trim(), traces: [], phase, usage: r.usage };
}

async function speak(
  ctx: RunCtx,
  id: ModelId,
  work: (onDelta?: (text: string) => void) => Promise<SeatTurn>,
  phase?: BuildPhase,
): Promise<SeatTurn> {
  const messageId = crypto.randomUUID();
  const onDelta = ctx.emit
    ? (text: string) => fire(ctx, { type: "delta", modelId: id, phase, text, messageId })
    : undefined;
  const turn = await work(onDelta);
  turn.messageId = messageId;
  turn.phase = turn.phase ?? phase;
  fire(ctx, { type: "turn", turn });
  if (turn.usage) {
    fire(ctx, { type: "usage", modelId: id, prompt: turn.usage.prompt, completion: turn.usage.completion });
  }
  return turn;
}

async function execPlugin(
  name: string,
  args: Record<string, unknown>,
  ctx: RunCtx,
): Promise<string> {
  switch (name) {
    case "call_peer": {
      if (ctx.depth >= 1) return "Peer calls cannot nest.";
      if (ctx.peerCalls >= MAX_PEER) return "Peer-call budget exhausted for this turn.";
      const model = String(args.model ?? "") as ModelId;
      const question = String(args.question ?? "").trim();
      if (!MODELS[model]) return "Unknown seat.";
      if (model === ctx.current) return "Ask a different seat.";
      if (!question) return "Need a question.";
      if (!resolveSeat(model, ctx.keys, ctx.auth, ctx.picks)) {
        return `${MODELS[model].name} is not connected.`;
      }
      ctx.peerCalls += 1;
      const system = seatSystem(model, ctx.current, ctx.connected, ctx.insights, false, ctx.picks);
      const r = await completeOnce({
        id: model,
        keys: ctx.keys,
        auth: ctx.auth,
        picks: ctx.picks,
        system,
        messages: [{ role: "user", content: question }],
        tools: false,
      });
      if (!r.ok) return r.error;
      const text = r.text.trim() || "(empty)";
      ctx.peerTurns.push({ modelId: model, content: text, traces: [] });
      return text.slice(0, 4000);
    }
    case "pin_insight": {
      const title = String(args.title ?? "").trim() || "Untitled";
      const body = String(args.body ?? "").trim();
      if (!body) return "Need a body.";
      ctx.insights.push({
        id: crypto.randomUUID(),
        title: title.slice(0, 80),
        body: body.slice(0, 800),
        from: ctx.current,
      });
      return `Pinned “${title.slice(0, 80)}”.`;
    }
    case "recall_insights": {
      if (!ctx.insights.length) return "No pins yet.";
      return ctx.insights
        .map((i) => `- ${i.title} (${MODELS[i.from].name}): ${i.body}`)
        .join("\n");
    }
    case "make_image": {
      const prompt = String(args.prompt ?? args.body ?? "").trim();
      if (!prompt) return "Need an image prompt.";
      const seat = resolveSeat("qwenimg", ctx.keys, ctx.auth, ctx.picks);
      if (!seat) return "TEMPER Qwen Image is not connected.";
      const img = await generateImage(seat, prompt);
      if (!img.ok) return img.error;
      ctx.peerTurns.push({ modelId: "qwenimg", content: img.text, traces: [] });
      return img.text.slice(0, 4000);
    }
    case "now":
      return new Date().toISOString();
    case "math":
      return safeMath(String(args.expr ?? ""));
    default:
      return `Unknown plugin: ${name}`;
  }
}

async function completeWithTools(
  id: ModelId,
  keys: ProviderKeys,
  auth: AuthModes,
  system: string,
  messages: ChatMsg[],
  ctx: RunCtx,
): Promise<SeatTurn> {
  ctx.current = id;
  const local: ChatMsg[] = [...messages];
  let text = "";
  const traces: ToolTrace[] = [];
  let lastUsage: TokenUsage | undefined;
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const r = await completeOnce({
      id,
      keys,
      auth,
      picks: ctx.picks,
      system,
      messages: local,
      tools: true,
    });
    if (!r.ok) return { modelId: id, content: "", traces, error: r.error };
    text = r.text.trim();
    lastUsage = r.usage;
    if (!r.toolCalls.length) break;
    local.push({
      role: "assistant",
      content: text || r.toolCalls.map((t) => t.name).join(", "),
    });
    for (const call of r.toolCalls) {
      const result = await execPlugin(call.name, call.args, ctx);
      traces.push({
        name: call.name,
        args: JSON.stringify(call.args),
        result: result.slice(0, 500),
      });
      ctx.traces.push(traces[traces.length - 1]!);
      local.push({
        role: "tool",
        name: call.name,
        toolCallId: call.id,
        content: result.slice(0, 4000),
      });
    }
  }
  return { modelId: id, content: text, traces, usage: lastUsage };
}

function insightBlock(insights: Insight[]): string {
  if (!insights.length) return "Shared board: empty.";
  return `Shared board:\n${insights
    .map((i) => `- ${i.title} (${MODELS[i.from].name}): ${i.body}`)
    .join("\n")}`;
}

function seatSystem(
  id: ModelId,
  host: ModelId,
  seats: ModelId[],
  insights: Insight[],
  withPlugins: boolean,
  picks?: Picks,
): string {
  const def = MODELS[id];
  const modelName = chosenModel(id, picks);
  const others = seats.filter((s) => s !== id).map((s) => MODELS[s].name);
  const pluginLines = withPlugins
    ? `You have the host plugin bus: ${PLUGINS.map((p) => p.name).join(", ")}. Use call_peer when another lab is stronger on a sub-question. Use pin_insight for durable findings. Use make_image when a still would help.`
    : "You do not have plugins on this turn. Answer directly.";
  return [
    `You are ${def.name} (${def.lab}, ${modelName}) seated at Swarm, a multi-LLM council.`,
    def.node ? `You run on node ${def.node}.` : "",
    `Voice: ${def.voice}`,
    `Host of this session: ${MODELS[host].name}. Other seats: ${others.join(", ") || "none"}.`,
    pluginLines,
    insightBlock(insights),
    "Be concise, direct, and specific. Disagree when you should. Do not pretend to be a different lab.",
    "Do not mention being an AI language model. No filler openings.",
  ]
    .filter(Boolean)
    .join("\n");
}

function historyToChat(
  history: SwarmTurnInput["history"],
  forId?: ModelId,
): ChatMsg[] {
  return history.slice(-16).map((h) => {
    if (h.role === "user") return { role: "user" as const, content: h.content };
    const tag = h.modelId && h.modelId !== forId ? `[${MODELS[h.modelId].name}] ` : "";
    return { role: "assistant" as const, content: `${tag}${h.content}` };
  });
}

const ARCHITECT_PREF: ModelId[] = ["claude", "gpt", "grok", "qwen", "gemini", "mistral"];
const IMPLEMENT_PREF: ModelId[] = [
  "qwen",
  "gpt",
  "claude",
  "grok",
  "deepseek",
  "github",
  "together",
  "groq",
];
const REVIEW_PREF: ModelId[] = ["claude", "gemini", "perplexity", "grok", "gpt", "mistral"];

function textSeats(connected: ModelId[]): ModelId[] {
  const t = connected.filter((id) => !MODELS[id].image);
  return t.length ? t : connected;
}

function pickRoles(connected: ModelId[], pref: ModelId[], cap: number): ModelId[] {
  const pool = textSeats(connected);
  const ordered = [...pref.filter((id) => pool.includes(id)), ...pool.filter((id) => !pref.includes(id))];
  const uniq: ModelId[] = [];
  for (const id of ordered) {
    if (!uniq.includes(id)) uniq.push(id);
    if (uniq.length >= cap) break;
  }
  return uniq;
}

function digestTurns(turns: SeatTurn[], max = 3600): string {
  const body = turns
    .filter((t) => t.content && !t.error)
    .map((t) => `### ${MODELS[t.modelId].name}${t.model ? ` · ${t.model}` : ""}\n${t.content}`)
    .join("\n\n");
  if (!body) return "(empty)";
  return body.length > max ? `${body.slice(0, max)}\n…` : body;
}

async function askBuild(
  id: ModelId,
  input: SwarmTurnInput,
  ctx: RunCtx,
  system: string,
  user: string,
  phase: BuildPhase,
  maxTokens: number,
): Promise<SeatTurn> {
  return speak(ctx, id, async (onDelta) => {
    const r = await completeOnce({
      id,
      keys: input.keys,
      auth: ctx.auth,
      picks: ctx.picks,
      system,
      messages: [
        ...historyToChat(input.history, id),
        { role: "user", content: user },
      ],
      tools: false,
      maxTokens,
      onDelta,
    });
    return fromComplete(id, r, phase);
  }, phase);
}

async function runBuildHeavy(
  input: SwarmTurnInput,
  ctx: RunCtx,
  host: ModelId,
  connected: ModelId[],
  prompt: string,
): Promise<SeatTurn[]> {
  const architects = pickRoles(connected, ARCHITECT_PREF, 3);
  const implementers = pickRoles(connected, IMPLEMENT_PREF, 3);
  const reviewers = pickRoles(connected, REVIEW_PREF, 2);
  const turns: SeatTurn[] = [];

  fire(ctx, { type: "phase", phase: "spec", seats: architects });
  fire(ctx, { type: "notice", content: `SPEC — ${architects.map((id) => MODELS[id].name).join(", ")}` });
  const specUser = [
    "BUILD HEAVY — SPEC phase. You are one architect on a multi-lab engineering swarm, not a chatbot.",
    "Same job as Grok Build: turn the brief into a concrete build spec.",
    "Output: stack, file tree, what each file does, acceptance checks. Numbered. No filler.",
    `Brief:\n${prompt}`,
  ].join("\n");
  const specTurns = await Promise.all(
    architects.map((id) =>
      askBuild(
        id,
        input,
        ctx,
        `${seatSystem(id, host, connected, ctx.insights, false, ctx.picks)}\nRole: architect. Spec only.`,
        specUser,
        "spec",
        1100,
      ),
    ),
  );
  turns.push(...specTurns);
  const specDigest = digestTurns(specTurns);

  fire(ctx, { type: "phase", phase: "implement", seats: implementers });
  fire(ctx, { type: "notice", content: `IMPLEMENT — ${implementers.map((id) => MODELS[id].name).join(", ")}` });

  const implUser = [
    "BUILD HEAVY — IMPLEMENT phase. You are an implementer on the swarm.",
    "Write the actual files. Full contents in markdown fences tagged with paths (```ts src/foo.ts).",
    "Do not restate the spec. Ship code.",
    `Brief:\n${prompt}`,
    `Spec digest from the architects:\n${specDigest}`,
  ].join("\n");
  const implTurns = await Promise.all(
    implementers.map((id) =>
      askBuild(
        id,
        input,
        ctx,
        `${seatSystem(id, host, connected, ctx.insights, false, ctx.picks)}\nRole: implementer. Code, not commentary.`,
        implUser,
        "implement",
        2200,
      ),
    ),
  );
  turns.push(...implTurns);
  const implDigest = digestTurns(implTurns, 5000);

  fire(ctx, { type: "phase", phase: "review", seats: reviewers });
  fire(ctx, { type: "notice", content: `REVIEW — ${reviewers.map((id) => MODELS[id].name).join(", ")}` });

  const reviewUser = [
    "BUILD HEAVY — REVIEW phase. Hostile review. Same bar as Grok Build verify.",
    "List BLOCKERS then NITS. Call missing files, auth mistakes, layout breaks, fake APIs.",
    `Brief:\n${prompt}`,
    `Spec:\n${specDigest}`,
    `Implementations:\n${implDigest}`,
  ].join("\n");
  const reviewTurns = await Promise.all(
    reviewers.map((id) =>
      askBuild(
        id,
        input,
        ctx,
        `${seatSystem(id, host, connected, ctx.insights, false, ctx.picks)}\nRole: reviewer. Find what would fail a ship gate.`,
        reviewUser,
        "review",
        900,
      ),
    ),
  );
  turns.push(...reviewTurns);

  if (!connected.includes(host)) {
    return turns;
  }
  const mergeUser = [
    "BUILD HEAVY — MERGE. You are the lead. Same job as Grok Build: produce the shippable result.",
    "Merge the best of each implementer. Address blockers. Output final files and a verify checklist.",
    "Use call_peer only if a hole remains that another live seat must fill.",
    `Brief:\n${prompt}`,
    `Spec:\n${specDigest}`,
    `Implementations:\n${implDigest}`,
    `Reviews:\n${digestTurns(reviewTurns, 2500)}`,
  ].join("\n");
  fire(ctx, { type: "phase", phase: "merge", seats: [host] });
  fire(ctx, { type: "notice", content: `MERGE — ${MODELS[host].name}` });
  ctx.peerCalls = 0;
  const merge = await speak(ctx, host, async () => {
    const t = await completeWithTools(
      host,
      input.keys,
      ctx.auth,
      `${seatSystem(host, host, connected, ctx.insights, true, ctx.picks)}\nRole: lead engineer. Merge and ship.`,
      [...historyToChat(input.history, host), { role: "user", content: mergeUser }],
      ctx,
    );
    t.phase = "merge";
    return t;
  }, "merge");
  turns.push(merge, ...ctx.peerTurns.map((t) => ({ ...t, phase: "merge" as const })));
  return turns;
}

export async function runSwarm(
  input: SwarmTurnInput,
  emit?: (event: SwarmEvent) => void,
): Promise<SwarmTurnResult> {
  if (!allowRun()) {
    return { ok: false, error: "Swarm is cooling down. Wait a moment, then send again." };
  }
  const prompt = input.prompt.trim();
  if (!prompt) return { ok: false, error: "Write a brief first." };

  const uniqueSeats = [...new Set(input.seats)].filter((id) => MODELS[id]);
  const skipped: { modelId: ModelId; reason: string }[] = [];
  const connected = uniqueSeats.filter((id) => {
    if (resolveSeat(id, input.keys, input.auth, input.picks)) return true;
    skipped.push({
      modelId: id,
      reason: `${MODELS[id].name} is not connected. Open Connect and paste OAuth or a key.`,
    });
    return false;
  });
  if (!connected.length) {
    return {
      ok: false,
      error: "No live seats. Connect OAuth (or an API key) in Connect. Grok can ride the app xAI key.",
    };
  }

  const insights: Insight[] = [...input.insights];
  const ctx: RunCtx = {
    keys: input.keys,
    auth: input.auth ?? {},
    picks: input.picks ?? {},
    insights,
    traces: [],
    peerTurns: [],
    peerCalls: 0,
    current: input.host,
    depth: 0,
    connected,
    emit,
  };

  const mode: SwarmMode = input.mode;
  const host = connected.includes(input.host) ? input.host : connected[0]!;
  const turns: SeatTurn[] = [];

  try {
    if (mode === "parallel") {
      fire(ctx, { type: "phase", phase: "parallel", seats: connected });
      const results = await Promise.all(
        connected.map((id) =>
          speak(ctx, id, async (onDelta) => {
            const r = await completeOnce({
              id,
              keys: input.keys,
              auth: ctx.auth,
              picks: ctx.picks,
              system: seatSystem(id, host, connected, insights, false, ctx.picks),
              messages: [
                ...historyToChat(input.history, id),
                { role: "user", content: prompt },
              ],
              tools: false,
              onDelta,
            });
            return fromComplete(id, r);
          }),
        ),
      );
      turns.push(...results);
    } else if (mode === "roundtable") {
      const running: SwarmTurnInput["history"] = [
        ...input.history,
        { role: "user", content: prompt },
      ];
      for (const id of connected) {
        const withTools = id === host;
        const turn = await speak(ctx, id, async (onDelta) => {
          if (withTools) {
            return completeWithTools(
              id,
              input.keys,
              ctx.auth,
              seatSystem(id, host, connected, insights, true, ctx.picks),
              historyToChat(running, id),
              ctx,
            );
          }
          const r = await completeOnce({
            id,
            keys: input.keys,
            auth: ctx.auth,
            picks: ctx.picks,
            system: seatSystem(id, host, connected, insights, false, ctx.picks),
            messages: historyToChat(running, id),
            tools: false,
            onDelta,
          });
          return fromComplete(id, r);
        });
        turns.push(turn);
        if (turn.content) {
          running.push({
            role: "assistant",
            content: turn.content,
            modelId: id,
          });
        }
      }
    } else if (mode === "debate") {
      if (connected.length < 2) {
        return {
          ok: false,
          error: "Debate needs at least two connected seats.",
        };
      }
      const mid = Math.ceil(connected.length / 2);
      const aff = connected.slice(0, mid);
      const neg = connected.slice(mid);
      const opening = [
        ...input.history,
        {
          role: "user" as const,
          content: `DEBATE — opening statements.\nMotion: ${prompt}\nAffirm seats: ${aff.map((s) => MODELS[s].name).join(", ")}.\nDissent seats: ${neg.map((s) => MODELS[s].name).join(", ")}.`,
        },
      ];
      fire(ctx, { type: "phase", phase: "opening", seats: connected });
      const openResults = await Promise.all(
        connected.map((id) => {
          const side = aff.includes(id) ? "AFFIRM the motion." : "DISSENT from the motion.";
          return speak(ctx, id, async (onDelta) => {
            const r = await completeOnce({
              id,
              keys: input.keys,
              auth: ctx.auth,
              picks: ctx.picks,
              system: `${seatSystem(id, host, connected, insights, false, ctx.picks)}\nYou are on the ${side} side. Opening statement only.`,
              messages: historyToChat(opening, id),
              tools: false,
              onDelta,
            });
            return fromComplete(id, r);
          });
        }),
      );
      turns.push(...openResults);
      const rebuttalHist: SwarmTurnInput["history"] = [
        ...opening,
        ...openResults
          .filter((t) => t.content)
          .map((t) => ({
            role: "assistant" as const,
            content: t.content,
            modelId: t.modelId,
          })),
        {
          role: "user" as const,
          content: "Rebuttal round. Answer the opposing seats. Stay on your side.",
        },
      ];
      fire(ctx, { type: "phase", phase: "rebuttal", seats: connected });
      const rebuttals = await Promise.all(
        connected.map((id) => {
          const side = aff.includes(id) ? "AFFIRM" : "DISSENT";
          return speak(ctx, id, async (onDelta) => {
            const r = await completeOnce({
              id,
              keys: input.keys,
              auth: ctx.auth,
              picks: ctx.picks,
              system: `${seatSystem(id, host, connected, insights, false, ctx.picks)}\nRebuttal. Side: ${side}.`,
              messages: historyToChat(rebuttalHist, id),
              tools: false,
              onDelta,
            });
            return fromComplete(id, r);
          });
        }),
      );
      turns.push(...rebuttals);
    } else if (mode === "buildheavy") {
      turns.push(...(await runBuildHeavy(input, ctx, host, connected, prompt)));
    } else {
      if (!connected.includes(host)) {
        return { ok: false, error: `${MODELS[host].name} must be connected to conduct.` };
      }
      fire(ctx, { type: "phase", phase: "conductor", seats: [host] });
      const hostTurn = await speak(ctx, host, async () => {
        return completeWithTools(
          host,
          input.keys,
          ctx.auth,
          seatSystem(host, host, connected, insights, true, ctx.picks),
          [
            ...historyToChat(input.history, host),
            {
              role: "user",
              content: `You are conductor. Summon peers with call_peer when useful. Brief:\n${prompt}`,
            },
          ],
          ctx,
        );
      });
      turns.push(hostTurn, ...ctx.peerTurns);
    }
  } catch (err) {
    return {
      ok: false,
      error: sanitize(err instanceof Error ? err.message : "Swarm failed."),
    };
  }

  for (const t of turns) {
    t.model = resolveSeat(t.modelId, input.keys, ctx.auth, ctx.picks)?.model;
  }

  const result: SwarmTurnResult = { ok: true, turns, insights, skipped };
  fire(ctx, { type: "insights", insights });
  return result;
}

export async function pingNodes(keys: ProviderKeys) {
  const status = providerStatus();
  const forgeUrl = keys.forgeUrl?.trim() || forgeEnv().url || FORGE_DEFAULT_URL;
  const temperUrl = keys.temperUrl?.trim() || temperEnv().url;
  const [forgeMs, temperMs] = await Promise.all([
    pingModels(forgeUrl, keys.forge?.trim() || forgeEnv().key || "local"),
    pingModels(temperUrl, keys.temper?.trim() || temperEnv().key),
  ]);
  return {
    ...status,
    forge: forgeMs !== false || status.forge,
    temper: temperMs !== false || status.temper,
    forgeMs: forgeMs === false ? undefined : forgeMs,
    temperMs: temperMs === false ? undefined : temperMs,
    forgeUrl: forgeMs === false ? undefined : forgeUrl,
  };
}

async function pingModels(base?: string, key?: string): Promise<number | false> {
  if (!base) return false;
  let url = base.trim().replace(/\/+$/, "");
  if (url.endsWith("/chat/completions")) url = url.slice(0, -"/chat/completions".length);
  if (!url.endsWith("/models")) url = `${url}/models`;
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const headers: Record<string, string> = {};
    if (key && key !== "local") headers.Authorization = `Bearer ${key}`;
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) return false;
    return Date.now() - t0;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
