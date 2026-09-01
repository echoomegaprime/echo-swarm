# QUENCH import note

This directory is the clean tracked source tree used by the live FORGE `echo-fusion-worker.service`, imported from `/home/forge/echo-maximalist-swarm` at source Git SHA `6a26110ef6b896e1bb9708fba9e815bf93e944fb`.

The import deliberately excludes the nested `.git` directory, virtual environments, runtime/checkpoint state, logs, and `/etc/echo/echo-fusion-worker.env`. No secret-bearing environment file was read or copied. Original source bytes are bound in `SOURCE_PROVENANCE.json`; files added on QUENCH (`QUENCH_PROVENANCE.md`, `SOURCE_PROVENANCE.json`, and `requirements.txt`) are not part of that source-hash set.

The committed systemd unit describes a default `stub` profile. FORGE's optional protected environment file currently overrides runtime configuration; its contents are not repository material. Use the live `/health` response and seat fingerprint as the runtime source of truth.

The Echo Swarm web/MCP application does not expose a caller-supplied worker address. Its bridge accepts only a configured loopback origin, defaults to `127.0.0.1:8157`, clamps budget inputs, redacts returned secrets, and polls runs by validated ID.

Independent PR review corrected `src/echo_fusion/arbitration.py` so identical claim prefixes from different subproblems cannot be collapsed as replication and asynchronous completion cannot promote a less-corroborated member as the visible cluster representative. It corrected `src/echo_fusion_worker/app.py` so an idempotent `wait:true` retry waits for an existing run and returns the completed result inline; `src/echo_fusion_worker/live_adapters.py` now parses whitespace-tolerant key assignments; and `src/echo_fusion/schemas.py` caps model-labeled external evidence until trusted verification. `SOURCE_PROVENANCE.json` retains the original FORGE SHAs and records the corrected QUENCH SHAs; the authored `tests/test_review_regressions.py` plus the updated trusted-evidence cascade invariant prove these boundaries.

The later `reconstructed_v05` integration is additive. It does not relabel or replace the recovered `echo_fusion` engine. `src/echo_fusion_worker/portable_core.py` adapts the separately versioned wheel under `../maximalist_reconstructed_core/`; that directory binds the wheel to source SHA `8b65901d8f037374ad48cbb7ee4bf488d1f1327c` and SHA-256 `8ba752e781f91599e16ef9609998306a85e3948aaa77f707675e9f279ba2d040`. The app exposes this adapter only when `FUSION_PROFILE=reconstructed_v05`; its existing `stub` and `live` profiles remain distinct. Version 0.5.0 adds deterministic routing receipts, configurable bounded routing, evidence claim topology, coverage telemetry, explicit provider/model fallback configuration, and restart-safe seat-performance history in addition to the bounded Echo SDK capability and memory phases. These mechanisms belong to the reconstruction and do not establish historical parity.

## Verification

```powershell
$env:PYTHONPATH = "$PWD\systems\echo_maximalist_fusion\src"
.\.venv-brain\Scripts\python.exe systems\echo_maximalist_fusion\tests\test_invariants.py
.\.venv-brain\Scripts\python.exe systems\echo_maximalist_fusion\tests\test_worker.py
.\.venv-brain\Scripts\python.exe systems\echo_maximalist_fusion\tests\test_live_adapters.py
.\.venv-brain\Scripts\python.exe -m pytest systems\echo_maximalist_fusion\tests\test_review_regressions.py -q
$env:PYTHONPATH = "$PWD\systems\maximalist_reconstructed_core\vendor\maximalist_reconstructed-0.5.0-py3-none-any.whl;$PWD\systems\echo_maximalist_fusion\src"
.\.venv-brain\Scripts\python.exe -m pytest systems\echo_maximalist_fusion\tests\test_portable_core.py -q
```

Do not restart `echo-workers` or the production Fusion unit merely to test this vendored source. Run isolated tests or a separate loopback development instance.
