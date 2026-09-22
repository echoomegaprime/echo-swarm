import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from echo_fusion.arbitration import merge_replication, score_clusters
from echo_fusion.schemas import Budget, Evidence, EvidenceKind, Finding, VerifyStatus
from echo_fusion_worker import live_adapters
from echo_fusion_worker.app import create_app
from echo_fusion_worker.factory import clamp_budget
from echo_fusion_worker.idempotency import (
    IdempotencyStore,
    IdempotencyStoreError,
    request_sha256,
    seed_completed_run,
)


class _Result:
    def __init__(self, run_id: str) -> None:
        self.run_id = run_id
        self.confidence = 1.0
        self.abstained = False

    def model_dump(self, *, mode: str) -> dict:
        assert mode == "json"
        return {"run_id": self.run_id, "answer": "already fused"}


class _DurableProbeEngine:
    def __init__(self, durable: dict[str, dict], store: IdempotencyStore) -> None:
        self.durable = durable
        self.store = store
        self.created = 0
        self.driven = 0
        self.key = "restart-key"
        self.request_digest = ""

    def create_state(
        self, objective: str, context: dict, budget: Budget
    ) -> SimpleNamespace:
        del objective, context, budget
        self.created += 1
        return SimpleNamespace(run_id=f"run_{self.created:032x}")

    async def drive_state(self, state: SimpleNamespace) -> _Result:
        self.driven += 1
        assert self.store.lookup(self.key, self.request_digest) == state.run_id
        result = _Result(state.run_id)
        self.durable[state.run_id] = {
            "phase": "done",
            "done": True,
            "result": result.model_dump(mode="json"),
            "error": None,
        }
        return result

    def get_run(self, run_id: str) -> dict | None:
        return self.durable.get(run_id)


def test_replication_does_not_merge_across_subproblems() -> None:
    shared_prefix = "same eighty-character prefix " * 4
    first = Finding(claim=f"{shared_prefix}alpha", subproblem="legal", seat_id="seat_a")
    second = Finding(
        claim=f"{shared_prefix}beta", subproblem="technical", seat_id="seat_b"
    )
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
        store = IdempotencyStore()
        app = create_app(
            engine=object(),  # type: ignore[arg-type]
            profile="test",
            fingerprint="test",
            idempotency_store=store,
        )
        run_id = "run_00000000000000000000000000000001"
        budget = clamp_budget(Budget())
        app.state.runs[run_id] = {
            "phase": "done",
            "done": True,
            "result": {"answer": "already fused"},
            "error": None,
        }
        digest = request_sha256(objective="same objective", context={}, budget=budget)
        store.bind("retry-key", digest, run_id)
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test"
        ) as client:
            response = await client.post(
                "/run",
                json={
                    "objective": "same objective",
                    "wait": True,
                    "idempotency_key": "retry-key",
                },
            )

        assert response.status_code == 200
        assert response.json() == {
            "run_id": run_id,
            "phase": "done",
            "done": True,
            "result": {"answer": "already fused"},
        }

    asyncio.run(exercise())


def test_idempotency_survives_restart_and_is_committed_before_drive(
    tmp_path: Path,
) -> None:
    async def exercise() -> None:
        path = tmp_path / "idempotency.v1.json"
        durable: dict[str, dict] = {}
        first_store = IdempotencyStore(path)
        first_engine = _DurableProbeEngine(durable, first_store)
        budget = clamp_budget(Budget())
        first_engine.request_digest = request_sha256(
            objective="restart safe", context={}, budget=budget
        )
        first = create_app(
            engine=first_engine,
            profile="test",
            fingerprint="test",
            idempotency_store=first_store,
        )
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=first), base_url="http://test"
        ) as client:
            response = await client.post(
                "/run",
                json={
                    "objective": "restart safe",
                    "wait": True,
                    "idempotency_key": "restart-key",
                },
            )
        assert response.status_code == 200
        run_id = response.json()["run_id"]
        assert path.is_file()

        restarted_store = IdempotencyStore(path)
        restarted_engine = _DurableProbeEngine(durable, restarted_store)
        restarted_engine.request_digest = first_engine.request_digest
        restarted = create_app(
            engine=restarted_engine,
            profile="test",
            fingerprint="test",
            idempotency_store=restarted_store,
        )
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=restarted), base_url="http://test"
        ) as client:
            retry = await client.post(
                "/run",
                json={
                    "objective": "restart safe",
                    "wait": True,
                    "idempotency_key": "restart-key",
                },
            )
        assert retry.status_code == 200
        assert retry.json()["run_id"] == run_id
        assert restarted_engine.created == 0
        assert restarted_engine.driven == 0

    asyncio.run(exercise())


def test_concurrent_same_key_creates_exactly_one_run(tmp_path: Path) -> None:
    async def exercise() -> None:
        store = IdempotencyStore(tmp_path / "idempotency.v1.json")
        durable: dict[str, dict] = {}
        engine = _DurableProbeEngine(durable, store)
        engine.request_digest = request_sha256(
            objective="one run", context={}, budget=clamp_budget(Budget())
        )
        app = create_app(
            engine=engine,
            profile="test",
            fingerprint="test",
            idempotency_store=store,
        )
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            responses = await asyncio.gather(
                *[
                    client.post(
                        "/run",
                        json={"objective": "one run", "idempotency_key": "restart-key"},
                    )
                    for _ in range(20)
                ]
            )
        assert {response.status_code for response in responses} == {202}
        assert len({response.json()["run_id"] for response in responses}) == 1
        await asyncio.sleep(0)
        assert engine.created == 1
        assert engine.driven == 1

    asyncio.run(exercise())


def test_idempotency_key_reuse_with_different_request_is_rejected() -> None:
    async def exercise() -> None:
        store = IdempotencyStore()
        engine = _DurableProbeEngine({}, store)
        engine.request_digest = request_sha256(
            objective="first", context={}, budget=clamp_budget(Budget())
        )
        app = create_app(
            engine=engine,
            profile="test",
            fingerprint="test",
            idempotency_store=store,
        )
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            first = await client.post(
                "/run", json={"objective": "first", "idempotency_key": "restart-key"}
            )
            conflict = await client.post(
                "/run", json={"objective": "second", "idempotency_key": "restart-key"}
            )
        assert first.status_code == 202
        assert conflict.status_code == 409
        assert engine.created == 1

    asyncio.run(exercise())


def test_corrupt_idempotency_state_fails_closed(tmp_path: Path) -> None:
    path = tmp_path / "idempotency.v1.json"
    path.write_text('{"schema":"wrong","entries":{}}\n', encoding="utf-8")
    with pytest.raises(IdempotencyStoreError, match="provenance or schema"):
        IdempotencyStore(path)


def test_dangling_persistent_mapping_fails_closed(tmp_path: Path) -> None:
    async def exercise() -> None:
        store = IdempotencyStore(tmp_path / "idempotency.v1.json")
        digest = request_sha256(
            objective="missing", context={}, budget=clamp_budget(Budget())
        )
        store.bind("restart-key", digest, "run_00000000000000000000000000000001")
        app = create_app(
            engine=_DurableProbeEngine({}, store),
            profile="test",
            fingerprint="test",
            idempotency_store=store,
        )
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/run", json={"objective": "missing", "idempotency_key": "restart-key"}
            )
        assert response.status_code == 503

    asyncio.run(exercise())


def test_incomplete_restart_mapping_requires_explicit_resume(tmp_path: Path) -> None:
    async def exercise() -> None:
        store = IdempotencyStore(tmp_path / "idempotency.v1.json")
        digest = request_sha256(
            objective="partial", context={}, budget=clamp_budget(Budget())
        )
        run_id = "run_00000000000000000000000000000001"
        store.bind("restart-key", digest, run_id)
        durable = {
            run_id: {
                "phase": "first_pass",
                "done": False,
                "result": None,
                "error": None,
            }
        }
        engine = _DurableProbeEngine(durable, store)
        app = create_app(
            engine=engine,
            profile="test",
            fingerprint="test",
            idempotency_store=store,
        )
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/run", json={"objective": "partial", "idempotency_key": "restart-key"}
            )
        assert response.status_code == 409
        assert "explicit resume" in response.json()["detail"]
        assert engine.created == 0
        assert engine.driven == 0

    asyncio.run(exercise())


def test_failed_idempotency_commit_schedules_no_provider_work(tmp_path: Path) -> None:
    async def exercise() -> None:
        store = IdempotencyStore(tmp_path / "idempotency.v1.json")

        def fail_commit() -> None:
            raise IdempotencyStoreError("simulated atomic commit failure")

        store._persist = fail_commit  # type: ignore[method-assign]
        engine = _DurableProbeEngine({}, store)
        app = create_app(
            engine=engine,
            profile="test",
            fingerprint="test",
            idempotency_store=store,
        )
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/run",
                json={"objective": "no dispatch", "idempotency_key": "restart-key"},
            )
        await asyncio.sleep(0)
        assert response.status_code == 503
        assert engine.created == 1
        assert engine.driven == 0
        assert app.state.runs == {}
        assert store.entry_count == 0

    asyncio.run(exercise())


def test_store_file_contains_only_hashed_key(tmp_path: Path) -> None:
    path = tmp_path / "idempotency.v1.json"
    store = IdempotencyStore(path)
    digest = request_sha256(objective="safe", context={}, budget=clamp_budget(Budget()))
    store.bind("do-not-persist-raw", digest, "run_00000000000000000000000000000001")
    document = json.loads(path.read_text(encoding="utf-8"))
    raw = path.read_text(encoding="utf-8")
    assert "do-not-persist-raw" not in raw
    assert len(document["entries"]) == 1


def test_seed_completed_run_is_restart_safe_and_idempotent(tmp_path: Path) -> None:
    run_id = "run_00000000000000000000000000000001"
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    checkpoint = {
        "profile": "MAXIMALIST_RECONSTRUCTED",
        "historical_parity": False,
        "run_id": run_id,
        "status": "completed",
        "result": {"run_id": run_id, "answer": "verified"},
    }
    (state_dir / f"{run_id}.json").write_text(json.dumps(checkpoint), encoding="utf-8")
    request = {
        "objective": "seed verified",
        "context": {"verification": True},
        "budget": {"max_calls": 120, "max_cost_usd": 5.0, "max_wall_s": 4800.0},
    }
    store_path = tmp_path / "idempotency.v1.json"
    first = seed_completed_run(
        store_path=store_path,
        state_dir=state_dir,
        run_id=run_id,
        key="seed-key",
        request=request,
    )
    second = seed_completed_run(
        store_path=store_path,
        state_dir=state_dir,
        run_id=run_id,
        key="seed-key",
        request=request,
    )
    assert first["seeded"] is True
    assert second["seeded"] is False
    assert IdempotencyStore(store_path).entry_count == 1


def test_seed_rejects_incomplete_run(tmp_path: Path) -> None:
    run_id = "run_00000000000000000000000000000001"
    checkpoint = {
        "profile": "MAXIMALIST_RECONSTRUCTED",
        "historical_parity": False,
        "run_id": run_id,
        "status": "running",
        "result": None,
    }
    (tmp_path / f"{run_id}.json").write_text(json.dumps(checkpoint), encoding="utf-8")
    with pytest.raises(IdempotencyStoreError, match="not a completed"):
        seed_completed_run(
            store_path=tmp_path / "idempotency.v1.json",
            state_dir=tmp_path,
            run_id=run_id,
            key="seed-key",
            request={
                "objective": "seed rejected",
                "context": {},
                "budget": {
                    "max_calls": 120,
                    "max_cost_usd": 5.0,
                    "max_wall_s": 4800.0,
                },
            },
        )


def test_gate_key_loader_accepts_whitespace(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    key_path = tmp_path / "sovereign.env"
    key_path.write_text(
        "COMMENT=value\n SOVEREIGN_KEY = test-only-key \n", encoding="utf-8"
    )
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
