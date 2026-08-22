import { useEffect, useRef, useState } from "react";
import { Check, Copy, Reply } from "lucide-react";
import { MODELS, variantLabel } from "@/lib/swarm/catalog";
import type { SwarmMessage } from "@/lib/swarm/types";
import { useSwarm } from "@/lib/swarm/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function Thread() {
  const session = useSwarm((s) => s.sessions.find((x) => x.id === s.activeId) ?? s.sessions[0]!);
  const thinking = useSwarm((s) => s.thinking);
  const streaming = useSwarm((s) => s.streaming);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [session.messages.length, thinking.length, streaming.map((s) => s.content.length).join()]);

  if (!session.messages.length && !thinking.length && !streaming.length) {
    return null;
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4">
      {session.messages.map((m, i) => {
        const prev = session.messages[i - 1];
        const phaseBreak = m.phase && m.phase !== prev?.phase;
        return (
          <div key={m.id} className="flex flex-col gap-2">
            {phaseBreak ? (
              <p className="pt-2 text-center text-[10px] font-medium tracking-[0.18em] text-subtle uppercase">
                {m.phase}
              </p>
            ) : null}
            <MessageCard message={m} />
          </div>
        );
      })}
      {streaming.map((s) => (
        <article
          key={s.messageId}
          className="w-[min(100%,40rem)] rounded-xl rounded-bl-sm bg-surface px-4 py-3 shadow-[var(--shadow-border)]"
        >
          <p className="mb-1 text-xs text-subtle">
            {MODELS[s.modelId].name}
            {s.phase ? ` · ${s.phase}` : ""}
          </p>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {s.content || ""}
            <span className="shimmer-text">▍</span>
          </p>
        </article>
      ))}
      {thinking.length && !streaming.length ? (
        <div className="flex flex-wrap gap-2">
          {thinking.map((id) => (
            <div
              key={id}
              className="rounded-lg bg-surface px-3 py-2 shadow-[var(--shadow-border)]"
            >
              <p className="text-xs text-subtle">{MODELS[id].name}</p>
              <p className="shimmer-text font-serif text-sm">Speaking</p>
            </div>
          ))}
        </div>
      ) : null}
      <div ref={bottom} />
    </div>
  );
}

function MessageCard({ message }: { message: SwarmMessage }) {
  if (message.role === "user") {
    return (
      <article className="ml-auto w-[min(100%,36rem)] rounded-xl rounded-br-sm bg-raised px-4 py-3 shadow-[var(--shadow-border)]">
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
      </article>
    );
  }
  if (message.role === "notice") {
    return (
      <p className="text-center text-xs text-subtle">{message.content}</p>
    );
  }
  const def = message.modelId ? MODELS[message.modelId] : null;
  return (
    <article className="w-[min(100%,40rem)] rounded-xl rounded-bl-sm bg-surface px-4 py-3 shadow-[var(--shadow-border)]">
      <header className="mb-2 flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-full bg-raised font-serif text-sm">
          {def?.monogram ?? "?"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-medium">
            {def?.name ?? "Seat"}
            {message.phase ? (
              <span className="text-[10px] font-medium tracking-[0.14em] text-subtle uppercase">
                {message.phase}
              </span>
            ) : null}
          </p>
          <p className="text-xs text-subtle">
            {message.modelId
              ? variantLabel(message.modelId, message.model)
              : def?.lab}
            {message.usage
              ? ` · ${message.usage.prompt + message.usage.completion} tok`
              : ""}
          </p>
        </div>
        {message.modelId ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Reply to this seat"
            onClick={() => {
              useSwarm.getState().setQuote({
                messageId: message.id,
                modelId: message.modelId!,
                content: message.content.slice(0, 400),
                only: false,
              });
              document.getElementById("swarm-brief")?.focus();
            }}
          >
            <Reply className="size-3.5" />
          </Button>
        ) : null}
        <CopyBtn text={message.content} label="Copy reply" />
      </header>
      <MessageBody text={message.content} />
      {message.traces?.length ? (
        <ul className="mt-3 flex flex-col gap-1.5">
          {message.traces.map((t, i) => (
            <li key={`${t.name}-${i}`}>
              <Badge variant="outline" className="font-mono">
                {pluginLabel(t.name, t.args)}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function pluginLabel(name: string, argsJson: string): string {
  try {
    const args = JSON.parse(argsJson) as { model?: string };
    if (name === "call_peer" && args.model) return `${name} → ${args.model}`;
  } catch {
    /* ignore */
  }
  return name;
}

const IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

type Chunk =
  | { type: "text"; value: string }
  | { type: "image"; value: string; alt?: string }
  | { type: "code"; lang: string; path?: string; value: string };

function parseBody(text: string): Chunk[] {
  const chunks: Chunk[] = [];
  const fence = /```([^\n`]*)\n([\s\S]*?)```/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text))) {
    if (match.index > last) chunks.push(...splitImages(text.slice(last, match.index)));
    const meta = match[1]!.trim();
    const body = match[2]!.replace(/\n$/, "");
    const path = meta.includes("/") || meta.includes(".") ? meta.split(/\s+/).pop() : undefined;
    const lang = meta.split(/\s+/)[0] ?? "";
    chunks.push({ type: "code", lang, path, value: body });
    last = match.index + match[0].length;
  }
  if (last < text.length) chunks.push(...splitImages(text.slice(last)));
  return chunks.length ? chunks : [{ type: "text", value: text }];
}

function splitImages(text: string): Chunk[] {
  const parts: Chunk[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(IMAGE_RE);
  while ((match = re.exec(text))) {
    if (match.index > last) parts.push({ type: "text", value: text.slice(last, match.index) });
    parts.push({ type: "image", value: match[2]!, alt: match[1] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  return parts;
}

function MessageBody({ text }: { text: string }) {
  const chunks = parseBody(text);
  return (
    <div className="flex flex-col gap-2">
      {chunks.map((p, i) => {
        if (p.type === "image") {
          return (
            <img
              key={i}
              src={p.value}
              alt={p.alt || "Generated still"}
              className="max-h-80 w-full rounded-md object-contain"
            />
          );
        }
        if (p.type === "code") {
          return (
            <figure key={i} className="overflow-hidden rounded-md bg-raised">
              <figcaption className="flex items-center justify-between gap-2 px-3 py-1.5">
                <span className="min-w-0 truncate font-mono text-[11px] text-subtle">
                  {p.path || p.lang || "code"}
                </span>
                <CopyBtn text={p.value} label="Copy code" />
              </figcaption>
              <pre className="overflow-x-auto px-3 pb-3 font-mono text-xs leading-relaxed text-fg">
                {p.value}
              </pre>
            </figure>
          );
        }
        return p.value.trim() ? (
          <p key={i} className="text-sm leading-relaxed whitespace-pre-wrap">
            {p.value}
          </p>
        ) : null;
      })}
    </div>
  );
}

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [ok, setOk] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      className="shrink-0"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          window.setTimeout(() => setOk(false), 1200);
        } catch {
          /* ignore */
        }
      }}
    >
      {ok ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </Button>
  );
}

export function EmptyHero() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 pt-6 pb-2 text-center md:pt-10">
      <p className="mb-3 text-xs font-medium tracking-[0.18em] text-subtle uppercase">
        Multi-LLM council
      </p>
      <h1 className="font-serif text-5xl leading-none tracking-tight text-fg md:text-6xl">
        Swarm
      </h1>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted">
        Cloud OAuth, GitHub CLI, speed labs, OpenRouter, FORGE, TEMPER. Paid
        subs first. Build Heavy runs the Grok-Build pipeline on the whole table.
      </p>
    </div>
  );
}
