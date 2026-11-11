import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { MODEL_IDS } from "./catalog";
import { pingNodes, providerStatus, runSwarm } from "./engine.server";
import { writeSwarmFiles } from "./apply.server";
import {
  pollGithubDevice,
  pullCliAuth,
  startCommanderGithubDevice,
  startGithubDevice,
} from "./oauth.server";
import { handleMaximalistTool } from "./mcp-maximalist.server";
import { authModesForEdition } from "./edition";

const modelId = z.enum(MODEL_IDS);

const authMode = z.enum(["oauth", "key"]);

const optionalStr = z.string().optional();

const fusionRunId = z.string().regex(/^run_[A-Za-z0-9_-]{4,80}$/u);

const fusionBudget = z
  .object({
    max_calls: z.number().int().min(1).max(120).optional(),
    max_cost_usd: z.number().positive().max(5).optional(),
    max_wall_s: z.number().positive().max(4_800).optional(),
  })
  .optional();

function fusionClientResult(result: Awaited<ReturnType<typeof handleMaximalistTool>>) {
  const structured = result.structuredContent;
  return {
    ok: structured.ok === true && result.isError !== true,
    isError: result.isError === true,
    text: result.content[0]?.text ?? "",
    run_id: typeof structured.run_id === "string" ? structured.run_id : undefined,
    phase: typeof structured.phase === "string" ? structured.phase : undefined,
    done: structured.done === true,
    profile: typeof structured.profile === "string" ? structured.profile : undefined,
    seats_fingerprint:
      typeof structured.seats_fingerprint === "string" ? structured.seats_fingerprint : undefined,
    result:
      structured.result && typeof structured.result === "object" ? structured.result : undefined,
    error: typeof structured.error === "string" ? structured.error : undefined,
  };
}

const turnInput = z.object({
  prompt: z.string().min(1).max(8000),
  mode: z.enum(["parallel", "roundtable", "debate", "conductor", "buildheavy"]),
  host: modelId,
  seats: z.array(modelId).min(1).max(17),
  keys: z.object({
    grok: optionalStr,
    openai: optionalStr,
    anthropic: optionalStr,
    google: optionalStr,
    deepseek: optionalStr,
    mistral: optionalStr,
    openrouter: optionalStr,
    groq: optionalStr,
    together: optionalStr,
    samba: optionalStr,
    cerebras: optionalStr,
    fireworks: optionalStr,
    perplexity: optionalStr,
    cohere: optionalStr,
    github: optionalStr,
    forge: optionalStr,
    forgeUrl: optionalStr,
    forgeModel: optionalStr,
    temper: optionalStr,
    temperUrl: optionalStr,
    temperModel: optionalStr,
  }),
  auth: z
    .object({
      grok: authMode.optional(),
      openai: authMode.optional(),
      anthropic: authMode.optional(),
      deepseek: authMode.optional(),
      github: authMode.optional(),
    })
    .optional()
    .default({}),
  picks: z.record(z.string(), z.string()).optional(),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(12000),
        modelId: modelId.optional(),
      }),
    )
    .max(24),
  insights: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        body: z.string(),
        from: modelId,
      }),
    )
    .max(40),
});

export const getProviderStatus = createServerFn({ method: "GET" }).handler(async () =>
  providerStatus(),
);

export const sendSwarmTurn = createServerFn({ method: "POST" })
  .validator(turnInput)
  .handler(async ({ data }) => {
    return runSwarm({
      ...data,
      auth: authModesForEdition(data.auth ?? {}),
      picks: data.picks ?? {},
    });
  });

export const pingFleet = createServerFn({ method: "POST" })
  .validator(
    z.object({
      forgeUrl: optionalStr,
      forge: optionalStr,
      temperUrl: optionalStr,
      temper: optionalStr,
    }),
  )
  .handler(async ({ data }) => pingNodes(data));

export const applySwarmFiles = createServerFn({ method: "POST" })
  .validator(
    z.object({
      slug: z.string().max(80).optional(),
      files: z
        .array(z.object({ path: z.string().max(180), content: z.string().max(400000) }))
        .max(40),
    }),
  )
  .handler(async ({ data }) => writeSwarmFiles(data.files, data.slug ?? "session"));

export const pullCliTokens = createServerFn({ method: "POST" }).handler(async () => pullCliAuth());

export const startGhDevice = createServerFn({ method: "POST" }).handler(async () =>
  startGithubDevice(),
);

export const pollGhDevice = createServerFn({ method: "POST" })
  .validator(z.object({ device_code: z.string().min(4).max(200) }))
  .handler(async ({ data }) => pollGithubDevice(data.device_code));

export const startCommanderGithubOAuth = createServerFn({ method: "POST" }).handler(async () =>
  startCommanderGithubDevice(),
);

export const pollCommanderGithubOAuth = createServerFn({ method: "POST" })
  .validator(z.object({ device_code: z.string().min(4).max(200) }))
  .handler(async ({ data }) => pollGithubDevice(data.device_code));

export const getFusionHealth = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () =>
    fusionClientResult(await handleMaximalistTool("swarm_maximalist_health", {})),
  );

export const startFusionRun = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      objective: z.string().min(1).max(12000),
      context: z.record(z.string(), z.unknown()).optional(),
      budget: fusionBudget,
      idempotency_key: z
        .string()
        .regex(/^[A-Za-z0-9._:-]{1,128}$/u)
        .optional(),
    }),
  )
  .handler(async ({ data }) =>
    fusionClientResult(await handleMaximalistTool("swarm_maximalist_start", data)),
  );

export const getFusionResult = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ run_id: fusionRunId }))
  .handler(async ({ data }) =>
    fusionClientResult(await handleMaximalistTool("swarm_maximalist_result", data)),
  );

export const resumeFusionRun = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ run_id: fusionRunId }))
  .handler(async ({ data }) =>
    fusionClientResult(await handleMaximalistTool("swarm_maximalist_resume", data)),
  );
