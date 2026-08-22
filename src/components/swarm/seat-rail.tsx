import { Plug, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  GROUP_META,
  MODELS,
  PLUGINS,
  idsIn,
  type ModelId,
} from "@/lib/swarm/catalog";
import { isConnected, useSwarm } from "@/lib/swarm/store";
import { Constellation } from "./constellation";
import { ModelPick } from "./model-pick";
import { cn } from "@/lib/utils";

export function SeatRail() {
  const host = useSwarm((s) => s.host);
  const seats = useSwarm((s) => s.seats);
  const keys = useSwarm((s) => s.keys);
  const live = useSwarm((s) => s.live);
  const toggleSeat = useSwarm((s) => s.toggleSeat);
  const setHost = useSwarm((s) => s.setHost);
  const setConnectOpen = useSwarm((s) => s.setConnectOpen);
  const sessions = useSwarm((s) => s.sessions);
  const activeId = useSwarm((s) => s.activeId);
  const insights = useSwarm(
    (s) => (s.sessions.find((x) => x.id === s.activeId) ?? s.sessions[0]!).insights,
  );
  const spend = useSwarm((s) => s.spend);

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-5 pb-3">
        <p className="text-xs font-medium tracking-[0.18em] text-subtle uppercase">Swarm</p>
        <h2 className="font-serif text-2xl tracking-tight">The table</h2>
      </div>
      <div className="px-3 pb-4">
        <Constellation />
        <SpendLine spend={spend} live={live} />
      </div>
      <ScrollArea className="flex-1 px-3 pb-4">
        {GROUP_META.map((g) => (
          <Group key={g.id} label={g.label}>
            {idsIn(g.id).map((id) => (
              <SeatRow
                key={id}
                id={id}
                host={host}
                seats={seats}
                live={isConnected(id, keys, live)}
                onHost={setHost}
                onToggle={toggleSeat}
                onConnect={() => setConnectOpen(true)}
              />
            ))}
          </Group>
        ))}
        <Separator className="my-4" />
        <p className="mb-2 px-1 text-xs font-medium tracking-wide text-subtle uppercase">
          Host plugins
        </p>
        <ul className="mb-4 flex flex-col gap-1 px-1">
          {PLUGINS.map((p) => (
            <li key={p.name} className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs text-muted">{p.name}</span>
              <Badge variant="ok">shared</Badge>
            </li>
          ))}
        </ul>
        {insights.length ? (
          <>
            <p className="mb-2 px-1 text-xs font-medium tracking-wide text-subtle uppercase">
              Board
            </p>
            <ul className="mb-4 flex flex-col gap-2">
              {insights.map((i) => (
                <li key={i.id} className="rounded-md bg-raised px-2 py-2">
                  <p className="text-xs font-medium">{i.title}</p>
                  <p className="text-xs text-muted">{i.body}</p>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <div className="mb-2 flex items-center justify-between px-1">
          <p className="text-xs font-medium tracking-wide text-subtle uppercase">Sessions</p>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="New session"
            onClick={() => useSwarm.getState().newSession()}
          >
            <Plus className="size-4" />
          </Button>
        </div>
        <ul className="flex flex-col gap-1">
          {sessions.map((sess) => (
            <li key={sess.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => useSwarm.getState().selectSession(sess.id)}
                className={cn(
                  "min-w-0 flex-1 truncate rounded-md px-2 py-2 text-left text-sm",
                  sess.id === activeId ? "bg-raised text-fg" : "text-muted hover:text-fg",
                )}
              >
                {sess.title}
              </button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${sess.title}`}
                onClick={() => useSwarm.getState().deleteSession(sess.id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      <p className="mb-1.5 px-1 text-xs font-medium tracking-wide text-subtle uppercase">
        {label}
      </p>
      <ul className="flex flex-col gap-1.5">{children}</ul>
    </div>
  );
}

function SeatRow({
  id,
  host,
  seats,
  live,
  onHost,
  onToggle,
  onConnect,
}: {
  id: ModelId;
  host: ModelId;
  seats: ModelId[];
  live: boolean;
  onHost: (id: ModelId) => void;
  onToggle: (id: ModelId) => void;
  onConnect: () => void;
}) {
  const def = MODELS[id];
  const on = seats.includes(id);
  const ping = useSwarm((s) =>
    id === "qwen" ? s.live.forgeMs : id === "qwenimg" ? s.live.temperMs : undefined,
  );
  const spend = useSwarm((s) => s.spend[id]);
  const tok = spend ? spend.prompt + spend.completion : 0;
  return (
    <li
      className={cn(
        "flex flex-col gap-1.5 rounded-lg px-2 py-1.5",
        host === id && "bg-raised",
      )}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => (live ? onHost(id) : onConnect())}
        >
          <span className="flex size-8 items-center justify-center rounded-full bg-surface font-serif text-sm shadow-[var(--shadow-border)]">
            {def.monogram}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{def.name}</span>
            <span className="block truncate text-xs text-subtle">
              {host === id ? "Host" : def.node ?? def.lab}
              {ping != null ? ` · ${ping}ms` : ""}
              {tok ? ` · ${tok.toLocaleString()} tok` : ""}
            </span>
          </span>
        </button>
        {live ? (
          <Switch
            checked={on}
            onCheckedChange={() => onToggle(id)}
            aria-label={`${def.name} in this turn`}
          />
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Connect ${def.name}`}
            onClick={onConnect}
          >
            <Plug className="size-4" />
          </Button>
        )}
      </div>
      <ModelPick id={id} />
    </li>
  );
}

function SpendLine({
  spend,
  live,
}: {
  spend: ReturnType<typeof useSwarm.getState>["spend"];
  live: ReturnType<typeof useSwarm.getState>["live"];
}) {
  const rows = Object.entries(spend);
  const tokens = rows.reduce((n, [, v]) => n + (v?.prompt ?? 0) + (v?.completion ?? 0), 0);
  const calls = rows.reduce((n, [, v]) => n + (v?.calls ?? 0), 0);
  return (
    <p className="mt-2 px-1 text-xs text-subtle">
      {tokens ? `${tokens.toLocaleString()} tok · ${calls} calls` : "Spend: idle"}
      {live.forgeMs != null ? ` · FORGE ${live.forgeMs}ms` : ""}
      {live.temperMs != null ? ` · TEMPER ${live.temperMs}ms` : ""}
    </p>
  );
}
