# MAXIMALIST_RECONSTRUCTED 0.5.2 portable core

This directory binds the Echo Swarm plugin to the standalone portable core at exact source revision `a0bae949d4c63b63feb0db86cefb49aaea231b88`.

The profile remains `MAXIMALIST_RECONSTRUCTED` and `historical_parity` remains `false`. Recovered historical material is retained as reference evidence, but this package does not claim parity with the historical 40-LLM implementation.

The vendored wheel is pure Python, has no runtime package dependencies, and is verified by `SOURCE_PROVENANCE.json`. It is loaded through the additive `reconstructed_v05` profile in `systems/echo_maximalist_fusion/src/echo_fusion_worker/portable_core.py`. The existing recovered Fusion Worker source, stub profile, and live profile remain available and separately provenance-bound.

## Runtime and routing selection

`FUSION_PROFILE=reconstructed_v05` selects the portable adapter. `MAXIMALIST_RUNTIME` must be one of:

- `anvil_live` for governed private ANVIL Ollama providers;
- `deterministic_test` for explicit offline verification only.

The production-oriented setting is `anvil_live`. Deterministic mode is reported in health and result provenance and is never an implicit fallback.

`MAXIMALIST_ROUTING_POLICY` selects one of `full_40`, `adaptive`, `cost_bounded`, `latency_bounded`, `offline_private`, `high_assurance`, or `canary`. The integration default is `full_40`; `MAXIMALIST_ROUTING_MAX_SEATS` applies a hard upper bound. Every completed result carries a deterministic routing receipt and coverage record. Adaptive live execution fails closed unless a planner, eligible swarm seats, and at least one separate Trinity seat are ready.

Run state, bounded memory, and seat-performance history persist independently through `MAXIMALIST_STATE_DIR`, `MAXIMALIST_MEMORY_FILE`, and `MAXIMALIST_PERFORMANCE_FILE`. Writes use restart-safe, idempotent storage. `MAXIMALIST_FALLBACK_CONFIG` is optional and explicit; it may define provider/model fallback order, but a live provider failure never triggers deterministic fake output.

The adapter defaults to the governed `echo_full_read` capability profile. It gathers bounded evidence from Arcanum search/enrichment, Knowledge Forge, Wolfram, Echo context/brain/doctrine/catalog/engine-library, and Phoenix status before decomposition. Set `MAXIMALIST_CAPABILITY_PROFILE=knowledge` for the smaller knowledge profile or `off` to disable capability calls. Live mode uses the Echo SDK gate and runtime credential references; deterministic capability output exists only under `deterministic_test`.

The worker remains loopback-only. Echo Swarm rejects caller-provided worker origins and validates core profile, non-parity, version, source SHA, 40-seat registry, separate Trinity, routing policy, performance persistence, claim topology, coverage telemetry, and governed capability readiness before live execution.

## Local verification

Add the wheel and worker source to `PYTHONPATH`, then run the portable-core tests with the same Python environment used for the existing Fusion Worker tests:

```powershell
$env:PYTHONPATH = "$PWD\systems\maximalist_reconstructed_core\vendor\maximalist_reconstructed-0.5.2-py3-none-any.whl;$PWD\systems\echo_maximalist_fusion\src"
python -m pytest systems\echo_maximalist_fusion\tests\test_portable_core.py -q
```

Rollback is a normal revert of the integration commit plus restoration of the prior `FUSION_PROFILE`. Do not delete retained run-state, memory, or performance files until their audit and recovery value has expired.
