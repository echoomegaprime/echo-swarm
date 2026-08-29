#!/usr/bin/env python3
"""Pure hot-path algorithms for echo-swarm-brain (baseline vs optimized).

Used by ``bench_hotpath.py`` and production ``app.py``. Baseline (pre-perf)
algorithms live alongside optimized ones so the microbenchmark can measure
real before/after deltas without shipping dead code into request handlers.

Hotspots (profile of /health, /trinity/decide, /llm/hybrids/run, /artifacts)
--------------------------------------------------------------------------
Hottest path on FORGE: supervisor ``GET /health`` storms (every few seconds)
plus grade synthesis on every Trinity decide / hybrid debate verdict.

1. **connect-per-request** — every ``_db()`` opened a fresh psycopg2 connection
   (TCP + auth + SSL handshake tax on artifacts + health).
   → process-local ``SimpleConnectionPool`` reuse (wired in app.py; modeled here).

2. **/health probe storm** — SELECT 1 + LLM TCP connect on every poll with no
   cache (needless-IO under k8s/systemd health probes).
   → process-local ``TtlCache`` for health payload.

3. **grade parse recompile** — ``re.search(..., re.I)`` every voice every call
   (and again on synthesis fallback).
   → precompiled ``_GRADE_RE`` + ``parse_grade_fast``.

4. **weighted consensus O(n²)** — naive pairwise agreement clustering over voice
   grades when synthesizing multi-agent / multi-round verdicts.
   → O(n) histogram + weight accumulation (``weighted_consensus_fast``).

5. **debate transcript O(k²)** — ``s += chunk`` string growth over rounds.
   → ``str.join`` (``transcript_join``).

6. **LLM reachability re-probe** — socket create_connection every health hit.
   → TTL-gated probe result (modeled + wired via health cache).
"""
from __future__ import annotations

import json
import re
import time
from collections import defaultdict
from typing import Any, Sequence

__all__ = [
    "TtlCache",
    "FakePool",
    "GRADE_RE",
    "parse_grade_baseline",
    "parse_grade_fast",
    "grades_equivalent",
    "weighted_consensus_slow",
    "weighted_consensus_fast",
    "consensus_equivalent",
    "transcript_quadratic",
    "transcript_join",
    "transcripts_equivalent",
    "make_voice_texts",
    "make_debate_rounds",
    "simulate_connect_per_request",
    "simulate_pool_reuse",
    "simulate_uncached_health_reads",
    "simulate_cached_health_reads",
    "simulate_llm_probe_uncached",
    "simulate_llm_probe_cached",
]


# ---------------------------------------------------------------------------
# Precompiled grade parser
# ---------------------------------------------------------------------------
# One multipattern covers the formats the baseline tries serially.
GRADE_RE = re.compile(
    r"(?:FINAL\s+GRADE|GRADE|grade)\s*[:\s]\s*(\d+\.?\d*)"
    r'|"grade"\s*:\s*(\d+\.?\d*)',
    re.I,
)

# Baseline formats (each recompiled + searched serially — needless work).
_BASELINE_GRADE_PATTERNS = (
    r"FINAL\s+GRADE\s*[:\s]\s*(\d+\.?\d*)",
    r"GRADE\s*[:\s]\s*(\d+\.?\d*)",
    r"grade\s*[:\s]\s*(\d+\.?\d*)",
    r'"grade"\s*:\s*(\d+\.?\d*)',
)


# ---------------------------------------------------------------------------
# TTL cache (health / soft caches)
# ---------------------------------------------------------------------------
class TtlCache:
    """Process-local TTL cache (one uvicorn worker = one process)."""

    __slots__ = ("ttl_sec", "_store", "hits", "misses")

    def __init__(self, ttl_sec: float = 5.0) -> None:
        self.ttl_sec = float(ttl_sec)
        self._store: dict[str, tuple[float, Any]] = {}
        self.hits = 0
        self.misses = 0

    def get(self, key: str = "_", now: float | None = None) -> Any | None:
        t = time.monotonic() if now is None else now
        item = self._store.get(key)
        if item is None:
            self.misses += 1
            return None
        expires_at, value = item
        if t >= expires_at:
            self._store.pop(key, None)
            self.misses += 1
            return None
        self.hits += 1
        return value

    def set(self, value: Any, key: str = "_", now: float | None = None) -> Any:
        t = time.monotonic() if now is None else now
        self._store[key] = (t + self.ttl_sec, value)
        return value

    def invalidate(self, key: str | None = None) -> None:
        if key is None:
            self._store.clear()
        else:
            self._store.pop(key, None)

    def reset_counters(self) -> None:
        self.hits = 0
        self.misses = 0


# ---------------------------------------------------------------------------
# Fake pool — model connect cost without live Postgres
# ---------------------------------------------------------------------------
class FakePool:
    """Models connect-per-request vs pool reuse (synthetic connect tax)."""

    __slots__ = ("connects", "reuses", "work_per_connect", "_live")

    def __init__(self, work_per_connect: int = 120) -> None:
        self.connects = 0
        self.reuses = 0
        self.work_per_connect = int(work_per_connect)
        self._live = False

    def connect_fresh(self) -> None:
        self.connects += 1
        acc = 0
        for i in range(self.work_per_connect):
            acc = (acc + i * 31) & 0xFFFFFFFF
        _ = acc

    def checkout(self) -> None:
        if not self._live:
            self.connect_fresh()
            self._live = True
        else:
            self.reuses += 1


def simulate_connect_per_request(n: int = 200, work_per_connect: int = 120) -> FakePool:
    """Baseline: open a new connection for every request."""
    pool = FakePool(work_per_connect=work_per_connect)
    for _ in range(n):
        pool.connect_fresh()
    return pool


def simulate_pool_reuse(n: int = 200, work_per_connect: int = 120) -> FakePool:
    """Optimized: one connect, then N checkouts."""
    pool = FakePool(work_per_connect=work_per_connect)
    for _ in range(n):
        pool.checkout()
    return pool


# ---------------------------------------------------------------------------
# Grade parse — re.search each call vs precompiled
# ---------------------------------------------------------------------------
def parse_grade_baseline(text: str) -> float | None:
    """Pre-perf: serial re.compile+search over several grade formats + json.

    Models the cost of chasing LLM format variants by recompiling and scanning
    each pattern every call (needless work under multi-voice synthesis).
    """
    if not text:
        return None
    for pat in _BASELINE_GRADE_PATTERNS:
        m = re.compile(pat, re.I).search(text)
        if m:
            return max(0.5, min(10.0, float(m.group(1))))
    try:
        obj = json.loads(text)
        if isinstance(obj, dict) and obj.get("grade") is not None:
            return max(0.5, min(10.0, float(obj["grade"])))
    except Exception:
        pass
    return None


def parse_grade_fast(text: str) -> float | None:
    """Optimized: single precompiled multipattern; JSON only if looks structured."""
    if not text:
        return None
    m = GRADE_RE.search(text)
    if m:
        raw = m.group(1) if m.group(1) is not None else m.group(2)
        if raw is not None:
            return max(0.5, min(10.0, float(raw)))
    # Only attempt JSON when the payload looks structured.
    stripped = text.lstrip()
    if stripped[:1] in "{[":
        try:
            obj = json.loads(text)
            g = obj.get("grade") if isinstance(obj, dict) else None
            if g is not None:
                return max(0.5, min(10.0, float(g)))
        except Exception:
            pass
    return None


def grades_equivalent(a: float | None, b: float | None, tol: float = 1e-9) -> bool:
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False
    return abs(a - b) <= tol


# ---------------------------------------------------------------------------
# Weighted multi-voice consensus — O(n²) pairwise vs O(n) histogram
# ---------------------------------------------------------------------------
def weighted_consensus_slow(
    voices: Sequence[tuple[str, float]],
    *,
    agreement_tol: float = 0.51,
) -> float | None:
    """Pre-perf baseline: for each voice, score agreement with every other voice.

    Cost O(n²): pairwise |gi - gj| checks drive a "cluster weight", then the
    densest cluster's weighted mean is returned. Mirrors naive multi-agent
    grade fusion before the histogram rewrite.
    """
    n = len(voices)
    if n == 0:
        return None
    if n == 1:
        return round(voices[0][1], 1)

    best_score = -1.0
    best_mean: float | None = None
    for i in range(n):
        wi, gi = voices[i]
        cluster_w = float(wi)
        cluster_sum = gi * float(wi)
        for j in range(n):
            if i == j:
                continue
            wj, gj = voices[j]
            if abs(gi - gj) <= agreement_tol:
                cluster_w += float(wj)
                cluster_sum += gj * float(wj)
        if cluster_w > best_score:
            best_score = cluster_w
            best_mean = cluster_sum / cluster_w if cluster_w > 0 else gi
    return None if best_mean is None else round(best_mean, 1)


def weighted_consensus_fast(
    voices: Sequence[tuple[str, float]],
    *,
    agreement_tol: float = 0.51,
) -> float | None:
    """Optimized: bucket grades to 0.1 CGC steps, O(n + buckets) densest window.

    Buckets at 0.1 grade resolution (CGC half-steps covered). A sliding window
    of width ≈ 2 * agreement_tol gathers the densest agreement cluster without
    pairwise comparisons.
    """
    n = len(voices)
    if n == 0:
        return None
    if n == 1:
        return round(voices[0][1], 1)

    # weight + weighted_sum per 0.1-grade bucket key (int centi-grade * 10)
    buckets: dict[int, list[float]] = defaultdict(lambda: [0.0, 0.0])
    for w, g in voices:
        # Clamp to CGC range then bucket
        g_clamped = max(0.5, min(10.0, float(g)))
        key = int(round(g_clamped * 10))
        buckets[key][0] += float(w)
        buckets[key][1] += g_clamped * float(w)

    if not buckets:
        return None

    keys = sorted(buckets.keys())
    # Window half-width in 0.1 units from agreement_tol
    half = max(0, int(round(agreement_tol * 10)))

    best_w = -1.0
    best_mean: float | None = None
    # Prefix sums over sorted keys for O(B) window evaluation
    # For small B (≤96 CGC tenths) a direct window scan is fine and clearer.
    for center in keys:
        lo, hi = center - half, center + half
        w_sum = 0.0
        g_sum = 0.0
        for k in keys:
            if k < lo:
                continue
            if k > hi:
                break
            bw, bs = buckets[k]
            w_sum += bw
            g_sum += bs
        if w_sum > best_w:
            best_w = w_sum
            best_mean = g_sum / w_sum if w_sum > 0 else center / 10.0
    return None if best_mean is None else round(best_mean, 1)


def consensus_equivalent(
    a: float | None,
    b: float | None,
    *,
    tol: float = 0.15,
) -> bool:
    """Allow small bucket-rounding drift between pairwise and histogram."""
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False
    return abs(a - b) <= tol


# ---------------------------------------------------------------------------
# Debate transcript — quadratic += vs join
# ---------------------------------------------------------------------------
def transcript_quadratic(rounds: Sequence[dict[str, str]]) -> str:
    """Pre-perf: naive string accumulation (O(k²) growth)."""
    out = ""
    for d in rounds:
        chunk = (
            f"Round {d['round']}: BULL: {d['bull'][:200]} | "
            f"BEAR: {d['bear'][:200]} | JUDGE: {d['judge'][:200]}"
        )
        if out:
            out = out + "\n" + chunk
        else:
            out = chunk
    return out


def transcript_join(rounds: Sequence[dict[str, str]]) -> str:
    """Optimized: single join of prebuilt chunks."""
    parts = [
        f"Round {d['round']}: BULL: {d['bull'][:200]} | "
        f"BEAR: {d['bear'][:200]} | JUDGE: {d['judge'][:200]}"
        for d in rounds
    ]
    return "\n".join(parts)


def transcripts_equivalent(a: str, b: str) -> bool:
    return a == b


# ---------------------------------------------------------------------------
# Health / LLM probe simulations (needless-IO models)
# ---------------------------------------------------------------------------
def _probe_work(units: int = 80) -> int:
    acc = 0
    for i in range(units):
        acc = (acc + i * 13) & 0xFFFFFFFF
    return acc


def simulate_uncached_health_reads(n: int = 200, work_per_probe: int = 80) -> int:
    """Every health hit pays full DB+LLM probe tax."""
    total = 0
    for _ in range(n):
        total ^= _probe_work(work_per_probe)
        total ^= _probe_work(work_per_probe // 2)
    return total


def simulate_cached_health_reads(
    n: int = 200,
    work_per_probe: int = 80,
    ttl_hits: int = 20,
) -> int:
    """One miss every ttl_hits requests; rest are cache hits (near-zero work)."""
    total = 0
    cache: int | None = None
    for i in range(n):
        if cache is None or (i % max(1, ttl_hits) == 0):
            cache = _probe_work(work_per_probe) ^ _probe_work(work_per_probe // 2)
        total ^= cache
    return total


def simulate_llm_probe_uncached(n: int = 200, work: int = 100) -> int:
    total = 0
    for _ in range(n):
        total ^= _probe_work(work)
    return total


def simulate_llm_probe_cached(n: int = 200, work: int = 100, ttl_hits: int = 25) -> int:
    total = 0
    cached: int | None = None
    for i in range(n):
        if cached is None or (i % max(1, ttl_hits) == 0):
            cached = _probe_work(work)
        total ^= cached
    return total


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
def make_voice_texts(n: int = 400) -> list[str]:
    """Synthetic Trinity/ensemble voice blobs with embedded grades."""
    texts: list[str] = []
    for i in range(n):
        # CGC-ish grades 0.5–10.0 with some noise + prose
        grade = 0.5 + ((i * 7) % 96) / 10.0
        texts.append(
            f"Voice {i} analysis.\nGRADE: {grade:.1f}\n"
            f"REASONING: Defect cluster {i % 11}; market note {i % 17}. "
            f"{'x' * (20 + (i % 40))}"
        )
    return texts


def make_debate_rounds(n: int = 200, blob: int = 800) -> list[dict[str, str]]:
    """Large debate transcript fixture (rounds × long positions)."""
    filler = "argument " * (blob // 10)
    rounds: list[dict[str, str]] = []
    for r in range(1, n + 1):
        rounds.append(
            {
                "round": str(r),
                "bull": f"BULL r{r} {filler} GRADE: {min(10.0, 6.0 + r * 0.1):.1f}",
                "bear": f"BEAR r{r} {filler} GRADE: {max(0.5, 8.0 - r * 0.1):.1f}",
                "judge": f"JUDGE r{r} interim {filler[:200]} GRADE: 7.0",
            }
        )
    return rounds
