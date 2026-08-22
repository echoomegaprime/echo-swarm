import type { ModelId } from "./catalog";
import type { SwarmFile, SwarmMessage } from "./types";

const FENCE = /```([^\n`]*)\n([\s\S]*?)```/g;
const MAX_FILE = 400_000;
const MAX_FILES = 40;

export function extractFiles(markdown: string, from?: ModelId): SwarmFile[] {
  const out: SwarmFile[] = [];
  const re = new RegExp(FENCE);
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown))) {
    const meta = match[1]!.trim();
    const content = match[2]!.replace(/\n$/, "");
    const path = pathFromMeta(meta);
    if (!path) continue;
    const safe = sanitizeRel(path);
    if (!safe) continue;
    if (content.length > MAX_FILE) continue;
    out.push({ path: safe, content, lang: meta.split(/\s+/)[0], from });
    if (out.length >= MAX_FILES) break;
  }
  return out;
}

export function filesFromMessages(messages: SwarmMessage[]): SwarmFile[] {
  const map = new Map<string, SwarmFile>();
  for (const m of messages) {
    if (m.role !== "assistant" || !m.content) continue;
    if (m.phase && m.phase !== "implement" && m.phase !== "merge") continue;
    for (const f of extractFiles(m.content, m.modelId)) {
      map.set(f.path, f);
    }
  }
  return [...map.values()];
}

function pathFromMeta(meta: string): string | undefined {
  const parts = meta.split(/\s+/).filter(Boolean);
  const hit = [...parts].reverse().find((p) => p.includes("/") || /\.\w{1,8}$/.test(p));
  return hit;
}

export function sanitizeRel(raw: string): string | null {
  const trimmed = raw.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!trimmed || trimmed.length > 180) return null;
  if (trimmed.includes("\0")) return null;
  const parts = trimmed.split("/").filter(Boolean);
  if (!parts.length) return null;
  if (parts.some((p) => p === ".." || p === ".")) return null;
  if (!parts.every((p) => /^[\w.-]+$/.test(p))) return null;
  if (!/\.\w{1,12}$/.test(parts[parts.length - 1]!)) return null;
  return parts.join("/");
}

function crc32(data: Uint8Array): number {
  let c = ~0 >>> 0;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i]!;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function u16(n: number): Uint8Array {
  return Uint8Array.of(n & 255, (n >>> 8) & 255);
}

function u32(n: number): Uint8Array {
  return Uint8Array.of(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
}

export function makeZip(files: SwarmFile[]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = encoder.encode(f.path);
    const data = encoder.encode(f.content);
    const crc = crc32(data);
    const local = concat(
      Uint8Array.of(0x50, 0x4b, 0x03, 0x04),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      data,
    );
    const central = concat(
      Uint8Array.of(0x50, 0x4b, 0x01, 0x02),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    );
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = concat(
    Uint8Array.of(0x50, 0x4b, 0x05, 0x06),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralSize),
    u32(offset),
    u16(0),
  );
  return concat(...locals, ...centrals, end);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function downloadZip(files: SwarmFile[], filename: string) {
  if (!files.length) return;
  const zip = makeZip(files);
  const copy = new Uint8Array(zip.byteLength);
  copy.set(zip);
  const blob = new Blob([copy], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".zip") ? filename : `${filename}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
