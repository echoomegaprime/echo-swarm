import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { MODEL_IDS } from "./catalog";
import { pingNodes, providerStatus, runSwarm } from "./engine.server";
import { writeSwarmFiles } from "./apply.server";
import { pollGithubDevice, pullCliAuth, startGithubDevice } from "./oauth.server";

const modelId = z.enum(MODEL_IDS);

const authMode = z.enum(["oauth", "key"]);

const optionalStr = z.string().optional();

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
    return runSwarm({ ...data, auth: data.auth ?? {}, picks: data.picks ?? {} });
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
