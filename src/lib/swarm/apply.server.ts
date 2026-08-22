import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { SwarmFile } from "./types";
import { sanitizeRel } from "./files";

const ROOT = resolve("/workspace/swarm-out");

export async function writeSwarmFiles(
  files: SwarmFile[],
  slug: string,
): Promise<{ ok: true; dir: string; written: string[] } | { ok: false; error: string }> {
  const safeSlug = (slug || "session").replace(/[^\w.-]+/g, "-").slice(0, 48) || "session";
  const dir = join(ROOT, safeSlug);
  if (!dir.startsWith(ROOT)) return { ok: false, error: "Bad destination." };
  const written: string[] = [];
  try {
    await mkdir(dir, { recursive: true });
    for (const f of files.slice(0, 40)) {
      const rel = sanitizeRel(f.path);
      if (!rel) continue;
      const target = resolve(dir, rel);
      if (!target.startsWith(dir + "/") && target !== dir) continue;
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, f.content.slice(0, 400_000), "utf8");
      written.push(rel);
    }
    if (!written.length) return { ok: false, error: "No path-tagged fences to apply." };
    return { ok: true, dir, written };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Apply failed." };
  }
}
