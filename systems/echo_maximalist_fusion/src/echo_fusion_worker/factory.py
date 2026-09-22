"""echo-fusion-worker · factory — engine profiles + server-side budget clamp.

A *profile* is a named builder that assembles a FusionEngine from a validated
seats config. This is the seam #34391 extends: it registers a 'live' profile
(ModelAdapter→swarm lanes, Embedder→echo.knowledge.embed, Contradictor→NLI margin,
MemoryAdapter→5 recall planes, StateStore→Postgres fusion_runs) without editing
this file — `register_profile("live", ...)` at import time and set FUSION_PROFILE=live.

The 'stub' profile ships here, fully implemented and default: a deterministic
worker-local StubModelAdapter + the engine's own real deterministic adapters. It
proves the whole cap→worker→engine→FusionResult pipeline end-to-end with zero
external deps. It is NOT a placeholder — it is the honest non-live profile.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Callable

from echo_fusion.adapters import (FakeMemory, HashEmbedder, InMemoryStateStore,
                                   JsonFindingExtractor, KeywordContradictor)
from echo_fusion.engine import FusionEngine
from echo_fusion.schemas import Budget

log = logging.getLogger("echo_fusion_worker.factory")

# ---- server-side budget ceiling (BILLING doctrine — the $1,000-Copilot class does
# not repeat: a client can never lift the per-run cap by sending a bigger budget). ----
MAX_CALLS_CEILING: int = 120
MAX_COST_CEILING: float = 5.0     # USD, per run
# Live runs make real per-seat LLM calls (~8-15s each via echo.swarm.ask), so a full
# decompose -> first-pass -> trinity-fuse -> verify cycle needs real wall headroom or
# fusion is cut off before it can synthesize an answer (observed: a 141s run truncated
# at the old 120s cap and abstained on an empty answer).
# Measured full-40 execution over ANVIL's single local Ollama lane reached the
# first Trinity pass near 2,000 seconds. The bounded 70-call recursive graph
# therefore receives an 80-minute hard wall while all other ceilings remain.
MAX_WALL_CEILING: float = 4_800.0  # seconds, per run


def clamp_budget(b: Budget | None) -> Budget:
    """Clamp any client-supplied budget DOWN to the worker ceilings. Never lifts a
    smaller client budget; only caps an over-large one. Preserves spent counters."""
    b = b or Budget()
    clamped = Budget(
        max_calls=min(int(b.max_calls), MAX_CALLS_CEILING),
        max_cost_usd=min(float(b.max_cost_usd), MAX_COST_CEILING),
        max_wall_s=min(float(b.max_wall_s), MAX_WALL_CEILING),
        calls_spent=b.calls_spent,
        cost_spent=b.cost_spent,
    )
    if clamped.max_calls != b.max_calls or clamped.max_cost_usd != b.max_cost_usd:
        log.info("budget clamped: calls %s->%s cost %.2f->%.2f",
                 b.max_calls, clamped.max_calls, b.max_cost_usd, clamped.max_cost_usd)
    return clamped


class StubModelAdapter:
    """Deterministic, dependency-free ModelAdapter for the 'stub' profile.

    Emits the exact JSON shape each engine phase asks for, derived from the prompt +
    context objective, so every code path (decompose → first-pass → retask → critique →
    trinity fuse → verify) round-trips with a well-formed, reproducible answer. It
    fabricates NO external evidence (evidence stays empty), so the grounding gate is
    exercised honestly rather than tricked.
    """

    async def call(self, *, seat_id: str, model: str, role: str, prompt: str,
                   context: dict[str, Any], timeout: float) -> dict[str, Any]:
        objective = str((context or {}).get("objective", "")).strip() or "the objective"
        obj = objective[:200]
        log.debug("stub.call seat=%s role=%s model=%s", seat_id, role, model)

        # 1. planner decompose — engine wants a JSON array of short strings.
        if "Decompose the objective" in prompt and "JSON array" in prompt:
            text = json.dumps([f"aspect: {obj[:120]}", "evidence and grounding", "risks"])
        # 2. trinity fusion — engine wants {"answer":...,"confidence":...}.
        elif '"answer"' in prompt:
            text = json.dumps({
                "answer": f"[stub] synthesized answer for: {obj}",
                "confidence": 0.5, "supported": [], "unresolved": [], "weak": [],
            })
        # 3. first-pass / retask / critique / verify — engine wants {"findings":[...]}.
        else:
            text = json.dumps({"findings": [{
                "claim": f"[stub] deterministic finding for '{obj}' from seat {seat_id}",
                "claim_type": "fact",
                "evidence": [],            # honest: a stub has no external evidence
                "confidence": 0.5, "importance": 0.5, "novelty": 0.5,
            }]})
        # ModelAdapter contract: return {"text": <str>, "cost_usd": <float>}.
        return {"text": text, "cost_usd": 0.0}


# ---- profile registry -------------------------------------------------------
_PROFILES: dict[str, Callable[[dict[str, Any]], FusionEngine]] = {}


def register_profile(name: str, builder: Callable[[dict[str, Any]], FusionEngine]) -> None:
    """Register a profile builder. #34391 calls this to add 'live' with no edit here."""
    _PROFILES[name] = builder
    log.info("registered fusion profile %r", name)


def build_engine(cfg: dict[str, Any], profile: str = "stub") -> FusionEngine:
    """Build a FusionEngine for the named profile from a validated seats config.

    Fail-closed on an unknown profile (KeyError) rather than silently degrading.
    """
    if profile not in _PROFILES:
        raise KeyError(f"unknown fusion profile {profile!r}; registered: {sorted(_PROFILES)}")
    log.info("building engine profile=%s seats=%d trinity=%d",
             profile, len(cfg["seats"]), len(cfg["trinity"]))
    return _PROFILES[profile](cfg)


def _build_stub_engine(cfg: dict[str, Any]) -> FusionEngine:
    return FusionEngine(
        model=StubModelAdapter(),
        extractor=JsonFindingExtractor(),
        embedder=HashEmbedder(),
        contradictor=KeywordContradictor(),
        memory=FakeMemory(),
        store=InMemoryStateStore(),
        seats=cfg["seats"],
        trinity=cfg["trinity"],
        planner_seat=cfg["planner_seat"],
        reserve_specialists=cfg["reserve_specialists"],
    )


register_profile("stub", _build_stub_engine)
