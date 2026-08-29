#!/usr/bin/env python3
"""Live smoke for the running echo-fusion-worker on 127.0.0.1:8157.

Proves the deployed service (not an in-process TestClient) answers: /health,
/selftest, async run -> poll -> FusionResult, and in-process resume.
"""
import json
import sys
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8157"
fails = 0


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, json.loads(r.read().decode())


def check(name, cond, detail=""):
    global fails
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f" :: {detail}"))
    if not cond:
        fails += 1


st, h = call("GET", "/health")
check("health", st == 200 and h.get("ok") and h.get("profile") == "stub"
      and h.get("seats_fingerprint"), f"{st} {h}")

st, s = call("POST", "/selftest")
check("selftest", st == 200 and s.get("ok") and s.get("answer"), f"{st} {s}")

st, r = call("POST", "/run", {"objective": "live smoke: capital of texas"})
check("run.async_202", st == 202 and r.get("run_id"), f"{st} {r}")
rid = r.get("run_id")

result = None
for _ in range(100):
    st, g = call("GET", f"/runs/{rid}")
    if g.get("done"):
        result = g.get("result")
        break
    time.sleep(0.1)
check("run.completes", result is not None and result.get("answer"), f"poll result={result}")

st, rr = call("POST", "/resume", {"run_id": rid})
check("resume", st in (200, 202) and rr.get("run_id") == rid, f"{st} {rr}")

st, nf = 0, None
try:
    call("GET", "/runs/nope-not-real")
except urllib.error.HTTPError as e:
    st = e.code
check("unknown_run_404", st == 404, f"status={st}")

print("")
print("SMOKE GREEN" if not fails else f"{fails} SMOKE FAILURES")
sys.exit(1 if fails else 0)
