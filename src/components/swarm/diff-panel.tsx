import { useMemo, useState } from "react";
import { MODELS } from "@/lib/swarm/catalog";
import { fileMap, lineDiff } from "@/lib/swarm/diff";
import type { SwarmMessage } from "@/lib/swarm/types";
import { useSwarm } from "@/lib/swarm/store";
import { cn } from "@/lib/utils";

export function DiffPanel() {
  const messages = useSwarm(
    (s) => (s.sessions.find((x) => x.id === s.activeId) ?? s.sessions[0]!).messages,
  );
  const impl = messages.filter((m) => m.role === "assistant" && m.phase === "implement" && m.modelId);
  if (impl.length < 2) return null;
  return <DiffInner impl={impl} />;
}

function DiffInner({ impl }: { impl: SwarmMessage[] }) {
  const [a, setA] = useState(impl[0]!.id);
  const [b, setB] = useState(impl[1]!.id);
  const left = impl.find((m) => m.id === a) ?? impl[0]!;
  const right = impl.find((m) => m.id === b) ?? impl[1]!;
  const files = useMemo(() => {
    const la = fileMap(left.content);
    const lb = fileMap(right.content);
    const names = [...new Set([...la.keys(), ...lb.keys()])];
    return names.map((path) => ({
      path,
      lines: lineDiff(la.get(path) ?? "", lb.get(path) ?? ""),
    }));
  }, [left, right]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-3">
      <p className="mb-2 text-xs font-medium tracking-wide text-subtle uppercase">Implement diff</p>
      <div className="mb-2 flex flex-wrap gap-2">
        <SeatSelect value={a} onChange={setA} options={impl} label="A" />
        <SeatSelect value={b} onChange={setB} options={impl} label="B" />
      </div>
      <div className="flex max-h-80 flex-col gap-3 overflow-y-auto rounded-lg bg-surface p-3 shadow-[var(--shadow-border)]">
        {files.length ? (
          files.map((f) => (
            <section key={f.path}>
              <p className="mb-1 font-mono text-[11px] text-subtle">{f.path}</p>
              <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed">
                {f.lines.map((line, i) => (
                  <div
                    key={i}
                    className={cn(
                      "px-1",
                      line.type === "add" && "bg-ok/15 text-ok",
                      line.type === "del" && "bg-danger/15 text-danger",
                    )}
                  >
                    {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
                    {line.text}
                  </div>
                ))}
              </pre>
            </section>
          ))
        ) : (
          <p className="text-xs text-muted">No path-tagged fences to diff.</p>
        )}
      </div>
    </div>
  );
}

function SeatSelect({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SwarmMessage[];
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-md bg-raised px-2 text-sm text-fg"
      >
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {m.modelId ? MODELS[m.modelId].name : "Seat"}
          </option>
        ))}
      </select>
    </label>
  );
}
