# Swarm

Interactive multi-LLM council with two security-explicit editions, a recovered sovereign Swarm Brain, Maximalist Fusion, and graphical exact-release certificates.

**Live:** [https://swarm-app.echo-op.com](https://swarm-app.echo-op.com)  
**Install all surfaces:** [docs/INSTALL.md](docs/INSTALL.md)

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:8080`. Connect labs, select a purpose and mode, brief the table, and optionally enable Fusion and voice readback.

Build the authoritative private OAuth edition with `npm run build:private`; build the distributable bring-your-own-key edition with `npm run build:public`. See [docs/EDITIONS.md](docs/EDITIONS.md).

## Interactive chat

- Purpose controls bring models into the visible conversation for brainstorm, debate, build, review, evidence validation, advisory certification review, planning, and reporting.
- Every seat remains independently attributable and can be replied to, copied, or read aloud.
- **Fusion on** sends the completed council evidence to the loopback Echo Fusion Worker and inserts the fused result back into the same chat as a separate `MAXIMALIST_RECONSTRUCTED` message.
- The microphone fills the composer through the browser Web Speech API. Readback can speak any reply or automatically speak completed fused output when the browser exposes speech synthesis.
- “Certify” is an evidence-gated advisory review. It never claims to replace CertForge plus the Certification Forge GitHub App exact-SHA receipts.
- **Certificate** opens the real release certificate graphic. The certificate is complete only after the AI Builder, independent Certification Forge certifier, and Commander signatures all verify. See [docs/CERTIFICATES.md](docs/CERTIFICATES.md).

Production unit on FORGE: `echo-swarm.service` → `:8365` → Cloudflare `swarm-app.echo-op.com`.

## Modes

| Mode        | What it does                                         |
| ----------- | ---------------------------------------------------- |
| Parallel    | Every live seat answers at once                      |
| Roundtable  | Seats speak in order; host keeps plugins             |
| Debate      | Affirm vs dissent, then rebuttal                     |
| Conductor   | Host summons peers with `call_peer`                  |
| Build Heavy | Spec → implement → review → merge on the whole swarm |

## Connect

The authoritative private edition exposes **Pull CLIs** for approved OAuth/signed-session credentials and hides remote API-key entry. The public edition disables CLI/session harvesting and accepts caller-owned API keys. FORGE/TEMPER remain local seats.

The edition policy is enforced server-side as well as in the UI. A request cannot flip the private service into API-key mode or make the public service borrow private remote-provider environment credentials. Never commit tokens or keys.

## Host plugin

Other chats POST the same contract:

- Manifest: `/api/plugin.json`
- OpenAPI: `/api/plugin/openapi.json`
- Run: `POST /api/plugin/swarm`
- SSE: `POST /api/plugin/stream`
- MCP: `/api/plugin/mcp`
- Apply files: `POST /api/plugin/apply`
- Certificate page: `/certificate`
- Signed certificate JSON: `/api/certificate`
- Certificate SVG: `/api/certificate.svg`
- Icon: `/__grok/icon-180.png`

Auth headers: **`x-echo-agent: <surface>`** (required). When `SWARM_MCP_TOKEN` is set on the host, also `Authorization: Bearer <token>`.

Lab key headers are accepted only by the public API-key edition. The private OAuth edition discards caller credential and local-node override headers before execution.

### Signed certificate tools

The MCP catalog now includes `swarm_certificate_status` and `swarm_certificate_artifact`. They verify signature state and return the printable page, SVG download, signed JSON envelope, and independent Certification Forge record without granting a model authority to apply the Commander's signature.

### Maximalist Fusion Brain

The MCP endpoint also exposes the asynchronous `MAXIMALIST_RECONSTRUCTED` workflow backed by the loopback Fusion worker. The clean FORGE source tree for the earlier worker and its engine remains preserved at [`systems/echo_maximalist_fusion`](systems/echo_maximalist_fusion), bound to its source Git SHA and per-file hashes. The additive [`systems/maximalist_reconstructed_core`](systems/maximalist_reconstructed_core) integration binds the portable 0.4.0 core to exact source SHA `c7505746b578aae3dcd524ab2b218e86f257badd` without silently replacing that recovered source:

1. `swarm_maximalist_health` verifies `MAXIMALIST_RECONSTRUCTED`, `historical_parity: false`, core version/SHA, 40 seats, separate Trinity, provider readiness, and the governed 11-capability profile.
2. `swarm_maximalist_start` rechecks that exact live identity, starts a bounded deep-fusion run, and returns a `run_id` immediately.
3. `swarm_maximalist_result` polls that run and returns a chat-ready fused answer with confidence, preserved dissent, unresolved uncertainty, and structured provenance.
4. `swarm_maximalist_resume` resumes persisted run state after a worker interruption.

Set `FUSION_WORKER_BASE` to the worker's loopback origin (default `http://127.0.0.1:8157`). Non-loopback origins and caller-supplied worker addresses are rejected. Select the new adapter with `FUSION_PROFILE=reconstructed_v03` and explicitly set `MAXIMALIST_RUNTIME=anvil_live`; `deterministic_test` is an offline verification mode and the plugin will not accept it for a live start or resume.

`MAXIMALIST_CAPABILITY_PROFILE=echo_full_read` is the integration default. Live capability calls use `MAXIMALIST_SDK_BASE_URL` (falling back to the existing `FUSION_GATE_BASE`) and a runtime-only Echo credential reference. Capability scope or availability failures remain visible and degrade independently; they never trigger a fake live fallback.

### Recovered Echo Swarm Brain

The HAMMER-recovered sovereign brain is preserved under [`systems/echo_swarm_brain`](systems/echo_swarm_brain) and exposed as a separate fixed-loopback MCP family:

1. `swarm_brain_health`
2. `swarm_brain_think`
3. `swarm_brain_trinity_consult`
4. `swarm_brain_trinity_decide`
5. `swarm_brain_hybrid`

Set `SWARM_BRAIN_BASE` to its loopback origin (default `http://127.0.0.1:8260`). The recovered 3.2.0 source retains its original comic-research and CGC-grading specialization, Postgres artifact dependency, and ALPHA model dependency; the plugin does not relabel it as the newer Maximalist Fusion Worker.

## Build Heavy artifacts

Implementers write path-tagged fences:

````
```ts src/lib/foo.ts
export const x = 1
```
````

**Zip** downloads them. **Apply** writes `/workspace/swarm-out/<session>/`.

## Stack

TanStack Start, Vite, Zustand, Tailwind. Node 22+.

Echo Prime Technologies.
