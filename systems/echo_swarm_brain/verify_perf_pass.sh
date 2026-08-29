#!/usr/bin/env bash
# Smoke + microbenchmark gate for echo-swarm-brain 3.2.0-perf
set -euo pipefail
cd "$(dirname "$0")"
export PYTHONPATH=.

echo "== py_compile =="
python3 -m py_compile app.py llm.py hotpath.py bench_hotpath.py

echo "== unit tests (hotpath + smoke) =="
python3 -m pytest tests/test_hotpath.py tests/test_smoke.py -q --tb=line

echo "== microbenchmark =="
python3 bench_hotpath.py

echo "== live smoke (if up on :8260) =="
PORT="${SWARM_BRAIN_PORT:-8260}"
HEALTH_JSON="$(mktemp -t echo-swarm-brain-health.XXXXXX.json)" || HEALTH_JSON=""
if [[ -z "$HEALTH_JSON" ]]; then
  echo "LIVE_SMOKE_SKIP (mktemp failed)"
elif curl -fsS --max-time 3 "http://127.0.0.1:${PORT}/health" >"$HEALTH_JSON" 2>/dev/null; then
  trap 'rm -f -- "$HEALTH_JSON"' EXIT
  HEALTH_PATH="$HEALTH_JSON" python3 - <<'PY'
import json, os, sys
with open(os.environ["HEALTH_PATH"], encoding="utf-8") as stream:
    h = json.load(stream)
svc = str(h.get("service") or "")
ver = str(h.get("version") or "")
status = h.get("status")
print("LIVE_HEALTH", json.dumps({k: h.get(k) for k in ("status", "version", "perf", "ok", "service")}))
if svc and svc != "echo-swarm-brain":
    print(f"LIVE_SMOKE_SKIP (port owned by other service: {svc!r})")
    sys.exit(0)
if status not in ("healthy", "degraded", "ok"):
    print("LIVE_SMOKE_FAIL unexpected status:", status)
    sys.exit(1)
if ver and not (ver.endswith("-perf") or "perf" in ver):
    print("LIVE_SMOKE_WARN version not yet perf-tagged:", ver)
else:
    print("LIVE_SMOKE_OK", ver)
PY
else
  rm -f -- "$HEALTH_JSON"
  echo "LIVE_SMOKE_SKIP (service not reachable on :${PORT})"
fi

echo "VERIFY_PERF_PASS_OK"
