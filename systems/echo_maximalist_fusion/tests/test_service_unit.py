"""Static deployment contract for the reconstructed Fusion worker unit."""

import json
from pathlib import Path


UNIT = Path(__file__).resolve().parents[1] / "deploy" / "echo-fusion-worker.service"
RESERVATION = Path(__file__).resolve().parents[1] / "deploy" / "port-reservation.json"


def test_service_unit_is_profile_bound_and_state_isolated() -> None:
    unit = UNIT.read_text(encoding="utf-8")

    assert "Environment=FUSION_PROFILE=reconstructed_v05" in unit
    assert "Environment=MAXIMALIST_SDK_BASE_URL=http://127.0.0.1:8000" in unit
    assert "Environment=FUSION_GATE_BASE=http://127.0.0.1:8000" in unit
    assert (
        "Environment=MAXIMALIST_STATE_DIR=/var/lib/echo/maximalist-reconstructed-v05"
        in unit
    )
    assert (
        "Environment=MAXIMALIST_MEMORY_FILE="
        "/var/lib/echo/maximalist-reconstructed-v05/memory.json"
    ) in unit
    assert (
        "Environment=MAXIMALIST_PERFORMANCE_FILE="
        "/var/lib/echo/maximalist-reconstructed-v05/performance.json"
    ) in unit
    assert "Environment=MAXIMALIST_ROUTING_POLICY=full_40" in unit
    assert "Environment=MAXIMALIST_ROUTING_MAX_SEATS=40" in unit
    assert "StateDirectory=echo/maximalist-reconstructed-v05" in unit
    assert "StateDirectoryMode=0750" in unit
    assert (
        "ExecStart=/home/forge/echo-maximalist-swarm/.venv/bin/python -m uvicorn "
        "echo_fusion_worker.app:app --host 127.0.0.1 --port 8358 --log-level info"
    ) in unit


def test_service_unit_does_not_expose_the_worker_to_the_network() -> None:
    unit = UNIT.read_text(encoding="utf-8")

    assert "--host 0.0.0.0" not in unit
    assert "--host ::" not in unit


def test_service_unit_matches_governed_port_reservation() -> None:
    unit = UNIT.read_text(encoding="utf-8")
    reservation = json.loads(RESERVATION.read_text(encoding="utf-8"))

    assert reservation["profile"] == "MAXIMALIST_RECONSTRUCTED"
    assert reservation["historical_parity"] is False
    assert reservation["port"] == 8358
    assert reservation["bind"] == "127.0.0.1:8358"
    assert reservation["service"] == "echo-fusion-worker-v05.service"
    assert reservation["registry"]["readback_matched"] is True
    assert reservation["registry"]["listener_present_at_claim"] is False
    assert reservation["deployment_status"] == "reserved_not_deployed"
    assert reservation["certification_claim"] is False
    assert "--host 127.0.0.1 --port 8358" in unit

    protected_ports = {
        item["port"]
        for item in reservation["protected_existing_services"]
        if item["must_not_change"]
    }
    assert protected_ports == {8157, 8357}
    assert "--port 8157" not in unit
    assert "--port 8357" not in unit
