type JsonRecord = Record<string, unknown>;

export type MaximalistToolName =
  | "swarm_maximalist_health"
  | "swarm_maximalist_start"
  | "swarm_maximalist_result"
  | "swarm_maximalist_resume";

type McpToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent: JsonRecord;
  isError?: true;
};

const DEFAULT_WORKER_BASE = "http://127.0.0.1:8157";
const WORKER_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_CHARS = 1_000_000;
const MAX_OBJECTIVE_CHARS = 12_000;
const MAX_CONTEXT_CHARS = 16_000;
const MAX_ANSWER_CHARS = 30_000;
const MAX_CALLS = 120;
const MAX_COST_USD = 5;
const MAX_WALL_SECONDS = 420;
const REQUIRED_CORE_PROFILE = "MAXIMALIST_RECONSTRUCTED";
const REQUIRED_CORE_VERSION = "0.4.0";
const REQUIRED_CORE_SHA = "c7505746b578aae3dcd524ab2b218e86f257badd";
const REQUIRED_CAPABILITY_PROFILE = "echo_full_read";
const REQUIRED_CAPABILITY_IDS = [
  "echo.arcanum.search",
  "echo.arcanum.enrich",
  "echo.knowledge.search",
  "echo.wolfram.llm",
  "echo.context.recall",
  "echo.brain.search",
  "echo.doctrine.search",
  "echo.caps.search",
  "echo.engine.query",
  "echo.wolfram.health",
  "echo.dr.phoenix_status",
] as const;
const RUN_ID = /^run_[A-Za-z0-9_-]{4,80}$/u;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,128}$/u;

const commonOutputSchema = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    operation: {
      type: "string",
      enum: ["health", "start", "result", "resume"],
    },
    run_id: { type: "string" },
    phase: { type: "string" },
    done: { type: "boolean" },
    profile: { type: "string" },
    historical_parity: { type: "boolean" },
    core_version: { type: "string" },
    core_sha: { type: "string" },
    provider_mode: { type: "string" },
    capability_profile: { type: "string" },
    capability_mode: { type: "string" },
    capability_ready: { type: "boolean" },
    ready_capability_count: { type: "integer" },
    selected_capability_ids: { type: "array", items: { type: "string" } },
    degraded_capability_ids: { type: "array", items: { type: "string" } },
    configured_seat_count: { type: "integer" },
    trinity_separate: { type: "boolean" },
    seats_fingerprint: { type: "string" },
    result: { type: "object" },
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

const statefulAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

export const MAXIMALIST_MCP_TOOLS = [
  {
    name: "swarm_maximalist_health",
    description:
      "Check the live MAXIMALIST_RECONSTRUCTED Fusion Brain worker, active-run count, exact core identity, 40-seat registry, and governed Echo capability readiness.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    outputSchema: commonOutputSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: "swarm_maximalist_start",
    description:
      "Start an asynchronous Maximalist Fusion Brain run. Returns a run_id immediately; poll swarm_maximalist_result until done. The brain performs bounded Arcanum, Knowledge Forge, Wolfram, Echo memory/doctrine/catalog/engine, and Phoenix grounding before independent first passes, finding propagation, dynamic re-tasking, dissent preservation, evidence-weighted arbitration, separate Trinity fusion, recursive verification, and memory writeback.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        objective: { type: "string", minLength: 1, maxLength: MAX_OBJECTIVE_CHARS },
        context: {
          type: "object",
          description: "Optional bounded, non-secret context for this run.",
        },
        budget: {
          type: "object",
          additionalProperties: false,
          properties: {
            max_calls: { type: "integer", minimum: 1, maximum: MAX_CALLS },
            max_cost_usd: { type: "number", exclusiveMinimum: 0, maximum: MAX_COST_USD },
            max_wall_s: { type: "number", exclusiveMinimum: 0, maximum: MAX_WALL_SECONDS },
          },
        },
        idempotency_key: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          description: "Optional caller-stable key for safe retry of run creation.",
        },
      },
      required: ["objective"],
    },
    outputSchema: commonOutputSchema,
    annotations: statefulAnnotations,
  },
  {
    name: "swarm_maximalist_result",
    description:
      "Poll an asynchronous Maximalist run by run_id. When complete, returns the fused answer, confidence, major findings, preserved dissent, unresolved uncertainty, and provenance as chat-ready text plus structured content.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { run_id: { type: "string", pattern: RUN_ID.source } },
      required: ["run_id"],
    },
    outputSchema: commonOutputSchema,
    annotations: readOnlyAnnotations,
  },
  {
    name: "swarm_maximalist_resume",
    description:
      "Resume a persisted Maximalist run by run_id after a worker interruption, preserving the run's finding bus and phase state.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { run_id: { type: "string", pattern: RUN_ID.source } },
      required: ["run_id"],
    },
    outputSchema: commonOutputSchema,
    annotations: statefulAnnotations,
  },
] as const;

const maximalistNames = new Set<MaximalistToolName>(MAXIMALIST_MCP_TOOLS.map((tool) => tool.name));

export function isMaximalistToolName(name: string): name is MaximalistToolName {
  return maximalistNames.has(name as MaximalistToolName);
}

class SafeMaximalistError extends Error {}

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function workerBase(): string {
  const raw = process.env.FUSION_WORKER_BASE?.trim() || DEFAULT_WORKER_BASE;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeMaximalistError("Maximalist Fusion worker configuration is invalid.");
  }
  const loopback = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  if (!loopback.has(url.hostname) || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new SafeMaximalistError("Maximalist Fusion worker must remain on a loopback origin.");
  }
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/u, "");
}

async function workerJson(path: string, init?: RequestInit): Promise<JsonRecord> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS);
  try {
    const response = await fetch(`${workerBase()}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
      signal: controller.signal,
    });
    const text = await response.text();
    if (text.length > MAX_RESPONSE_CHARS) {
      throw new SafeMaximalistError("Maximalist Fusion worker returned an oversized response.");
    }
    if (!response.ok) {
      throw new SafeMaximalistError(`Maximalist Fusion worker returned HTTP ${response.status}.`);
    }
    try {
      return asRecord(JSON.parse(text));
    } catch {
      throw new SafeMaximalistError("Maximalist Fusion worker returned invalid JSON.");
    }
  } catch (error) {
    if (error instanceof SafeMaximalistError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new SafeMaximalistError("Maximalist Fusion worker timed out.");
    }
    throw new SafeMaximalistError("Maximalist Fusion worker is unavailable.");
  } finally {
    clearTimeout(timer);
  }
}

function assertCoreIdentity(body: JsonRecord, options: { requireLive?: boolean } = {}): void {
  const { requireLive = false } = options;
  const selectedCapabilities = new Set(
    Array.isArray(body.selected_capability_ids)
      ? body.selected_capability_ids.filter((item): item is string => typeof item === "string")
      : [],
  );
  if (
    body.profile !== REQUIRED_CORE_PROFILE ||
    body.historical_parity !== false ||
    body.core_version !== REQUIRED_CORE_VERSION ||
    body.core_sha !== REQUIRED_CORE_SHA ||
    body.configured_seat_count !== 40 ||
    body.trinity_separate !== true ||
    body.capability_profile !== REQUIRED_CAPABILITY_PROFILE ||
    body.credential_values_exposed !== false ||
    REQUIRED_CAPABILITY_IDS.some((id) => !selectedCapabilities.has(id))
  ) {
    throw new SafeMaximalistError(
      "Maximalist Fusion worker identity does not match the certified reconstructed core.",
    );
  }
  if (
    requireLive &&
    (body.provider_mode !== "live" || body.capability_mode !== "live" || body.ready !== true)
  ) {
    throw new SafeMaximalistError(
      "Maximalist Fusion live execution is blocked by provider readiness.",
    );
  }
}

async function verifiedWorkerHealth(requireLive = false): Promise<JsonRecord> {
  const body = await workerJson("/health");
  if (body.ok !== true) {
    throw new SafeMaximalistError("Maximalist Fusion worker is not healthy.");
  }
  assertCoreIdentity(body, { requireLive });
  return body;
}

function assertResultIdentity(body: JsonRecord): void {
  if (body.done !== true) return;
  const result = asRecord(body.result);
  const provenance = asRecord(result.provenance);
  if (
    provenance.profile !== REQUIRED_CORE_PROFILE ||
    provenance.historical_parity !== false ||
    provenance.core_version !== REQUIRED_CORE_VERSION ||
    provenance.core_sha !== REQUIRED_CORE_SHA ||
    provenance.trinity_separate !== true ||
    provenance.provider_mode !== "live" ||
    provenance.capability_profile !== REQUIRED_CAPABILITY_PROFILE ||
    provenance.capability_mode !== "live"
  ) {
    throw new SafeMaximalistError(
      "Maximalist Fusion result provenance does not match the certified reconstructed core.",
    );
  }
}

function boundedPositive(value: unknown, fallback: number, maximum: number, label: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new SafeMaximalistError(`${label} must be a positive number.`);
  }
  return Math.min(value, maximum);
}

function startPayload(args: JsonRecord): JsonRecord {
  if (typeof args.objective !== "string" || !args.objective.trim()) {
    throw new SafeMaximalistError("Provide a non-empty objective for the Maximalist run.");
  }
  const objective = args.objective.trim();
  if (objective.length > MAX_OBJECTIVE_CHARS) {
    throw new SafeMaximalistError(
      `The Maximalist objective is too long (maximum ${MAX_OBJECTIVE_CHARS} characters).`,
    );
  }
  const budget = asRecord(args.budget);
  const payload: JsonRecord = {
    objective,
    budget: {
      max_calls: Math.floor(boundedPositive(budget.max_calls, MAX_CALLS, MAX_CALLS, "max_calls")),
      max_cost_usd: boundedPositive(
        budget.max_cost_usd,
        MAX_COST_USD,
        MAX_COST_USD,
        "max_cost_usd",
      ),
      max_wall_s: boundedPositive(
        budget.max_wall_s,
        MAX_WALL_SECONDS,
        MAX_WALL_SECONDS,
        "max_wall_s",
      ),
    },
    wait: false,
  };
  if (args.context !== undefined) {
    const context = asRecord(args.context);
    if (context !== args.context) {
      throw new SafeMaximalistError("context must be a JSON object.");
    }
    if (JSON.stringify(context).length > MAX_CONTEXT_CHARS) {
      throw new SafeMaximalistError(
        `Maximalist context is too large (maximum ${MAX_CONTEXT_CHARS} characters).`,
      );
    }
    payload.context = context;
  }
  if (args.idempotency_key !== undefined) {
    if (typeof args.idempotency_key !== "string" || !IDEMPOTENCY_KEY.test(args.idempotency_key)) {
      throw new SafeMaximalistError(
        "idempotency_key must be 1-128 letters, numbers, dots, underscores, colons, or hyphens.",
      );
    }
    payload.idempotency_key = args.idempotency_key;
  }
  return payload;
}

function runId(args: JsonRecord): string {
  if (typeof args.run_id !== "string" || !RUN_ID.test(args.run_id)) {
    throw new SafeMaximalistError("Provide a valid Maximalist run_id.");
  }
  return args.run_id;
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
  if (typeof value === "string") return redact(value).slice(0, MAX_ANSWER_CHARS);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => safeJson(entry, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonRecord)
        .slice(0, 100)
        .map(([key, entry]) => [key, safeJson(entry, depth + 1)]),
    );
  }
  return undefined;
}

function ok(operation: string, data: JsonRecord, text: string): McpToolResult {
  const sanitized = asRecord(safeJson(data));
  return {
    content: [{ type: "text", text: redact(text).slice(0, MAX_ANSWER_CHARS) }],
    structuredContent: { ...sanitized, ok: true, operation },
  };
}

function fail(operation: string, error: unknown): McpToolResult {
  const message = redact(error instanceof Error ? error.message : "Maximalist Fusion call failed.");
  return {
    isError: true,
    content: [
      { type: "text", text: `# Swarm Maximalist Fusion\n\n**Status:** failed\n\n${message}` },
    ],
    structuredContent: { ok: false, operation, error: message },
  };
}

function resultText(body: JsonRecord): string {
  const run = typeof body.run_id === "string" ? body.run_id : "unknown";
  const phase = typeof body.phase === "string" ? body.phase : "unknown";
  if (body.done !== true) {
    return [
      "# Swarm Maximalist Fusion",
      "",
      "**Status:** running",
      `**Run ID:** \`${run}\``,
      `**Phase:** ${phase}`,
      "",
      "Poll `swarm_maximalist_result` with this run ID.",
    ].join("\n");
  }
  const result = asRecord(body.result);
  const answer = typeof result.answer === "string" ? result.answer : "(no fused answer returned)";
  const confidence =
    typeof result.confidence === "number" ? result.confidence.toFixed(3) : "unknown";
  const lines = [
    "# Swarm Maximalist Fusion",
    "",
    "**Status:** complete",
    `**Run ID:** \`${run}\``,
    `**Confidence:** ${confidence}`,
    "",
    answer,
  ];
  const dissent = Array.isArray(result.dissent) ? result.dissent.slice(0, 10) : [];
  if (dissent.length) {
    lines.push("", "## Preserved dissent", "");
    for (const item of dissent) {
      const record = asRecord(item);
      if (typeof record.claim === "string") lines.push(`- ${record.claim}`);
    }
  }
  const unresolved = Array.isArray(result.unresolved) ? result.unresolved.slice(0, 10) : [];
  if (unresolved.length) {
    lines.push("", "## Unresolved", "");
    for (const item of unresolved) if (typeof item === "string") lines.push(`- ${item}`);
  }
  const capabilityResults = Array.isArray(result.capability_results)
    ? result.capability_results.slice(0, REQUIRED_CAPABILITY_IDS.length)
    : [];
  if (capabilityResults.length) {
    const completed = capabilityResults.filter(
      (item) => asRecord(item).status === "completed",
    ).length;
    const degraded = capabilityResults.filter((item) => {
      const status = asRecord(item).status;
      return status !== "completed" && status !== "skipped";
    }).length;
    lines.push(
      "",
      "## Capability grounding",
      "",
      `- Completed: ${completed}`,
      `- Degraded: ${degraded}`,
    );
  }
  return lines.join("\n");
}

export async function handleMaximalistTool(
  name: MaximalistToolName,
  args: JsonRecord,
): Promise<McpToolResult> {
  const operation = name.replace("swarm_maximalist_", "");
  try {
    if (name === "swarm_maximalist_health") {
      const body = await verifiedWorkerHealth();
      return ok(
        operation,
        body,
        [
          "# Swarm Maximalist Fusion",
          "",
          "**Status:** healthy",
          `**Profile:** ${String(body.profile ?? "unknown")}`,
          `**Core:** ${String(body.core_version ?? "unknown")} @ ${String(body.core_sha ?? "unknown")}`,
          `**Provider mode:** ${String(body.provider_mode ?? "unknown")}`,
          `**Capabilities:** ${String(body.capability_profile ?? "unknown")} (${String(body.ready_capability_count ?? "unknown")}/${REQUIRED_CAPABILITY_IDS.length} ready)`,
          `**Seats fingerprint:** ${String(body.seats_fingerprint ?? "unknown")}`,
          `**Active runs:** ${String(body.active_runs ?? "unknown")}`,
        ].join("\n"),
      );
    }
    if (name === "swarm_maximalist_start") {
      await verifiedWorkerHealth(true);
      const body = await workerJson("/run", {
        method: "POST",
        body: JSON.stringify(startPayload(args)),
      });
      const id = runId({ run_id: body.run_id });
      return ok(
        operation,
        body,
        [
          "# Swarm Maximalist Fusion",
          "",
          "**Status:** started",
          `**Run ID:** \`${id}\``,
          `**Phase:** ${String(body.phase ?? "running")}`,
          "",
          "Poll `swarm_maximalist_result` with this run ID until `done` is true.",
        ].join("\n"),
      );
    }
    if (name === "swarm_maximalist_result") {
      const id = runId(args);
      const body = await workerJson(`/runs/${encodeURIComponent(id)}`);
      if (body.error) {
        throw new SafeMaximalistError("The Maximalist run ended with an error.");
      }
      assertResultIdentity(body);
      return ok(operation, body, resultText(asRecord(safeJson(body))));
    }
    const id = runId(args);
    await verifiedWorkerHealth(true);
    const body = await workerJson("/resume", {
      method: "POST",
      body: JSON.stringify({ run_id: id }),
    });
    return ok(
      operation,
      body,
      [
        "# Swarm Maximalist Fusion",
        "",
        "**Status:** resume requested",
        `**Run ID:** \`${id}\``,
        `**Phase:** ${String(body.phase ?? "resuming")}`,
      ].join("\n"),
    );
  } catch (error) {
    return fail(operation, error);
  }
}
