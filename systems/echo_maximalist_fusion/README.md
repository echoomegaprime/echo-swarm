# Echo Maximalist Fusion Brain

This directory hosts the Echo Swarm worker adapter for
`MAXIMALIST_RECONSTRUCTED` 0.5.3. It is a reconstructed, provenance-bound
reasoning system and explicitly reports `historical_parity=false`; it is not a
claim that the exact historical 40-LLM implementation was recovered.

The standalone portable core is authoritative for the reconstructed engine.
This worker supplies the asynchronous loopback HTTP contract used by Echo Swarm
and the guarded Omnipresence SDK bridge without replacing the older production
worker.

## Runtime shape

- 40 configured swarm seats plus a separate three-seat Trinity.
- Independent first pass, structured finding bus, propagation, dynamic
  re-tasking, explicit dissent, evidence-weighted arbitration, recursive
  Trinity fusion, and restart-safe state.
- Explicit routing policies, bounded calls/cost/time, capability preflight,
  claim-cluster and seat-contribution receipts, and performance persistence.
- Worker bind: `http://127.0.0.1:8358` only.
- Echo SDK bridge bind: `http://127.0.0.1:8487` only.
- Existing services on ports 8157 and 8357 are protected rollback surfaces and
  must not be replaced by this review branch.

## Provider boundary

`MAXIMALIST_RUNTIME=anvil_live` is the live route. It uses the configured ANVIL
Ollama provider and the governed `echo_full_read` capability profile. Provider
and SDK capability preflight fail independently and remain visible in
`GET /health`; start and resume are blocked by the host integrations unless the
live route is ready.

`MAXIMALIST_RUNTIME=deterministic_test` exists only for repeatable automated
tests. It is never selected implicitly and is not a live fallback.

## Worker endpoints

| Method and path      | Contract                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `GET /health`        | Exact reconstructed identity, seat/Trinity topology, provider readiness, capability readiness, and active run count. |
| `POST /selftest`     | Fixed end-to-end worker self-test under the selected runtime.                                                        |
| `POST /run`          | Start an asynchronous bounded run; optional `wait=true` is capped.                                                   |
| `GET /runs/{run_id}` | Read active or restart-restored state/result.                                                                        |
| `POST /resume`       | Publish `resuming`, then resume durable state asynchronously.                                                        |

## Local verification

Use an isolated project virtual environment containing the pinned test
dependencies; do not install them into the machine-wide Python runtime.

```powershell
python -m pytest systems/echo_maximalist_fusion/tests -q
python systems/echo_maximalist_fusion/tests/test_invariants.py
python systems/echo_maximalist_fusion/tests/test_live_adapters.py
python systems/echo_maximalist_fusion/tests/test_worker.py
python scripts/certforge_journey.py
npm test
npm run test:mcp
npm run typecheck
npm run lint
```

The deterministic suites prove behavior and contract integrity. They do not
prove that a live provider, the Echo SDK, hosted checks, Certification Forge, or
production is healthy.

## Live smoke

After deploying the exact reviewed worker to the reserved loopback port and
configuring the real live provider/capability routes, run:

```powershell
python systems/echo_maximalist_fusion/smoke_live.py `
  --base-url http://127.0.0.1:8358 `
  --poll-timeout 4860
```

The smoke fails closed unless it observes the exact 0.5.3 reconstructed core,
`historical_parity=false`, 40 seats, separate Trinity, a ready live provider,
all eleven required Echo SDK read capabilities, live result provenance,
completed resume readback, and the unknown-run negative control. It rejects
non-loopback targets and never enables a deterministic provider.

The full-40 route has a server-owned 4,800-second hard wall and a 500,000-input-
token ceiling. Measured ANVIL evidence first showed that the former 420-second
wall completed only 13 of 40 independent seats. A subsequent complete first
pass, finding propagation, retasking, and arbitration reached Trinity near
2,000 seconds and reserved 249,207 input tokens, proving that the interim
2,400-second/250,000-token envelope could not cover the bounded recursive
graph. The finite wall, 120-call cap, USD 5 configured-cost cap, 300-second
per-call timeout, and non-replay treatment of uncertain calls remain enforced.

## Activation and certification

Activation remains review-gated:

1. verify the exact remote PR SHA;
2. pass hosted CI, CodeQL, Release Sentinel, and the bounded CertForge journey;
3. deploy that exact SHA to an isolated canary while preserving the certified
   production service;
4. pass the live smoke and external acceptance checks;
5. obtain a current signed Certification Forge `PRODUCTION_READY` receipt bound
   to the same SHA and environment;
6. obtain the Commander's separate exact-SHA approval/signature;
7. merge and promote only the SHA that was reviewed and certified;
8. re-run health, critical journeys, negative controls, and stability probes.

Local success, a canary HTTP 200, or an unsigned evidence package is not a
production certification.

## Rollback

The review path is additive. Rollback disables the new `echo.fusion.*`
registrations, stops the isolated bridge and v05 worker, and restores routing to
the previously certified Echo Swarm release. Do not delete durable state or the
known-good production release during rollback.

The recovered-source record and transformation hashes are maintained in
`SOURCE_PROVENANCE.json`. The original build rationale and independent review
findings remain in `docs/CONSOLIDATED_BUILD_SPEC.md` and `docs/reviews/`.
