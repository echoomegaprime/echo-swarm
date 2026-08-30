#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { mergeAppEnv, projectRoot, readAppEnv } from "./with-app-env.mjs";

const edition = process.argv[2];
const outDir = process.argv[3] || "dist";

if (!new Set(["private-oauth", "public-api"]).has(edition)) {
  console.error("usage: node scripts/build-edition.mjs <private-oauth|public-api> [out-dir]");
  process.exit(2);
}
if (!new Set(["dist", "dist-private", "dist-public"]).has(outDir)) {
  console.error("output directory must be dist, dist-private, or dist-public");
  process.exit(2);
}

const vite = resolve("node_modules/vite/bin/vite.js");
const env = {
  ...mergeAppEnv(readAppEnv(projectRoot()), process.env),
  ECHO_SWARM_EDITION: edition,
  VITE_ECHO_SWARM_EDITION: edition,
};
const result = spawnSync(process.execPath, [vite, "build", "--outDir", outDir], {
  env,
  stdio: "inherit",
  shell: false,
});
if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);

// Nitro's Vercel preset writes to .vercel/output regardless of Vite --outDir.
// Copy that immutable build into an edition-specific distributable directory.
const generated = resolve(".vercel/output");
const target = resolve(outDir);
if (!existsSync(generated)) {
  console.error("Nitro build did not produce .vercel/output");
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
cpSync(generated, target, { recursive: true });
console.log(`[edition] ${edition} artifact -> ${target}`);
