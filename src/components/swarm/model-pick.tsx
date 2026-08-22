import { useState } from "react";
import { MODELS, VARIANTS, type ModelId } from "@/lib/swarm/catalog";
import { useSwarm } from "@/lib/swarm/store";
import { cn } from "@/lib/utils";

export function ModelPick({ id, className }: { id: ModelId; className?: string }) {
  const variants = VARIANTS[id] ?? [];
  const stored = useSwarm((s) => s.picks[id]);
  const setPick = useSwarm((s) => s.setPick);
  const fallback = MODELS[id].model;
  const current = stored?.trim() || fallback;
  const listed = variants.some((v) => v.id === current);
  const [forceCustom, setForceCustom] = useState(false);
  if (!variants.length) return null;
  const showCustom = forceCustom || !listed;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <select
        value={showCustom ? "__custom__" : current}
        onChange={(e) => {
          if (e.target.value === "__custom__") {
            setForceCustom(true);
            return;
          }
          setForceCustom(false);
          setPick(id, e.target.value);
        }}
        onClick={(e) => e.stopPropagation()}
        aria-label={`${MODELS[id].name} model`}
        className={cn(
          "h-7 w-full min-w-0 truncate rounded-sm bg-surface px-1.5 text-[11px] text-muted",
          "shadow-[var(--shadow-border)]",
          className,
        )}
      >
        {variants.map((v) => (
          <option key={v.id} value={v.id}>
            {v.label}
          </option>
        ))}
        <option value="__custom__">Custom id…</option>
      </select>
      {showCustom ? (
        <input
          value={listed ? "" : current}
          onChange={(e) => setPick(id, e.target.value)}
          onClick={(e) => e.stopPropagation()}
          spellCheck={false}
          autoComplete="off"
          aria-label={`${MODELS[id].name} custom model id`}
          placeholder="provider/model-id"
          className="h-7 w-full min-w-0 truncate rounded-sm bg-surface px-1.5 font-mono text-[11px] text-muted shadow-[var(--shadow-border)]"
        />
      ) : null}
    </div>
  );
}
