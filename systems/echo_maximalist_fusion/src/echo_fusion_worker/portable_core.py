"""Adapter from the provenance-locked Fusion Worker HTTP contract to core 0.3.0.

The portable core is additive: the recovered ``echo_fusion`` engine remains
untouched and available under its existing profiles. Selecting
``FUSION_PROFILE=reconstructed_v03`` opts into this adapter explicitly.
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
    CostTable,
    DeterministicFakeProvider,
    FusionEngine,
    JsonFileMemoryAdapter,
    JsonRunStateStore,
    ProviderRegistry,
    anvil_ollama_registry,
    build_deterministic_registry,
    build_preflight_report,
    default_registry,
)

from .factory import register_profile

CORE_PROFILE = "MAXIMALIST_RECONSTRUCTED"
CORE_VERSION = "0.3.0"
CORE_SHA = "d1e68e2f263d93648e494c5419852693fdd03fe0"
HISTORICAL_PARITY = False
SUPPORTED_RUNTIMES = frozenset({"anvil_live", "deterministic_test"})


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
        anvil_base_url: str | None = None,
    ) -> None:
        if runtime not in SUPPORTED_RUNTIMES:
            raise ValueError(
                f"MAXIMALIST_RUNTIME must be one of {sorted(SUPPORTED_RUNTIMES)}; got {runtime!r}"
            )
        self.runtime = runtime
        self.state_store = JsonRunStateStore(state_dir)
        self.memory = JsonFileMemoryAdapter(memory_file or Path(state_dir) / "memory.json")
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
        return {
            **self.metadata,
            "ready": ready,
            "planner_ready": report.planner_ready,
            "ready_swarm_seats": len(report.ready_swarm_seats),
            "ready_trinity_seats": len(report.ready_trinity_seats),
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
        )

    async def drive_state(self, state: PortableRunState) -> PortableResult:
        result = await self._engine(self._policy(state.budget)).run(
            state.objective,
            state.context,
            run_id=state.run_id,
            execution_mode=(
                "deterministic_test" if self.provider_mode == "deterministic_test" else "full_live"
            ),
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
            "MAXIMALIST_RUNTIME is required for reconstructed_v03; choose anvil_live or deterministic_test"
        )
    state_dir = os.environ.get("MAXIMALIST_STATE_DIR", "runtime/maximalist-reconstructed-v03")
    memory_file = os.environ.get("MAXIMALIST_MEMORY_FILE", "").strip() or None
    return PortableCoreEngine(runtime=runtime, state_dir=state_dir, memory_file=memory_file)


register_profile("reconstructed_v03", _build_portable_engine)
