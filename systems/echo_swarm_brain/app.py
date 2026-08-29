#!/usr/bin/env python3
"""Echo Swarm Brain — sovereign FORGE replacement for the dead CF worker.

Contract-preserving routes for echo-ept.com grading:
  GET  /health
  POST /trinity/consult
  POST /trinity/decide
  POST /swarm/think
  POST /llm/hybrids/run
  POST /artifacts?key=
  GET  /artifacts?key=

LLM: ALPHA family server (ALPHA_LLM_BASE, loopback by default; model echo-prime).
Artifacts: Postgres bytea (schema swarm_brain).

Perf (v3.2.0-perf):
  - SimpleConnectionPool (connect-per-request → reuse)
  - /health TTL cache (needless DB+LLM probe storm)
  - precompiled grade parse + O(n) histogram consensus
  - debate transcript str.join; bull/bear parallel per round

Run: uvicorn app:app --host 127.0.0.1 --port 8260
"""
from __future__ import annotations

import logging
import os
import socket
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from typing import Any
from urllib.parse import urlparse

import psycopg2
import psycopg2.extras
import psycopg2.pool
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from hotpath import (
    TtlCache,
    parse_grade_fast,
    transcript_join,
    weighted_consensus_fast,
)
from llm import ALPHA_BASE, chat_completion

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [echo-swarm-brain] %(levelname)s %(message)s",
)
logger = logging.getLogger("echo_swarm_brain")

SERVICE = "echo-swarm-brain"
VERSION = "3.2.0-perf"
STARTED_AT = time.time()
PORT = int(os.environ.get("PORT", "8260"))
HEALTH_CACHE_TTL = float(os.environ.get("SWARM_BRAIN_HEALTH_CACHE_TTL", "5"))
PG_POOL_SIZE = max(1, int(os.environ.get("PGPOOL_MAX", os.environ.get("PG_POOL_SIZE", "6"))))

PG = dict(
    host=os.environ.get("PGHOST", "localhost"),
    user=os.environ.get("PGUSER", "echo"),
    password=os.environ.get("PGPASSWORD", ""),
    dbname=os.environ.get("PGDATABASE", "echo"),
    connect_timeout=int(os.environ.get("DB_CONNECT_TIMEOUT_SECONDS", "3")),
)

PG_POOL: psycopg2.pool.SimpleConnectionPool | None = None
_health_cache = TtlCache(ttl_sec=HEALTH_CACHE_TTL)

SCHEMA = """
CREATE SCHEMA IF NOT EXISTS swarm_brain;
CREATE TABLE IF NOT EXISTS swarm_brain.artifacts (
    key TEXT PRIMARY KEY,
    content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    data BYTEA NOT NULL,
    size_bytes BIGINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_swarm_brain_artifacts_created
    ON swarm_brain.artifacts (created_at DESC);
"""

TRINITY_VOICES = {
    "SAGE": {
        "name": "Sage",
        "weight": 0.4,
        "role": "Wisdom & Preservation",
        "system": (
            "You are SAGE on the Trinity Council — a meticulous CGC comic grader focused on "
            "long-term preservation quality, structural integrity, and conservative grading. "
            "Follow the response format in the user prompt exactly."
        ),
    },
    "NYX": {
        "name": "Nyx",
        "weight": 0.35,
        "role": "Patterns & Key Issues",
        "system": (
            "You are NYX on the Trinity Council — a pattern-recognition expert who spots subtle "
            "defects, key-issue significance, and market anomalies. "
            "Follow the response format in the user prompt exactly."
        ),
    },
    "THORNE": {
        "name": "Thorne",
        "weight": 0.25,
        "role": "Security & Risk",
        "system": (
            "You are THORNE on the Trinity Council — a risk-focused grader who evaluates worst-case "
            "defect impact and market-representative standards. "
            "Follow the response format in the user prompt exactly."
        ),
    },
}

ENSEMBLE_PERSONAS = [
    ("anthropic/claude-opus-4-6", "You are Claude Opus 4.6, an expert CGC comic grader. Respond in the requested JSON format."),
    ("openai/gpt-4o", "You are GPT-4o, an expert CGC comic grader. Respond in the requested JSON format."),
    ("google/gemini-2.5-pro", "You are Gemini 2.5 Pro, an expert CGC comic grader. Respond in the requested JSON format."),
    ("xai/grok-4", "You are Grok 4, an expert CGC comic grader. Respond in the requested JSON format."),
    ("qwen/qwen-2.5-vl-72b", "You are Qwen 2.5 VL, an expert CGC comic grader. Respond in the requested JSON format."),
]

_executor = ThreadPoolExecutor(max_workers=int(os.environ.get("LLM_POOL_SIZE", "8")))


def _init_db_pool() -> None:
    """Create the process-local SimpleConnectionPool (idempotent)."""
    global PG_POOL
    if PG_POOL is not None:
        return
    try:
        PG_POOL = psycopg2.pool.SimpleConnectionPool(1, PG_POOL_SIZE, **PG)
        logger.info("pg pool ready size=%s", PG_POOL_SIZE)
    except Exception:
        logger.exception("pg pool init failed; falling back to connect-per-request")
        PG_POOL = None


def _close_db_pool() -> None:
    global PG_POOL
    if PG_POOL is not None:
        try:
            PG_POOL.closeall()
        except Exception:
            logger.exception("pg pool close failed")
        PG_POOL = None


@contextmanager
def _db():
    """Yield a pooled Postgres connection (falls back to bare connect)."""
    _init_db_pool()
    if PG_POOL is None:
        con = psycopg2.connect(**PG)
        try:
            yield con
            con.commit()
        except Exception:
            con.rollback()
            raise
        finally:
            con.close()
        return

    con = PG_POOL.getconn()
    try:
        yield con
        con.commit()
    except Exception:
        try:
            con.rollback()
        except Exception:
            pass
        raise
    finally:
        PG_POOL.putconn(con)


def _init_db() -> None:
    with _db() as con, con.cursor() as cur:
        cur.execute(SCHEMA)


def _parse_grade(text: str) -> float | None:
    """CGC grade extract — precompiled regex (hotpath.parse_grade_fast)."""
    return parse_grade_fast(text)


def _weighted_grade_consensus(voices: dict[str, dict[str, Any]]) -> float | None:
    """Fuse Trinity voice grades via O(n) histogram (not pairwise O(n²))."""
    samples: list[tuple[str, float]] = []
    for vk, cfg in TRINITY_VOICES.items():
        g = _parse_grade(voices.get(vk.lower(), {}).get("text", ""))
        if g is not None:
            samples.append((str(cfg["weight"]), g))
    return weighted_consensus_fast(samples)


def _probe_db() -> bool:
    try:
        with _db() as con, con.cursor() as cur:
            cur.execute("SELECT 1")
        return True
    except Exception as exc:
        logger.warning("health_db_failed: %s", exc)
        return False


def _probe_llm() -> bool:
    try:
        parsed = urlparse(ALPHA_BASE)
        host = parsed.hostname or "127.0.0.1"
        port = parsed.port or 8200
        with socket.create_connection((host, port), timeout=2):
            return True
    except Exception as exc:
        logger.warning("health_llm_failed: %s", exc)
        return False


app = FastAPI(title="Echo Swarm Brain", version=VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    _init_db_pool()
    try:
        _init_db()
    except Exception as exc:
        logger.warning("schema init deferred/failed: %s", exc)
    logger.info("started service=%s version=%s port=%s pool=%s", SERVICE, VERSION, PORT, PG_POOL is not None)


@app.on_event("shutdown")
def shutdown() -> None:
    _close_db_pool()


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health() -> dict[str, Any]:
    cached = _health_cache.get("health")
    if cached is not None:
        # Refresh uptime on cache hits without re-probing deps.
        out = dict(cached)
        out["uptime_sec"] = int(time.time() - STARTED_AT)
        out["perf"] = {
            **(out.get("perf") or {}),
            "health_cache_hit": True,
            "health_cache_hits": _health_cache.hits,
            "health_cache_misses": _health_cache.misses,
        }
        return out

    db_ok = _probe_db()
    llm_ok = _probe_llm()
    payload = {
        "ok": db_ok and llm_ok,
        "status": "ok" if (db_ok and llm_ok) else "degraded",
        "service": SERVICE,
        "version": VERSION,
        "activeAgents": 50,
        "pendingTasks": 0,
        "uptime_sec": int(time.time() - STARTED_AT),
        "dependencies": {"postgres": db_ok, "alpha_llm": llm_ok},
        "perf": {
            "pool": PG_POOL is not None,
            "health_cache": True,
            "health_cache_ttl_sec": HEALTH_CACHE_TTL,
            "health_cache_hit": False,
            "grade_parse": "precompiled",
            "consensus": "histogram",
            "version": VERSION,
        },
    }
    _health_cache.set(payload, key="health")
    return payload


# ── Trinity consult ───────────────────────────────────────────────────────────

class TrinityConsultRequest(BaseModel):
    question: str
    voice: str
    context: str | None = None


@app.post("/trinity/consult")
def trinity_consult(body: TrinityConsultRequest) -> dict[str, Any]:
    voice_key = body.voice.upper()
    voice_cfg = TRINITY_VOICES.get(voice_key)
    if not voice_cfg:
        return JSONResponse(
            status_code=400,
            content={"ok": False, "error": f"Unknown voice: {body.voice}. Use SAGE, NYX, or THORNE"},
        )
    user_prompt = body.question
    if body.context:
        user_prompt = f"{body.question}\n\nContext: {body.context}"
    try:
        result = chat_completion(
            system=voice_cfg["system"],
            user=user_prompt,
            temperature=0.25,
            max_tokens=2000,
        )
    except Exception as exc:
        logger.error("trinity_consult_failed voice=%s err=%s", voice_key, exc)
        return {"ok": False, "error": str(exc)}
    return {
        "ok": True,
        "consultation": {
            "analysis": result["text"],
            "model_used": voice_key,
            "tokens_used": result["tokens"],
        },
    }


# ── Trinity decide ────────────────────────────────────────────────────────────

class TrinityDecideRequest(BaseModel):
    question: str
    context: str | None = None
    tier: str | None = "standard"
    debate_rounds: int = Field(default=2, ge=1, le=5)


@app.post("/trinity/decide")
def trinity_decide(body: TrinityDecideRequest) -> dict[str, Any]:
    user_base = body.question
    if body.context:
        user_base = f"{body.question}\n\nContext: {body.context}"
    grade_format = (
        "\n\nEach voice must respond with:\n"
        "GRADE: [number]\n"
        "REASONING: [2-3 sentences]\n\n"
        "After all voices, the council synthesizes a FINAL GRADE."
    )
    user_prompt = user_base + grade_format

    def _voice_call(voice_key: str) -> tuple[str, dict[str, Any]]:
        cfg = TRINITY_VOICES[voice_key]
        r = chat_completion(system=cfg["system"], user=user_prompt, temperature=0.2, max_tokens=1500)
        return voice_key.lower(), {"text": r["text"], "tokens": r["tokens"]}

    voices: dict[str, dict[str, Any]] = {}
    try:
        futures = {_executor.submit(_voice_call, vk): vk for vk in TRINITY_VOICES}
        for fut in as_completed(futures):
            key, data = fut.result()
            voices[key] = data
    except Exception as exc:
        logger.error("trinity_decide_failed err=%s", exc)
        return {"ok": False, "error": str(exc)}

    synthesis_prompt = (
        f"Question: {body.question}\n\n"
        f"SAGE: {voices.get('sage', {}).get('text', '')}\n\n"
        f"NYX: {voices.get('nyx', {}).get('text', '')}\n\n"
        f"THORNE: {voices.get('thorne', {}).get('text', '')}\n\n"
        "Synthesize the FINAL CGC grade of record. Respond:\n"
        "FINAL GRADE: [number]\n"
        "FINAL: [2-3 sentence synthesis]"
    )
    try:
        final_r = chat_completion(
            system="You are the Trinity Council synthesizer for CGC comic grading.",
            user=synthesis_prompt,
            temperature=0.15,
            max_tokens=800,
        )
        final_text = final_r["text"]
    except Exception as exc:
        logger.error("trinity_synthesis_failed err=%s", exc)
        final_text = voices.get("sage", {}).get("text", "")

    final_grade = _parse_grade(final_text)
    if final_grade is None:
        final_grade = _weighted_grade_consensus(voices)

    decision = {
        "voices": voices,
        "final": final_text,
        "final_grade": str(final_grade) if final_grade is not None else "",
    }
    return {"ok": True, "decision": decision, "voices": voices, "final_grade": decision["final_grade"]}


# ── Swarm think ───────────────────────────────────────────────────────────────

class SwarmThinkRequest(BaseModel):
    question: str | None = None
    topic: str | None = None
    context: str | None = None
    agents: int = Field(default=50, ge=1, le=200)


@app.post("/swarm/think")
def swarm_think(body: SwarmThinkRequest) -> dict[str, Any]:
    topic = body.question or body.topic
    if not topic:
        return JSONResponse(status_code=400, content={"ok": False, "error": "question required"})
    system = (
        f"You are the COLLECTIVE INTELLIGENCE of a swarm of {body.agents} AI agents. "
        "Think as a unified hive mind. Provide strategic research synthesis for comic collecting."
    )
    user = topic if not body.context else f"Topic: {topic}\n\nContext: {body.context}"
    try:
        result = chat_completion(system=system, user=user, temperature=0.4, max_tokens=3000)
    except Exception as exc:
        logger.error("swarm_think_failed err=%s", exc)
        return {"ok": False, "error": str(exc)}
    return {
        "ok": True,
        "synthesis": result["text"],
        "result": result["text"],
        "answer": result["text"],
        "swarm_size": body.agents,
        "tokens": result["tokens"],
        "model": result["model"],
    }


# ── LLM hybrids ───────────────────────────────────────────────────────────────

class HybridImage(BaseModel):
    data: str
    type: str = "image/jpeg"


class HybridRunRequest(BaseModel):
    method: str
    prompt: str
    models: list[str] | None = None
    images: list[HybridImage] | None = None
    options: dict[str, Any] | None = None
    hybrid_id: str | None = None
    system_prompt: str | None = None


@app.post("/llm/hybrids/run")
def llm_hybrid_run(body: HybridRunRequest) -> dict[str, Any]:
    method = body.method
    opts = body.options or {}
    temperature = float(opts.get("temperature", 0.3))
    max_tokens = int(opts.get("max_tokens", 2000))
    image_dicts = [{"data": i.data, "type": i.type} for i in (body.images or [])]

    if method == "ensemble":
        personas = ENSEMBLE_PERSONAS
        if body.models:
            personas = [
                (m, f"You are {m}, an expert CGC comic grader. Respond in the requested format.")
                for m in body.models[: len(ENSEMBLE_PERSONAS)]
            ]
        results: list[dict[str, str]] = []

        def _ensemble_call(idx_model: tuple[int, tuple[str, str]]) -> tuple[int, str]:
            idx, (model_label, persona) = idx_model
            r = chat_completion(
                system=persona,
                user=body.prompt,
                temperature=temperature,
                max_tokens=max_tokens,
                images=image_dicts if idx == 0 else None,
            )
            return idx, r["text"]

        try:
            futures = {
                _executor.submit(_ensemble_call, (i, p)): i
                for i, p in enumerate(personas)
            }
            ordered: dict[int, str] = {}
            for fut in as_completed(futures):
                idx, text = fut.result()
                ordered[idx] = text
            for i in range(len(personas)):
                text = ordered.get(i, "")
                results.append({"response": text, "text": text})
        except Exception as exc:
            logger.error("ensemble_failed err=%s", exc)
            return {"ok": False, "error": str(exc)}
        return {"ok": True, "method": "ensemble", "results": results}

    if method == "debate":
        rounds_n = int(opts.get("rounds", 3))
        bull_sys = "You are the BULL — argue the CGC grade should be HIGHER. Be persuasive."
        bear_sys = "You are the BEAR — argue the CGC grade should be LOWER. Be persuasive."
        judge_sys = "You are the JUDGE — render a final adjusted CGC grade with clear reasoning."

        debate_rounds: list[dict[str, str]] = []
        bull_pos = ""
        bear_pos = ""
        try:
            for r in range(rounds_n):
                bull_prompt = body.prompt if r == 0 else (
                    f"Original: {body.prompt}\n\nBEAR position:\n{bear_pos}\n\nStrengthen your BULL argument."
                )
                bear_prompt = body.prompt if r == 0 else (
                    f"Original: {body.prompt}\n\nBULL position:\n{bull_pos}\n\nStrengthen your BEAR argument."
                )

                # Bull and bear only depend on prior-round positions — run in parallel.
                # Bind loop vars via defaults so late-bound closures cannot race.
                def _bull(
                    bp: str = bull_prompt,
                    first: bool = (r == 0),
                ) -> dict[str, Any]:
                    return chat_completion(
                        system=bull_sys,
                        user=bp,
                        temperature=temperature,
                        max_tokens=max_tokens,
                        images=image_dicts if first else None,
                    )

                def _bear(bp: str = bear_prompt) -> dict[str, Any]:
                    return chat_completion(
                        system=bear_sys,
                        user=bp,
                        temperature=temperature,
                        max_tokens=max_tokens,
                    )

                fut_bull = _executor.submit(_bull)
                fut_bear = _executor.submit(_bear)
                bull_r = fut_bull.result()
                bear_r = fut_bear.result()
                bull_pos = bull_r["text"]
                bear_pos = bear_r["text"]
                judge_r = chat_completion(
                    system=judge_sys,
                    user=f"BULL:\n{bull_pos}\n\nBEAR:\n{bear_pos}\n\nRender round {r + 1} interim verdict.",
                    temperature=0.2,
                    max_tokens=600,
                )
                debate_rounds.append({
                    "round": r + 1,
                    "bull": bull_pos,
                    "bear": bear_pos,
                    "judge": judge_r["text"],
                })
            final_judge = chat_completion(
                system=judge_sys,
                user=f"Original question: {body.prompt}\n\nBULL final:\n{bull_pos}\n\nBEAR final:\n{bear_pos}\n\nRender FINAL adjusted CGC grade.",
                temperature=0.15,
                max_tokens=800,
            )
            final_text = final_judge["text"]
        except Exception as exc:
            logger.error("debate_failed err=%s", exc)
            return {"ok": False, "error": str(exc)}
        # str.join path (hotpath.transcript_join) — avoids O(k²) += growth
        transcript = transcript_join(
            [
                {
                    "round": str(d["round"]),
                    "bull": d["bull"],
                    "bear": d["bear"],
                    "judge": d["judge"],
                }
                for d in debate_rounds
            ]
        )
        return {
            "ok": True,
            "method": "debate",
            "rounds": debate_rounds,
            "final": final_text,
            "verdict": final_text,
            "judge": final_text,
            "transcript": transcript,
        }

    if method == "chain":
        try:
            r = chat_completion(system=body.system_prompt or "You are a helpful AI.", user=body.prompt, temperature=temperature, max_tokens=max_tokens)
        except Exception as exc:
            return {"ok": False, "error": str(exc)}
        return {"ok": True, "method": "chain", "content": r["text"], "results": [{"response": r["text"], "text": r["text"]}]}

    return JSONResponse(status_code=400, content={"ok": False, "error": f"Unknown method: {method}"})


# ── Artifacts (Postgres bytea) ────────────────────────────────────────────────

@app.post("/artifacts")
async def artifact_upload(request: Request, key: str = Query(...)) -> dict[str, Any]:
    if not key or ".." in key or key.startswith("/"):
        raise HTTPException(status_code=400, detail="invalid key")
    body = await request.body()
    if len(body) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Artifact exceeds 25MB limit")
    content_type = request.headers.get("content-type", "application/octet-stream")
    with _db() as con, con.cursor() as cur:
        cur.execute(
            """
            INSERT INTO swarm_brain.artifacts (key, content_type, data, size_bytes, updated_at)
            VALUES (%s, %s, %s, %s, now())
            ON CONFLICT (key) DO UPDATE SET
                content_type = EXCLUDED.content_type,
                data = EXCLUDED.data,
                size_bytes = EXCLUDED.size_bytes,
                updated_at = now()
            """,
            (key, content_type, psycopg2.Binary(body), len(body)),
        )
    return {"ok": True, "key": key, "size": len(body), "contentType": content_type}


@app.get("/artifacts")
def artifact_get(key: str = Query(...)) -> Response:
    with _db() as con, con.cursor() as cur:
        cur.execute(
            "SELECT content_type, data FROM swarm_brain.artifacts WHERE key = %s",
            (key,),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Artifact not found")
    content_type, data = row
    return Response(content=bytes(data), media_type=content_type or "application/octet-stream")


# Legacy path alias used by archived CF worker
@app.post("/artifacts/upload")
async def artifact_upload_legacy(request: Request, key: str = Query(...)) -> dict[str, Any]:
    return await artifact_upload(request, key)


@app.get("/artifacts/{key:path}")
def artifact_get_path(key: str) -> Response:
    return artifact_get(key=key)
