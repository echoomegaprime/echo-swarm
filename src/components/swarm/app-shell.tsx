import { useEffect } from "react";
import { Award, Cable, Download, Menu, Plug, Plus, X } from "lucide-react";
import { Toaster } from "sonner";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getProviderStatus, pingFleet } from "@/lib/swarm/actions";
import { useSwarm } from "@/lib/swarm/store";
import { ConnectDialog } from "./connect-dialog";
import { PluginDialog } from "./plugin-dialog";
import { SeatRail } from "./seat-rail";
import { Composer } from "./composer";
import { EmptyHero, Thread } from "./thread";
import { ArtifactsBar } from "./artifacts-bar";
import { DiffPanel } from "./diff-panel";
import { EDITION_LABEL } from "@/lib/swarm/edition";

export function SwarmApp() {
  const setLive = useSwarm((s) => s.setLive);
  const mobileNav = useSwarm((s) => s.mobileNav);
  const setMobileNav = useSwarm((s) => s.setMobileNav);
  const setConnectOpen = useSwarm((s) => s.setConnectOpen);
  const setPluginOpen = useSwarm((s) => s.setPluginOpen);
  const messages = useSwarm(
    (s) => (s.sessions.find((x) => x.id === s.activeId) ?? s.sessions[0]!).messages,
  );
  const title = useSwarm(
    (s) => (s.sessions.find((x) => x.id === s.activeId) ?? s.sessions[0]!).title,
  );

  useEffect(() => {
    void Promise.resolve(useSwarm.persist.rehydrate()).then(() => {
      useSwarm.getState().setHydrated(true);
    });
    async function ping() {
      const keys = useSwarm.getState().keys;
      try {
        const s = await pingFleet({
          data: {
            forgeUrl: keys.forgeUrl,
            forge: keys.forge,
            temperUrl: keys.temperUrl,
            temper: keys.temper,
          },
        });
        setLive({
          grok: s.grok,
          github: s.github,
          forge: s.forge,
          temper: s.temper,
          forgeMs: s.forgeMs,
          temperMs: s.temperMs,
          env: s.env ?? {},
        });
      } catch {
        const s = await getProviderStatus();
        setLive({
          grok: s.grok,
          github: s.github,
          forge: s.forge,
          temper: s.temper,
          env: s.env ?? {},
        });
      }
    }
    void ping();
    const t = window.setInterval(() => void ping(), 20000);
    return () => window.clearInterval(t);
  }, [setLive]);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-dvh bg-bg text-fg">
        <aside className="hidden w-[18.5rem] shrink-0 border-r border-border md:block">
          <SeatRail />
        </aside>
        {mobileNav ? (
          <div className="fixed inset-0 z-40 md:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-bg/70"
              aria-label="Close menu"
              onClick={() => setMobileNav(false)}
            />
            <aside className="relative z-50 h-full w-[min(100%,18.5rem)] bg-surface">
              <div className="flex justify-end p-2">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Close menu"
                  onClick={() => setMobileNav(false)}
                >
                  <X className="size-4" />
                </Button>
              </div>
              <SeatRail />
            </aside>
          </div>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 items-center justify-between gap-3 px-3 md:px-5">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon-sm"
                className="md:hidden"
                aria-label="Open seats"
                onClick={() => setMobileNav(true)}
              >
                <Menu className="size-4" />
              </Button>
              <span className="hidden font-serif text-lg tracking-tight md:inline">
                {title}
              </span>
              <span className="font-serif text-lg tracking-tight md:hidden">Swarm</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="hidden text-[0.68rem] font-medium tracking-[0.12em] text-subtle uppercase xl:inline">
                {EDITION_LABEL}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="md:size-9"
                aria-label="New session"
                onClick={() => useSwarm.getState().newSession()}
              >
                <Plus className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="md:size-9"
                aria-label="Export session"
                onClick={() => exportSession()}
              >
                <Download className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Plugin" onClick={() => setPluginOpen(true)}>
                <Cable className="size-4" />
              </Button>
              <Button variant="ghost" size="sm" className="hidden md:inline-flex" onClick={() => setPluginOpen(true)}>
                <Cable className="size-4" />
                Plugin
              </Button>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Certificate" asChild>
                <a href="/certificate"><Award className="size-4" /></a>
              </Button>
              <Button variant="ghost" size="sm" className="hidden md:inline-flex" asChild>
                <a href="/certificate"><Award className="size-4" />Certificate</a>
              </Button>
              <Button variant="outline" size="icon" className="md:hidden" aria-label="Connect" onClick={() => setConnectOpen(true)}>
                <Plug className="size-4" />
              </Button>
              <Button variant="outline" size="sm" className="hidden md:inline-flex" onClick={() => setConnectOpen(true)}>
                <Plug className="size-4" />
                Connect
              </Button>
            </div>
          </header>
          <main className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto">
              {messages.length === 0 ? <EmptyHero /> : null}
              <Thread />
            </div>
            <DiffPanel />
            <ArtifactsBar />
            <Composer />
          </main>
        </div>
      </div>
      <ConnectDialog />
      <PluginDialog />
      <Toaster
        theme="dark"
        position="bottom-center"
        toastOptions={{
          className: "bg-raised text-fg shadow-[var(--shadow-border)]",
        }}
      />
    </TooltipProvider>
  );
}

function exportSession() {
  const sess = useSwarm.getState().active();
  const lines = sess.messages.map((m) => {
    if (m.role === "user") return `## You\n\n${m.content}`;
    if (m.role === "notice") return `*${m.content}*`;
    const name = m.modelId ? `${m.modelId}${m.phase ? ` · ${m.phase}` : ""}` : "seat";
    return `## ${name}\n\n${m.content}`;
  });
  const blob = new Blob([`# ${sess.title}\n\n${lines.join("\n\n")}\n`], {
    type: "text/markdown",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sess.title.replace(/[^\w.-]+/g, "-").slice(0, 48) || "swarm"}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
