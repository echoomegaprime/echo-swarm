type JsonRecord = Record<string, unknown>;

export type BrainToolName =
  | "swarm_brain_health"
  | "swarm_brain_think"
  | "swarm_brain_trinity_consult"
  | "swarm_brain_trinity_decide"
  | "swarm_brain_hybrid";

type McpToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent: JsonRecord;
  isError?: true;
};

const DEFAULT_BRAIN_BASE = "http://127.0.0.1:8260";
const BRAIN_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_CHARS = 1_000_000;
const MAX_TEXT_CHARS = 12_000;
const MAX_OUTPUT_CHARS = 30_000;
const MAX_MODELS = 10;

const outputSchema = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    operation: { type: "string" },
    service: { type: "string" },
    version: { type: "string" },
    status: { type: "string" },
    answer: { type: "string" },
    result: {},
    error: { type: "string" },
  },
  required: ["ok", "operation"],
} as const;

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const inferenceAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

export const BRAIN_MCP_TOOLS = [
  {
    name: "swarm_brain_health",
    description:
      "Check the recovered sovereign Echo Swarm Brain and its Postgres and ALPHA-LLM dependencies.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    outputSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: "swarm_brain_think",
    description:
      "Ask the recovered Echo Swarm Brain for a bounded hive-mind synthesis. This legacy brain retains its original comic-research specialization.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        question: { type: "string", minLength: 1, maxLength: MAX_TEXT_CHARS },
        context: { type: "string", maxLength: MAX_TEXT_CHARS },
        agents: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
      required: ["question"],
    },
    outputSchema,
    annotations: inferenceAnnotations,
  },
  {
    name: "swarm_brain_trinity_consult",
    description:
      "Consult one recovered Trinity voice: SAGE (preservation), NYX (patterns), or THORNE (risk). The source brain retains its original CGC grading specialization.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        question: { type: "string", minLength: 1, maxLength: MAX_TEXT_CHARS },
        voice: { type: "string", enum: ["SAGE", "NYX", "THORNE"] },
        context: { type: "string", maxLength: MAX_TEXT_CHARS },
      },
      required: ["question", "voice"],
    },
    outputSchema,
    annotations: inferenceAnnotations,
  },
  {
    name: "swarm_brain_trinity_decide",
    description:
      "Run the recovered three-voice Trinity decision route and return its synthesis and preserved voice outputs. This is advisory, not an Echo exact-SHA certification receipt.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        question: { type: "string", minLength: 1, maxLength: MAX_TEXT_CHARS },
        context: { type: "string", maxLength: MAX_TEXT_CHARS },
        tier: { type: "string", maxLength: 40, default: "standard" },
        debate_rounds: { type: "integer", minimum: 1, maximum: 5, default: 2 },
      },
      required: ["question"],
    },
    outputSchema,
    annotations: inferenceAnnotations,
  },
  {
    name: "swarm_brain_hybrid",
    description:
      "Run a recovered Echo Swarm Brain ensemble, debate, or chain over its configured sovereign ALPHA model endpoint.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        method: { type: "string", enum: ["ensemble", "debate", "chain"] },
        prompt: { type: "string", minLength: 1, maxLength: MAX_TEXT_CHARS },
        models: {
          type: "array",
          maxItems: MAX_MODELS,
          items: { type: "string", minLength: 1, maxLength: 160 },
        },
        options: {
          type: "object",
          additionalProperties: false,
          properties: {
            temperature: { type: "number", minimum: 0, maximum: 2 },
            max_tokens: { type: "integer", minimum: 1, maximum: 8000 },
            rounds: { type: "integer", minimum: 1, maximum: 5 },
          },
        },
        system_prompt: { type: "string", maxLength: MAX_TEXT_CHARS },
      },
      required: ["method", "prompt"],
    },
    outputSchema,
    annotations: inferenceAnnotations,
  },
] as const;

const brainNames = new Set<BrainToolName>(BRAIN_MCP_TOOLS.map((tool) => tool.name));

export function isBrainToolName(name: string): name is BrainToolName {
  return brainNames.has(name as BrainToolName);
}

class SafeBrainError extends Error {}

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function brainBase(): string {
  const raw = process.env.SWARM_BRAIN_BASE?.trim() || DEFAULT_BRAIN_BASE;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeBrainError("Echo Swarm Brain configuration is invalid.");
  }
  const loopback = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  if (!loopback.has(url.hostname) || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new SafeBrainError("Echo Swarm Brain must remain on a loopback origin.");
  }
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/u, "");
}

function redact(text: string): string {
  return text
    .replace(/Bearer\s+\S+/giu, "Bearer ***")
    .replace(/sk-[a-zA-Z0-9._-]+/gu, "sk-***")
    .replace(/xai-[a-zA-Z0-9._-]+/gu, "xai-***")
    .replace(/gh[pousr]_[a-zA-Z0-9_]+/gu, "gh*_***")
    .replace(/github_pat_[a-zA-Z0-9_]+/gu, "github_pat_***")
    .replace(/\bAIza[a-zA-Z0-9_-]{20,}\b/gu, "AIza***")
    .replace(
      /\b(api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*([:=])\s*["']?[^\s"',;]+["']?/giu,
      "$1$2***",
    );
}

function safeJson(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[depth limited]";
  if (typeof value === "string") return redact(value).slice(0, MAX_OUTPUT_CHARS);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => safeJson(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonRecord)
        .slice(0, 100)
        .map(([key, item]) => [key, safeJson(item, depth + 1)]),
    );
  }
  return undefined;
}

function textArg(args: JsonRecord, key: string, required = false): string | undefined {
  const value = args[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || (required && !value.trim())) {
    throw new SafeBrainError(`${key} must be ${required ? "a non-empty" : "a"} string.`);
  }
  const normalized = value.trim();
  if (normalized.length > MAX_TEXT_CHARS) {
    throw new SafeBrainError(`${key} is too long (maximum ${MAX_TEXT_CHARS} characters).`);
  }
  return normalized;
}

function integerArg(
  args: JsonRecord,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = args[key] ?? fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new SafeBrainError(`${key} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

async function brainJson(path: string, body?: JsonRecord): Promise<JsonRecord> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BRAIN_TIMEOUT_MS);
  try {
    const response = await fetch(`${brainBase()}${path}`, {
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
      headers: body ? { "content-type": "application/json" } : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    if (text.length > MAX_RESPONSE_CHARS) {
      throw new SafeBrainError("Echo Swarm Brain returned an oversized response.");
    }
    if (!response.ok)
      throw new SafeBrainError(`Echo Swarm Brain returned HTTP ${response.status}.`);
    let parsed: JsonRecord;
    try {
      parsed = asRecord(JSON.parse(text));
    } catch {
      throw new SafeBrainError("Echo Swarm Brain returned invalid JSON.");
    }
    if (parsed.ok === false) {
      throw new SafeBrainError(
        typeof parsed.error === "string" ? parsed.error : "Echo Swarm Brain rejected the request.",
      );
    }
    return parsed;
  } catch (error) {
    if (error instanceof SafeBrainError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new SafeBrainError("Echo Swarm Brain timed out.");
    }
    throw new SafeBrainError("Echo Swarm Brain is unavailable.");
  } finally {
    clearTimeout(timer);
  }
}

function answerFrom(body: JsonRecord): string {
  for (const value of [body.answer, body.result, body.synthesis, body.final, body.verdict]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const consultation = asRecord(body.consultation);
  if (typeof consultation.analysis === "string") return consultation.analysis;
  const decision = asRecord(body.decision);
  if (typeof decision.final === "string") return decision.final;
  return JSON.stringify(safeJson(body), null, 2);
}

function success(operation: string, body: JsonRecord): McpToolResult {
  const sanitized = asRecord(safeJson(body));
  const answer = redact(answerFrom(sanitized)).slice(0, MAX_OUTPUT_CHARS);
  return {
    content: [
      {
        type: "text",
        text: [
          "# Echo Swarm Brain",
          "",
          `**Operation:** ${operation}`,
          `**Status:** ${String(sanitized.status ?? "complete")}`,
          "",
          answer,
        ].join("\n"),
      },
    ],
    structuredContent: { ...sanitized, ok: true, operation, answer },
  };
}

function failure(operation: string, error: unknown): McpToolResult {
  const message = redact(error instanceof Error ? error.message : "Echo Swarm Brain call failed.");
  return {
    isError: true,
    content: [{ type: "text", text: `# Echo Swarm Brain\n\n**Status:** failed\n\n${message}` }],
    structuredContent: { ok: false, operation, error: message },
  };
}

function hybridPayload(args: JsonRecord): JsonRecord {
  const method = textArg(args, "method", true);
  if (!method || !["ensemble", "debate", "chain"].includes(method)) {
    throw new SafeBrainError("method must be ensemble, debate, or chain.");
  }
  const payload: JsonRecord = { method, prompt: textArg(args, "prompt", true) };
  if (args.system_prompt !== undefined) payload.system_prompt = textArg(args, "system_prompt");
  if (args.models !== undefined) {
    if (!Array.isArray(args.models) || args.models.length > MAX_MODELS) {
      throw new SafeBrainError(`models must contain at most ${MAX_MODELS} entries.`);
    }
    payload.models = args.models.map((model) => {
      if (typeof model !== "string" || !model.trim() || model.length > 160) {
        throw new SafeBrainError("Each model must be a non-empty string up to 160 characters.");
      }
      return model.trim();
    });
  }
  if (args.options !== undefined) {
    const options = asRecord(args.options);
    if (options !== args.options) throw new SafeBrainError("options must be an object.");
    const safeOptions: JsonRecord = {};
    if (options.temperature !== undefined) {
      if (
        typeof options.temperature !== "number" ||
        options.temperature < 0 ||
        options.temperature > 2
      ) {
        throw new SafeBrainError("temperature must be between 0 and 2.");
      }
      safeOptions.temperature = options.temperature;
    }
    if (options.max_tokens !== undefined) {
      safeOptions.max_tokens = integerArg(options, "max_tokens", 2000, 1, 8000);
    }
    if (options.rounds !== undefined) {
      safeOptions.rounds = integerArg(options, "rounds", 3, 1, 5);
    }
    payload.options = safeOptions;
  }
  return payload;
}

export async function handleBrainTool(
  name: BrainToolName,
  args: JsonRecord,
): Promise<McpToolResult> {
  const operation = name.replace("swarm_brain_", "");
  try {
    if (name === "swarm_brain_health") return success(operation, await brainJson("/health"));
    if (name === "swarm_brain_think") {
      return success(
        operation,
        await brainJson("/swarm/think", {
          question: textArg(args, "question", true),
          ...(args.context !== undefined ? { context: textArg(args, "context") } : {}),
          agents: integerArg(args, "agents", 50, 1, 200),
        }),
      );
    }
    if (name === "swarm_brain_trinity_consult") {
      const voice = textArg(args, "voice", true)?.toUpperCase();
      if (!voice || !["SAGE", "NYX", "THORNE"].includes(voice)) {
        throw new SafeBrainError("voice must be SAGE, NYX, or THORNE.");
      }
      return success(
        operation,
        await brainJson("/trinity/consult", {
          question: textArg(args, "question", true),
          voice,
          ...(args.context !== undefined ? { context: textArg(args, "context") } : {}),
        }),
      );
    }
    if (name === "swarm_brain_trinity_decide") {
      return success(
        operation,
        await brainJson("/trinity/decide", {
          question: textArg(args, "question", true),
          ...(args.context !== undefined ? { context: textArg(args, "context") } : {}),
          tier: textArg({ tier: args.tier ?? "standard" }, "tier", true),
          debate_rounds: integerArg(args, "debate_rounds", 2, 1, 5),
        }),
      );
    }
    return success(operation, await brainJson("/llm/hybrids/run", hybridPayload(args)));
  } catch (error) {
    return failure(operation, error);
  }
}
