import asyncio
from pathlib import Path

import httpx
import pytest

from echo_fusion.arbitration import merge_replication, score_clusters
from echo_fusion.schemas import Evidence, EvidenceKind, Finding, VerifyStatus
from echo_fusion_worker import live_adapters
from echo_fusion_worker.app import create_app


def test_replication_does_not_merge_across_subproblems() -> None:
    shared_prefix = "same eighty-character prefix " * 4
    first = Finding(claim=f"{shared_prefix}alpha", subproblem="legal", seat_id="seat_a")
    second = Finding(claim=f"{shared_prefix}beta", subproblem="technical", seat_id="seat_b")
    merged = merge_replication([first, second])
    assert [(finding.subproblem, finding.claim) for finding in merged] == [
        ("legal", first.claim),
        ("technical", second.claim),
    ]


def test_cluster_representative_prefers_best_corroborated_finding() -> None:
    weak = Finding(
        claim="shared truth",
        subproblem="critique",
        seat_id="seat_c",
        evidence=[Evidence(kind=EvidenceKind.REPLICATION, locator="seat_d")],
    )
    strong = Finding(
        claim="shared truth",
        subproblem="primary",
        seat_id="seat_a",
        evidence=[
            Evidence(kind=EvidenceKind.REPLICATION, locator="seat_b"),
            Evidence(kind=EvidenceKind.REPLICATION, locator="seat_c"),
        ],
    )

    ranked = score_clusters([[weak, strong]], {})

    assert ranked[0][0][0] is strong


def test_idempotent_wait_retry_returns_completed_result() -> None:
    async def exercise() -> None:
        app = create_app(engine=object(), profile="test", fingerprint="test")  # type: ignore[arg-type]
        run_id = "run_retry"
        app.state.runs[run_id] = {
            "phase": "done",
            "done": True,
            "result": {"answer": "already fused"},
            "error": None,
        }
        app.state.idem["retry-key"] = run_id
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/run",
                json={"objective": "same objective", "wait": True, "idempotency_key": "retry-key"},
            )

        assert response.status_code == 200
        assert response.json() == {
            "run_id": run_id,
            "phase": "done",
            "done": True,
            "result": {"answer": "already fused"},
        }

    asyncio.run(exercise())


def test_gate_key_loader_accepts_whitespace(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    key_path = tmp_path / "sovereign.env"
    key_path.write_text("COMMENT=value\n SOVEREIGN_KEY = test-only-key \n", encoding="utf-8")
    monkeypatch.setattr(live_adapters, "KEY_FILE", str(key_path))

    assert live_adapters._GateClient()._load_key() == "test-only-key"


def test_unverified_external_evidence_is_capped() -> None:
    unverified = Evidence(kind=EvidenceKind.CITATION, locator="doi:test")
    verified = Evidence(
        kind=EvidenceKind.CITATION,
        locator="doi:test",
        status=VerifyStatus.VERIFIED,
    )
    contradicted = Evidence(
        kind=EvidenceKind.CITATION,
        locator="doi:test",
        status=VerifyStatus.CONTRADICTED,
    )

    assert unverified.reliability() == 0.45
    assert verified.reliability() == 1.0
    assert contradicted.reliability() < unverified.reliability()
