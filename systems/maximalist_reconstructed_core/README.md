# MAXIMALIST_RECONSTRUCTED 0.3.0 portable core

This directory binds the Echo Swarm plugin to the standalone portable core at exact source revision `d1e68e2f263d93648e494c5419852693fdd03fe0`.

The profile remains `MAXIMALIST_RECONSTRUCTED` and `historical_parity` remains `false`. The package does not claim recovery of, or parity with, the historical 40-LLM implementation.

The vendored wheel is pure Python, has no runtime package dependencies, and is verified by `SOURCE_PROVENANCE.json`. It is loaded through the additive `reconstructed_v03` profile in `systems/echo_maximalist_fusion/src/echo_fusion_worker/portable_core.py`. The existing recovered Fusion Worker source, stub profile, and live profile remain available and separately provenance-bound.

## Runtime selection

`FUSION_PROFILE=reconstructed_v03` selects the portable adapter. `MAXIMALIST_RUNTIME` must be one of:

- `anvil_live` for the governed private ANVIL Ollama provider and all 40 configured seats;
- `deterministic_test` for explicit offline verification only.

The production-oriented setting is `anvil_live`. Deterministic mode is reported in health and result provenance and is never an implicit fallback.

The worker remains loopback-only. Echo Swarm continues to reject caller-provided worker origins and now validates the core profile, non-parity flag, seat count, separate Trinity flag, version, and source SHA before it starts or resumes a run.

## Local verification

Add the wheel and worker source to `PYTHONPATH`, then run the portable-core tests with the same Python environment used for the existing Fusion Worker tests:

```powershell
$env:PYTHONPATH = "$PWD\systems\maximalist_reconstructed_core\vendor\maximalist_reconstructed-0.3.0-py3-none-any.whl;$PWD\systems\echo_maximalist_fusion\src"
python -m pytest systems\echo_maximalist_fusion\tests\test_portable_core.py -q
```

Rollback is a normal revert of the integration commit plus restoration of the prior `FUSION_PROFILE`. Do not delete retained run-state files until their audit/recovery value has expired.
