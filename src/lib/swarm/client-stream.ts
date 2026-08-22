import type { SwarmEvent, SwarmTurnInput } from "./types";

export async function consumeSwarmStream(
  input: SwarmTurnInput,
  opts: {
    signal?: AbortSignal;
    onEvent: (event: SwarmEvent) => void;
  },
): Promise<void> {
  const res = await fetch("/api/plugin/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(text.slice(0, 200) || `Stream HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const chunks = buf.split("\n\n");
    buf = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("");
      if (!line) continue;
      try {
        opts.onEvent(JSON.parse(line) as SwarmEvent);
      } catch {
        /* ignore malformed */
      }
    }
  }
}
