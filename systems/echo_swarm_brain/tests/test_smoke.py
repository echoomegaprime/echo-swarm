"""Smoke tests for echo-swarm-brain grading contract."""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import SERVICE, VERSION, app  # noqa: E402


MOCK_LLM = {"text": "GRADE: 8.5\nDEFECTS: spine_stress\nCONFIDENCE: 85\nANALYSIS: Solid copy.", "tokens": 42, "model": "echo-prime"}


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_health_shape(client: TestClient) -> None:
    with patch("app.chat_completion", return_value=MOCK_LLM):
        resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert "ok" in body
    assert body["service"] == SERVICE
    assert body["version"] == VERSION


def test_trinity_consult_contract(client: TestClient) -> None:
    with patch("app.chat_completion", return_value=MOCK_LLM):
        resp = client.post("/trinity/consult", json={"question": "Grade this comic.", "voice": "SAGE"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert "consultation" in body
    assert "analysis" in body["consultation"]
    assert body["consultation"]["model_used"] == "SAGE"


def test_trinity_decide_contract(client: TestClient) -> None:
    with patch("app.chat_completion", return_value=MOCK_LLM):
        resp = client.post(
            "/trinity/decide",
            json={"question": "Final grade?", "context": "test", "tier": "critical", "debate_rounds": 2},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert "decision" in body
    assert "voices" in body["decision"]


def test_swarm_think_contract(client: TestClient) -> None:
    with patch("app.chat_completion", return_value={**MOCK_LLM, "text": "Key issue research notes."}):
        resp = client.post("/swarm/think", json={"question": "Research Amazing Spider-Man #1", "agents": 50})
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body.get("synthesis")


def test_hybrid_ensemble_contract(client: TestClient) -> None:
    with patch("app.chat_completion", return_value={**MOCK_LLM, "text": '{"grade": 8.0, "confidence": 80, "defects": [], "analysis": "ok"}'}):
        resp = client.post(
            "/llm/hybrids/run",
            json={
                "method": "ensemble",
                "prompt": "Grade comic",
                "models": ["openai/gpt-4o", "anthropic/claude-opus-4-6"],
                "options": {"temperature": 0.2, "max_tokens": 500},
            },
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert len(body["results"]) >= 2
    assert "response" in body["results"][0]


def test_hybrid_debate_contract(client: TestClient) -> None:
    debate_text = "FINAL GRADE: 7.5\nReasoning: balanced verdict."
    with patch("app.chat_completion", return_value={**MOCK_LLM, "text": debate_text}):
        resp = client.post(
            "/llm/hybrids/run",
            json={"method": "debate", "prompt": "Grade debate", "options": {"rounds": 1, "temperature": 0.4}},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["rounds"]
    assert body["final"]


@pytest.mark.parametrize(
    ("path", "payload", "expected_error"),
    [
        ("/trinity/consult", {"question": "Grade this comic.", "voice": "SAGE"}, "trinity consultation failed"),
        ("/trinity/decide", {"question": "Final grade?"}, "trinity decision failed"),
        ("/swarm/think", {"question": "Research this issue."}, "swarm synthesis failed"),
        ("/llm/hybrids/run", {"method": "ensemble", "prompt": "Grade comic"}, "ensemble execution failed"),
        ("/llm/hybrids/run", {"method": "debate", "prompt": "Grade comic", "options": {"rounds": 1}}, "debate execution failed"),
        ("/llm/hybrids/run", {"method": "chain", "prompt": "Grade comic"}, "chain execution failed"),
    ],
)
def test_llm_failures_do_not_expose_exception_details(
    client: TestClient,
    caplog: pytest.LogCaptureFixture,
    path: str,
    payload: dict[str, object],
    expected_error: str,
) -> None:
    secret_detail = "internal-provider-token-and-stack-detail"
    with patch("app.chat_completion", side_effect=RuntimeError(secret_detail)):
        resp = client.post(path, json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"ok": False, "error": expected_error}
    assert secret_detail not in resp.text
    assert secret_detail not in caplog.text


def test_artifacts_roundtrip(client: TestClient) -> None:
    key = "comics/test/smoke.jpg"
    payload = b"\xff\xd8\xff\xe0fake-jpeg"
    with patch("app._db") as mock_db:
        mock_con = mock_db.return_value.__enter__.return_value
        mock_cur = mock_con.cursor.return_value.__enter__.return_value
        mock_cur.fetchone.return_value = ("image/jpeg", payload)
        post = client.post(f"/artifacts?key={key}", content=payload, headers={"Content-Type": "image/jpeg"})
        assert post.status_code == 200
        assert post.json()["ok"] is True
        assert post.json()["key"] == key
        get = client.get(f"/artifacts?key={key}")
        assert get.status_code == 200
        assert get.content == payload
