"""Ports (protocols) + in-memory fakes for the fusion engine.

The engine depends only on these protocols, so the 14 invariant tests drive it
with deterministic fakes (no live providers) and production wires the concrete
NATS/echo-memory/pgvector implementations behind the same interfaces.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import re
from typing import Any, Protocol

from .schemas import Finding, RunState

log = logging.getLogger("echo_fusion.adapters")


# ---------------------------------------------------------------- ports
class ModelAdapter(Protocol):
    async def call(self, *, seat_id: str, model: str, role: str, prompt: str,
                   context: dict[str, Any], timeout: float) -> dict[str, Any]:
        """Return {'text': str, 'cost_usd': float}. Must not raise for a provider
        error — return {'error': str} so the engine can isolate the seat."""
        ...


class Extractor(Protocol):
    def extract(self, raw: str, seat: dict[str, Any]) -> list[Finding]:
        """Parse a seat's raw output into schema-valid Findings (never raises)."""
        ...


class Embedder(Protocol):
    async def embed(self, texts: list[str]) -> list[list[float]]:
        ...


class Contradictor(Protocol):
    async def contradicts(self, a: str, b: str) -> bool:
        """True if claim a contradicts claim b (NLI / cheap LLM)."""
        ...


class MemoryAdapter(Protocol):
    async def retrieve(self, objective: str, limit: int = 20) -> list[dict[str, Any]]:
        ...

    async def write_run(self, result: Any) -> list[str]:
        ...


class StateStore(Protocol):
    async def save(self, state: RunState) -> None: ...
    async def load(self, run_id: str) -> RunState | None: ...
    async def list_incomplete(self) -> list[str]: ...


# ------------------------------------------------ JSON structured extractor
_FENCE = re.compile(r"```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```", re.DOTALL)
# evidence kinds a MODEL may assert. REPLICATION is engine-only (independent
# agreement recorded by the blackboard/merge) — a seat claiming it is fabricating
# consensus; unknown kinds coerce to assertion rather than drop the whole finding.
_MODEL_EVIDENCE_KINDS = {"citation", "tool_result", "retrieval", "assertion"}
_MAX_EVIDENCE = 16


class JsonFindingExtractor:
    """Locate the JSON payload robustly (native block, fenced block, or JSON after a
    natural-language preamble via raw_decode), then validate. On parse failure,
    degrade to a single low-confidence finding — never crash, never fabricate a 0.5
    score silently. Real providers fence, prefix prose, and emit nested objects, so
    a naive `json.loads(raw)` or a non-greedy `{.*?}` regex silently loses findings.
    """

    @staticmethod
    def _find_json(raw: str) -> Any:
        m = _FENCE.search(raw)
        candidates = ([m.group(1)] if m else []) + [raw]
        dec = json.JSONDecoder()
        for c in candidates:
            c = c.strip()
            try:
                return json.loads(c)
            except Exception:  # noqa: BLE001
                pass
            # locate the first JSON value even behind a prose preamble / trailing text
            starts = [p for p in (c.find("{"), c.find("[")) if p >= 0]
            if starts:
                try:
                    obj, _end = dec.raw_decode(c[min(starts):])
                    return obj
                except Exception:  # noqa: BLE001
                    continue
        return None

    def extract(self, raw: str, seat: dict[str, Any]) -> list[Finding]:
        blocks: list[Any] = []
        raw = (raw or "").strip()
        if not raw:
            return []
        parsed = self._find_json(raw)
        if parsed is None:
            log.debug("extract: no JSON for seat=%s, degrading", seat.get("id"))
            return [self._degraded(raw, seat)]
        items = parsed.get("findings", parsed) if isinstance(parsed, dict) else parsed
        if isinstance(items, dict):
            items = [items]
        if not isinstance(items, list):
            return [self._degraded(raw, seat)]
        # ALLOWLIST model-supplied fields. A seat must NOT be able to self-grant
        # verified/contradicted or an evidence.status of 'verified' — those are the
        # engine's to set, and letting the model set them is the scores-are-lies defect
        # moved one field over. Everything trust-bearing is forced/stripped here.
        allow = {"claim", "claim_type", "confidence", "novelty", "importance", "source_refs"}
        for it in items:
            if not isinstance(it, dict) or "claim" not in it:
                continue
            clean = {k: v for k, v in it.items() if k in allow}
            ev_in = it.get("evidence") if isinstance(it.get("evidence"), list) else []
            clean["evidence"] = []
            for e in ev_in[:_MAX_EVIDENCE]:        # cap: no locator-spam to buy agreement
                if not isinstance(e, dict):
                    continue
                # allowlist the KIND: REPLICATION is engine-only (a seat claiming it is
                # fabricating independent agreement); unknown -> assertion, never dropped.
                kind = str(e.get("kind", "assertion")).lower()
                if kind not in _MODEL_EVIDENCE_KINDS:
                    kind = "assertion"
                clean["evidence"].append({
                    "kind": kind,
                    "locator": str(e.get("locator", ""))[:2000],
                    "snippet": str(e.get("snippet", ""))[:2000],
                    "status": "unverified"})       # model can NEVER assert verified
            clean.update(subproblem=seat.get("subproblem", ""), seat_id=seat.get("id", ""),
                         model=seat.get("model", ""), role=seat.get("role", ""),
                         verified=False, contradicted=False)
            try:
                blocks.append(Finding(**clean))
            except Exception as exc:  # noqa: BLE001
                log.debug("extract: invalid finding for seat=%s: %s", seat.get("id"), exc)
        return blocks or [self._degraded(raw, seat)]

    @staticmethod
    def _degraded(raw: str, seat: dict[str, Any]) -> Finding:
        return Finding(claim=raw[:500], confidence=0.2, novelty=0.2, importance=0.2,
                       subproblem=seat.get("subproblem", ""), seat_id=seat.get("id", ""),
                       model=seat.get("model", ""), role=seat.get("role", ""))


# --------------------------------------------------------------- fakes
class InMemoryStateStore:
    def __init__(self) -> None:
        self._d: dict[str, RunState] = {}
        self.saves = 0

    async def save(self, state: RunState) -> None:
        self.saves += 1
        self._d[state.run_id] = state.model_copy(deep=True)

    async def load(self, run_id: str) -> RunState | None:
        s = self._d.get(run_id)
        return s.model_copy(deep=True) if s else None

    async def list_incomplete(self) -> list[str]:
        return [r for r, s in self._d.items() if s.phase.value != "finalized"]


class FakeMemory:
    def __init__(self, memories: list[dict[str, Any]] | None = None) -> None:
        self._m = memories or []
        self.writes = 0
        self.write_calls: list[float] = []
        self.retrieved_after_first_pass = False

    async def retrieve(self, objective: str, limit: int = 20) -> list[dict[str, Any]]:
        return self._m[:limit]

    async def write_run(self, result: Any) -> list[str]:
        self.writes += 1
        import time as _t
        self.write_calls.append(_t.time())
        return ["mem_" + str(self.writes)]


class HashEmbedder:
    """Deterministic toy embedder: bag-of-words hashed to a fixed vector so tests
    are reproducible without a model. Similar claims land near each other."""

    def __init__(self, dim: int = 64) -> None:
        self.dim = dim

    @staticmethod
    def _h(tok: str) -> int:
        # hashlib, NOT builtin hash() — the latter is PYTHONHASHSEED-randomized, which
        # makes clustering (and therefore the acceptance gate) nondeterministic.
        return int.from_bytes(hashlib.md5(tok.encode()).digest()[:8], "big")

    async def embed(self, texts: list[str]) -> list[list[float]]:
        out = []
        for t in texts:
            v = [0.0] * self.dim
            for tok in re.findall(r"[a-z0-9]+", (t or "").lower()):
                v[self._h(tok) % self.dim] += 1.0
            n = math.sqrt(sum(x * x for x in v)) or 1.0
            out.append([x / n for x in v])
        return out


class KeywordContradictor:
    """Toy NLI: two claims contradict if one asserts and the other negates the
    same head noun (contains 'not'/'no' asymmetrically over a shared token)."""

    async def contradicts(self, a: str, b: str) -> bool:
        a, b = a.lower(), b.lower()
        neg = lambda s: any(w in s.split() for w in ("not", "no", "never", "false"))  # noqa: E731
        toks_a = set(re.findall(r"[a-z0-9]+", a)) - {"not", "no", "never", "false", "is", "the", "a"}
        toks_b = set(re.findall(r"[a-z0-9]+", b)) - {"not", "no", "never", "false", "is", "the", "a"}
        shared = toks_a & toks_b
        return bool(shared) and (neg(a) != neg(b))


class ScriptedModelAdapter:
    """Deterministic model adapter for tests: maps (role or seat_id) -> callable or
    literal reply. Records every prompt so tests can assert independence (no seat
    ever sees another seat's output in its first-pass prompt)."""

    def __init__(self, script: dict[str, Any], *, fail_seats: set[str] | None = None,
                 hang_seats: set[str] | None = None, cost: float = 0.0) -> None:
        self.script = script
        self.fail_seats = fail_seats or set()
        self.hang_seats = hang_seats or set()
        self.cost = cost
        self.prompts: list[dict[str, str]] = []

    async def call(self, *, seat_id, model, role, prompt, context, timeout):
        self.prompts.append({"seat_id": seat_id, "role": role, "prompt": prompt})
        if seat_id in self.hang_seats:
            await asyncio.sleep(timeout + 5)   # force a timeout
        if seat_id in self.fail_seats:
            return {"error": "scripted_failure"}
        key = seat_id if seat_id in self.script else role
        val = self.script.get(key, self.script.get("__default__", ""))
        text = val(prompt, context) if callable(val) else val
        return {"text": text, "cost_usd": self.cost}
