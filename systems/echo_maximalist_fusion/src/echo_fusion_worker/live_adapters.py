"""echo-fusion-worker · LIVE profile — real models + real grounding.

Binds the abstract engine adapters to live fleet caps (all tier 0-1, so the worker
authenticates to the gate with the sovereign key alone — no HMAC):

  ModelAdapter   -> echo.swarm.ask  (depth=fast, $0 lanes)     — real per-seat answers
  MemoryAdapter  -> echo.knowledge.search                      — the TIE/PIE/ARCS grounded
                                                                  corpus, as Evidence(RETRIEVAL)

Embedder (HashEmbedder), Contradictor (KeywordContradictor) and StateStore
(InMemoryStateStore) remain the deterministic ones for now — a real NLI contradictor,
pgvector embedder and Postgres state store are the #34391 hardening items. This profile
makes the brain ANSWER with real models grounded in the real corpus; it does not yet
claim calibrated confidence (that is #34391).

Registered as the "live" profile at import — no network happens at import time.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any

import httpx

from echo_fusion.adapters import (HashEmbedder, InMemoryStateStore,
                                   JsonFindingExtractor, KeywordContradictor)
from echo_fusion.engine import FusionEngine
from .factory import register_profile

log = logging.getLogger("echo_fusion_worker.live")

GATE_BASE = os.environ.get("FUSION_GATE_BASE", "http://127.0.0.1:8002")
KEY_FILE = os.environ.get("FUSION_SOVEREIGN_KEY_FILE", "/home/forge/.echo_sovereign_key")
_SWARM_DEPTH = os.environ.get("FUSION_SWARM_DEPTH", "fast")   # fast|deep|max


def _clamp(x: object, default: float = 0.4) -> float:
    try:
        return max(0.0, min(1.0, float(x)))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


# ---- pure shaping (unit-tested, no network) ---------------------------------
def extract_swarm_answer(env: dict[str, Any]) -> tuple[str, float]:
    """Pull (answer, confidence) out of an echo.swarm.ask gate envelope."""
    body = (env or {}).get("result", {}).get("body", {}) or {}
    ans = body.get("final_answer") or body.get("answer") or body.get("text") or ""
    return str(ans), _clamp(body.get("confidence", 0.4))


def extract_search_body(env: dict[str, Any]) -> dict[str, Any]:
    """Pull the search body ({hits:[...]}) out of an echo.knowledge.search envelope."""
    if isinstance(env, dict) and "hits" in env:
        return env
    return (env or {}).get("result", {}).get("body", {}) or {}


def shape_model_text(prompt: str, answer: str, confidence: float) -> str:
    """Wrap a real model answer into the exact JSON shape the engine phase expects,
    so the JsonFindingExtractor / _parse_fusion / _decompose parse cleanly instead of
    degrading real content to a 0.2 prose blob (the #1 fake->live risk)."""
    conf = _clamp(confidence)
    # decompose asks for a JSON array of strings — pass the model output through so the
    # engine's own array-parse (or line-split fallback) handles it.
    if "Decompose the objective" in prompt and "JSON array" in prompt:
        return answer
    # trinity fusion asks for {"answer":...}
    if '"answer"' in prompt:
        return json.dumps({"answer": answer, "confidence": conf})
    # first-pass / retask / critique / verify ask for {"findings":[...]}
    return json.dumps({"findings": [{
        "claim": answer, "claim_type": "fact",
        "confidence": conf, "importance": 0.6, "novelty": 0.5, "evidence": [],
    }]})


def shape_search_hits(body: dict[str, Any]) -> list[dict[str, Any]]:
    """Turn echo.knowledge.search hits into MemoryAdapter records the engine can seed
    as Evidence(RETRIEVAL) (locator = corpus path + document/chunk id)."""
    out: list[dict[str, Any]] = []
    for h in (body or {}).get("hits", []) or []:
        if not isinstance(h, dict):
            continue
        out.append({
            "content": h.get("snippet", ""),
            "id": f'{h.get("path", "")}#{h.get("document_id", "")}:{h.get("chunk_idx", "")}',
            "source": h.get("title", ""),
            "score": _clamp(h.get("hybrid_score", 0.0), 0.0),
        })
    return out


# ---- gate client ------------------------------------------------------------
class _GateClient:
    """Authenticated caller for tier 0-1 gate caps (X-Echo-API-Key, no HMAC)."""

    def __init__(self) -> None:
        self._key: str | None = None

    def _load_key(self) -> str:
        if self._key is None:
            with open(KEY_FILE, "r", encoding="utf-8") as fh:
                for line in fh:
                    name, separator, value = line.partition("=")
                    if separator and name.strip() == "SOVEREIGN_KEY" and value.strip():
                        self._key = value.strip()
                        break
            if not self._key:
                raise RuntimeError(f"no SOVEREIGN_KEY in {KEY_FILE}")
        return self._key

    async def invoke(self, capability: str, params: dict[str, Any], timeout: float) -> dict[str, Any]:
        body = {"envelope_version": 1, "capability": capability, "params": params}
        headers = {"X-Echo-API-Key": self._load_key(), "Content-Type": "application/json"}
        async with httpx.AsyncClient(timeout=timeout) as c:
            r = await c.post(f"{GATE_BASE}/sdk/invoke", headers=headers, json=body)
        r.raise_for_status()
        return r.json()


# ---- live adapters ----------------------------------------------------------
class SwarmModelAdapter:
    """ModelAdapter backed by echo.swarm.ask (depth=fast). Returns the engine's
    {"text","cost_usd"} contract; on any failure returns {"error",...} so the engine's
    breaker isolates the seat instead of crashing the run."""

    def __init__(self, gate: _GateClient) -> None:
        self.gate = gate

    async def call(self, *, seat_id: str, model: str, role: str, prompt: str,
                   context: dict[str, Any], timeout: float) -> dict[str, Any]:
        try:
            env = await self.gate.invoke("echo.swarm.ask",
                                         {"question": prompt, "depth": _SWARM_DEPTH},
                                         timeout=max(timeout, 90.0))
            answer, conf = extract_swarm_answer(env)
            log.debug("swarm seat=%s role=%s conf=%.2f ans=%.60s", seat_id, role, conf, answer)
            return {"text": shape_model_text(prompt, answer, conf), "cost_usd": 0.0}
        except Exception as exc:  # noqa: BLE001
            log.warning("swarm seat=%s failed: %s", seat_id, exc)
            return {"error": f"swarm_ask: {exc}", "cost_usd": 0.0}


class GroundedMemoryAdapter:
    """MemoryAdapter backed by echo.knowledge.search — the TIE/PIE/ARCS grounded corpus."""

    def __init__(self, gate: _GateClient) -> None:
        self.gate = gate

    async def retrieve(self, objective: str, limit: int = 20) -> list[dict[str, Any]]:
        try:
            env = await self.gate.invoke("echo.knowledge.search",
                                         {"query": objective, "limit": min(int(limit), 20)},
                                         timeout=30.0)
            recs = shape_search_hits(extract_search_body(env))
            log.info("grounding retrieved %d hits for %.60s", len(recs), objective)
            return recs
        except Exception as exc:  # noqa: BLE001
            log.warning("knowledge.search failed: %s", exc)
            return []

    async def write_run(self, result: Any) -> list[str]:
        # Write-back (brain.crystallize + spine, gated on not-abstained/high-conf) is a
        # #34391 hardening item. Do NOT fabricate writes here.
        return []


def _build_live_engine(cfg: dict[str, Any]) -> FusionEngine:
    gate = _GateClient()
    return FusionEngine(
        model=SwarmModelAdapter(gate),
        extractor=JsonFindingExtractor(),
        embedder=HashEmbedder(),
        contradictor=KeywordContradictor(),
        memory=GroundedMemoryAdapter(gate),
        store=InMemoryStateStore(),
        seats=cfg["seats"],
        trinity=cfg["trinity"],
        planner_seat=cfg["planner_seat"],
        reserve_specialists=cfg["reserve_specialists"],
    )


register_profile("live", _build_live_engine)
