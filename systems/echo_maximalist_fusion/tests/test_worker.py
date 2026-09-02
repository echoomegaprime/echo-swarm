"""Invariant suite for echo-fusion-worker — the async HTTP skeleton that hosts
FusionEngine behind echo.fusion.run.

House style matches tests/test_invariants.py: async w-functions, a TESTS list, a
main() runner printing PASS/FAIL + ALL GREEN. Run: python3 tests/test_worker.py

No live providers here: the 'stub' profile wires FusionEngine with a deterministic
worker-local StubModelAdapter + the engine's own real deterministic adapters
(JsonFindingExtractor / HashEmbedder / KeywordContradictor / FakeMemory /
InMemoryStateStore), so every path is exercised end-to-end with zero external deps.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src"))

import httpx  # noqa: E402
from httpx import ASGITransport  # noqa: E402

from echo_fusion.schemas import Budget, RunState  # noqa: E402
from echo_fusion_worker.config import (SeatsConfigError, VALID_PROVIDERS,  # noqa: E402
                                       load_seats_dict, seats_fingerprint)
from echo_fusion_worker.factory import (build_engine, register_profile,  # noqa: E402
                                        clamp_budget, StubModelAdapter,
                                        MAX_CALLS_CEILING, MAX_COST_CEILING)
from echo_fusion_worker.app import create_app  # noqa: E402


def _valid_cfg() -> dict:
    return {
        "profile_default": "stub",
        "reserve_specialists": 4,
        "seats": [
            {"id": "t1_llama", "model": "llama-3.1-8b", "provider": "local", "role": "reasoner", "tier": 1},
            {"id": "t1_haiku", "model": "haiku", "provider": "anthropic", "role": "researcher", "tier": 1},
            {"id": "t1_gpt4o_mini", "model": "gpt-4o-mini", "provider": "openai", "role": "reasoner", "tier": 1},
            {"id": "t1_flash", "model": "gemini-flash", "provider": "google", "role": "critic", "tier": 1},
            {"id": "t2_opus", "model": "opus", "provider": "anthropic", "role": "reasoner", "tier": 2},
            {"id": "t2_gpt41", "model": "gpt-4.1", "provider": "openai", "role": "reasoner", "tier": 2},
            {"id": "t2_grok", "model": "grok-reasoning", "provider": "xai", "role": "critic", "tier": 2},
        ],
        "trinity": [
            {"name": "THORNE", "model": "opus", "provider": "anthropic", "role": "integrator"},
            {"name": "NYX", "model": "gpt-4.1", "provider": "openai", "role": "reasoner"},
            {"name": "SAGE", "model": "gemini-pro", "provider": "google", "role": "expander"},
        ],
        "planner_seat": {"id": "planner", "model": "gpt-4o-mini", "provider": "openai", "role": "planner"},
        "verifier_seats": [
            {"id": "v_grok", "model": "grok-reasoning", "provider": "xai", "role": "verifier"},
            {"id": "v_local", "model": "qwen", "provider": "local", "role": "verifier"},
        ],
    }


# ---- 1. seats loader: fail-closed provider-family validation (clone-swarm defense) ----
async def w01_seats_loader_accepts_valid():
    cfg = load_seats_dict(_valid_cfg())
    assert len(cfg["seats"]) == 7, "seats lost in load"
    assert cfg["planner_seat"]["provider"] == "openai"
    assert len(cfg["trinity"]) == 3


async def w02_seats_rejects_unknown_provider():
    bad = _valid_cfg()
    bad["seats"][0]["provider"] = "cohere"  # not a backend family
    try:
        load_seats_dict(bad)
    except SeatsConfigError as e:
        assert "cohere" in str(e), "error must name the offending provider"
        return
    raise AssertionError("unknown provider was accepted — clone-swarm gate is open")


async def w03_seats_rejects_missing_planner():
    bad = _valid_cfg()
    del bad["planner_seat"]
    try:
        load_seats_dict(bad)
    except SeatsConfigError:
        return
    raise AssertionError("missing planner_seat was accepted")


async def w04_seats_rejects_trinity_not_three():
    for n in (2, 4):
        bad = _valid_cfg()
        bad["trinity"] = bad["trinity"][:1] * n
        try:
            load_seats_dict(bad)
        except SeatsConfigError:
            continue
        raise AssertionError(f"trinity of {n} was accepted (must be exactly 3)")


async def w05_seats_rejects_seat_missing_field():
    bad = _valid_cfg()
    del bad["seats"][2]["model"]
    try:
        load_seats_dict(bad)
    except SeatsConfigError:
        return
    raise AssertionError("seat missing 'model' was accepted")


async def w06_valid_providers_is_exact():
    assert VALID_PROVIDERS == frozenset({"openai", "anthropic", "google", "local", "xai"})


async def w07_fingerprint_stable_and_sensitive():
    cfg = load_seats_dict(_valid_cfg())
    fp1 = seats_fingerprint(cfg)
    fp2 = seats_fingerprint(load_seats_dict(_valid_cfg()))
    assert fp1 == fp2, "fingerprint not stable for identical config"
    mut = _valid_cfg()
    mut["seats"][0]["provider"] = "openai"
    assert seats_fingerprint(load_seats_dict(mut)) != fp1, "fingerprint blind to a provider change"


# ---- 2. factory: profiles + budget clamp ----
async def w08_build_engine_stub():
    from echo_fusion.engine import FusionEngine
    eng = build_engine(load_seats_dict(_valid_cfg()), profile="stub")
    assert isinstance(eng, FusionEngine)


async def w09_register_profile_extension():
    marker = {}

    def _prof(cfg):
        marker["built"] = True
        return build_engine(cfg, profile="stub")

    register_profile("unit_probe", _prof)
    eng = build_engine(load_seats_dict(_valid_cfg()), profile="unit_probe")
    assert marker.get("built"), "registered profile builder was not invoked"
    from echo_fusion.engine import FusionEngine
    assert isinstance(eng, FusionEngine)


async def w10_build_engine_unknown_profile_fails_closed():
    try:
        build_engine(load_seats_dict(_valid_cfg()), profile="does_not_exist")
    except KeyError:
        return
    raise AssertionError("unknown profile silently accepted")


async def w11_budget_clamped_to_ceiling():
    b = clamp_budget(Budget(max_calls=99999, max_cost_usd=999.0))
    assert b.max_calls <= MAX_CALLS_CEILING, "max_calls not clamped"
    assert b.max_cost_usd <= MAX_COST_CEILING, "max_cost not clamped"


async def w12_budget_clamp_leaves_small_budget():
    b = clamp_budget(Budget(max_calls=5, max_cost_usd=0.10))
    assert b.max_calls == 5 and abs(b.max_cost_usd - 0.10) < 1e-9, "clamp altered an in-bounds budget"


async def w13_stub_model_answers_any_objective():
    m = StubModelAdapter()
    raw = await m.call(seat_id="s", model="m", role="reasoner",
                       prompt="anything at all", context={}, timeout=5.0)
    # ModelAdapter contract: a dict {"text","cost_usd"}, text = JSON the extractor parses.
    assert isinstance(raw, dict) and "text" in raw and "cost_usd" in raw
    import json
    doc = json.loads(raw["text"])
    assert doc.get("findings") or doc.get("claim"), "stub produced no parseable finding"


# ---- 3. engine seam: drive a caller-owned RunState (async worker contract) ----
async def w14_drive_state_matches_run():
    eng = build_engine(load_seats_dict(_valid_cfg()), profile="stub")
    state = RunState(objective="what is the capital of texas", budget=clamp_budget(Budget()))
    rid = state.run_id
    res = await eng.drive_state(state)
    assert res.run_id == rid, "drive_state must preserve the caller's run_id"
    assert res.answer, "drive_state produced no answer"


# ---- 4. HTTP surface (async ASGI, no network) ----
def _client(app):
    return httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


async def _mk_app():
    cfg = load_seats_dict(_valid_cfg())
    eng = build_engine(cfg, profile="stub")
    return create_app(engine=eng, profile="stub", fingerprint=seats_fingerprint(cfg))


async def w15_health_reports_profile_and_fingerprint():
    app = await _mk_app()
    async with _client(app) as c:
        r = await c.get("/health")
        assert r.status_code == 200
        j = r.json()
        assert j["ok"] is True and j["profile"] == "stub"
        assert j["seats_fingerprint"] and isinstance(j["active_runs"], int)


async def w16_run_is_async_202_then_pollable():
    app = await _mk_app()
    async with _client(app) as c:
        r = await c.post("/run", json={"objective": "summarize the alamo"})
        assert r.status_code == 202, f"run must be async 202, got {r.status_code}"
        rid = r.json()["run_id"]
        assert rid
        result = None
        for _ in range(50):
            g = await c.get(f"/runs/{rid}")
            assert g.status_code == 200
            body = g.json()
            if body["done"]:
                result = body["result"]
                break
            await asyncio.sleep(0.05)
        assert result is not None, "run never completed"
        assert result["answer"], "completed run has no answer"
        assert result["run_id"] == rid


async def w17_run_wait_true_returns_inline():
    app = await _mk_app()
    async with _client(app) as c:
        r = await c.post("/run", json={"objective": "define chain of title", "wait": True})
        assert r.status_code == 200, f"wait:true should return 200 with the result, got {r.status_code}"
        j = r.json()
        assert j["done"] and j["result"]["answer"]


async def w18_unknown_run_id_404():
    app = await _mk_app()
    async with _client(app) as c:
        g = await c.get("/runs/does-not-exist")
        assert g.status_code == 404


async def w19_idempotency_key_dedupes():
    app = await _mk_app()
    async with _client(app) as c:
        a = await c.post("/run", json={"objective": "x", "idempotency_key": "K1"})
        b = await c.post("/run", json={"objective": "x", "idempotency_key": "K1"})
        assert a.json()["run_id"] == b.json()["run_id"], "same idempotency_key spawned two runs"


async def w20_client_budget_is_clamped_server_side():
    app = await _mk_app()
    async with _client(app) as c:
        r = await c.post("/run", json={"objective": "y", "wait": True,
                                       "budget": {"max_calls": 100000, "max_cost_usd": 5000.0}})
        assert r.status_code == 200
        # the run completed under the ceiling rather than fanning out unbounded
        used = r.json()["result"]["provenance"].get("calls_spent")
        assert used is None or used <= MAX_CALLS_CEILING, "server did not clamp the client budget"


async def w21_selftest_is_green():
    app = await _mk_app()
    async with _client(app) as c:
        r = await c.post("/selftest")
        assert r.status_code == 200, f"selftest failed: {r.text[:200]}"
        j = r.json()
        assert j["ok"] is True and j["answer"], "selftest did not produce an answer"


async def w22_resume_reruns_in_process():
    app = await _mk_app()
    async with _client(app) as c:
        run = await c.post("/run", json={"objective": "resume me", "wait": True})
        rid = run.json()["run_id"]
        original_answer = run.json()["result"]["answer"]
        rr = await c.post("/resume", json={"run_id": rid})
        assert rr.status_code == 202, f"resume returned {rr.status_code}"
        assert rr.json()["run_id"] == rid
        assert rr.json()["phase"] == "resuming"
        for _ in range(100):
            result = await c.get(f"/runs/{rid}")
            if result.json()["done"]:
                break
            await asyncio.sleep(0.01)
        body = result.json()
        assert body["done"] is True, "resumed run did not complete"
        assert body["error"] is None, f"resumed run failed: {body['error']}"
        assert body["result"]["answer"] == original_answer


TESTS = [
    w01_seats_loader_accepts_valid, w02_seats_rejects_unknown_provider,
    w03_seats_rejects_missing_planner, w04_seats_rejects_trinity_not_three,
    w05_seats_rejects_seat_missing_field, w06_valid_providers_is_exact,
    w07_fingerprint_stable_and_sensitive, w08_build_engine_stub,
    w09_register_profile_extension, w10_build_engine_unknown_profile_fails_closed,
    w11_budget_clamped_to_ceiling, w12_budget_clamp_leaves_small_budget,
    w13_stub_model_answers_any_objective, w14_drive_state_matches_run,
    w15_health_reports_profile_and_fingerprint, w16_run_is_async_202_then_pollable,
    w17_run_wait_true_returns_inline, w18_unknown_run_id_404,
    w19_idempotency_key_dedupes, w20_client_budget_is_clamped_server_side,
    w21_selftest_is_green, w22_resume_reruns_in_process,
]


async def main():
    fails = 0
    for t in TESTS:
        try:
            await t()
            print("PASS", t.__name__)
        except Exception as e:  # noqa: BLE001
            fails += 1
            import traceback
            print("FAIL", t.__name__, "::", repr(e))
            traceback.print_exc()
    print("")
    print("ALL GREEN" if not fails else f"{fails}/{len(TESTS)} FAILING")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
