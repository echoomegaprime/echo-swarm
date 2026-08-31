# MAXIMALIST_RECONSTRUCTED 0.4.0 portable core

This directory binds the Echo Swarm plugin to the standalone portable core at exact source revision `c7505746b578aae3dcd524ab2b218e86f257badd`.

The profile remains `MAXIMALIST_RECONSTRUCTED` and `historical_parity` remains `false`. The package does not claim recovery of, or parity with, the historical 40-LLM implementation.

The vendored wheel is pure Python, has no runtime package dependencies, and is verified by `SOURCE_PROVENANCE.json`. It is loaded through the additive `reconstructed_v03` profile in `systems/echo_maximalist_fusion/src/echo_fusion_worker/portable_core.py`. The existing recovered Fusion Worker source, stub profile, and live profile remain available and separately provenance-bound.

## Runtime selection

`FUSION_PROFILE=reconstructed_v03` selects the portable adapter. `MAXIMALIST_RUNTIME` must be one of:

- `anvil_live` for the governed private ANVIL Ollama provider and all 40 configured seats;
- `deterministic_test` for explicit offline verification only.

The production-oriented setting is `anvil_live`. Deterministic mode is reported in health and result provenance and is never an implicit fallback.

The adapter defaults to the governed `echo_full_read` capability profile. It gathers bounded evidence from Arcanum search/enrichment, Knowledge Forge, Wolfram, Echo context/brain/doctrine/catalog/engine-library, and Phoenix status before decomposition. Set `MAXIMALIST_CAPABILITY_PROFILE=knowledge` for the smaller knowledge profile or `off` to disable capability calls. Live mode uses the Echo SDK gate and runtime credential references; deterministic capability output exists only under `deterministic_test`.

The worker remains loopback-only. Echo Swarm continues to reject caller-provided worker origins and now validates the core profile, non-parity flag, seat count, separate Trinity flag, version, and source SHA before it starts or resumes a run.

## Local verification

Add the wheel and worker source to `PYTHONPATH`, then run the portable-core tests with the same Python environment used for the existing Fusion Worker tests:

```powershell
$env:PYTHONPATH = "$PWD\systems\maximalist_reconstructed_core\vendor\maximalist_reconstructed-0.4.0-py3-none-any.whl;$PWD\systems\echo_maximalist_fusion\src"
python -m pytest systems\echo_maximalist_fusion\tests\test_portable_core.py -q
```

Rollback is a normal revert of the integration commit plus restoration of the prior `FUSION_PROFILE`. Do not delete retained run-state files until their audit/recovery value has expired.
