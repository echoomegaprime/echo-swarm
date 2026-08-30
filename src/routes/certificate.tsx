import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  Download,
  ExternalLink,
  FileJson,
  Fingerprint,
  KeyRound,
  Printer,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createCommanderSignature } from "@/lib/certificate/commander-key";
import type { ReleaseCertificateSnapshot } from "@/lib/certificate/types";
import {
  pollCommanderGithubOAuth,
  startCommanderGithubOAuth,
} from "@/lib/swarm/actions";
import { PRIVATE_OAUTH_EDITION } from "@/lib/swarm/edition";

export const Route = createFileRoute("/certificate")({ component: CertificatePage });

interface DeviceState {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
}

function CertificatePage() {
  const [certificate, setCertificate] = useState<ReleaseCertificateSnapshot>();
  const [error, setError] = useState("");
  const [device, setDevice] = useState<DeviceState>();
  const [oauthToken, setOauthToken] = useState("");
  const [githubLogin, setGithubLogin] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setError("");
    const response = await fetch("/api/certificate", { cache: "no-store" });
    if (!response.ok) throw new Error(`certificate_http_${response.status}`);
    setCertificate((await response.json()) as ReleaseCertificateSnapshot);
  }

  useEffect(() => {
    void refresh().catch((reason) => setError(reason instanceof Error ? reason.message : "Certificate unavailable"));
  }, []);

  async function beginCommanderOAuth() {
    setBusy(true);
    setError("");
    try {
      const result = await startCommanderGithubOAuth();
      if (!result.ok) throw new Error(result.error);
      setDevice(result.data);
      window.open(result.data.verification_uri, "_blank", "noopener,noreferrer");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "GitHub OAuth could not start");
    } finally {
      setBusy(false);
    }
  }

  async function finishCommanderOAuth() {
    if (!device) return;
    setBusy(true);
    setError("");
    try {
      const result = await pollCommanderGithubOAuth({ data: { device_code: device.device_code } });
      if (!result.ok) throw new Error(result.pending ? "Authorization is still pending." : result.error);
      const identityResponse = await fetch("https://api.github.com/user", {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${result.token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      if (!identityResponse.ok) throw new Error("GitHub OAuth identity could not be verified.");
      const identity = (await identityResponse.json()) as { login?: string };
      if (!identity.login) throw new Error("GitHub OAuth identity has no login.");
      setOauthToken(result.token);
      setGithubLogin(identity.login);
      setDevice(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "GitHub OAuth failed");
    } finally {
      setBusy(false);
    }
  }

  async function signCertificate() {
    if (!certificate || !oauthToken || !githubLogin || !confirmed) return;
    setBusy(true);
    setError("");
    try {
      const submission = await createCommanderSignature(certificate, githubLogin);
      const response = await fetch("/api/certificate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${oauthToken}`,
        },
        body: JSON.stringify(submission),
      });
      const result = (await response.json()) as {
        ok: boolean;
        error?: string;
        certificate?: ReleaseCertificateSnapshot;
      };
      if (!response.ok || !result.ok || !result.certificate) {
        throw new Error(result.error ?? `certificate_signature_http_${response.status}`);
      }
      setCertificate(result.certificate);
      setOauthToken("");
      setConfirmed(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Certificate signing failed");
    } finally {
      setBusy(false);
    }
  }

  const ready = certificate?.signatures.builder?.verified && certificate.signatures.certifier?.verified;
  const graphicUrl = `/api/certificate.svg?v=${encodeURIComponent(certificate?.certificateDigest ?? "pending")}`;

  return (
    <main className="min-h-dvh bg-[#08090e] text-[#f5f2fb] print:bg-white print:text-black">
      <header className="mx-auto flex max-w-[100rem] items-center justify-between gap-4 px-4 py-5 sm:px-8">
        <Button variant="ghost" asChild><a href="/"><ArrowLeft className="size-4" />Back to Swarm</a></Button>
        <div className="flex items-center gap-2">
          <Badge variant={certificate?.complete ? "ok" : "outline"}>
            {certificate?.complete ? "Fully signed" : certificate?.status?.replaceAll("_", " ") ?? "Loading"}
          </Badge>
          <Button variant="ghost" size="icon" aria-label="Refresh certificate" onClick={() => void refresh()}>
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </header>

      <section className="mx-auto grid max-w-[100rem] gap-6 px-4 pb-12 sm:px-8 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl">
          <img src={graphicUrl} alt="Echo Swarm signed release certificate" className="block h-auto w-full" />
        </div>

        <aside className="flex flex-col gap-4">
          <div className="rounded-2xl border border-white/10 bg-white/[.04] p-5">
            <h1 className="font-serif text-3xl">Release certificate</h1>
            <p className="mt-2 text-sm leading-6 text-white/65">
              The graphic is backed by the exact machine-readable envelope. Every green signature is verified from its public key on each request.
            </p>
            <div className="mt-5 grid gap-2">
              <Button asChild><a href="/api/certificate.svg?download=1"><Download className="size-4" />Download SVG certificate</a></Button>
              <Button variant="outline" asChild><a href="/api/certificate?download=1"><FileJson className="size-4" />Download signed JSON</a></Button>
              <Button variant="ghost" onClick={() => window.print()}><Printer className="size-4" />Print or save PDF</Button>
              {certificate?.verificationUrl ? (
                <Button variant="ghost" asChild><a href={certificate.verificationUrl} target="_blank" rel="noreferrer"><ExternalLink className="size-4" />Independent CertForge record</a></Button>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[.04] p-5">
            <div className="flex items-center gap-2"><Fingerprint className="size-5 text-violet-300" /><h2 className="font-medium">Signature ceremony</h2></div>
            <p className="mt-2 text-sm leading-6 text-white/65">{certificate?.message ?? "Loading certification evidence…"}</p>
            {error ? <div className="mt-3 flex gap-2 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-100"><ShieldAlert className="mt-0.5 size-4 shrink-0" />{error}</div> : null}

            {certificate?.complete ? (
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-100"><BadgeCheck className="size-5" />All three digital signatures verify.</div>
            ) : PRIVATE_OAUTH_EDITION && ready ? (
              <div className="mt-4 grid gap-3">
                {!device && !oauthToken ? <Button disabled={busy} onClick={() => void beginCommanderOAuth()}><KeyRound className="size-4" />Authorize Commander with GitHub OAuth</Button> : null}
                {device ? (
                  <div className="rounded-xl border border-violet-300/30 bg-violet-300/10 p-4 text-sm">
                    <p>Enter this one-time code at GitHub:</p>
                    <p className="my-3 font-mono text-2xl tracking-[.18em]">{device.user_code}</p>
                    <a className="underline" href={device.verification_uri} target="_blank" rel="noreferrer">Open GitHub device authorization</a>
                    <Button className="mt-3 w-full" variant="outline" disabled={busy} onClick={() => void finishCommanderOAuth()}>I authorized this device</Button>
                  </div>
                ) : null}
                {oauthToken ? (
                  <>
                    <label className="flex items-start gap-3 rounded-xl border border-white/10 p-3 text-sm leading-5">
                      <input className="mt-1" type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
                      <span>I am {certificate.commanderDisplayName}, authenticated as GitHub <strong>{githubLogin}</strong>, and I approve release <span className="font-mono">{certificate.releaseSha.slice(0, 12)}</span>.</span>
                    </label>
                    <Button disabled={!confirmed || busy} onClick={() => void signCertificate()}><Fingerprint className="size-4" />Apply my digital signature</Button>
                  </>
                ) : null}
              </div>
            ) : !PRIVATE_OAUTH_EDITION ? (
              <p className="mt-4 rounded-lg border border-amber-300/25 bg-amber-300/10 p-3 text-sm text-amber-100">Commander signing is intentionally disabled in the public API-key edition. Sign the authoritative private OAuth release.</p>
            ) : null}
          </div>
        </aside>
      </section>
    </main>
  );
}

