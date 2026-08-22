import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PLUGINS } from "@/lib/swarm/catalog";
import { useSwarm } from "@/lib/swarm/store";

type CopyKind = "spec" | "openapi" | "mcp" | "claude" | "chatgpt" | "codex" | "curl";

export function PluginDialog() {
  const open = useSwarm((s) => s.pluginOpen);
  const setOpen = useSwarm((s) => s.setPluginOpen);
  const [copied, setCopied] = useState<CopyKind | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const specUrl = origin ? `${origin}/api/plugin.json` : "/api/plugin.json";
  const runUrl = origin ? `${origin}/api/plugin/swarm` : "/api/plugin/swarm";
  const streamUrl = origin ? `${origin}/api/plugin/stream` : "/api/plugin/stream";
  const mcpUrl = origin ? `${origin}/api/plugin/mcp` : "/api/plugin/mcp";
  const openapiUrl = origin ? `${origin}/api/plugin/openapi.json` : "/api/plugin/openapi.json";
  const curl = `curl -s ${runUrl} -H 'content-type: application/json' -d '{"prompt":"Argue both sides of local-first agents.","mode":"parallel","host":"grok","seats":["grok"]}'`;
  const claude = JSON.stringify(
    { mcpServers: { swarm: { url: mcpUrl } } },
    null,
    2,
  );
  const chatgpt = `Custom GPT Actions → Import from URL:\n${openapiUrl}\n\nThen call swarmBrief with prompt + mode.`;
  const codex = JSON.stringify(
    {
      mcpServers: {
        swarm: {
          url: mcpUrl,
          headers: { "content-type": "application/json" },
        },
      },
    },
    null,
    2,
  );

  async function copy(kind: CopyKind, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[min(88dvh,42rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl font-normal tracking-tight">
            Host plugin
          </DialogTitle>
          <DialogDescription className="text-sm text-muted">
            Wire ChatGPT Actions, Claude Desktop, Codex MCP, or any host that
            POSTs JSON. Same council. Same OAuth seats.
          </DialogDescription>
        </DialogHeader>
        <ul className="mb-4 flex flex-col gap-2">
          {PLUGINS.map((p) => (
            <li
              key={p.name}
              className="rounded-md bg-raised px-3 py-2 shadow-[var(--shadow-border)]"
            >
              <p className="font-mono text-xs text-accent">{p.name}</p>
              <p className="text-sm text-muted">{p.description}</p>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-3">
          <Row label="OpenAPI" value={openapiUrl} kind="openapi" copied={copied} onCopy={copy} />
          <Row label="Manifest" value={specUrl} kind="spec" copied={copied} onCopy={copy} />
          <Row label="MCP" value={mcpUrl} kind="mcp" copied={copied} onCopy={copy} />
          <Row label="Stream" value={streamUrl} kind="curl" copied={copied} onCopy={copy} />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => copy("chatgpt", chatgpt)}>
              {copied === "chatgpt" ? "Copied" : "ChatGPT Actions"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => copy("claude", claude)}>
              {copied === "claude" ? "Copied" : "Claude MCP"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => copy("codex", codex)}>
              {copied === "codex" ? "Copied" : "Codex MCP"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => copy("curl", curl)}>
              {copied === "curl" ? "Copied" : "Sample curl"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  value,
  kind,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  kind: CopyKind;
  copied: CopyKind | null;
  onCopy: (kind: CopyKind, text: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <p className="w-16 shrink-0 text-[10px] font-medium tracking-wide text-subtle uppercase">
        {label}
      </p>
      <Badge variant="outline" className="min-w-0 flex-1 truncate font-mono">
        {value}
      </Badge>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Copy ${label}`}
        onClick={() => onCopy(kind, value)}
      >
        {copied === kind ? <Check className="size-4" /> : <Copy className="size-4" />}
      </Button>
    </div>
  );
}
