#!/usr/bin/env python3
"""Microbenchmark: echo-swarm-brain hot-path perf (before vs after).

Proves deltas for:

  1) weighted multi-voice consensus O(n²) pairwise → O(n) histogram
  2) grade parse re.search-each-call → precompiled GRADE_RE
  3) debate transcript quadratic += → str.join
  4) /health uncached probe storm → TTL cache
  5) LLM reachability re-probe → TTL
  6) connect-per-request → pool reuse

Run:  python3 bench_hotpath.py
Exit: 0 when all required benches meet speedup gates.
Writes: bench_report.json
"""
from __future__ import annotations

import json
import statistics
import sys
import time
from pathlib import Path
from typing import Any, Callable

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from hotpath import (  # noqa: E402
    consensus_equivalent,
    grades_equivalent,
    make_debate_rounds,
    make_voice_texts,
    parse_grade_baseline,
    parse_grade_fast,
    simulate_cached_health_reads,
    simulate_connect_per_request,
    simulate_llm_probe_cached,
    simulate_llm_probe_uncached,
    simulate_pool_reuse,
    simulate_uncached_health_reads,
    transcript_join,
    transcript_quadratic,
    transcripts_equivalent,
    weighted_consensus_fast,
    weighted_consensus_slow,
)

_ITER = 24
_WARM = 4
_BAR = 40
_MIN_CONSENSUS = 3.0
_MIN_PARSE = 1.5
_MIN_TRANSCRIPT = 1.5
_MIN_HEALTH = 3.0
_MIN_LLM = 3.0
_MIN_POOL = 2.0

REPORT_PATH = HERE / "bench_report.json"
VERSION = "3.2.0-perf"


def _bar(ratio: float) -> str:
    filled = min(int(max(0.0, ratio) * _BAR), _BAR)
    return "█" * filled + "░" * (_BAR - filled)


def _stats(durations: list[float]) -> dict[str, float]:
    ms = [d * 1_000 for d in durations]
    return {
        "mean": statistics.mean(ms),
        "median": statistics.median(ms),
        "p95": sorted(ms)[min(len(ms) - 1, int(0.95 * len(ms)))],
        "stdev": statistics.stdev(ms) if len(ms) > 1 else 0.0,
    }


def _time_fn(
    fn: Callable[[], Any],
    iterations: int = _ITER,
    warmup: int = _WARM,
) -> dict[str, float]:
    for _ in range(warmup):
        fn()
    durations: list[float] = []
    for _ in range(iterations):
        t0 = time.perf_counter()
        fn()
        durations.append(time.perf_counter() - t0)
    return _stats(durations)


def _print_comparison(label: str, slow: dict[str, float], fast: dict[str, float]) -> float:
    speedup = slow["mean"] / fast["mean"] if fast["mean"] > 0 else float("inf")
    rel = fast["mean"] / slow["mean"] if slow["mean"] > 0 else 0.0
    print(f"\n{'─' * 64}")
    print(f"  {label}")
    print(f"{'─' * 64}")
    print(f"  {'Metric':<12} {'BEFORE':>12} {'AFTER':>12} {'Speedup':>10}")
    print(f"  {'mean ms':<12} {slow['mean']:>12.4f} {fast['mean']:>12.4f} {speedup:>9.1f}×")
    print(f"  {'median ms':<12} {slow['median']:>12.4f} {fast['median']:>12.4f}")
    print(f"  {'p95 ms':<12} {slow['p95']:>12.4f} {fast['p95']:>12.4f}")
    print(f"  {'stdev ms':<12} {slow['stdev']:>12.4f} {fast['stdev']:>12.4f}")
    print()
    print(f"  BEFORE  {_bar(1.0)}  {slow['mean']:.4f} ms")
    print(f"  AFTER   {_bar(rel)}  {fast['mean']:.4f} ms")
    print(f"\n  → {speedup:.2f}× faster  ({100 * (1 - rel):.1f}% reduction in mean latency)")
    return speedup


def bench_consensus(n_voices: int = 1200) -> tuple[dict, dict, float, dict[str, Any]]:
    texts = make_voice_texts(n_voices)
    # Weight by voice index pattern (Trinity-style + ensemble)
    weights = [0.25 + (i % 5) * 0.05 for i in range(n_voices)]
    voices: list[tuple[str, float]] = []
    for i, t in enumerate(texts):
        g = parse_grade_fast(t)
        assert g is not None
        voices.append((str(weights[i]), g))

    slow_r = weighted_consensus_slow(voices)
    fast_r = weighted_consensus_fast(voices)
    assert consensus_equivalent(slow_r, fast_r), f"consensus mismatch {slow_r} vs {fast_r}"

    slow = _time_fn(lambda: weighted_consensus_slow(voices), iterations=12, warmup=2)
    fast = _time_fn(lambda: weighted_consensus_fast(voices), iterations=12, warmup=2)
    speedup = _print_comparison(
        "weighted_consensus (O(n²) pairwise → O(n) histogram buckets)",
        slow,
        fast,
    )
    return slow, fast, speedup, {
        "n_voices": n_voices,
        "slow_result": slow_r,
        "fast_result": fast_r,
    }


def bench_parse(n: int = 12000) -> tuple[dict, dict, float, dict[str, Any]]:
    texts = make_voice_texts(n)
    # Correctness on a sample
    for t in texts[:: max(1, n // 50)]:
        assert grades_equivalent(parse_grade_baseline(t), parse_grade_fast(t)), t[:80]

    slow = _time_fn(lambda: [parse_grade_baseline(t) for t in texts], iterations=12, warmup=2)
    fast = _time_fn(lambda: [parse_grade_fast(t) for t in texts], iterations=12, warmup=2)
    speedup = _print_comparison(
        "parse_grade (re.search each call → precompiled GRADE_RE)",
        slow,
        fast,
    )
    return slow, fast, speedup, {"n_texts": n}


def bench_transcript(n_rounds: int = 400) -> tuple[dict, dict, float, dict[str, Any]]:
    rounds = make_debate_rounds(n_rounds, blob=600)
    base = transcript_quadratic(rounds)
    opt = transcript_join(rounds)
    assert transcripts_equivalent(base, opt), "transcript mismatch"

    slow = _time_fn(lambda: transcript_quadratic(rounds), iterations=20, warmup=3)
    fast = _time_fn(lambda: transcript_join(rounds), iterations=20, warmup=3)
    speedup = _print_comparison(
        "debate transcript (quadratic += → str.join)",
        slow,
        fast,
    )
    return slow, fast, speedup, {"n_rounds": n_rounds, "chars": len(opt)}


def bench_health(n: int = 400) -> tuple[dict, dict, float, dict[str, Any]]:
    slow = _time_fn(
        lambda: simulate_uncached_health_reads(n=n, work_per_probe=120),
        iterations=16,
        warmup=2,
    )
    fast = _time_fn(
        lambda: simulate_cached_health_reads(n=n, work_per_probe=120, ttl_hits=20),
        iterations=16,
        warmup=2,
    )
    speedup = _print_comparison(
        "/health probe storm (uncached DB+LLM → TTL cache)",
        slow,
        fast,
    )
    return slow, fast, speedup, {"n_reads": n}


def bench_llm_probe(n: int = 500) -> tuple[dict, dict, float, dict[str, Any]]:
    slow = _time_fn(
        lambda: simulate_llm_probe_uncached(n=n, work=140),
        iterations=16,
        warmup=2,
    )
    fast = _time_fn(
        lambda: simulate_llm_probe_cached(n=n, work=140, ttl_hits=25),
        iterations=16,
        warmup=2,
    )
    speedup = _print_comparison(
        "LLM reachability re-probe (socket every hit → TTL)",
        slow,
        fast,
    )
    return slow, fast, speedup, {"n_probes": n}


def bench_pool(n: int = 500) -> tuple[dict, dict, float, dict[str, Any]]:
    def run_fresh() -> None:
        simulate_connect_per_request(n=n, work_per_connect=100)

    def run_pool() -> None:
        simulate_pool_reuse(n=n, work_per_connect=100)

    slow = _time_fn(run_fresh, iterations=14, warmup=2)
    fast = _time_fn(run_pool, iterations=14, warmup=2)
    speedup = _print_comparison(
        "DB connect-per-request → SimpleConnectionPool reuse",
        slow,
        fast,
    )
    p = simulate_pool_reuse(n=n)
    return slow, fast, speedup, {
        "n": n,
        "connects": p.connects,
        "reuses": p.reuses,
    }


def main() -> int:
    print(f"echo-swarm-brain microbenchmark  version={VERSION}")
    print(f"iterations≈{_ITER} warmup={_WARM}")

    suites: list[tuple[str, Callable[[], tuple], float]] = [
        ("weighted_consensus_on2_to_hist", bench_consensus, _MIN_CONSENSUS),
        ("parse_grade_precompiled", bench_parse, _MIN_PARSE),
        ("debate_transcript_join", bench_transcript, _MIN_TRANSCRIPT),
        ("health_ttl_cache", bench_health, _MIN_HEALTH),
        ("llm_probe_ttl", bench_llm_probe, _MIN_LLM),
        ("connection_pool_reuse", bench_pool, _MIN_POOL),
    ]

    report: dict[str, Any] = {
        "service": "echo-swarm-brain",
        "version": VERSION,
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "benches": {},
        "gates": {},
        "ok": True,
    }

    all_ok = True
    for name, fn, min_speedup in suites:
        slow, fast, speedup, extra = fn()
        gate_ok = speedup >= min_speedup
        if not gate_ok:
            all_ok = False
            print(f"  GATE FAIL {name}: {speedup:.2f}× < required {min_speedup:.1f}×")
        else:
            print(f"  GATE PASS {name}: {speedup:.2f}× ≥ {min_speedup:.1f}×")
        report["benches"][name] = {
            "before_mean_ms": slow["mean"],
            "after_mean_ms": fast["mean"],
            "speedup": round(speedup, 3),
            "before": slow,
            "after": fast,
            **extra,
        }
        report["gates"][name] = {
            "min_speedup": min_speedup,
            "observed": round(speedup, 3),
            "ok": gate_ok,
        }

    report["ok"] = all_ok
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"\nWrote {REPORT_PATH}")

    if all_ok:
        print("\nBENCH_OK — all hot-path gates passed")
        return 0
    print("\nBENCH_FAIL — one or more gates missed speedup threshold")
    return 1


if __name__ == "__main__":
    sys.exit(main())
