"""Contract tests for the additive MAXIMALIST_RECONSTRUCTED 0.5.2 adapter."""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import httpx
import pytest
from httpx import ASGITransport

REPO_ROOT = Path(__file__).resolve().parents[3]
CORE_WHEEL = (
    REPO_ROOT
    / "systems"
    / "maximalist_reconstructed_core"
    / "vendor"
    / "maximalist_reconstructed-0.5.2-py3-none-any.whl"
)
WORKER_SRC = REPO_ROOT / "systems" / "echo_maximalist_fusion" / "src"
sys.path.insert(0, str(CORE_WHEEL))
sys.path.insert(0, str(WORKER_SRC))

from echo_fusion.schemas import Budget  # noqa: E402
from echo_fusion_worker.app import create_app  # noqa: E402
from echo_fusion_worker.portable_core import (  # noqa: E402
    CORE_PROFILE,
    CORE_SHA,
    CORE_VERSION,
    PortableCoreEngine,
    SUPPORTED_ROUTING_POLICIES,
)

EXPECTED_CAPABILITY_IDS = [
    "echo.arcanum.search",
    "echo.arcanum.enrich",
    "echo.knowledge.search",
    "echo.wolfram.llm",
    "echo.context.recall",
    "echo.brain.search",
    "echo.doctrine.search",
    "echo.caps.search",
    "echo.engine.query",
    "echo.wolfram.health",
    "echo.dr.phoenix_status",
]


def _client(app):
    return httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def test_vendored_wheel_is_present_and_sha_bound() -> None:
    import hashlib

    assert CORE_WHEEL.is_file()
    assert hashlib.sha256(CORE_WHEEL.read_bytes()).hexdigest() == (
        "48b2778a6bd730fbcb8d18013347ba4da6c3f7282950b7eade4e6446ce90f53a"
    )


def test_anvil_runtime_has_40_seats_and_separate_trinity(tmp_path: Path) -> None:
    runtime = PortableCoreEngine(runtime="anvil_live", state_dir=tmp_path)
    assert runtime.metadata == {
        "profile": CORE_PROFILE,
        "historical_parity": False,
        "core_version": CORE_VERSION,
        "core_sha": CORE_SHA,
        "provider_mode": "live",
        "runtime": "anvil_live",
        "configured_seat_count": 40,
        "trinity_separate": True,
        "routing_policy": "full_40",
        "routing_max_seats": 40,
        "supported_routing_policies": sorted(SUPPORTED_ROUTING_POLICIES),
        "performance_persistence": True,
        "explicit_fallback_configured": False,
        "claim_topology": True,
        "coverage_telemetry": True,
        "capability_profile": "echo_full_read",
        "capability_mode": "live",
        "selected_capability_ids": EXPECTED_CAPABILITY_IDS,
    }
    assert len(runtime.registry.seats) == 40
    assert len(runtime.registry.trinity) == 3
    assert not ({seat.id for seat in runtime.registry.seats} & {seat.id for seat in runtime.registry.trinity})
    assert runtime.fake_capabilities is None


def test_worker_round_trip_and_restart_readback(tmp_path: Path) -> None:
    async def exercise() -> tuple[str, dict]:
        runtime = PortableCoreEngine(runtime="deterministic_test", state_dir=tmp_path)
        app = create_app(engine=runtime, profile="reconstructed_v05", fingerprint="portable-v05")

        async with _client(app) as client:
            health = await client.get("/health")
            assert health.status_code == 200
            h = health.json()
            assert h["profile"] == CORE_PROFILE
            assert h["historical_parity"] is False
            assert h["core_version"] == CORE_VERSION
            assert h["core_sha"] == CORE_SHA
            assert h["configured_seat_count"] == 40
            assert h["trinity_separate"] is True
            assert h["provider_mode"] == "deterministic_test"
            assert h["ready"] is True
            assert h["capability_profile"] == "echo_full_read"
            assert h["capability_mode"] == "deterministic_test"
            assert h["capability_ready"] is True
            assert h["ready_capability_count"] == 11
            assert h["degraded_capability_ids"] == []
            assert h["selected_capability_ids"] == EXPECTED_CAPABILITY_IDS
            assert h["capability_preflight"]["credential_values_exposed"] is False

            response = await client.post(
                "/run",
                json={
                    "objective": "Verify the portable worker contract",
                    "context": {"source": "portable-core-test"},
                    "budget": {"max_calls": 120, "max_cost_usd": 5, "max_wall_s": 120},
                    "wait": True,
                    "idempotency_key": "portable-core-test-v1",
                },
            )
            assert response.status_code == 200, response.text
            body = response.json()
            assert body["done"] is True
            run_id = body["run_id"]
            result = body["result"]
            assert run_id.startswith("run_")
            assert result["answer"]
            assert result["provenance"]["profile"] == CORE_PROFILE
            assert result["provenance"]["historical_parity"] is False
            assert result["provenance"]["core_version"] == CORE_VERSION
            assert result["provenance"]["core_sha"] == CORE_SHA
            assert result["provenance"]["trinity_separate"] is True
            assert result["provenance"]["configured_seat_count"] == 40
            assert result["provenance"]["deterministic_test_output"] is True
            assert result["provenance"]["capability_profile"] == "echo_full_read"
            assert result["provenance"]["capability_mode"] == "deterministic_test"
            assert result["provenance"]["routing"]["policy"] == "full_40"
            assert len(result["provenance"]["routing"]["routing_fingerprint"]) == 64
            assert result["coverage"]["selected_seats"] == 40
            assert result["coverage"]["configured_seats"] == 40
            assert result["coverage"]["selection_ratio"] == 1.0
            assert result["claim_clusters"]
            assert result["seat_contributions"]
            assert result["performance_writes"]
            assert len(result["capability_results"]) == 11

            selftest = await client.post("/selftest")
            assert selftest.status_code == 200, selftest.text
            assert selftest.json()["ok"] is True
            assert selftest.json()["profile"] == "reconstructed_v05"
            return run_id, result

    run_id, result = asyncio.run(exercise())
    restarted = PortableCoreEngine(runtime="deterministic_test", state_dir=tmp_path)
    recovered = restarted.get_run(run_id)
    assert recovered is not None
    assert recovered["done"] is True
    assert recovered["result"]["answer"] == result["answer"]
    assert restarted.fake_capabilities is not None
    assert restarted.fake_capabilities.calls == []
    assert restarted.performance.snapshot()

    resumed = asyncio.run(restarted.resume(run_id))
    assert resumed.answer == result["answer"]
    assert restarted.fake_capabilities.calls == []


def test_unknown_runtime_fails_closed(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="MAXIMALIST_RUNTIME"):
        PortableCoreEngine(runtime="automatic-fallback", state_dir=tmp_path)


def test_adaptive_routing_is_bounded_and_persists_performance(tmp_path: Path) -> None:
    runtime = PortableCoreEngine(
        runtime="deterministic_test",
        state_dir=tmp_path,
        routing_policy="adaptive",
        routing_max_seats=8,
    )
    state = runtime.create_state(
        "Audit a high-risk security recovery design",
        {},
        Budget(max_calls=120, max_cost_usd=5, max_wall_s=120),
    )
    result = asyncio.run(runtime.drive_state(state)).model_dump(mode="json")

    assert runtime.metadata["routing_policy"] == "adaptive"
    assert runtime.metadata["routing_max_seats"] == 8
    assert result["provenance"]["seat_count"] == 8
    assert result["provenance"]["routing"]["policy"] == "adaptive"
    assert len(result["provenance"]["routing"]["routing_fingerprint"]) == 64
    assert result["coverage"]["selected_seats"] == 8
    assert result["coverage"]["configured_seats"] == 40
    assert result["coverage"]["selection_ratio"] == 0.2
    assert len(result["performance_writes"]) == len(result["performance_updates"])
    assert (tmp_path / "performance.json").is_file()


def test_unknown_routing_policy_fails_closed(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="MAXIMALIST_ROUTING_POLICY"):
        PortableCoreEngine(
            runtime="deterministic_test",
            state_dir=tmp_path,
            routing_policy="automatic-fallback",
        )


def test_reconstructed_profile_requires_explicit_runtime(monkeypatch, tmp_path: Path) -> None:
    from echo_fusion_worker.portable_core import _build_portable_engine

    monkeypatch.delenv("MAXIMALIST_RUNTIME", raising=False)
    monkeypatch.setenv("MAXIMALIST_STATE_DIR", os.fspath(tmp_path))
    with pytest.raises(RuntimeError, match="MAXIMALIST_RUNTIME is required"):
        _build_portable_engine({})
