import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, AudioLines, Blend, Mic, MicOff, Square, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { MODE_META, MODELS, MODES, STARTERS, type ModelId } from "@/lib/swarm/catalog";
import { getFusionResult, sendSwarmTurn, startFusionRun } from "@/lib/swarm/actions";
import { consumeSwarmStream } from "@/lib/swarm/client-stream";
import {
  COLLABORATION_PURPOSES,
  PURPOSE_META,
  PURPOSE_MODES,
  purposePrompt,
  type CollaborationPurpose,
} from "@/lib/swarm/purpose";
import { isConnected, useSwarm } from "@/lib/swarm/store";
import type { SwarmEvent, SwarmTurnInput, SwarmTurnResult } from "@/lib/swarm/types";
import {
  speakText,
  startVoiceInput,
  stopSpeaking,
  voiceInputAvailable,
  voiceOutputAvailable,
} from "@/lib/swarm/voice";
import { cn } from "@/lib/utils";

const VISIBLE_PURPOSES: CollaborationPurpose[] = [
  "brainstorm",
  "review",
  "validate",
  "certify",
  "build",
  "debate",
  "plan",
  "report",
];

export function Composer() {
  const [draft, setDraft] = useState("");
  const [purpose, setPurpose] = useState<CollaborationPurpose>("brainstorm");
  const [fusionEnabled, setFusionEnabled] = useState(false);
  const [fusionBusy, setFusionBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceReadback, setVoiceReadback] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const stopVoiceRef = useRef<(() => void) | null>(null);
  const mode = useSwarm((s) => s.mode);
  const setMode = useSwarm((s) => s.setMode);
  const host = useSwarm((s) => s.host);
  const seats = useSwarm((s) => s.seats);
  const keys = useSwarm((s) => s.keys);
  const live = useSwarm((s) => s.live);
  const thinking = useSwarm((s) => s.thinking);
  const quote = useSwarm((s) => s.quote);
  const session = useSwarm((s) => s.sessions.find((x) => x.id === s.activeId) ?? s.sessions[0]!);
  const busy = thinking.length > 0 || fusionBusy;

  async function fuseResult(
    objective: string,
    result: Extract<SwarmTurnResult, { ok: true }>,
    runId: number,
    signal: AbortSignal,
  ) {
    const store = useSwarm.getState();
    setFusionBusy(true);
    store.pushMessages([
      {
        id: crypto.randomUUID(),
        role: "notice",
        content: "Echo Fusion Worker is fusing the visible council output.",
        createdAt: Date.now(),
      },
    ]);
    const context = {
      purpose,
      mode: store.mode,
      selected_models: result.turns.map((turn) => turn.modelId),
      council_outputs: result.turns.slice(0, 8).map((turn) => ({
        model: turn.modelId,
        phase: turn.phase,
        content: turn.content.slice(0, 1_000),
        error: turn.error?.slice(0, 400),
      })),
    };
    const started = await startFusionRun({
      data: {
        objective,
        context,
        budget: { max_calls: 120, max_cost_usd: 5, max_wall_s: 4800 },
        idempotency_key: `chat:${runId}`,
      },
    });
    if (!started.ok || !started.run_id) {
      throw new Error(started.error || "Echo Fusion Worker did not return a run ID.");
    }
    let polled = started;
    const deadline = Date.now() + 4_860_000;
    while (!polled.done && Date.now() < deadline) {
      if (signal.aborted) return;
      await new Promise<void>((resolve) => window.setTimeout(resolve, 1_250));
      if (signal.aborted) return;
      polled = await getFusionResult({ data: { run_id: started.run_id } });
      if (!polled.ok) throw new Error(polled.error || "Echo Fusion Worker polling failed.");
    }
    if (!polled.done) throw new Error("Echo Fusion Worker exceeded the 81-minute full-40 limit.");
    store.pushMessages([
      {
        id: crypto.randomUUID(),
        role: "assistant",
        source: "fusion",
        runId: started.run_id,
        content: polled.text,
        phase: "fusion",
        createdAt: Date.now(),
      },
    ]);
    if (voiceReadback) speakText(polled.text);
  }

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
    const task = quoted
      ? `Reply to ${MODELS[quoted.modelId].name} who said:\n"""${quoted.content.slice(0, 600)}"""\n\n${raw}`
      : raw;
    const prompt = purposePrompt(purpose, task);
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
      .filter((message) => message.role === "user" || message.role === "assistant")
      .slice(-16)
      .map((message) => ({
        role: message.role as "user" | "assistant",
        content: message.content,
        modelId: message.modelId,
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
    let completedResult: SwarmTurnResult | undefined;
    abortRef.current = ctrl;

    const onEvent = (event: SwarmEvent) => {
      const state = useSwarm.getState();
      if (state.runId !== runId) return;
      if (event.type === "phase") state.setThinking(event.seats);
      if (event.type === "notice") {
        state.pushMessages([
          {
            id: crypto.randomUUID(),
            role: "notice",
            content: event.content,
            createdAt: Date.now(),
          },
        ]);
      }
      if (event.type === "delta") {
        state.upsertStream({
          messageId: event.messageId,
          modelId: event.modelId,
          phase: event.phase,
          content: event.text,
        });
      }
      if (event.type === "turn") {
        const id = event.turn.messageId ?? crypto.randomUUID();
        if (committed.has(id)) return;
        committed.add(id);
        state.dropStream(id);
        state.pushMessages([
          {
            id,
            role: "assistant",
            source: "council",
            modelId: event.turn.modelId,
            model: event.turn.model,
            content: event.turn.error ? event.turn.error : event.turn.content,
            traces: event.turn.traces,
            phase: event.turn.phase,
            usage: event.turn.usage,
            createdAt: Date.now(),
          },
        ]);
        if (event.turn.usage) state.addUsage(event.turn.modelId, event.turn.usage);
      }
      if (event.type === "usage") {
        state.addUsage(event.modelId, { prompt: event.prompt, completion: event.completion });
      }
      if (event.type === "insights") state.setInsights(event.insights);
      if (event.type === "done") {
        completedResult = event.result;
        state.clearStream();
        if (!event.result.ok) {
          toast(event.result.error);
          state.pushMessages([
            {
              id: crypto.randomUUID(),
              role: "notice",
              content: event.result.error,
              createdAt: Date.now(),
            },
          ]);
          return;
        }
        state.setInsights(event.result.insights);
        for (const turn of event.result.turns) {
          const id =
            turn.messageId ?? `${turn.modelId}-${turn.phase ?? "x"}-${turn.content.slice(0, 24)}`;
          if (committed.has(id) || committed.has(turn.messageId ?? "")) continue;
          if (turn.messageId) committed.add(turn.messageId);
          committed.add(id);
          state.pushMessages([
            {
              id: crypto.randomUUID(),
              role: "assistant",
              source: "council",
              modelId: turn.modelId,
              model: turn.model,
              content: turn.error ? turn.error : turn.content,
              traces: turn.traces,
              phase: turn.phase,
              usage: turn.usage,
              createdAt: Date.now(),
            },
          ]);
          if (turn.usage) state.addUsage(turn.modelId, turn.usage);
        }
        if (event.result.skipped.length) {
          state.pushMessages([
            {
              id: crypto.randomUUID(),
              role: "notice",
              content: event.result.skipped.map((item) => item.reason).join(" "),
              createdAt: Date.now(),
            },
          ]);
        }
      }
    };

    try {
      await consumeSwarmStream(input, { signal: ctrl.signal, onEvent });
      if (fusionEnabled && completedResult?.ok && !ctrl.signal.aborted) {
        await fuseResult(raw, completedResult, runId, ctrl.signal);
      }
    } catch (error) {
      if (ctrl.signal.aborted || useSwarm.getState().runId !== runId) return;
      if (!completedResult) {
        try {
          const result = await sendSwarmTurn({ data: input });
          if (useSwarm.getState().runId !== runId) return;
          onEvent({ type: "done", result });
          if (fusionEnabled && result.ok && !ctrl.signal.aborted) {
            await fuseResult(raw, result, runId, ctrl.signal);
          }
        } catch (fallbackError) {
          toast(fallbackError instanceof Error ? fallbackError.message : "Turn failed.");
        }
      } else {
        const message = error instanceof Error ? error.message : "Fusion failed.";
        toast(message);
        store.pushMessages([
          { id: crypto.randomUUID(), role: "notice", content: message, createdAt: Date.now() },
        ]);
      }
    } finally {
      abortRef.current = null;
      setFusionBusy(false);
      if (useSwarm.getState().runId === runId) {
        useSwarm.getState().setThinking([]);
        useSwarm.getState().clearStream();
      }
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submit(draft);
  }

  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    if (window.matchMedia("(max-width: 767px)").matches) return;
    event.preventDefault();
    void submit(draft);
  }

  function toggleVoiceInput() {
    if (listening) {
      stopVoiceRef.current?.();
      stopVoiceRef.current = null;
      return;
    }
    if (!voiceInputAvailable()) {
      toast("Voice input is not available in this browser.");
      return;
    }
    stopVoiceRef.current =
      startVoiceInput({
        onText: (text) => setDraft((current) => `${current}${current ? " " : ""}${text}`),
        onState: setListening,
        onError: (message) => toast(`Voice input: ${message}`),
      }) ?? null;
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      {!session.messages.length && !busy ? (
        <div className="mb-3 flex flex-col gap-2">
          {STARTERS.map((starter) => (
            <button
              key={starter}
              type="button"
              className="rounded-lg bg-surface px-4 py-3 text-left text-sm text-muted shadow-[var(--shadow-border)] transition-colors duration-150 hover:text-fg"
              onClick={() => setDraft(starter)}
            >
              {starter}
            </button>
          ))}
        </div>
      ) : null}
      <div className="mb-2 flex gap-1 overflow-x-auto pb-1" aria-label="Swarm purpose">
        {VISIBLE_PURPOSES.filter((item) => COLLABORATION_PURPOSES.includes(item)).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => {
              setPurpose(item);
              setMode(PURPOSE_MODES[item]);
            }}
            className={cn(
              "h-9 shrink-0 rounded-full px-3 text-xs font-medium transition-colors duration-150",
              purpose === item ? "bg-fg text-bg" : "bg-raised text-muted hover:text-fg",
            )}
          >
            {PURPOSE_META[item].label}
          </button>
        ))}
      </div>
      <div className="mb-2 flex gap-1 overflow-x-auto pb-1" aria-label="Swarm mode">
        {MODES.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setMode(item)}
            className={cn(
              "h-9 shrink-0 rounded-full px-3 text-xs font-medium transition-colors duration-150",
              mode === item ? "bg-accent text-accent-fg" : "bg-surface text-muted hover:text-fg",
            )}
          >
            {MODE_META[item].label}
          </button>
        ))}
      </div>
      <p className="mb-2 text-xs text-subtle">
        {PURPOSE_META[purpose].instruction} {MODE_META[mode].hint}
      </p>
      <div className="mb-2 flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={fusionEnabled}
          onClick={() => setFusionEnabled((enabled) => !enabled)}
          className={cn(
            "flex h-9 items-center gap-2 rounded-full px-3 text-xs font-medium",
            fusionEnabled ? "bg-accent text-accent-fg" : "bg-surface text-muted",
          )}
        >
          <Blend className="size-3.5" />
          Fusion {fusionEnabled ? "on" : "off"}
        </button>
        <button
          type="button"
          aria-pressed={voiceReadback}
          onClick={() => {
            if (!voiceOutputAvailable()) {
              toast("Voice readback is not available in this browser.");
              return;
            }
            setVoiceReadback((enabled) => {
              if (enabled) stopSpeaking();
              return !enabled;
            });
          }}
          className={cn(
            "flex h-9 items-center gap-2 rounded-full px-3 text-xs font-medium",
            voiceReadback ? "bg-accent text-accent-fg" : "bg-surface text-muted",
          )}
        >
          <AudioLines className="size-3.5" />
          Read fused output {voiceReadback ? "on" : "off"}
        </button>
      </div>
      {quote ? (
        <div className="mb-2 flex items-start gap-2 rounded-lg bg-raised px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium">Reply to {MODELS[quote.modelId].name}</p>
            <p className="truncate text-xs text-muted">{quote.content}</p>
            <label className="mt-1 flex items-center gap-2 text-xs text-muted">
              <Switch
                checked={quote.only}
                onCheckedChange={(value) =>
                  useSwarm.getState().setQuote({ ...quote, only: Boolean(value) })
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
      <form onSubmit={onSubmit} className="rounded-xl bg-surface p-2 shadow-[var(--shadow-border)]">
        <label className="sr-only" htmlFor="swarm-brief">
          Brief
        </label>
        <textarea
          id="swarm-brief"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
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
            {fusionBusy ? " · Fusion running" : ""}
          </p>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="icon"
              variant={listening ? "default" : "ghost"}
              aria-label={listening ? "Stop voice input" : "Start voice input"}
              className="rounded-full"
              onClick={toggleVoiceInput}
            >
              {listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
            </Button>
            {busy ? (
              <Button
                type="button"
                size="icon"
                variant="outline"
                aria-label="Stop"
                className="rounded-full"
                onClick={() => {
                  abortRef.current?.abort();
                  stopVoiceRef.current?.();
                  stopVoiceRef.current = null;
                  stopSpeaking();
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
        </div>
      </form>
    </div>
  );
}
