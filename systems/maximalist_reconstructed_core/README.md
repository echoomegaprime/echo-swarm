# MAXIMALIST_RECONSTRUCTED 0.6.0 portable core

This directory binds the Echo Swarm plugin to the standalone portable core at exact source revision `efc85e8cb6934b7edb0e28a44ddcab2d709ebb19` and wheel SHA-256 `8dbd6519d7f7a093233145cccd91f92c01c8d58133c6801846dc4688318ea544`.

The profile remains `MAXIMALIST_RECONSTRUCTED` and `historical_parity` remains `false`. Recovered historical material is retained as reference evidence, but this package does not claim parity with the historical 40-LLM implementation.

The vendored wheel is pure Python, has no runtime package dependencies, and is verified by `SOURCE_PROVENANCE.json`. It is loaded through the additive `reconstructed_v06` profile in `systems/echo_maximalist_fusion/src/echo_fusion_worker/portable_core.py`. The earlier 0.5.3 wheel remains retained for rollback; it is not relabeled as the new product. The existing recovered Fusion Worker source, stub profile, and live profile remain separately provenance-bound.

## Runtime and routing selection

`FUSION_PROFILE=reconstructed_v06` selects the portable adapter. `MAXIMALIST_RUNTIME` must be one of:

- `anvil_live` for governed private ANVIL Ollama providers;
- `deterministic_test` for explicit offline verification only.

The production-oriented setting is `anvil_live`. Deterministic mode is reported in health and result provenance and is never an implicit fallback.

ANVIL requests explicitly use the installed Qwen artifact's measured 32,768-token context limit. `ANVIL_OLLAMA_NUM_CTX` may lower that value to a minimum of 2,048 but may not exceed it. The HTTP transport timeout is constructed from the same bounded `MAXIMALIST_REQUEST_TIMEOUT_SECONDS` value used by the run controller, closing the prior independent 60-second transport boundary. Uncertain outcomes remain non-replayable.

`MAXIMALIST_ROUTING_POLICY` selects one of `full_40`, `adaptive`, `cost_bounded`, `latency_bounded`, `offline_private`, `high_assurance`, or `canary`. The integration default is `full_40`; `MAXIMALIST_ROUTING_MAX_SEATS` applies a hard upper bound. Every completed result carries a deterministic routing receipt and coverage record. Adaptive live execution fails closed unless a planner, eligible swarm seats, and at least one separate Trinity seat are ready.

Run state, bounded memory, and seat-performance history persist independently through `MAXIMALIST_STATE_DIR`, `MAXIMALIST_MEMORY_FILE`, and `MAXIMALIST_PERFORMANCE_FILE`. Writes use restart-safe, idempotent storage. `MAXIMALIST_FALLBACK_CONFIG` is optional and explicit; it may define provider/model fallback order, but a live provider failure never triggers deterministic fake output.

The adapter defaults to the governed `echo_full_read_personality` capability profile. It gathers the eleven bounded read-only Echo/Arcanum/Knowledge/Wolfram/Phoenix evidence lanes plus one independently voiced Personality Forge consultation before decomposition. The Personality lane is accepted only after the host verifies the exact TEMPER runtime identity, model listing, two-GPU placement, no-fallback adapter identity, response digest, and Ed25519 routing receipt. Persona output remains external data, never authority. Set `MAXIMALIST_CAPABILITY_PROFILE=echo_full_read` to omit Personality Forge, `knowledge` for the smaller knowledge profile, or `off` to disable capability calls. Live SDK credentials remain runtime-only; deterministic output exists only under `deterministic_test`.

`MAXIMALIST_MAX_WALL_SECONDS` defaults to 600 seconds and is capped at an absolute 900 seconds in both the HTTP budget clamp and portable run controller. A caller may lower this limit but cannot raise it. This closes the observed 420-second truncation while keeping the run bounded.

The worker remains loopback-only. Echo Swarm rejects caller-provided worker origins and validates core profile, non-parity, version, source SHA, 40-seat registry, separate Trinity, routing policy, performance persistence, claim topology, coverage telemetry, and governed capability readiness before live execution.

## Local verification

Add the wheel and worker source to `PYTHONPATH`, then run the portable-core tests with the same Python environment used for the existing Fusion Worker tests:

```powershell
$env:PYTHONPATH = "$PWD\systems\maximalist_reconstructed_core\vendor\maximalist_reconstructed-0.6.0-py3-none-any.whl;$PWD\systems\echo_maximalist_fusion\src"
python -m pytest systems\echo_maximalist_fusion\tests\test_portable_core.py systems\echo_maximalist_fusion\tests\test_personality_forge.py -q
```

Rollback is a normal revert of the integration commit plus restoration of the prior `FUSION_PROFILE`. Do not delete retained run-state, memory, or performance files until their audit and recovery value has expired.
