"""Strict served-provider/model identity regression: no network calls."""
import asyncio
from pathlib import Path
import pytest
from echo_fusion_worker import fleet_lanes
from maximalist_reconstructed.providers import ProviderError
from test_fleet_lanes import _FakeGate, _request, _roster

@pytest.mark.parametrize("body", [
    {"ok": True, "text": "claimed reply"},
    {"ok": True, "text": "claimed reply", "provider": "openrouter"},
    {"ok": True, "text": "claimed reply", "model": "x"},
    {"ok": True, "text": "claimed reply", "provider": "", "model": "x"},
    {"ok": True, "text": "claimed reply", "provider": "openrouter", "model": " "},
    {"ok": True, "text": "claimed reply", "provider": 12, "model": "x"},
    {"ok": True, "text": "claimed reply", "provider": "openrouter", "model": None},
])
def test_missing_served_identity_fails_closed(tmp_path: Path, body) -> None:
    roster = fleet_lanes.FleetRoster.load(_roster(tmp_path))
    with pytest.raises(ProviderError, match="missing explicit served provider/model identity"):
        asyncio.run(fleet_lanes.FleetGateAdapter(roster, gate=_FakeGate(body)).complete(
            _request("openrouter::anthropic/claude-opus-4-8")))

def test_exact_served_identity_accepted(tmp_path: Path) -> None:
    roster = fleet_lanes.FleetRoster.load(_roster(tmp_path))
    body = {"ok": True, "text": "valid", "provider": "openrouter",
            "model": "anthropic/claude-opus-4-8",
            "usage": {"prompt_tokens": 9, "completion_tokens": 4}}
    result = asyncio.run(fleet_lanes.FleetGateAdapter(roster, gate=_FakeGate(body)).complete(
        _request("openrouter::anthropic/claude-opus-4-8")))
    assert result.text == "valid" and result.usage_source == "gate_reported"

def test_explicit_reroute_still_rejected(tmp_path: Path) -> None:
    roster = fleet_lanes.FleetRoster.load(_roster(tmp_path))
    body = {"ok": True, "text": "wrong lane", "provider": "openrouter",
            "model": "openrouter/free"}
    with pytest.raises(ProviderError, match="instead of openrouter/anthropic/claude-opus-4-8"):
        asyncio.run(fleet_lanes.FleetGateAdapter(roster, gate=_FakeGate(body)).complete(
            _request("openrouter::anthropic/claude-opus-4-8")))

