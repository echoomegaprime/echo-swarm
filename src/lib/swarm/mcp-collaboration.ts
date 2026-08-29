import type { SwarmMode } from "./catalog";
import {
  isCollaborationPurpose,
  PURPOSE_META,
  PURPOSE_MODES,
  purposePrompt,
  type CollaborationPurpose,
} from "./purpose";
import type { SwarmTurnResult } from "./types";

export type { CollaborationPurpose } from "./purpose";

export type CollaborationPlan = {
  purpose: CollaborationPurpose;
  mode: SwarmMode;
  prompt: string;
};

type CollaborationTurn = {
  modelId: string;
  model?: string;
  content: string;
  error?: string;
  phase?: string;
  usage?: { prompt: number; completion: number };
};

type CollaborationOutput = {
  ok: boolean;
  purpose: CollaborationPurpose;
  mode: SwarmMode;
  turns: CollaborationTurn[];
  insights: { title: string; body: string; from: string }[];
  skipped: { modelId: string; reason: string }[];
  error?: string;
  truncated?: boolean;
};

const MAX_TASK_CHARS = 12_000;
const MAX_TURN_CHARS = 12_000;
const MAX_CHAT_CHARS = 30_000;

export function createCollaborationPlan(
  task: unknown,
  purpose: unknown,
): CollaborationPlan | (CollaborationPlan & { error: string }) {
  const normalizedPurpose: CollaborationPurpose | undefined =
    purpose === undefined ? "brainstorm" : isCollaborationPurpose(purpose) ? purpose : undefined;
  const errorPurpose = normalizedPurpose ?? "brainstorm";
  const errorPlan = (error: string): CollaborationPlan & { error: string } => ({
    purpose: errorPurpose,
    mode: PURPOSE_MODES[errorPurpose],
    prompt: "",
    error,
  });
  if (typeof task !== "string" || !task.trim()) {
    return errorPlan("Provide a non-empty task for the Swarm collaboration.");
  }
  const normalizedTask = task.trim();
  if (normalizedTask.length > MAX_TASK_CHARS) {
    return errorPlan(`The collaboration task is too long (maximum ${MAX_TASK_CHARS} characters).`);
  }
  if (!normalizedPurpose) {
    return errorPlan(
      "Purpose must be brainstorm, debate, build, review, validate, certify, plan, or report.",
    );
  }

  const prompt = purposePrompt(normalizedPurpose, normalizedTask);

  return {
    purpose: normalizedPurpose,
    mode: PURPOSE_MODES[normalizedPurpose],
    prompt,
  };
}

export function formatCollaborationResult(
  plan: CollaborationPlan,
  result: SwarmTurnResult,
): {
  content: { type: "text"; text: string }[];
  structuredContent: CollaborationOutput;
  isError?: true;
} {
  if (!result.ok) {
    const error = redact(result.error);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `# Swarm Collaboration\n\n**Status:** failed\n\n${error}`,
        },
      ],
      structuredContent: {
        ok: false,
        purpose: plan.purpose,
        mode: plan.mode,
        turns: [],
        insights: [],
        skipped: [],
        error,
      },
    };
  }

  const turns = result.turns.slice(0, 20).map((turn) => ({
    modelId: turn.modelId,
    ...(turn.model ? { model: turn.model } : {}),
    content: redact(turn.content).slice(0, MAX_TURN_CHARS),
    ...(turn.error ? { error: redact(turn.error) } : {}),
    ...(turn.phase ? { phase: turn.phase } : {}),
    ...(turn.usage ? { usage: turn.usage } : {}),
  }));
  const insights = result.insights.slice(0, 40).map((insight) => ({
    title: redact(insight.title).slice(0, 400),
    body: redact(insight.body).slice(0, 4_000),
    from: insight.from,
  }));
  const skipped = result.skipped.slice(0, 20).map((seat) => ({
    modelId: seat.modelId,
    reason: redact(seat.reason).slice(0, 1_000),
  }));
  const contributorCount = turns.filter((turn) => turn.content.trim().length > 0).length;
  if (contributorCount === 0 && insights.length === 0) {
    const error = "No selected model returned usable output.";
    const diagnostics = [
      ...turns.map(
        (turn) => `- **${turn.modelId}:** ${turn.error || "The model returned an empty response."}`,
      ),
      ...skipped.map((seat) => `- **${seat.modelId}:** ${seat.reason}`),
    ];
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: [
            "# Swarm Collaboration",
            "",
            "**Status:** failed",
            "**Contributors:** 0",
            "",
            error,
            ...(diagnostics.length ? ["", "## Model diagnostics", "", ...diagnostics] : []),
          ].join("\n"),
        },
      ],
      structuredContent: {
        ok: false,
        purpose: plan.purpose,
        mode: plan.mode,
        turns,
        insights,
        skipped,
        error,
      },
    };
  }
  const lines = [
    "# Swarm Collaboration",
    "",
    `**Purpose:** ${PURPOSE_META[plan.purpose].label}`,
    `**Mode:** ${plan.mode}`,
    `**Contributors:** ${contributorCount}`,
    "",
  ];
  for (const turn of turns) {
    const phase = turn.phase ? ` · ${turn.phase}` : "";
    const model = turn.model ? ` (${turn.model})` : "";
    lines.push(
      `## ${turn.modelId}${model}${phase}`,
      "",
      (turn.error ?? turn.content) || "(no response)",
      "",
    );
  }
  if (insights.length) {
    lines.push("## Shared insights", "");
    for (const insight of insights)
      lines.push(`- **${insight.title}** (${insight.from}): ${insight.body}`);
    lines.push("");
  }
  if (skipped.length) {
    lines.push("## Seats not reached", "");
    for (const seat of skipped) lines.push(`- **${seat.modelId}:** ${seat.reason}`);
    lines.push("");
  }
  let text = lines.join("\n");
  const truncated = text.length > MAX_CHAT_CHARS;
  if (truncated)
    text = `${text.slice(0, MAX_CHAT_CHARS)}\n\n_Chat rendering truncated; structured results contain the bounded seat outputs._`;

  return {
    content: [{ type: "text", text }],
    structuredContent: {
      ok: true,
      purpose: plan.purpose,
      mode: plan.mode,
      turns,
      insights,
      skipped,
      ...(truncated ? { truncated: true } : {}),
    },
  };
}

function redact(text: string): string {
  return text
    .replace(/Bearer\s+\S+/giu, "Bearer ***")
    .replace(/sk-[a-zA-Z0-9._-]+/gu, "sk-***")
    .replace(/xai-[a-zA-Z0-9._-]+/gu, "xai-***")
    .replace(/gh[pousr]_[a-zA-Z0-9_]+/gu, "gh*_***")
    .replace(/github_pat_[a-zA-Z0-9_]+/gu, "github_pat_***")
    .replace(/\bAIza[a-zA-Z0-9_-]{20,}\b/gu, "AIza***")
    .replace(/\bAKIA[A-Z0-9]{16}\b/gu, "AKIA***")
    .replace(/\b(?:hf_|glpat-|xox[baprs]-)[a-zA-Z0-9._-]{12,}\b/gu, "token-***")
    .replace(
      /\b(api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*([:=])\s*["']?[^\s"',;]+["']?/giu,
      "$1$2***",
    );
}
