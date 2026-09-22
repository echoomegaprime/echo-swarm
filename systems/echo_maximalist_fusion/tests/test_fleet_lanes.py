"""fleet_live: heterogeneous roster over gate-brokered lanes (no network in these tests)."""
from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
CORE_WHEEL = (REPO_ROOT / "systems" / "maximalist_reconstructed_core" / "vendor"
              / "maximalist_reconstructed-0.5.3-py3-none-any.whl")
sys.path.insert(0, str(CORE_WHEEL))
sys.path.insert(0, str(REPO_ROOT / "systems" / "echo_maximalist_fusion" / "src"))

from maximalist_reconstructed.providers import ProviderError, ProviderRequest  # noqa: E402

from echo_fusion_worker import fleet_lanes  # noqa: E402
from echo_fusion_worker.portable_core import PortableCoreEngine  # noqa: E402

LANES = [
    ("openrouter", "anthropic/claude-opus-4-8", 15.0, 75.0),
    ("openrouter", "google/gemini-3.5-flash", 0.3, 2.5),
    ("fireworks", "accounts/fireworks/models/kimi-k2p6", 15.0, 75.0),
    ("together", "meta-llama/Llama-3.3-70B-Instruct-Turbo", 0.88, 0.88),
    ("together", "Qwen/Qwen2.5-72B-Instruct-Turbo", 1.2, 1.2),
    ("cloudflare", "@cf/nvidia/nemotron-3-120b-a12b", 15.0, 75.0),
    ("sambanova", "Meta-Llama-3.3-70B-Instruct", 0.6, 1.2),
    ("ollama-local-forge", "echo.qwen.local.openai_chat", 0.0, 0.0),
]


def _roster(tmp_path: Path, *, age_seconds: float = 0.0) -> Path:
    lanes = []
    for provider, model, rate_in, rate_out in LANES:
        lanes.append({"ref": fleet_lanes.lane_ref(provider, model), "provider": provider, "model": model,
                      "family": fleet_lanes.model_family(provider, model), "input_usd_per_million": rate_in,
                      "output_usd_per_million": rate_out,
                      "pricing_source": "local_zero_cost" if rate_in == 0 else "published_per_token",
                      "latency_ms": 900})
    document = {"schema": fleet_lanes.ROSTER_SCHEMA, "generated_at": time.time() - age_seconds,
                "lanes": lanes, "trinity": [lanes[0]["ref"], lanes[1]["ref"], lanes[2]["ref"]],
                "planner": lanes[3]["ref"]}
    path = tmp_path / "roster.json"
    path.write_text(json.dumps(document), encoding="utf-8")
    return path


def test_model_families_are_classified_by_model_not_router() -> None:
    assert fleet_lanes.model_family("openrouter", "anthropic/claude-opus-4-8") == "anthropic"
    assert fleet_lanes.model_family("openrouter", "google/gemini-3.5-flash") == "google"
    assert fleet_lanes.model_family("together", "meta-llama/Llama-3.3-70B-Instruct-Turbo") == "meta"
    assert fleet_lanes.model_family("sambanova", "Meta-Llama-3.3-70B-Instruct") == "meta"
    assert fleet_lanes.model_family("groq", "openai/gpt-oss-20b") == "openai"
    assert fleet_lanes.model_family("fireworks", "accounts/fireworks/models/kimi-k2p6") == "moonshot"
    assert fleet_lanes.model_family("together", "deepcogito/cogito-v1-preview-qwen-32B") == "qwen"


def test_pricing_parses_per_token_per_million_local_and_unpriced() -> None:
    assert fleet_lanes.lane_pricing({"pricing_json": json.dumps({"prompt": "0.000001", "completion": "0.000005"})}) == (
        1.0, 5.0, "published_per_token")
    assert fleet_lanes.lane_pricing({"pricing_json": {"input": 0.88, "output": 0.88}}) == (0.88, 0.88, "published_per_million")
    assert fleet_lanes.lane_pricing({"provider": "ollama-local-forge", "pricing_json": None})[2] == "local_zero_cost"
    rate_in, rate_out, source = fleet_lanes.lane_pricing({"provider": "cloudflare", "pricing_json": None})
    assert source == "unpriced_conservative_estimate" and rate_in > 0 and rate_out > rate_in


def test_registry_seats_forty_across_distinct_families(tmp_path: Path) -> None:
    roster = fleet_lanes.FleetRoster.load(_roster(tmp_path))
    registry = fleet_lanes.fleet_registry(roster)
    families = [seat.provider_family for seat in registry.seats]
    assert len(registry.seats) == 40
    assert len(set(families)) == len({lane["family"] for lane in roster.lanes})
    assert max(families.count(f) for f in set(families)) - min(families.count(f) for f in set(families)) <= 8
    assert all(seat.independence_group == seat.provider_family for seat in registry.seats)
    assert len({seat.provider_family for seat in registry.trinity}) == 3
    assert not ({s.id for s in registry.seats} & {s.id for s in registry.trinity})
    assert registry.planner.model == roster.planner


def test_roster_rejects_clone_rosters_and_dangling_trinity(tmp_path: Path) -> None:
    path = _roster(tmp_path)
    data = json.loads(path.read_text())
    data["lanes"] = [lane for lane in data["lanes"] if lane["family"] == "meta"]
    path.write_text(json.dumps(data))
    with pytest.raises(ValueError, match="three distinct model families"):
        fleet_lanes.FleetRoster.load(path)


def test_probe_is_roster_bound_and_expires(tmp_path: Path, monkeypatch) -> None:
    fresh = fleet_lanes.FleetRoster.load(_roster(tmp_path))
    adapter = fleet_lanes.FleetGateAdapter(fresh)
    ref = fresh.lanes[0]["ref"]
    assert asyncio.run(adapter.probe(ref)) is True
    assert asyncio.run(adapter.probe("nope::missing")) is False
    stale = fleet_lanes.FleetRoster.load(_roster(tmp_path, age_seconds=48 * 3600))
    assert asyncio.run(fleet_lanes.FleetGateAdapter(stale).probe(ref)) is False


def test_cost_table_prices_every_seat(tmp_path: Path) -> None:
    roster = fleet_lanes.FleetRoster.load(_roster(tmp_path))
    costs = roster.cost_table()
    for seat in fleet_lanes.fleet_registry(roster).seats:
        assert costs.estimate(seat.provider, seat.model, 1000, 1000) is not None


class _FakeGate:
    def __init__(self, body: dict) -> None:
        self.body, self.calls = body, []

    async def invoke(self, capability, params, *, reason, timeout=None):
        self.calls.append((capability, params, reason))
        return self.body


def _request(model: str, phase: str = "independent_pass") -> ProviderRequest:
    return ProviderRequest(provider="fleet_gate", seat_id="seat_01", model=model, role="critic",
                           prompt="Q", context={}, phase=phase, max_output_tokens=256)


def test_adapter_routes_the_exact_lane_and_reports_usage(tmp_path: Path) -> None:
    roster = fleet_lanes.FleetRoster.load(_roster(tmp_path))
    gate = _FakeGate({"ok": True, "text": "answer", "usage": {"prompt_tokens": 12, "completion_tokens": 7}})
    adapter = fleet_lanes.FleetGateAdapter(roster, gate=gate)
    completion = asyncio.run(adapter.complete(_request("together::meta-llama/Llama-3.3-70B-Instruct-Turbo")))
    capability, params, _ = gate.calls[0]
    assert capability == "echo.llm.call"
    assert params["provider"] == "together" and params["model"] == "meta-llama/Llama-3.3-70B-Instruct-Turbo"
    assert params["max_tokens"] == 256
    assert (completion.text, completion.input_tokens, completion.output_tokens) == ("answer", 12, 7)


def test_adapter_failures_raise_provider_errors(tmp_path: Path) -> None:
    roster = fleet_lanes.FleetRoster.load(_roster(tmp_path))
    with pytest.raises(ProviderError, match="429"):
        asyncio.run(fleet_lanes.FleetGateAdapter(roster, gate=_FakeGate({"ok": False, "error": "HTTP 429"}))
                    .complete(_request(roster.lanes[0]["ref"])))
    with pytest.raises(ProviderError, match="no text"):
        asyncio.run(fleet_lanes.FleetGateAdapter(roster, gate=_FakeGate({"ok": True, "text": " "}))
                    .complete(_request(roster.lanes[0]["ref"])))
    with pytest.raises(ProviderError, match="must be"):
        asyncio.run(fleet_lanes.FleetGateAdapter(roster, gate=_FakeGate({"ok": True, "text": "x"}))
                    .complete(_request("no-separator")))


def test_trinity_phase_asks_for_the_candidate_schema(tmp_path: Path) -> None:
    roster = fleet_lanes.FleetRoster.load(_roster(tmp_path))
    gate = _FakeGate({"ok": True, "text": "{}"})
    asyncio.run(fleet_lanes.FleetGateAdapter(roster, gate=gate).complete(_request(roster.trinity[0], "trinity")))
    assert "supported_claims" in gate.calls[0][1]["prompt"] and gate.calls[0][1]["temperature"] == 0


def test_portable_core_fleet_runtime_is_heterogeneous(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("MAXIMALIST_FLEET_ROSTER", str(_roster(tmp_path)))
    runtime = PortableCoreEngine(runtime="fleet_live", state_dir=tmp_path / "state")
    meta = runtime.metadata
    assert meta["runtime"] == "fleet_live" and meta["configured_seat_count"] == 40
    assert meta["seat_model_families"] >= 6 and meta["seat_distinct_models"] == len(LANES)
    assert runtime.providers.adapter_for("fleet_gate") is not None
    assert runtime.providers.adapter_for("anvil_ollama") is None
    policy = runtime._policy(type("B", (), {"max_calls": 120, "max_cost_usd": 5, "max_wall_s": 1200})())  # noqa: SLF001
    assert policy.provider_concurrency == {"fleet_gate": 8} and policy.max_estimated_cost_usd == 5


def test_anvil_runtime_reports_its_clone_topology(tmp_path: Path) -> None:
    meta = PortableCoreEngine(runtime="anvil_live", state_dir=tmp_path).metadata
    assert meta["seat_distinct_models"] == 3 and meta["fleet_roster_age_hours"] is None


def test_router_aliases_are_not_seated_and_reselect_rederives(tmp_path: Path) -> None:
    assert fleet_lanes._ROUTER_ALIAS.search("openrouter/free")  # noqa: SLF001
    assert fleet_lanes._ROUTER_ALIAS.search("openrouter/auto")  # noqa: SLF001
    assert not fleet_lanes._ROUTER_ALIAS.search("google/gemini-3.5-flash")  # noqa: SLF001
    assert fleet_lanes.model_family("together", "thinkingmachines/Inkling") == "thinkingmachines"
    path = _roster(tmp_path)
    data = json.loads(path.read_text())
    data["lanes"].append({"ref": "openrouter::openrouter/free", "provider": "openrouter", "model": "openrouter/free",
                          "family": "other:openrouter", "input_usd_per_million": 0, "output_usd_per_million": 0,
                          "pricing_source": "published_per_token", "latency_ms": 100})
    path.write_text(json.dumps(data))
    document = fleet_lanes.reselect_roster(path)
    assert all("openrouter/free" not in lane["ref"] for lane in document["lanes"])
    roster = fleet_lanes.FleetRoster.load(path)
    assert len({roster.lane(ref)["family"] for ref in roster.trinity}) == 3


def test_trinity_prefers_strongest_published_lane_under_the_cap() -> None:
    lanes = [
        {"ref": "a::claude-fable", "model": "anthropic/claude-fable-5", "family": "anthropic",
         "input_usd_per_million": 10, "output_usd_per_million": 50, "pricing_source": "published_per_token"},
        {"ref": "a::claude-opus", "model": "anthropic/claude-opus-4.8", "family": "anthropic",
         "input_usd_per_million": 5, "output_usd_per_million": 25, "pricing_source": "published_per_token"},
        {"ref": "c::gemma", "model": "@cf/gemma-27b", "family": "google",
         "input_usd_per_million": 15, "output_usd_per_million": 75, "pricing_source": "unpriced_conservative_estimate"},
        {"ref": "o::gemini", "model": "google/gemini-3.5-flash", "family": "google",
         "input_usd_per_million": 1.5, "output_usd_per_million": 9, "pricing_source": "published_per_token"},
        {"ref": "o::gpt-luna", "model": "openai/gpt-5.6-luna", "family": "openai",
         "input_usd_per_million": 1, "output_usd_per_million": 6, "pricing_source": "published_per_token"},
        {"ref": "o::gpt-mini", "model": "openai/gpt-4.1-mini", "family": "openai",
         "input_usd_per_million": 0.4, "output_usd_per_million": 1.6, "pricing_source": "published_per_token"},
    ]
    trinity, planner = fleet_lanes.select_trinity_and_planner(lanes)
    assert set(trinity) == {"a::claude-opus", "o::gemini", "o::gpt-luna"}
    assert planner == "o::gpt-mini"


def test_silent_router_fallback_is_rejected(tmp_path: Path) -> None:
    roster = fleet_lanes.FleetRoster.load(_roster(tmp_path))
    gate = _FakeGate({"ok": True, "text": "answer", "provider": "openrouter", "model": "openrouter/free"})
    with pytest.raises(ProviderError, match="instead of openrouter/anthropic/claude-opus-4-8"):
        asyncio.run(fleet_lanes.FleetGateAdapter(roster, gate=gate).complete(
            _request("openrouter::anthropic/claude-opus-4-8")))
    assert gate.calls[0][1]["allow_reroute"] is False
    same = _FakeGate({"ok": True, "text": "ok", "provider": "openrouter", "model": "anthropic/claude-opus-4-8"})
    assert asyncio.run(fleet_lanes.FleetGateAdapter(roster, gate=same).complete(
        _request("openrouter::anthropic/claude-opus-4-8"))).text == "ok"


def test_trinity_skips_tiny_models_and_ranks_by_strength() -> None:
    lanes = [
        {"ref": "t::qwen-1.5b", "model": "arize-ai/qwen-2-1.5b-instruct", "family": "qwen",
         "input_usd_per_million": 0.1, "output_usd_per_million": 0.1, "pricing_source": "published_per_token"},
        {"ref": "o::luna", "model": "gpt-5.6-luna", "family": "openai",
         "input_usd_per_million": 1, "output_usd_per_million": 6, "pricing_source": "published_per_token"},
        {"ref": "r::ultra", "model": "nvidia/nemotron-3-ultra-550b-a55b:free", "family": "nvidia",
         "input_usd_per_million": 0, "output_usd_per_million": 0, "pricing_source": "published_per_token"},
        {"ref": "c::llama70", "model": "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "family": "meta",
         "input_usd_per_million": 15, "output_usd_per_million": 75, "pricing_source": "unpriced_conservative_estimate"},
        {"ref": "c::oss", "model": "@cf/openai/gpt-oss-120b", "family": "openai",
         "input_usd_per_million": 15, "output_usd_per_million": 75, "pricing_source": "unpriced_conservative_estimate"},
    ]
    trinity, _ = fleet_lanes.select_trinity_and_planner(lanes)
    assert trinity == ["o::luna", "r::ultra", "c::llama70"]
    assert fleet_lanes.lane_strength(lanes[0]) <= 30


def test_token_cap_compliance_excludes_uncapped_reasoning_lanes() -> None:
    cap = fleet_lanes.CANARY_MAX_TOKENS
    assert fleet_lanes.honors_token_cap({"usage": {"completion_tokens": cap}, "text": "READY ..."}, cap)
    assert not fleet_lanes.honors_token_cap({"usage": {"completion_tokens": 2926}, "text": "READY"}, cap)
    assert fleet_lanes.honors_token_cap({"text": "READY " * 50}, cap)
    assert not fleet_lanes.honors_token_cap({"text": "x" * 8000}, cap)


def test_list_price_estimates_replace_the_flat_guess_for_known_providers() -> None:
    assert fleet_lanes.lane_pricing({"provider": "cloudflare", "model_id": "@cf/meta/llama-3.3-70b"}) == (
        0.5, 3.0, "provider_list_estimate")
    assert fleet_lanes.lane_pricing({"provider": "openai", "model_id": "gpt-4o"})[:2] == (2.5, 10.0)
    assert fleet_lanes.lane_pricing({"provider": "openai", "model_id": "gpt-4o-mini"})[:2] == (0.15, 0.6)
    assert fleet_lanes.lane_pricing({"provider": "mystery", "model_id": "x"})[2] == "unpriced_conservative_estimate"
