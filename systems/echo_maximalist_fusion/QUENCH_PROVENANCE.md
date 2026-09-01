# QUENCH import note

This directory is the clean tracked source tree used by the live FORGE `echo-fusion-worker.service`, imported from `/home/forge/echo-maximalist-swarm` at source Git SHA `6a26110ef6b896e1bb9708fba9e815bf93e944fb`.

The import deliberately excludes the nested `.git` directory, virtual environments, runtime/checkpoint state, logs, and `/etc/echo/echo-fusion-worker.env`. No secret-bearing environment file was read or copied. Original source bytes are bound in `SOURCE_PROVENANCE.json`; files added on QUENCH (`QUENCH_PROVENANCE.md`, `SOURCE_PROVENANCE.json`, and `requirements.txt`) are not part of that source-hash set.

The committed systemd unit describes a default `stub` profile. FORGE's optional protected environment file currently overrides runtime configuration; its contents are not repository material. Use the live `/health` response and seat fingerprint as the runtime source of truth.

The Echo Swarm web/MCP application does not expose a caller-supplied worker address. Its bridge accepts only a configured loopback origin, defaults to `127.0.0.1:8157`, clamps budget inputs, redacts returned secrets, and polls runs by validated ID.

Independent PR review corrected `src/echo_fusion/arbitration.py` so identical claim prefixes from different subproblems cannot be collapsed as replication and asynchronous completion cannot promote a less-corroborated member as the visible cluster representative. It corrected `src/echo_fusion_worker/app.py` so an idempotent `wait:true` retry waits for an existing run and returns the completed result inline; `src/echo_fusion_worker/live_adapters.py` now parses whitespace-tolerant key assignments; and `src/echo_fusion/schemas.py` caps model-labeled external evidence until trusted verification. `SOURCE_PROVENANCE.json` retains the original FORGE SHAs and records the corrected QUENCH SHAs; the authored `tests/test_review_regressions.py` plus the updated trusted-evidence cascade invariant prove these boundaries.

The later portable integration remains additive and does not relabel or replace the recovered `echo_fusion` engine. The retained 0.5.3 wheel is the rollback artifact for the previous `reconstructed_v05` release. The current `reconstructed_v06` adapter binds the separately versioned 0.6.0 wheel to source SHA `efc85e8cb6934b7edb0e28a44ddcab2d709ebb19` and SHA-256 `8dbd6519d7f7a093233145cccd91f92c01c8d58133c6801846dc4688318ea544`. Version 0.6.0 preserves the 40-seat/separate-Trinity, deterministic routing, evidence topology, dissent, coverage, performance persistence, explicit fallback, ANVIL context, and eleven read-only capability mechanisms from 0.5.3. It adds an opt-in host adapter boundary for one signed Personality Forge consultation. The host requires TEMPER's exact runtime identity, loaded model, two-GPU placement, no-fallback adapter continuity, response digest, and Ed25519 receipt before treating persona text as external evidence. The run wall defaults to 600 seconds under a hard 900-second ceiling, addressing the observed 420-second post-fusion truncation without making execution unbounded. None of these mechanisms establishes historical parity.

## Verification

```powershell
$env:PYTHONPATH = "$PWD\systems\echo_maximalist_fusion\src"
.\.venv-brain\Scripts\python.exe systems\echo_maximalist_fusion\tests\test_invariants.py
.\.venv-brain\Scripts\python.exe systems\echo_maximalist_fusion\tests\test_worker.py
.\.venv-brain\Scripts\python.exe systems\echo_maximalist_fusion\tests\test_live_adapters.py
.\.venv-brain\Scripts\python.exe -m pytest systems\echo_maximalist_fusion\tests\test_review_regressions.py -q
$env:PYTHONPATH = "$PWD\systems\maximalist_reconstructed_core\vendor\maximalist_reconstructed-0.6.0-py3-none-any.whl;$PWD\systems\echo_maximalist_fusion\src"
.\.venv-brain\Scripts\python.exe -m pytest systems\echo_maximalist_fusion\tests\test_portable_core.py systems\echo_maximalist_fusion\tests\test_personality_forge.py -q
```

Do not restart `echo-workers` or the production Fusion unit merely to test this vendored source. Run isolated tests or a separate loopback development instance.
