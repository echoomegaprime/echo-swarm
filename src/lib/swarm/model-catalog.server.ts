import { VARIANTS, type ModelVariant } from "./catalog";

const URL = "https://openrouter.ai/api/v1/models";
const MAX_BYTES = 4_000_000;
let cached: { fetchedAt: number; variants: ModelVariant[] } | undefined;
let pending: Promise<{ fetchedAt?: number; variants: ModelVariant[] }> | undefined;

export function parsePublicModels(value: unknown): ModelVariant[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { data?: unknown }).data))
    return [];
  const rows = (value as { data: unknown[] }).data;
  const found = new Map<string, ModelVariant>();
  for (const row of rows.slice(0, 2_000)) {
    if (!row || typeof row !== "object") continue;
    const model = row as {
      id?: unknown;
      name?: unknown;
      architecture?: { output_modalities?: unknown };
    };
    if (typeof model.id !== "string" || !/^[a-zA-Z0-9~][a-zA-Z0-9._~:/-]{0,160}$/u.test(model.id))
      continue;
    if (
      model.id.endsWith(":batch") ||
      !Array.isArray(model.architecture?.output_modalities) ||
      !model.architecture.output_modalities.includes("text")
    )
      continue;
    const label =
      typeof model.name === "string"
        ? Array.from(model.name)
            .filter((character) => character.charCodeAt(0) >= 32)
            .join("")
            .slice(0, 120)
        : model.id;
    found.set(model.id, { id: model.id, label });
  }
  return [...found.values()];
}

export async function publicModelCatalog() {
  if (cached && Date.now() - cached.fetchedAt < 3_600_000) return cached;
  if (pending) return pending;
  pending = (async () => {
    try {
      const response = await fetch(URL, { redirect: "error", signal: AbortSignal.timeout(12_000) });
      if (!response.ok || !response.body) throw new Error("Model catalog unavailable");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_BYTES) throw new Error("Model catalog exceeds size limit");
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      const variants = parsePublicModels(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      if (!variants.length) throw new Error("No supported models returned");
      cached = {
        fetchedAt: Date.now(),
        variants: variants.some((variant) => variant.id === "openrouter/auto")
          ? variants
          : [{ id: "openrouter/auto", label: "Auto" }, ...variants],
      };
      return cached;
    } catch {
      return cached ?? { variants: VARIANTS.openrouter };
    } finally {
      pending = undefined;
    }
  })();
  return pending;
}
