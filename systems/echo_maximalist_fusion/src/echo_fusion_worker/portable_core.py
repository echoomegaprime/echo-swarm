"""Adapter from the provenance-locked Fusion Worker HTTP contract to core 0.5.0.

The portable core is additive: the recovered ``echo_fusion`` engine remains
untouched and available under its existing profiles. Selecting
``FUSION_PROFILE=reconstructed_v05`` opts into this adapter explicitly.
"""
from __future__ import annotations

import os
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from maximalist_reconstructed import (
    ANVIL_OLLAMA_DEFAULT_BASE_URL,
    AnvilOllamaAdapter,
    BudgetPolicy,
    CapabilityCatalog,
    CostTable,
    DeterministicFakeProvider,
    EchoSDKCapabilityAdapter,
    FusionEngine,
    JsonFileMemoryAdapter,
    JsonFilePerformanceAdapter,
    JsonRunStateStore,
    ProviderRegistry,
    anvil_ollama_registry,
    build_deterministic_capability_orchestrator,
    build_deterministic_registry,
    build_live_capability_orchestrator,
    build_preflight_report,
    default_registry,
)

from .factory import register_profile

CORE_PROFILE = "MAXIMALIST_RECONSTRUCTED"
CORE_VERSION = "0.5.0"
CORE_SHA = "8b65901d8f037374ad48cbb7ee4bf488d1f1327c"
HISTORICAL_PARITY = False
SUPPORTED_RUNTIMES = frozenset({"anvil_live", "deterministic_test"})
SUPPORTED_ROUTING_POLICIES = frozenset(
    {
        "full_40",
        "adaptive",
        "cost_bounded",
        "latency_bounded",
        "offline_private",
        "high_assurance",
        "canary",
    }
)
DEFAULT_ROUTING_POLICY = "full_40"
DEFAULT_CAPABILITY_PROFILE = "echo_full_read"
DEFAULT_SDK_BASE_URL = "http://127.0.0.1:8002"


def _runtime_sdk_key() -> str:
    """Resolve a credential at call time without retaining or serializing it."""
    direct = os.environ.get("ECHO_SDK_API_KEY", "").strip()
    if direct:
        return direct
    key_path = Path(
        os.environ.get(
            "FUSION_SOVEREIGN_KEY_FILE",
            "/home/forge/.echo_sovereign_key",
        )
    )
    try:
        with key_path.open("r", encoding="utf-8") as handle:
            for index, line in enumerate(handle):
                if index >= 256:
                    break
                name, separator, value = line.partition("=")
                if (
                    separator
                    and name.strip() in {"SOVEREIGN_KEY", "ECHO_API_KEY", "ECHO_SDK_API_KEY"}
                    and value.strip()
                ):
                    return value.strip().strip('"').strip("'")
    except OSError:
        pass
    return ""


@dataclass(slots=True)
class PortableRunState:
    run_id: str
    objective: str
    context: dict[str, Any]
    budget: Any


class PortableResult:
    """Expose the small result surface expected by the existing worker app."""

    def __init__(self, result: Any) -> None:
        self._result = result
        self.run_id = result.run_id
        self.answer = result.answer
        self.confidence = result.confidence
        self.abstained = not bool(str(result.answer).strip())

    def model_dump(self, *, mode: str = "json") -> dict[str, Any]:
        del mode
        data = self._result.to_dict()
        data["abstained"] = self.abstained
        provenance = dict(data.get("provenance") or {})
        provenance.update(
            {
                "profile": CORE_PROFILE,
                "historical_parity": HISTORICAL_PARITY,
                "core_version": CORE_VERSION,
                "core_sha": CORE_SHA,
                "trinity_separate": True,
            }
        )
        data["provenance"] = provenance
        return data


class PortableCoreEngine:
    """Build isolated core engines over one durable state and memory boundary."""

    def __init__(
        self,
        *,
        runtime: str,
        state_dir: str | Path,
        memory_file: str | Path | None = None,
        performance_file: str | Path | None = None,
        anvil_base_url: str | None = None,
        capability_profile: str | None = None,
        sdk_base_url: str | None = None,
        routing_policy: str | None = None,
        routing_max_seats: int | None = None,
        fallback_config: str | Path | None = None,
    ) -> None:
        if runtime not in SUPPORTED_RUNTIMES:
            raise ValueError(
                f"MAXIMALIST_RUNTIME must be one of {sorted(SUPPORTED_RUNTIMES)}; got {runtime!r}"
            )
        self.runtime = runtime
        self.state_store = JsonRunStateStore(state_dir)
        self.memory = JsonFileMemoryAdapter(memory_file or Path(state_dir) / "memory.json")
        self.performance = JsonFilePerformanceAdapter(
            performance_file or Path(state_dir) / "performance.json"
        )
        selected_routing_policy = (
            routing_policy
            or os.environ.get("MAXIMALIST_ROUTING_POLICY", "").strip()
            or DEFAULT_ROUTING_POLICY
        )
        if selected_routing_policy not in SUPPORTED_ROUTING_POLICIES:
            raise ValueError(
                "MAXIMALIST_ROUTING_POLICY must be one of "
                f"{sorted(SUPPORTED_ROUTING_POLICIES)}; got {selected_routing_policy!r}"
            )
        self.routing_policy = selected_routing_policy
        default_routing_limit = 40 if selected_routing_policy == "full_40" else 12
        self.routing_max_seats = self._positive_int(
            routing_max_seats
            if routing_max_seats is not None
            else os.environ.get("MAXIMALIST_ROUTING_MAX_SEATS"),
            default_routing_limit,
            40,
        )
        selected_fallback_config = (
            os.fspath(fallback_config)
            if fallback_config is not None
            else os.environ.get("MAXIMALIST_FALLBACK_CONFIG", "").strip()
        )
        self.explicit_fallback_configured = bool(selected_fallback_config)
        self.capability_catalog = CapabilityCatalog.load()
        selected_profile = (
            capability_profile
            or os.environ.get("MAXIMALIST_CAPABILITY_PROFILE", "").strip()
            or DEFAULT_CAPABILITY_PROFILE
        )
        capability_limit = self._positive_int(
            os.environ.get("MAXIMALIST_MAX_CAPABILITY_CALLS"),
            12,
            32,
        )
        if runtime == "deterministic_test":
            self.registry = default_registry()
            names = {
                seat.provider
                for seat in (*self.registry.seats, *self.registry.trinity, self.registry.planner)
            }
            self.providers, fake = build_deterministic_registry(names)
            if not isinstance(fake, DeterministicFakeProvider):
                raise TypeError("deterministic registry did not return its explicit test provider")
            self.costs = CostTable(free_providers=names)
            self.provider_mode = "deterministic_test"
            self.capabilities, self.fake_capabilities = (
                build_deterministic_capability_orchestrator(
                    self.capability_catalog,
                    selected_profile,
                    max_calls=capability_limit,
                )
            )
        else:
            self.registry = anvil_ollama_registry()
            self.providers = ProviderRegistry()
            self.providers.register(
                "anvil_ollama",
                AnvilOllamaAdapter(
                    base_url=(
                        anvil_base_url
                        or os.environ.get("ANVIL_OLLAMA_BASE_URL", "").strip()
                        or ANVIL_OLLAMA_DEFAULT_BASE_URL
                    )
                ),
            )
            self.costs = CostTable(free_providers={"anvil_ollama"})
            self.provider_mode = "live"
            self.fake_capabilities = None
            sdk_adapter = EchoSDKCapabilityAdapter(
                sdk_base_url
                or os.environ.get("MAXIMALIST_SDK_BASE_URL", "").strip()
                or os.environ.get("FUSION_GATE_BASE", "").strip()
                or DEFAULT_SDK_BASE_URL,
                api_key_loader=_runtime_sdk_key,
            )
            self.capabilities = build_live_capability_orchestrator(
                self.capability_catalog,
                selected_profile,
                adapter=sdk_adapter,
                max_calls=capability_limit,
            )
        if selected_fallback_config:
            self.providers.load_fallback_config(selected_fallback_config)

    @property
    def metadata(self) -> dict[str, Any]:
        return {
            "profile": CORE_PROFILE,
            "historical_parity": HISTORICAL_PARITY,
            "core_version": CORE_VERSION,
            "core_sha": CORE_SHA,
            "provider_mode": self.provider_mode,
            "runtime": self.runtime,
            "configured_seat_count": len(self.registry.seats),
            "trinity_separate": True,
            "routing_policy": self.routing_policy,
            "routing_max_seats": self.routing_max_seats,
            "supported_routing_policies": sorted(SUPPORTED_ROUTING_POLICIES),
            "performance_persistence": True,
            "explicit_fallback_configured": self.explicit_fallback_configured,
            "claim_topology": True,
            "coverage_telemetry": True,
            "capability_profile": self.capabilities.profile,
            "capability_mode": self.capabilities.mode,
            "selected_capability_ids": self.capabilities.selected_ids,
        }

    async def health_metadata(self) -> dict[str, Any]:
        report = await build_preflight_report(
            self.registry,
            self.providers,
            self.costs,
            runtime="fake" if self.provider_mode == "deterministic_test" else "live",
        )
        ready = report.planner_ready and bool(report.ready_swarm_seats) and bool(
            report.ready_trinity_seats
        )
        capability_preflight = await self.capabilities.preflight()
        capability_states = capability_preflight["capabilities"]
        capability_degraded = [
            item["capability_id"]
            for item in capability_states
            if item["status"] != "ready"
        ]
        return {
            **self.metadata,
            "ready": ready,
            "planner_ready": report.planner_ready,
            "ready_swarm_seats": len(report.ready_swarm_seats),
            "ready_trinity_seats": len(report.ready_trinity_seats),
            "capability_ready": not capability_degraded,
            "ready_capability_count": len(capability_states) - len(capability_degraded),
            "degraded_capability_ids": capability_degraded,
            "capability_preflight": capability_preflight,
            "credential_values_exposed": False,
        }

    def create_state(
        self,
        objective: str,
        context: dict[str, Any],
        budget: Any,
    ) -> PortableRunState:
        return PortableRunState(
            run_id="run_" + uuid.uuid4().hex,
            objective=objective,
            context=dict(context),
            budget=budget,
        )

    @staticmethod
    def _positive_int(value: Any, fallback: int, ceiling: int) -> int:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            parsed = fallback
        return min(max(1, parsed), ceiling)

    @staticmethod
    def _positive_float(value: Any, fallback: float, ceiling: float) -> float:
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            parsed = fallback
        return min(max(0.001, parsed), ceiling)

    def _policy(self, budget: Any) -> BudgetPolicy:
        return BudgetPolicy(
            max_calls=self._positive_int(getattr(budget, "max_calls", None), 120, 120),
            max_input_tokens=self._positive_int(
                os.environ.get("MAXIMALIST_MAX_INPUT_TOKENS"), 250_000, 1_000_000
            ),
            max_output_tokens=self._positive_int(
                os.environ.get("MAXIMALIST_MAX_OUTPUT_TOKENS"), 100_000, 250_000
            ),
            max_estimated_cost_usd=min(
                max(0.0, float(getattr(budget, "max_cost_usd", 5.0))), 5.0
            ),
            max_output_tokens_per_call=self._positive_int(
                os.environ.get("MAXIMALIST_MAX_OUTPUT_PER_CALL"), 1024, 4096
            ),
            deadline_seconds=self._positive_float(
                getattr(budget, "max_wall_s", None), 420.0, 420.0
            ),
            request_timeout_seconds=self._positive_float(
                os.environ.get("MAXIMALIST_REQUEST_TIMEOUT_SECONDS"), 180.0, 300.0
            ),
            retry_limit=0,
            default_provider_concurrency=self._positive_int(
                os.environ.get("MAXIMALIST_PROVIDER_CONCURRENCY"), 1, 4
            ),
            require_pricing=self.provider_mode != "deterministic_test",
        )

    def _engine(self, policy: BudgetPolicy) -> FusionEngine:
        return FusionEngine(
            providers=self.providers,
            memory=self.memory,
            registry=self.registry,
            state_store=self.state_store,
            max_fusion_passes=3,
            max_concurrency=10,
            provider_mode=self.provider_mode,
            budget_policy=policy,
            cost_table=self.costs,
            capabilities=self.capabilities,
            performance=self.performance,
        )

    async def drive_state(self, state: PortableRunState) -> PortableResult:
        eligible_seat_ids = None
        if self.provider_mode == "live" and self.routing_policy != "full_40":
            report = await build_preflight_report(
                self.registry,
                self.providers,
                self.costs,
                runtime="live",
            )
            if not report.planner_ready or not report.ready_trinity_seats:
                raise RuntimeError(
                    "adaptive live routing requires a ready planner and at least one Trinity seat"
                )
            eligible_seat_ids = report.ready_swarm_seats
        result = await self._engine(self._policy(state.budget)).run(
            state.objective,
            state.context,
            run_id=state.run_id,
            execution_mode=(
                f"deterministic_{self.routing_policy}"
                if self.provider_mode == "deterministic_test"
                else f"{self.routing_policy}_live"
            ),
            routing_policy=self.routing_policy,
            routing_max_seats=self.routing_max_seats,
            eligible_seat_ids=eligible_seat_ids,
        )
        return PortableResult(result)

    async def resume(self, run_id: str) -> PortableResult:
        default_budget = type(
            "ResumeBudget",
            (),
            {"max_calls": 120, "max_cost_usd": 5.0, "max_wall_s": 420.0},
        )()
        result = await self._engine(self._policy(default_budget)).resume(run_id)
        return PortableResult(result)

    def get_run(self, run_id: str) -> dict[str, Any] | None:
        if not self.state_store.exists(run_id):
            return None
        state = self.state_store.load(run_id)
        result = PortableResult(state.result).model_dump(mode="json") if state.result else None
        done = result is not None or state.status in {
            "cancelled",
            "blocked_budget",
            "blocked_deadline",
            "blocked_uncertain",
        }
        error = None if state.status in {"running", "completed"} else state.status
        return {
            "run_id": run_id,
            "phase": "done" if result is not None else state.last_completed_phase,
            "done": done,
            "result": result,
            "error": error,
        }


def _build_portable_engine(cfg: dict[str, Any]) -> PortableCoreEngine:
    del cfg
    runtime = os.environ.get("MAXIMALIST_RUNTIME", "").strip()
    if not runtime:
        raise RuntimeError(
            "MAXIMALIST_RUNTIME is required for reconstructed_v05; choose anvil_live or deterministic_test"
        )
    state_dir = os.environ.get("MAXIMALIST_STATE_DIR", "runtime/maximalist-reconstructed-v05")
    memory_file = os.environ.get("MAXIMALIST_MEMORY_FILE", "").strip() or None
    performance_file = os.environ.get("MAXIMALIST_PERFORMANCE_FILE", "").strip() or None
    return PortableCoreEngine(
        runtime=runtime,
        state_dir=state_dir,
        memory_file=memory_file,
        performance_file=performance_file,
    )


register_profile("reconstructed_v05", _build_portable_engine)
