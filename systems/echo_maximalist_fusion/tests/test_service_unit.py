"""Static deployment contract for the reconstructed Fusion worker unit."""

from pathlib import Path


UNIT = Path(__file__).resolve().parents[1] / "deploy" / "echo-fusion-worker.service"


def test_service_unit_is_profile_bound_and_state_isolated() -> None:
    unit = UNIT.read_text(encoding="utf-8")

    assert "Environment=FUSION_PROFILE=reconstructed_v03" in unit
    assert "Environment=MAXIMALIST_SDK_BASE_URL=http://127.0.0.1:8000" in unit
    assert "Environment=FUSION_GATE_BASE=http://127.0.0.1:8000" in unit
    assert (
        "Environment=MAXIMALIST_STATE_DIR=/var/lib/echo/maximalist-reconstructed-v03"
        in unit
    )
    assert (
        "Environment=MAXIMALIST_MEMORY_FILE="
        "/var/lib/echo/maximalist-reconstructed-v03/memory.json"
    ) in unit
    assert "StateDirectory=echo/maximalist-reconstructed-v03" in unit
    assert "StateDirectoryMode=0750" in unit
    assert (
        "ExecStart=/home/forge/echo-maximalist-swarm/.venv/bin/python -m uvicorn "
        "echo_fusion_worker.app:app --host 127.0.0.1 --port 8157 --log-level info"
    ) in unit


def test_service_unit_does_not_expose_the_worker_to_the_network() -> None:
    unit = UNIT.read_text(encoding="utf-8")

    assert "--host 0.0.0.0" not in unit
    assert "--host ::" not in unit
