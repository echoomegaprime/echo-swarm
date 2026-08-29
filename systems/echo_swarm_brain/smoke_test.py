#!/usr/bin/env python3
"""Live smoke test against running echo-swarm-brain (local or public)."""
from __future__ import annotations

import json
import os
import sys
import urllib.request

BASE = os.environ.get("SWARM_BRAIN_URL", "http://127.0.0.1:8260")


def _post(path: str, body: dict) -> dict:
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    return json.loads(urllib.request.urlopen(req, timeout=180).read())


def main() -> int:
    print(f"smoke base={BASE}")
    health = json.loads(urllib.request.urlopen(f"{BASE}/health", timeout=30).read())
    print(f"health ok={health.get('ok')} status={health.get('status')}")
    if not health.get("ok"):
        print("WARN: health degraded (LLM or DB may be down)")

    consult = _post("/trinity/consult", {"question": "GRADE: test\nGrade a NM copy.", "voice": "SAGE"})
    assert consult.get("ok"), consult
    print(f"consult tokens={consult['consultation']['tokens_used']}")

    think = _post("/swarm/think", {"question": "Is ASM #1 a key issue?", "agents": 10})
    assert think.get("ok"), think
    print(f"think synthesis_len={len(think.get('synthesis', ''))}")

    print("smoke PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())