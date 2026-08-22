export type DiffLine = { type: "eq" | "add" | "del"; text: string };

export function lineDiff(a: string, b: string): DiffLine[] {
  const left = a.split("\n").slice(0, 2000);
  const right = b.split("\n").slice(0, 2000);
  const n = left.length;
  const m = right.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        left[i] === right[j] ? (dp[i + 1]![j + 1] ?? 0) + 1 : Math.max(dp[i + 1]![j] ?? 0, dp[i]![j + 1] ?? 0);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (left[i] === right[j]) {
      out.push({ type: "eq", text: left[i]! });
      i += 1;
      j += 1;
    } else if ((dp[i + 1]![j] ?? 0) >= (dp[i]![j + 1] ?? 0)) {
      out.push({ type: "del", text: left[i]! });
      i += 1;
    } else {
      out.push({ type: "add", text: right[j]! });
      j += 1;
    }
  }
  while (i < n) {
    out.push({ type: "del", text: left[i]! });
    i += 1;
  }
  while (j < m) {
    out.push({ type: "add", text: right[j]! });
    j += 1;
  }
  return out;
}

export function fileMap(markdown: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /```([^\n`]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown))) {
    const meta = match[1]!.trim();
    const parts = meta.split(/\s+/).filter(Boolean);
    const path = [...parts].reverse().find((p) => p.includes("/") || /\.\w{1,8}$/.test(p));
    if (!path) continue;
    map.set(path, match[2]!.replace(/\n$/, ""));
  }
  return map;
}
