import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, Square, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { MODE_META, MODELS, MODES, STARTERS, type ModelId } from "@/lib/swarm/catalog";
import { sendSwarmTurn } from "@/lib/swarm/actions";
import { consumeSwarmStream } from "@/lib/swarm/client-stream";
import { isConnected, useSwarm } from "@/lib/swarm/store";
import type { SwarmEvent, SwarmTurnInput } from "@/lib/swarm/types";
import { cn } from "@/lib/utils";

export function Composer() {
  const [draft, setDraft] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const mode = useSwarm((s) => s.mode);
  const setMode = useSwarm((s) => s.setMode);
  const host = useSwarm((s) => s.host);
  const seats = useSwarm((s) => s.seats);
  const keys = useSwarm((s) => s.keys);
  const live = useSwarm((s) => s.live);
  const thinking = useSwarm((s) => s.thinking);
  const quote = useSwarm((s) => s.quote);
  const session = useSwarm((s) => s.sessions.find((x) => x.id === s.activeId) ?? s.sessions[0]!);
  const busy = thinking.length > 0;

  async function submit(text: string) {
    const raw = text.trim();
    if (!raw || busy) return;
    const liveSeats = seats.filter((id) => isConnected(id, keys, live));
    if (!liveSeats.length) {
      useSwarm.getState().setConnectOpen(true);
      toast("Connect a lab first.");
      return;
    }
    const store = useSwarm.getState();
    const quoted = store.quote;
    const prompt = quoted
      ? `Reply to ${MODELS[quoted.modelId].name} who said:\n"""${quoted.content.slice(0, 600)}"""\n\n${raw}`
      : raw;
    const seatList =
      quoted?.only && liveSeats.includes(quoted.modelId) ? [quoted.modelId] : liveSeats;
    store.titleFromPrompt(raw);
    store.pushMessages([
      {
        id: crypto.randomUUID(),
        role: "user",
        content: raw,
        replyTo: quoted?.messageId,
        createdAt: Date.now(),
      },
    ]);
    setDraft("");
    store.setQuote(null);
    const runId = store.beginRun();
    store.setThinking(mode === "conductor" ? [store.host] : seatList);
    store.clearStream();

    const history = session.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-16)
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
        modelId: m.modelId,
      }));

    const input: SwarmTurnInput = {
      prompt,
      mode: store.mode,
      host: seatList.includes(store.host) ? store.host : seatList[0]!,
      seats: seatList,
      keys: store.keys,
      auth: store.auth,
      picks: store.picks,
      history,
      insights: session.insights,
    };

    const committed = new Set<string>();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const onEvent = (ev: SwarmEvent) => {
      const s = useSwarm.getState();
      if (s.runId !== runId) return;
      if (ev.type === "phase") s.setThinking(ev.seats);
      if (ev.type === "notice") {
        s.pushMessages([
          { id: crypto.randomUUID(), role: "notice", content: ev.content, createdAt: Date.now() },
        ]);
      }
      if (ev.type === "delta") {
        s.upsertStream({
          messageId: ev.messageId,
          modelId: ev.modelId,
          phase: ev.phase,
          content: ev.text,
        });
      }
      if (ev.type === "turn") {
        const id = ev.turn.messageId ?? crypto.randomUUID();
        if (committed.has(id)) return;
        committed.add(id);
        s.dropStream(id);
        s.pushMessages([
          {
            id,
            role: "assistant",
            modelId: ev.turn.modelId,
            model: ev.turn.model,
            content: ev.turn.error ? ev.turn.error : ev.turn.content,
            traces: ev.turn.traces,
            phase: ev.turn.phase,
            usage: ev.turn.usage,
            createdAt: Date.now(),
          },
        ]);
        if (ev.turn.usage) s.addUsage(ev.turn.modelId, ev.turn.usage);
      }
      if (ev.type === "usage") s.addUsage(ev.modelId, { prompt: ev.prompt, completion: ev.completion });
      if (ev.type === "insights") s.setInsights(ev.insights);
      if (ev.type === "done") {
        s.clearStream();
        if (!ev.result.ok) {
          toast(ev.result.error);
          s.pushMessages([
            { id: crypto.randomUUID(), role: "notice", content: ev.result.error, createdAt: Date.now() },
          ]);
          return;
        }
        s.setInsights(ev.result.insights);
        for (const t of ev.result.turns) {
          const id = t.messageId ?? `${t.modelId}-${t.phase ?? "x"}-${t.content.slice(0, 24)}`;
          if (committed.has(id) || committed.has(t.messageId ?? "")) continue;
          if (t.messageId) committed.add(t.messageId);
          committed.add(id);
          s.pushMessages([
            {
              id: crypto.randomUUID(),
              role: "assistant",
              modelId: t.modelId,
              model: t.model,
              content: t.error ? t.error : t.content,
              traces: t.traces,
              phase: t.phase,
              usage: t.usage,
              createdAt: Date.now(),
            },
          ]);
          if (t.usage) s.addUsage(t.modelId, t.usage);
        }
        if (ev.result.skipped.length) {
          s.pushMessages([
            {
              id: crypto.randomUUID(),
              role: "notice",
              content: ev.result.skipped.map((x) => x.reason).join(" "),
              createdAt: Date.now(),
            },
          ]);
        }
      }
    };

    try {
      await consumeSwarmStream(input, { signal: ctrl.signal, onEvent });
    } catch (err) {
      if (ctrl.signal.aborted || useSwarm.getState().runId !== runId) return;
      try {
        const result = await sendSwarmTurn({ data: input });
        if (useSwarm.getState().runId !== runId) return;
        if (!result.ok) {
          toast(result.error);
          store.pushMessages([
            { id: crypto.randomUUID(), role: "notice", content: result.error, createdAt: Date.now() },
          ]);
        } else {
          onEvent({ type: "done", result });
        }
      } catch {
        const msg = err instanceof Error ? err.message : "Turn failed.";
        toast(msg);
      }
    } finally {
      abortRef.current = null;
      if (useSwarm.getState().runId === runId) {
        useSwarm.getState().setThinking([]);
        useSwarm.getState().clearStream();
      }
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit(draft);
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    if (window.matchMedia("(max-width: 767px)").matches) return;
    e.preventDefault();
    void submit(draft);
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      {!session.messages.length && !busy ? (
        <div className="mb-3 flex flex-col gap-2">
          {STARTERS.map((s) => (
            <button
              key={s}
              type="button"
              className="rounded-lg bg-surface px-4 py-3 text-left text-sm text-muted shadow-[var(--shadow-border)] transition-colors duration-150 hover:text-fg"
              onClick={() => setDraft(s)}
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}
      <div className="mb-2 flex gap-1 overflow-x-auto pb-1">
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              "h-11 shrink-0 rounded-full px-4 text-sm font-medium transition-colors duration-150",
              mode === m ? "bg-accent text-accent-fg" : "bg-surface text-muted hover:text-fg",
            )}
          >
            {MODE_META[m].label}
          </button>
        ))}
      </div>
      <p className="mb-2 text-xs text-subtle">{MODE_META[mode].hint}</p>
      {quote ? (
        <div className="mb-2 flex items-start gap-2 rounded-lg bg-raised px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium">Reply to {MODELS[quote.modelId].name}</p>
            <p className="truncate text-xs text-muted">{quote.content}</p>
            <label className="mt-1 flex items-center gap-2 text-xs text-muted">
              <Switch
                checked={quote.only}
                onCheckedChange={(v) =>
                  useSwarm.getState().setQuote({ ...quote, only: Boolean(v) })
                }
              />
              This seat only
            </label>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Clear quote"
            onClick={() => useSwarm.getState().setQuote(null)}
          >
            <X className="size-4" />
          </Button>
        </div>
      ) : null}
      <form
        onSubmit={onSubmit}
        className="rounded-xl bg-surface p-2 shadow-[var(--shadow-border)]"
      >
        <label className="sr-only" htmlFor="swarm-brief">
          Brief
        </label>
        <textarea
          id="swarm-brief"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder={`Brief the table. Host is ${MODELS[host].name}.`}
          rows={3}
          disabled={busy}
          suppressHydrationWarning
          className="w-full resize-none bg-transparent px-3 py-2 text-sm text-fg placeholder:text-subtle focus-visible:outline-none"
        />
        <div className="flex items-center justify-between gap-2 px-1 pb-1">
          <p className="text-xs text-subtle tabular-nums">
            {seats.filter((id: ModelId) => isConnected(id, keys, live)).length} live
          </p>
          {busy ? (
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="Stop"
              className="rounded-full"
              onClick={() => {
                abortRef.current?.abort();
                useSwarm.getState().abortRun();
              }}
            >
              <Square className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              disabled={!draft.trim()}
              aria-label="Send brief"
              className="rounded-full"
            >
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
