"""Unit tests for echo-swarm-brain hotpath algorithms + app wiring."""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from hotpath import (  # noqa: E402
    TtlCache,
    consensus_equivalent,
    grades_equivalent,
    make_debate_rounds,
    make_voice_texts,
    parse_grade_baseline,
    parse_grade_fast,
    simulate_connect_per_request,
    simulate_pool_reuse,
    transcript_join,
    transcript_quadratic,
    transcripts_equivalent,
    weighted_consensus_fast,
    weighted_consensus_slow,
)


class TestGradeParse:
    def test_plain_grade_line(self) -> None:
        text = "GRADE: 8.5\nREASONING: solid"
        assert parse_grade_fast(text) == 8.5
        assert grades_equivalent(parse_grade_baseline(text), parse_grade_fast(text))

    def test_json_grade(self) -> None:
        text = '{"grade": 9.2, "analysis": "NM"}'
        assert parse_grade_fast(text) == 9.2
        assert grades_equivalent(parse_grade_baseline(text), parse_grade_fast(text))

    def test_clamp_bounds(self) -> None:
        assert parse_grade_fast("GRADE: 0.1") == 0.5
        assert parse_grade_fast("GRADE: 12") == 10.0

    def test_missing(self) -> None:
        assert parse_grade_fast("no grade here") is None
        assert parse_grade_fast("") is None

    def test_fixture_parity(self) -> None:
        for t in make_voice_texts(80):
            assert grades_equivalent(parse_grade_baseline(t), parse_grade_fast(t))


class TestConsensus:
    def test_single_voice(self) -> None:
        voices = [("1.0", 8.0)]
        assert weighted_consensus_fast(voices) == 8.0
        assert weighted_consensus_slow(voices) == 8.0

    def test_empty(self) -> None:
        assert weighted_consensus_fast([]) is None
        assert weighted_consensus_slow([]) is None

    def test_dense_cluster(self) -> None:
        voices = [
            ("0.4", 8.0),
            ("0.35", 8.2),
            ("0.25", 5.0),  # outlier
        ]
        slow = weighted_consensus_slow(voices)
        fast = weighted_consensus_fast(voices)
        assert consensus_equivalent(slow, fast)
        # Densest agreement is around 8.x, not the 5.0 outlier
        assert slow is not None and slow >= 7.5
        assert fast is not None and fast >= 7.5

    def test_large_fixture_parity(self) -> None:
        texts = make_voice_texts(200)
        voices: list[tuple[str, float]] = []
        for i, t in enumerate(texts):
            g = parse_grade_fast(t)
            assert g is not None
            voices.append((str(0.2 + (i % 4) * 0.1), g))
        slow = weighted_consensus_slow(voices)
        fast = weighted_consensus_fast(voices)
        assert consensus_equivalent(slow, fast, tol=0.2)


class TestTranscript:
    def test_join_matches_quadratic(self) -> None:
        rounds = make_debate_rounds(12, blob=100)
        assert transcripts_equivalent(
            transcript_quadratic(rounds),
            transcript_join(rounds),
        )

    def test_empty(self) -> None:
        assert transcript_join([]) == ""
        assert transcript_quadratic([]) == ""


class TestPoolAndCache:
    def test_pool_reuses(self) -> None:
        fresh = simulate_connect_per_request(n=50, work_per_connect=2)
        pooled = simulate_pool_reuse(n=50, work_per_connect=2)
        assert fresh.connects == 50
        assert pooled.connects == 1
        assert pooled.reuses == 49

    def test_ttl_cache_hit_miss(self) -> None:
        c = TtlCache(ttl_sec=60.0)
        assert c.get("h") is None
        c.set({"ok": True}, key="h")
        assert c.get("h") == {"ok": True}
        assert c.hits >= 1
        c.invalidate("h")
        assert c.get("h") is None


class TestAppWiring:
    """Exercise production app imports for parse/consensus/health cache."""

    @pytest.fixture
    def client(self) -> TestClient:
        from app import app  # noqa: WPS433

        return TestClient(app)

    def test_version_perf_tag(self) -> None:
        import app as swarm  # noqa: WPS433

        assert "perf" in swarm.VERSION

    def test_parse_grade_uses_fast(self) -> None:
        import app as swarm  # noqa: WPS433

        assert swarm._parse_grade("GRADE: 7.5") == 7.5
        assert swarm._parse_grade('{"grade": 6.0}') == 6.0

    def test_weighted_consensus_helper(self) -> None:
        import app as swarm  # noqa: WPS433

        g = swarm._weighted_grade_consensus(
            {
                "sage": {"text": "GRADE: 8.0"},
                "nyx": {"text": "GRADE: 8.2"},
                "thorne": {"text": "GRADE: 5.0"},
            }
        )
        assert g is not None
        assert 7.5 <= g <= 8.5

    def test_health_uses_cache(self, client: TestClient) -> None:
        import app as swarm  # noqa: WPS433

        swarm._health_cache.invalidate()
        with patch.object(swarm, "_probe_db", return_value=True) as pdb, patch.object(
            swarm, "_probe_llm", return_value=True
        ) as pllm:
            r1 = client.get("/health")
            r2 = client.get("/health")
        assert r1.status_code == 200
        assert r2.status_code == 200
        body = r1.json()
        assert body["service"] == "echo-swarm-brain"
        assert "perf" in body
        assert body["perf"]["health_cache"] is True
        # Second call should hit TTL (probes once)
        assert pdb.call_count == 1
        assert pllm.call_count == 1

    def test_trinity_decide_uses_fast_parse(self, client: TestClient) -> None:
        mock = {
            "text": "GRADE: 8.5\nREASONING: NM spine.",
            "tokens": 20,
            "model": "echo-prime",
        }
        with patch("app.chat_completion", return_value=mock):
            resp = client.post(
                "/trinity/decide",
                json={"question": "Final grade?", "context": "test", "debate_rounds": 1},
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["ok"] is True
        assert body.get("final_grade") == "8.5"
