import type { SwarmMode } from "./catalog";

export const COLLABORATION_PURPOSES = [
  "brainstorm",
  "debate",
  "build",
  "review",
  "validate",
  "certify",
  "plan",
  "report",
] as const;

export type CollaborationPurpose = (typeof COLLABORATION_PURPOSES)[number];

export const PURPOSE_MODES: Record<CollaborationPurpose, SwarmMode> = {
  brainstorm: "parallel",
  debate: "debate",
  build: "buildheavy",
  review: "roundtable",
  validate: "roundtable",
  certify: "conductor",
  plan: "conductor",
  report: "conductor",
};

export const PURPOSE_META: Record<CollaborationPurpose, { label: string; instruction: string }> = {
  brainstorm: {
    label: "Brainstorm",
    instruction:
      "Generate independent approaches first, then identify the strongest ideas, conflicts, and next experiments.",
  },
  debate: {
    label: "Debate",
    instruction:
      "Argue opposing positions, rebut the strongest counterargument, and preserve dissent.",
  },
  build: {
    label: "Build",
    instruction:
      "Produce an implementable specification, concrete artifacts, hostile review, and verification steps.",
  },
  review: {
    label: "Review",
    instruction:
      "Review independently for correctness, regressions, security, missing assumptions, and rollback gaps. Rank actionable findings.",
  },
  validate: {
    label: "Validate",
    instruction:
      "Validate each material claim against supplied evidence. Separate observed, verified, inferred, unknown, and blocked conclusions.",
  },
  certify: {
    label: "Certify",
    instruction:
      "Perform an evidence-gated certification review. Return PASS, FAIL, or ABSTAIN with criteria and evidence. This is advisory unless an exact-SHA CertForge/GitHub App receipt is supplied.",
  },
  plan: {
    label: "Plan",
    instruction:
      "Create a dependency-aware execution and verification plan with acceptance criteria and rollback.",
  },
  report: {
    label: "Report",
    instruction:
      "Create a decision-ready report covering evidence, agreements, disagreements, risks, and recommended next actions without inventing work.",
  },
};

export function isCollaborationPurpose(value: unknown): value is CollaborationPurpose {
  return typeof value === "string" && (COLLABORATION_PURPOSES as readonly string[]).includes(value);
}

export function purposePrompt(purpose: CollaborationPurpose, task: string): string {
  return [
    `SWARM PURPOSE: ${PURPOSE_META[purpose].label.toUpperCase()}`,
    PURPOSE_META[purpose].instruction,
    "Show which evidence or contribution supports each material conclusion. Do not hide disagreement.",
    `Task:\n${task.trim()}`,
  ].join("\n\n");
}
