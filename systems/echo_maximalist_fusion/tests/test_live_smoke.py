"""Deterministic contract tests for the deployed-worker smoke verifier."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any

import pytest

SMOKE_PATH = Path(__file__).resolve().parents[1] / "smoke_live.py"
SPEC = importlib.util.spec_from_file_location("echo_fusion_live_smoke", SMOKE_PATH)
assert SPEC is not None and SPEC.loader is not None
smoke = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(smoke)


RUN_ID = "run_" + "a" * 32


def live_health(**overrides: Any) -> dict[str, Any]:
    body = {
        "ok": True,
        "service": "echo-fusion-worker",
        "version": smoke.EXPECTED_WORKER_VERSION,
        "profile": smoke.EXPECTED_PROFILE,
        "historical_parity": False,
        "core_version": smoke.EXPECTED_CORE_VERSION,
        "core_sha": smoke.EXPECTED_CORE_SHA,
        "configured_seat_count": 40,
        "trinity_separate": True,
        "provider_mode": "live",
        "ready": True,
        "capability_profile": smoke.EXPECTED_CAPABILITY_PROFILE,
        "capability_mode": "live",
        "capability_ready": True,
        "degraded_capability_ids": [],
        "selected_capability_ids": list(smoke.EXPECTED_CAPABILITY_IDS),
        "credential_values_exposed": False,
        "seats_fingerprint": "fixed-test-fingerprint",
        "active_runs": 0,
    }
    body.update(overrides)
    return body


def live_result(answer: str = "Austin") -> dict[str, Any]:
    return {
        "answer": answer,
        "provenance": {
            "profile": smoke.EXPECTED_PROFILE,
            "historical_parity": False,
            "core_version": smoke.EXPECTED_CORE_VERSION,
            "core_sha": smoke.EXPECTED_CORE_SHA,
            "trinity_separate": True,
            "provider_mode": "live",
            "capability_mode": "live",
        },
    }


def test_health_contract_accepts_only_ready_reconstructed_live_worker() -> None:
    smoke.validate_health(200, live_health())

    with pytest.raises(smoke.SmokeFailure, match="profile mismatch"):
        smoke.validate_health(200, live_health(profile="stub"))
    with pytest.raises(smoke.SmokeFailure, match="live provider route"):
        smoke.validate_health(200, live_health(provider_mode="deterministic_test"))
    with pytest.raises(smoke.SmokeFailure, match="capability routes"):
        smoke.validate_health(
            200,
            live_health(
                capability_ready=False, degraded_capability_ids=["echo.brain.search"]
            ),
        )


@pytest.mark.parametrize(
    "base",
    (
        "https://127.0.0.1:8358",
        "http://forge.internal:8358",
        "http://user:password@127.0.0.1:8358",
        "http://127.0.0.1:8358/path",
    ),
)
def test_worker_origin_must_remain_explicit_loopback(base: str) -> None:
    with pytest.raises(smoke.SmokeFailure, match="loopback HTTP origin"):
        smoke.validated_base(base)


def test_full_smoke_flow_verifies_resume_and_negative_control(monkeypatch) -> None:
    calls: list[tuple[str, str, dict[str, Any] | None]] = []

    def fake_request(
        _base: str,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
        *,
        timeout: float,
    ) -> tuple[int, dict[str, Any]]:
        assert timeout == 1.0
        calls.append((method, path, body))
        if path == "/health":
            return 200, live_health()
        if path == "/run":
            return 202, {"run_id": RUN_ID, "phase": "running"}
        if path == "/resume":
            return 202, {"run_id": RUN_ID, "phase": "resuming"}
        if path == f"/runs/{RUN_ID}":
            return 200, {
                "run_id": RUN_ID,
                "phase": "done",
                "done": True,
                "result": live_result(),
                "error": None,
            }
        if path == "/runs/nope-not-real":
            return 404, {"detail": "unknown run_id nope-not-real"}
        raise AssertionError(f"unexpected smoke request: {method} {path}")

    monkeypatch.setattr(smoke, "request_json", fake_request)
    smoke.run_smoke(
        "http://127.0.0.1:8358",
        request_timeout=1.0,
        poll_timeout=1.0,
        poll_interval=0.001,
    )

    assert not any(path == "/selftest" for _, path, _ in calls)
    start_payload = next(body for method, path, body in calls if method == "POST" and path == "/run")
    assert start_payload is not None
    assert start_payload["budget"]["max_wall_s"] == 4800.0
    assert ("POST", "/resume", {"run_id": RUN_ID}) in calls
    assert calls[-1][:2] == ("GET", "/runs/nope-not-real")
