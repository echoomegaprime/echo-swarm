"""Static deployment contract for the reconstructed Fusion worker unit."""

from pathlib import Path


UNIT = Path(__file__).resolve().parents[1] / "deploy" / "echo-fusion-worker.service"


def test_service_unit_is_profile_bound_and_state_isolated() -> None:
    unit = UNIT.read_text(encoding="utf-8")

    assert "Environment=FUSION_PROFILE=reconstructed_v06" in unit
    assert "Environment=MAXIMALIST_SDK_BASE_URL=http://127.0.0.1:8000" in unit
    assert "Environment=FUSION_GATE_BASE=http://127.0.0.1:8000" in unit
    assert (
        "Environment=MAXIMALIST_STATE_DIR=/var/lib/echo/maximalist-reconstructed-v06"
        in unit
    )
    assert (
        "Environment=MAXIMALIST_MEMORY_FILE="
        "/var/lib/echo/maximalist-reconstructed-v06/memory.json"
    ) in unit
    assert (
        "Environment=MAXIMALIST_PERFORMANCE_FILE="
        "/var/lib/echo/maximalist-reconstructed-v06/performance.json"
    ) in unit
    assert "Environment=MAXIMALIST_ROUTING_POLICY=full_40" in unit
    assert "Environment=MAXIMALIST_ROUTING_MAX_SEATS=40" in unit
    assert "Environment=MAXIMALIST_CAPABILITY_PROFILE=echo_full_read_personality" in unit
    assert "Environment=MAXIMALIST_MAX_CAPABILITY_CALLS=12" in unit
    assert "Environment=MAXIMALIST_MAX_WALL_SECONDS=600" in unit
    assert "Environment=PERSONALITY_FORGE_BASE_URL=http://127.0.0.1:18420" in unit
    assert (
        "Environment=PERSONALITY_FORGE_EXPECTED_COMMIT="
        "a0907f5da9f624dde4406cfd4d371e6497372654"
    ) in unit
    assert (
        "Environment=PERSONALITY_FORGE_EXPECTED_RELEASE="
        "20260804T084943Z-86b01e275844"
    ) in unit
    assert (
        "Environment=PERSONALITY_FORGE_EXPECTED_RUNTIME_ENV="
        "py312-torch2.11.0-cu128-bnb0.50.1"
    ) in unit
    assert "Environment=PERSONALITY_FORGE_MODEL=echo-gs343" in unit
    assert "StateDirectory=echo/maximalist-reconstructed-v06" in unit
    assert "StateDirectoryMode=0750" in unit
    assert (
        "ExecStart=/home/forge/echo-maximalist-swarm/.venv/bin/python -m uvicorn "
        "echo_fusion_worker.app:app --host 127.0.0.1 --port 8157 --log-level info"
    ) in unit


def test_service_unit_does_not_expose_the_worker_to_the_network() -> None:
    unit = UNIT.read_text(encoding="utf-8")

    assert "--host 0.0.0.0" not in unit
    assert "--host ::" not in unit
