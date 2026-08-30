import { ExternalLink, Unplug } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  FORGE_DEFAULT_MODEL,
  FORGE_DEFAULT_URL,
  GROUP_META,
  KEY_DOCS,
  MODELS,
  TEMPER_DEFAULT_MODEL,
  idsIn,
  type AuthMode,
  type AuthModes,
  type KeyField,
  type ModelId,
  type OAuthField,
  type ProviderKeys,
  type SeatGroup,
} from "@/lib/swarm/catalog";
import { pollGhDevice, pullCliTokens, startGhDevice } from "@/lib/swarm/actions";
import { isConnected, maskKey, useSwarm, type FleetLive } from "@/lib/swarm/store";
import { ModelPick } from "./model-pick";
import {
  EDITION_LABEL,
  PRIVATE_OAUTH_EDITION,
  PUBLIC_API_EDITION,
} from "@/lib/swarm/edition";

export function ConnectDialog() {
  const open = useSwarm((s) => s.connectOpen);
  const setOpen = useSwarm((s) => s.setConnectOpen);
  const keys = useSwarm((s) => s.keys);
  const live = useSwarm((s) => s.live);
  const auth = useSwarm((s) => s.auth);
  const setKey = useSwarm((s) => s.setKey);
  const clearKey = useSwarm((s) => s.clearKey);
  const setAuth = useSwarm((s) => s.setAuth);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[min(88dvh,44rem)] w-[min(100%-1.5rem,36rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl font-normal tracking-tight">
            Connect labs
          </DialogTitle>
          <DialogDescription className="text-sm text-muted">
            {PRIVATE_OAUTH_EDITION
              ? "Private OAuth edition. Pull approved signed-in CLI sessions; caller API-key entry is disabled. FORGE and TEMPER remain private local metal."
              : "Public API-key edition. Bring your own provider keys; this build cannot read CLI sessions or private server credentials."}
          </DialogDescription>
        </DialogHeader>
        <Badge variant="outline">{EDITION_LABEL}</Badge>
        {PRIVATE_OAUTH_EDITION ? <CliBar /> : null}
        {GROUP_META.map((g) => (
          <GroupSection
            key={g.id}
            group={g.id}
            label={g.label}
            keys={keys}
            live={live}
            auth={auth}
            onSet={setKey}
            onClear={clearKey}
            onAuth={setAuth}
          />
        ))}
      </DialogContent>
    </Dialog>
  );
}

function GroupSection({
  group,
  label,
  keys,
  live,
  auth,
  onSet,
  onClear,
  onAuth,
}: {
  group: SeatGroup;
  label: string;
  keys: ProviderKeys;
  live: FleetLive;
  auth: AuthModes;
  onSet: (field: keyof ProviderKeys, value: string) => void;
  onClear: (field: keyof ProviderKeys) => void;
  onAuth: (field: OAuthField, mode: AuthMode) => void;
}) {
  const ids = idsIn(group).filter(
    (id) => group === "fleet" || PUBLIC_API_EDITION || MODELS[id].oauth,
  );
  if (!ids.length) return null;
  return (
    <Section title={label}>
      {ids.map((id) =>
        group === "fleet" ? (
          <FleetConnect
            key={id}
            id={id}
            keys={keys}
            live={live}
            onSet={onSet}
            onClear={onClear}
          />
        ) : (
          <SeatConnect
            key={id}
            id={id}
            keys={keys}
            live={live}
            authMode={
              MODELS[id].oauth
                ? (auth[MODELS[id].keyField as OAuthField] ?? "oauth")
                : undefined
            }
            onSet={onSet}
            onClear={onClear}
            onAuth={MODELS[id].oauth ? onAuth : undefined}
          />
        ),
      )}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-4">
      <p className="mb-2 text-xs font-medium tracking-[0.16em] text-subtle uppercase">
        {title}
      </p>
      <ul className="flex flex-col gap-3">{children}</ul>
    </div>
  );
}

function SeatConnect({
  id,
  keys,
  live,
  authMode,
  onSet,
  onClear,
  onAuth,
}: {
  id: ModelId;
  keys: ProviderKeys;
  live: FleetLive;
  authMode?: AuthMode;
  onSet: (field: keyof ProviderKeys, value: string) => void;
  onClear: (field: keyof ProviderKeys) => void;
  onAuth?: (field: OAuthField, mode: AuthMode) => void;
}) {
  const def = MODELS[id];
  const docs = KEY_DOCS[def.keyField];
  const field = def.keyField as keyof ProviderKeys;
  const connected = isConnected(id, keys, live);
  const stored = keys[field];
  const envHint =
    (id === "grok" && live.grok && !stored) ||
    (id === "github" && live.github && !stored);

  useEffect(() => {
    if (PUBLIC_API_EDITION && def.oauth && onAuth && authMode !== "key") {
      onAuth(def.keyField as OAuthField, "key");
    }
  }, [authMode, def.keyField, def.oauth, onAuth]);

  return (
    <li className="rounded-lg bg-raised p-3 shadow-[var(--shadow-border)]">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-full bg-surface font-serif text-sm">
            {def.monogram}
          </span>
          <div>
            <p className="text-sm font-medium">{def.name}</p>
            <p className="text-xs text-subtle">{def.lab}</p>
          </div>
        </div>
        <Badge variant={connected ? "ok" : "outline"}>{connected ? "Live" : "Dark"}</Badge>
      </div>
      {PUBLIC_API_EDITION && def.oauth ? (
        <Badge variant="outline">API key only</Badge>
      ) : null}
      <p className="mb-2 text-xs text-muted">
        {PRIVATE_OAUTH_EDITION
          ? `${def.oauthLabel ?? "OAuth"} is the only accepted remote credential mode in this private build.`
          : docs.hint}
      </p>
      <div className="mb-2">
        <ModelPick id={id} />
      </div>
      {envHint ? (
        <p className="mb-2 text-xs text-muted">
          {id === "grok" ? "Using the app xAI connection." : "Using the app GitHub token."}
        </p>
      ) : null}
      {PUBLIC_API_EDITION ? (
        <TokenRow
          label={`${def.name} API key`}
          placeholder={stored ? maskKey(stored) : docs.placeholder}
          href={docs.href}
          linkLabel={docs.label}
          stored={Boolean(stored)}
          onSet={(v) => onSet(field, v)}
          onClear={() => onClear(field)}
        />
      ) : (
        <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted">
          {stored ? "OAuth/session credential loaded for this browser session." : "Use Pull CLIs above to load an approved OAuth/session credential."}
        </div>
      )}
    </li>
  );
}

function FleetConnect({
  id,
  keys,
  live,
  onSet,
  onClear,
}: {
  id: ModelId;
  keys: ProviderKeys;
  live: FleetLive;
  onSet: (field: keyof ProviderKeys, value: string) => void;
  onClear: (field: keyof ProviderKeys) => void;
}) {
  const def = MODELS[id];
  const docs = KEY_DOCS[def.keyField as KeyField];
  const connected = isConnected(id, keys, live);
  const urlField = def.urlField!;
  const modelField = def.modelField!;
  const keyField = def.keyField as keyof ProviderKeys;
  const url = keys[urlField];
  const model = keys[modelField];
  const token = keys[keyField];
  const defaultUrl = def.defaultUrl ?? "";
  const defaultModel = id === "qwen" ? FORGE_DEFAULT_MODEL : TEMPER_DEFAULT_MODEL;

  return (
    <li className="rounded-lg bg-raised p-3 shadow-[var(--shadow-border)]">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-full bg-surface font-serif text-sm">
            {def.monogram}
          </span>
          <div>
            <p className="text-sm font-medium">{def.name}</p>
            <p className="text-xs text-subtle">
              {def.node} · {model || defaultModel}
            </p>
          </div>
        </div>
        <Badge variant={connected ? "ok" : "outline"}>{connected ? "Live" : "Dark"}</Badge>
      </div>
      <p className="mb-2 text-xs text-muted">{docs.hint}</p>
      <div className="flex flex-col gap-2">
        <ModelPick id={id} />
        <Input
          type="url"
          autoComplete="off"
          spellCheck={false}
          placeholder={defaultUrl || "https://temper.example/v1"}
          value={url ?? ""}
          className="h-10"
          onChange={(e) => onSet(urlField, e.target.value)}
          aria-label={`${def.name} base URL`}
        />
        <Input
          autoComplete="off"
          spellCheck={false}
          placeholder={`model · ${defaultModel}`}
          value={model ?? ""}
          className="h-10"
          onChange={(e) => onSet(modelField, e.target.value)}
          aria-label={`${def.name} model id`}
        />
        <TokenRow
          label={`${def.name} token`}
          placeholder={token ? maskKey(token) : "local (optional)"}
          href={docs.href}
          linkLabel={def.node ?? "Node"}
          stored={Boolean(token)}
          onSet={(v) => onSet(keyField, v)}
          onClear={() => onClear(keyField)}
        />
        {!url && defaultUrl ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => {
              onSet(urlField, defaultUrl);
              onSet(modelField, defaultModel);
              if (!token) onSet(keyField, "local");
            }}
          >
            Use {def.node} default
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function TokenRow({
  label,
  placeholder,
  href,
  linkLabel,
  stored,
  onSet,
  onClear,
}: {
  label: string;
  placeholder: string;
  href: string;
  linkLabel: string;
  stored: boolean;
  onSet: (v: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Input
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        className="h-10"
        onChange={(e) => {
          const v = e.target.value.trim();
          if (v) onSet(v);
        }}
        aria-label={label}
      />
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1 sm:flex-none" asChild>
          <a href={href} target="_blank" rel="noreferrer">
            {linkLabel}
            <ExternalLink className="size-3.5" />
          </a>
        </Button>
        {stored ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Disconnect ${label}`}
            onClick={onClear}
          >
            <Unplug className="size-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function CliBar() {
  const [busy, setBusy] = useState(false);
  const [device, setDevice] = useState<{ user_code: string; verification_uri: string; device_code: string } | null>(
    null,
  );

  async function pull() {
    setBusy(true);
    try {
      const got = await pullCliTokens();
      const store = useSwarm.getState();
      if (got.github) store.setKey("github", got.github);
      if (got.openai) store.setKey("openai", got.openai);
      if (got.anthropic) store.setKey("anthropic", got.anthropic);
      if (got.grok) store.setKey("grok", got.grok);
      toast(got.sources.length ? `Pulled ${got.sources.join(", ")}` : "No CLI tokens on this machine.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "CLI pull failed.");
    } finally {
      setBusy(false);
    }
  }

  async function startDevice() {
    setBusy(true);
    try {
      const start = await startGhDevice();
      if (!start.ok) {
        toast(start.error);
        return;
      }
      setDevice(start.data);
      toast(`GitHub code ${start.data.user_code}`);
      void poll(start.data.device_code);
    } catch (err) {
      toast(err instanceof Error ? err.message : "GitHub device failed.");
    } finally {
      setBusy(false);
    }
  }

  async function poll(code: string) {
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => window.setTimeout(r, 5000));
      const result = await pollGhDevice({ data: { device_code: code } });
      if (result.ok) {
        useSwarm.getState().setKey("github", result.token);
        setDevice(null);
        toast("GitHub OAuth live.");
        return;
      }
      if (!result.pending) {
        toast(result.error);
        return;
      }
    }
    toast("GitHub device timed out.");
  }

  return (
    <div className="mb-4 rounded-lg bg-raised p-3 shadow-[var(--shadow-border)]">
      <p className="mb-2 text-xs font-medium tracking-wide text-subtle uppercase">OAuth capture</p>
      <p className="mb-2 text-xs text-muted">
        Pulls `gh auth token`, Claude Code, Codex, and an xAI OAuth token. GitHub
        device uses the public gh CLI client if no GITHUB_CLIENT_ID is set.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void pull()}>
          Pull CLIs
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void startDevice()}>
          GitHub device
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void navigator.clipboard.writeText("gh auth token")}
        >
          Copy gh
        </Button>
      </div>
      {device ? (
        <p className="mt-2 text-sm text-muted">
          Open{" "}
          <a className="text-accent underline" href={device.verification_uri} target="_blank" rel="noreferrer">
            {device.verification_uri}
          </a>{" "}
          and enter <span className="font-mono text-fg">{device.user_code}</span>
        </p>
      ) : null}
    </div>
  );
}
