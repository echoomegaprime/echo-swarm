"""FLEET_LIVE runtime: a heterogeneous 40-seat roster over gate-brokered LLM lanes.

``anvil_live`` seats all 40 positions on one Ollama node running three small Qwen
models, so every "independent" seat shares a model family and the arbitration
agreement signal rewards clones. ``fleet_live`` instead seats the roster across
distinct model families reached through the FORGE SDK gate's ``echo.llm.call``
router (credentials stay brokered by the gate; this worker never holds a
provider key).

The roster is a file produced by ``python -m echo_fusion_worker.fleet_lanes build``:
it discovers live lanes with ``echo.llm.list``, canaries each candidate with a
16-token probe, keeps the lanes that answer, and records pricing so the core's
budget policy can bound every run. Seat readiness (``probe``) is answered from
that roster, never by spending on a live call during ``/health``.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, ClassVar

import httpx

from maximalist_reconstructed import CostTable, ProviderRegistry
from maximalist_reconstructed.config import ROLE_FAMILIES, SeatConfig, SeatRegistry
from maximalist_reconstructed.control import PricingRate
from maximalist_reconstructed.providers import ProviderCompletion, ProviderError, ProviderRequest

FLEET_PROVIDER = "fleet_gate"
LANE_SEPARATOR = "::"
ROSTER_SCHEMA = "echo.maximalist.fleet-roster.v1"
DEFAULT_ROSTER_PATH = "/var/lib/echo/maximalist-fleet/roster.json"
DEFAULT_GATE_BASE = "http://127.0.0.1:8000"
DEFAULT_MAX_ROSTER_AGE_SECONDS = 36 * 3600
SEAT_COUNT = 40
# Lanes without published pricing are metered at a deliberately high estimate so the
# budget policy over-counts rather than silently treating them as free.
UNPRICED_INPUT_USD_PER_MILLION = 15.0
UNPRICED_OUTPUT_USD_PER_MILLION = 75.0
_NON_CHAT = re.compile(
    r"audio|transcri|nova-3|parakeet|guard|image|embed|whisper|tts|rerank|lora|vision-only|safeguard",
    re.IGNORECASE,
)
_FAMILY_RULES: tuple[tuple[str, str], ...] = (
    (r"claude|anthropic", "anthropic"),
    (r"gemini|gemma|google", "google"),
    (r"gpt-oss", "openai_oss"),
    (r"(^|[/._-])(gpt|o[134]|chatgpt|openai)", "openai"),
    (r"grok|x-ai|xai", "xai"),
    (r"deepseek", "deepseek"),
    (r"kimi|moonshot", "moonshot"),
    (r"nemotron|nvidia", "nvidia"),
    (r"mistral|mixtral|codestral|magistral", "mistral"),
    (r"cohere|command|north", "cohere"),
    (r"llama|meta", "meta"),
    (r"qwen|qwq|cogito|c3po", "qwen"),
    (r"allam", "sdaia"),
    (r"glm|zhipu|z-ai", "zhipu"),
    (r"minimax", "minimax"),
    (r"phi-|microsoft", "microsoft"),
    (r"granite|ibm", "ibm"),
    (r"sonar|perplexity", "perplexity"),
    (r"thinkingmachines|inkling", "thinkingmachines"),
)
# Router aliases pick an undisclosed model per request, so they have no stable family.
_ROUTER_ALIAS = re.compile(r"^(openrouter/)?(free|auto)$|(^|/)auto$", re.IGNORECASE)


def model_family(provider: str, model: str) -> str:
    haystack = f"{model} {provider}".lower()
    for pattern, family in _FAMILY_RULES:
        if re.search(pattern, haystack):
            return family
    return f"other:{provider.lower()}"


def lane_ref(provider: str, model: str) -> str:
    return f"{provider}{LANE_SEPARATOR}{model}"


def split_lane_ref(reference: str) -> tuple[str, str]:
    provider, separator, model = reference.partition(LANE_SEPARATOR)
    if not separator or not provider or not model:
        raise ProviderError(f"fleet seat model must be '<provider>{LANE_SEPARATOR}<model>': {reference!r}")
    return provider, model


def _sovereign_key() -> str:
    direct = os.environ.get("ECHO_SDK_API_KEY", "").strip()
    if direct:
        return direct
    path = Path(os.environ.get("FUSION_SOVEREIGN_KEY_FILE", "/home/forge/.echo_sovereign_key"))
    try:
        for line in path.read_text(encoding="utf-8").splitlines()[:256]:
            name, separator, value = line.partition("=")
            if separator and name.strip() in {"SOVEREIGN_KEY", "ECHO_API_KEY", "ECHO_SDK_API_KEY"} and value.strip():
                return value.strip().strip('"').strip("'")
    except OSError:
        pass
    raise ProviderError("no gate credential available for fleet lanes", retryable=False)


def _unwrap(payload: Any) -> dict[str, Any]:
    result = payload.get("result", payload) if isinstance(payload, dict) else payload
    body = result.get("body", result) if isinstance(result, dict) else result
    return body if isinstance(body, dict) else {"ok": False, "error": "gate returned a non-object body"}


def _usd_per_million(value: Any, *, per_token: bool) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number < 0:
        return None
    return round(number * 1_000_000, 6) if per_token else number


def lane_pricing(lane: dict[str, Any]) -> tuple[float, float, str]:
    raw = lane.get("pricing_json")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raw = None
    if isinstance(raw, dict):
        if "prompt" in raw or "completion" in raw:
            rate_in = _usd_per_million(raw.get("prompt", 0), per_token=True)
            rate_out = _usd_per_million(raw.get("completion", 0), per_token=True)
            if rate_in is not None and rate_out is not None:
                return rate_in, rate_out, "published_per_token"
        if "input" in raw or "output" in raw:
            rate_in = _usd_per_million(raw.get("input", 0), per_token=False)
            rate_out = _usd_per_million(raw.get("output", 0), per_token=False)
            if rate_in is not None and rate_out is not None:
                return rate_in, rate_out, "published_per_million"
    if str(lane.get("provider", "")).startswith("ollama-local"):
        return 0.0, 0.0, "local_zero_cost"
    return UNPRICED_INPUT_USD_PER_MILLION, UNPRICED_OUTPUT_USD_PER_MILLION, "unpriced_conservative_estimate"


class _Gate:
    def __init__(self, base_url: str | None = None, timeout: float = 120.0) -> None:
        self.base_url = (base_url or os.environ.get("FLEET_GATE_BASE")
                         or os.environ.get("MAXIMALIST_SDK_BASE_URL") or DEFAULT_GATE_BASE).rstrip("/")
        self.timeout = timeout

    async def invoke(self, capability: str, params: dict[str, Any], *, reason: str,
                     timeout: float | None = None) -> dict[str, Any]:
        body = {"envelope_version": 1, "capability": capability, "params": params,
                "context": {"bypass_reason": reason}}
        headers = {"X-Echo-API-Key": _sovereign_key(), "Content-Type": "application/json"}
        async with httpx.AsyncClient(timeout=timeout or self.timeout) as client:
            response = await client.post(f"{self.base_url}/sdk/invoke", headers=headers, json=body)
        if response.status_code >= 400:
            raise ProviderError(f"gate HTTP {response.status_code} for {capability}",
                                retryable=response.status_code in {408, 429, 500, 502, 503, 504},
                                status_code=response.status_code)
        return _unwrap(response.json())


@dataclass(slots=True)
class FleetRoster:
    generated_at: float
    lanes: list[dict[str, Any]]
    trinity: list[str]
    planner: str
    path: str = ""

    @classmethod
    def load(cls, path: str | Path | None = None) -> "FleetRoster":
        target = Path(path or os.environ.get("MAXIMALIST_FLEET_ROSTER", DEFAULT_ROSTER_PATH))
        data = json.loads(target.read_text(encoding="utf-8"))
        if data.get("schema") != ROSTER_SCHEMA:
            raise ValueError(f"fleet roster schema must be {ROSTER_SCHEMA}")
        lanes = [dict(item) for item in data.get("lanes") or []]
        if len({lane["family"] for lane in lanes}) < 3:
            raise ValueError("fleet roster needs at least three distinct model families")
        refs = {lane["ref"] for lane in lanes}
        trinity = [str(item) for item in data.get("trinity") or []]
        planner = str(data.get("planner") or "")
        if len(trinity) != 3 or not set(trinity) <= refs or planner not in refs:
            raise ValueError("fleet roster trinity/planner must reference roster lanes")
        return cls(float(data["generated_at"]), lanes, trinity, planner, str(target))

    def age_seconds(self, now: float | None = None) -> float:
        return max(0.0, (now or time.time()) - self.generated_at)

    def is_fresh(self, now: float | None = None) -> bool:
        limit = float(os.environ.get("MAXIMALIST_FLEET_MAX_AGE_SECONDS", DEFAULT_MAX_ROSTER_AGE_SECONDS))
        return self.age_seconds(now) <= limit

    def lane(self, reference: str) -> dict[str, Any] | None:
        return next((lane for lane in self.lanes if lane["ref"] == reference), None)

    def families(self) -> list[str]:
        return sorted({lane["family"] for lane in self.lanes})

    def cost_table(self) -> CostTable:
        rates = [PricingRate(provider=FLEET_PROVIDER, model=lane["ref"],
                             input_usd_per_million=float(lane["input_usd_per_million"]),
                             output_usd_per_million=float(lane["output_usd_per_million"]))
                 for lane in self.lanes]
        return CostTable(rates=rates, free_providers=set())


@dataclass
class FleetGateAdapter:
    """ProviderAdapter over ``echo.llm.call``; seat ``model`` is ``<lane-provider>::<model>``."""

    roster: FleetRoster
    gate: _Gate = field(default_factory=_Gate)

    probe_verifies_network: ClassVar[bool] = False
    auth_mode: ClassVar[str] = "gate_brokered"
    metering: ClassVar[str] = "gate_brokered_priced"
    node_name: ClassVar[str] = "FORGE-gate"

    async def complete(self, request: ProviderRequest) -> ProviderCompletion:
        provider, model = split_lane_ref(request.model)
        trinity = request.phase == "trinity"
        prompt = request.prompt
        if trinity:
            prompt += ("\n\nReturn ONLY a JSON object with keys answer (string), confidence (0-1), "
                       "supported_claims, weak_claims, unresolved (arrays of strings).")
        body = await self.gate.invoke(
            "echo.llm.call",
            {"provider": provider, "model": model, "prompt": prompt,
             "max_tokens": int(request.max_output_tokens), "temperature": 0 if trinity else 0.3,
             "purpose": f"maximalist_fleet:{request.phase}:{request.seat_id}"},
            reason=f"MAXIMALIST fleet_live seat {request.seat_id} ({request.role}) via lane {provider}/{model}",
        )
        if not body.get("ok"):
            error = str(body.get("error") or "llm_call_failed")[:200]
            retryable = any(token in error.lower() for token in ("timeout", "429", "rate", "shed", "503", "502"))
            raise ProviderError(f"fleet lane {provider}/{model}: {error}", retryable=retryable)
        text = body.get("text")
        if not isinstance(text, str) or not text.strip():
            raise ProviderError(f"fleet lane {provider}/{model} returned no text")
        usage = body.get("usage") if isinstance(body.get("usage"), dict) else {}

        def count(*names: str) -> int | None:
            for name in names:
                value = usage.get(name, body.get(name))
                if isinstance(value, (int, float)) and value >= 0:
                    return int(value)
            return None

        return ProviderCompletion(
            text=text,
            input_tokens=count("input_tokens", "prompt_tokens"),
            output_tokens=count("output_tokens", "completion_tokens"),
            usage_source="gate_reported" if usage else "estimated",
        )

    async def probe(self, model: str) -> bool:
        return self.roster.is_fresh() and self.roster.lane(model) is not None


def fleet_registry(roster: FleetRoster, seat_count: int = SEAT_COUNT) -> SeatRegistry:
    """Seat ``seat_count`` positions round-robin across families, then lanes within a family."""
    by_family: "OrderedDict[str, list[dict[str, Any]]]" = OrderedDict()
    for lane in sorted(roster.lanes, key=lambda item: (item["family"], item.get("latency_ms", 0))):
        by_family.setdefault(lane["family"], []).append(lane)
    order: list[dict[str, Any]] = []
    depth = 0
    while len(order) < seat_count:
        added = False
        for lanes in by_family.values():
            if lanes:
                order.append(lanes[depth % len(lanes)])
                added = True
                if len(order) == seat_count:
                    break
        depth += 1
        if not added:
            break

    def seat(seat_id: str, lane: dict[str, Any], role: str, domains: tuple[str, ...]) -> SeatConfig:
        cost = float(lane["input_usd_per_million"]) + float(lane["output_usd_per_million"])
        return SeatConfig(
            id=seat_id, provider=FLEET_PROVIDER, model=lane["ref"], role=role, domains=domains,
            provider_family=lane["family"], independence_group=lane["family"],
            cost_class="free" if cost == 0 else ("premium" if cost >= 20 else "standard"),
            latency_class="fast" if int(lane.get("latency_ms", 0)) < 4000 else "standard",
            privacy_class="local" if lane.get("pricing_source") == "local_zero_cost" else "external",
            locality="local" if lane.get("pricing_source") == "local_zero_cost" else "remote",
        )

    seats = tuple(
        seat(f"seat_{index + 1:02d}", lane, ROLE_FAMILIES[index % len(ROLE_FAMILIES)],
             (ROLE_FAMILIES[index % len(ROLE_FAMILIES)], "general"))
        for index, lane in enumerate(order)
    )
    trinity_roles = (("trinity_a", "pattern_execution_synthesis"),
                     ("trinity_b", "critique_recursive_integration"),
                     ("trinity_c", "hypothesis_expansion"))
    trinity = tuple(seat(seat_id, roster.lane(ref), role, ("synthesis",))
                    for (seat_id, role), ref in zip(trinity_roles, roster.trinity))
    return SeatRegistry(seats=seats, trinity=trinity,
                        planner=seat("planner", roster.lane(roster.planner), "planner", ("planning",)))


def build_fleet_providers(roster: FleetRoster) -> ProviderRegistry:
    providers = ProviderRegistry()
    providers.register(FLEET_PROVIDER, FleetGateAdapter(roster))
    return providers


# ---------------------------------------------------------------- roster builder
_TRINITY_PREFERENCE = ("anthropic", "google", "openai", "moonshot", "deepseek", "xai", "meta", "qwen", "nvidia")
_PLANNER_MODELS = ("gpt-4.1-mini", "gpt-4o-mini", "llama-3.3-70b", "gemini-3-flash")
_TRINITY_MAX_OUTPUT_USD_PER_MILLION = 30.0


def select_trinity_and_planner(lanes: list[dict[str, Any]]) -> tuple[list[str], str]:
    """Trinity: three distinct families, strongest priced lane in each (published pricing only,
    capped so an ultra-premium lane is not chosen by default). Planner: a cheap, JSON-reliable lane."""
    priced = [lane for lane in lanes if lane.get("pricing_source", "").startswith("published")
              and float(lane["output_usd_per_million"]) <= _TRINITY_MAX_OUTPUT_USD_PER_MILLION]
    pool = priced or list(lanes)
    trinity: list[dict[str, Any]] = []
    for family in (*_TRINITY_PREFERENCE, *sorted({lane["family"] for lane in pool})):
        if len(trinity) == 3:
            break
        if family in {item["family"] for item in trinity}:
            continue
        options = [lane for lane in pool if lane["family"] == family]
        if options:
            trinity.append(max(options, key=lambda lane: (float(lane["output_usd_per_million"]),
                                                           -int(lane.get("latency_ms", 0)))))
    if len(trinity) < 3:
        raise ValueError("fleet roster cannot seat a three-family Trinity")
    planner = next((lane for marker in _PLANNER_MODELS for lane in lanes if marker in lane["model"].lower()),
                   None) or min(pool, key=lambda lane: float(lane["output_usd_per_million"]) or 1e9)
    return [lane["ref"] for lane in trinity], planner["ref"]


def reselect_roster(path: Path) -> dict[str, Any]:
    """Re-derive families and Trinity/planner for an existing roster without re-running canaries."""
    document = json.loads(path.read_text(encoding="utf-8"))
    lanes = [lane for lane in document["lanes"] if not _ROUTER_ALIAS.search(lane["model"])]
    for lane in lanes:
        lane["family"] = model_family(lane["provider"], lane["model"])
    document["lanes"] = lanes
    document["trinity"], document["planner"] = select_trinity_and_planner(lanes)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(document, indent=1), encoding="utf-8")
    os.replace(temporary, path)
    return document


def _find_lane_list(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list) and payload and isinstance(payload[0], dict):
        return payload
    if isinstance(payload, dict):
        for value in payload.values():
            found = _find_lane_list(value)
            if found:
                return found
    return []


async def build_roster(*, out: Path, concurrency: int, per_family: int, include_degraded: int,
                       max_input_usd_per_million: float) -> dict[str, Any]:
    gate = _Gate(timeout=90.0)
    listing = await gate.invoke("echo.llm.list", {}, reason="MAXIMALIST fleet roster discovery", timeout=60)
    lanes = [lane for lane in _find_lane_list(listing)
             if lane.get("is_active") and lane.get("call_kind") in {"openai_compat", "anthropic_cli", "dedicated_endpoint"}
             and not _NON_CHAT.search(str(lane.get("model_id") or ""))
             and not _ROUTER_ALIAS.search(str(lane.get("model_id") or ""))]
    candidates = [lane for lane in lanes if lane.get("health_status") == "ok"]
    degraded: dict[str, int] = {}
    for lane in lanes:
        if lane.get("health_status") == "degraded" and degraded.get(lane["provider"], 0) < include_degraded:
            degraded[lane["provider"]] = degraded.get(lane["provider"], 0) + 1
            candidates.append(lane)
    semaphore = asyncio.Semaphore(concurrency)

    async def canary(lane: dict[str, Any]) -> dict[str, Any]:
        provider, model = str(lane["provider"]), str(lane["model_id"])
        rate_in, rate_out, source = lane_pricing(lane)
        record = {"ref": lane_ref(provider, model), "provider": provider, "model": model,
                  "family": model_family(provider, model), "input_usd_per_million": rate_in,
                  "output_usd_per_million": rate_out, "pricing_source": source,
                  "catalog_health": lane.get("health_status")}
        if rate_in > max_input_usd_per_million:
            return {**record, "ok": False, "error": "input price above roster ceiling"}
        async with semaphore:
            started = time.monotonic()
            try:
                body = await gate.invoke("echo.llm.call", {
                    "provider": provider, "model": model, "prompt": "Reply with the single word: READY",
                    "max_tokens": 16, "temperature": 0, "purpose": "maximalist_fleet_roster_canary"},
                    reason=f"MAXIMALIST fleet roster canary (16 tokens) for lane {provider}/{model}", timeout=75)
            except Exception as exc:  # noqa: BLE001 - every failure is recorded, none is fatal
                return {**record, "ok": False, "error": f"{type(exc).__name__}: {str(exc)[:120]}"}
            latency = int((time.monotonic() - started) * 1000)
        text = str(body.get("text") or "")
        ok = bool(body.get("ok")) and "ready" in text.lower()
        return {**record, "ok": ok, "latency_ms": latency,
                "error": None if ok else str(body.get("error") or text[:80] or "no text")[:160]}

    results = await asyncio.gather(*(canary(lane) for lane in candidates))
    passing = sorted((item for item in results if item["ok"]), key=lambda item: (item["family"], item["latency_ms"]))
    kept: list[dict[str, Any]] = []
    for family in sorted({item["family"] for item in passing}):
        kept.extend([item for item in passing if item["family"] == family][:per_family])
    families = {item["family"] for item in kept}
    if len(families) < 3:
        raise SystemExit(f"only {len(families)} model families passed the canary; refusing to write a clone roster")

    trinity, planner = select_trinity_and_planner(kept)
    document = {
        "schema": ROSTER_SCHEMA, "generated_at": time.time(),
        "generated_at_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "profile": "MAXIMALIST_RECONSTRUCTED", "historical_parity": False,
        "lanes": [{key: item[key] for key in ("ref", "provider", "model", "family", "input_usd_per_million",
                                              "output_usd_per_million", "pricing_source", "latency_ms")}
                  for item in kept],
        "trinity": trinity, "planner": planner,
        "canary": {"candidates": len(candidates), "passed": len(passing),
                   "failures": [{"ref": item["ref"], "error": item["error"]} for item in results if not item["ok"]]},
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    temporary = out.with_suffix(".tmp")
    temporary.write_text(json.dumps(document, indent=1), encoding="utf-8")
    os.replace(temporary, out)
    return document


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="echo_fusion_worker.fleet_lanes")
    sub = parser.add_subparsers(dest="command", required=True)
    build = sub.add_parser("build", help="discover, canary, and write the fleet roster")
    build.add_argument("--out", default=os.environ.get("MAXIMALIST_FLEET_ROSTER", DEFAULT_ROSTER_PATH))
    build.add_argument("--concurrency", type=int, default=6)
    build.add_argument("--per-family", type=int, default=4)
    build.add_argument("--include-degraded", type=int, default=3)
    build.add_argument("--max-input-usd-per-million", type=float, default=20.0)
    reselect = sub.add_parser("reselect", help="re-derive families and Trinity/planner without canaries")
    reselect.add_argument("--roster", default=os.environ.get("MAXIMALIST_FLEET_ROSTER", DEFAULT_ROSTER_PATH))
    show = sub.add_parser("show", help="summarize the current roster and its 40-seat layout")
    show.add_argument("--roster", default=None)
    args = parser.parse_args(argv)
    if args.command == "build":
        document = asyncio.run(build_roster(out=Path(args.out), concurrency=args.concurrency,
                                            per_family=args.per_family, include_degraded=args.include_degraded,
                                            max_input_usd_per_million=args.max_input_usd_per_million))
        families = sorted({lane["family"] for lane in document["lanes"]})
        print(json.dumps({"out": args.out, "lanes": len(document["lanes"]), "families": families,
                          "trinity": document["trinity"], "planner": document["planner"],
                          "canary": {k: v for k, v in document["canary"].items() if k != "failures"}}, indent=1))
        return 0
    if args.command == "reselect":
        document = reselect_roster(Path(args.roster))
        print(json.dumps({"lanes": len(document["lanes"]), "trinity": document["trinity"],
                          "planner": document["planner"]}, indent=1))
        return 0
    roster = FleetRoster.load(args.roster)
    registry = fleet_registry(roster)
    families = [seat.provider_family for seat in registry.seats]
    print(json.dumps({"roster": roster.path, "age_hours": round(roster.age_seconds() / 3600, 2),
                      "fresh": roster.is_fresh(), "seats": len(registry.seats),
                      "distinct_lanes": len({seat.model for seat in registry.seats}),
                      "distinct_families": len(set(families)),
                      "family_seats": {family: families.count(family) for family in sorted(set(families))},
                      "trinity": [(seat.provider_family, seat.model) for seat in registry.trinity],
                      "planner": registry.planner.model}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
