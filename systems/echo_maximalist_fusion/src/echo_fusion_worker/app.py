"""echo-fusion-worker · FastAPI app — the async host for echo.fusion.run.

Async-first by design: a live fusion run is minutes of multi-seat fan-out, so a
synchronous POST proxied through the gate would time out. `POST /run` returns 202
+ run_id immediately and drives the engine as a background task; `GET /runs/{id}`
polls phase/result. `wait:true` is a bounded (~30s) convenience for stub/selftest.

Binds 127.0.0.1 only — the sole caller is the SDK gate on the same host, which
removes the worker-auth question for this skeleton. Structured logs carry run_id
on every line.
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from echo_fusion.schemas import Budget, RunState
from .config import load_seats, seats_fingerprint
from .factory import build_engine, clamp_budget

WORKER_VERSION = "0.2.0"
WAIT_CAP_SECONDS = 30.0

logging.basicConfig(
    level=os.environ.get("FUSION_LOG_LEVEL", "INFO"),
    format='{"ts":"%(asctime)s","lvl":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}',
    stream=sys.stdout,
)
log = logging.getLogger("echo_fusion_worker.app")


class RunRequest(BaseModel):
    objective: str = Field(min_length=1)
    context: dict[str, Any] | None = None
    budget: dict[str, Any] | None = None
    wait: bool = False
    idempotency_key: str | None = None


class ResumeRequest(BaseModel):
    run_id: str = Field(min_length=1)


def create_app(*, engine: Any, profile: str, fingerprint: str) -> FastAPI:
    """Build the worker app around an already-constructed FusionEngine.

    Tests build the engine explicitly; the service builds it from seats.yaml at
    import (below). Keeping construction out of the app makes every path testable
    with no files or env.
    """
    app = FastAPI(title="echo-fusion-worker", version=WORKER_VERSION)
    app.state.engine = engine
    app.state.profile = profile
    app.state.fingerprint = fingerprint
    app.state.runs = {}     # run_id -> {phase, done, result, error}
    app.state.idem = {}     # idempotency_key -> run_id

    async def _drive(run_id: str, state: RunState) -> None:
        rec = app.state.runs[run_id]
        try:
            result = await engine.drive_state(state)
            rec["result"] = result.model_dump(mode="json")
            rec["phase"] = "done"
            log.info("run.done run_id=%s confidence=%.3f abstained=%s",
                     run_id, result.confidence, result.abstained)
        except Exception as exc:  # noqa: BLE001
            rec["error"] = repr(exc)
            rec["phase"] = "error"
            log.exception("run.error run_id=%s", run_id)
        finally:
            rec["done"] = True

    def _start(objective: str, context: dict[str, Any], budget: Budget) -> str:
        create_state = getattr(engine, "create_state", None)
        state = (
            create_state(objective, context, budget)
            if callable(create_state)
            else RunState(objective=objective, budget=budget)
        )
        run_id = state.run_id
        app.state.runs[run_id] = {"phase": "running", "done": False, "result": None, "error": None}
        log.info("run.start run_id=%s objective=%.80s max_calls=%d",
                 run_id, objective.replace("\n", " "), budget.max_calls)
        asyncio.create_task(_drive(run_id, state))
        return run_id

    async def _await_run(run_id: str, cap: float) -> None:
        rec = app.state.runs[run_id]
        waited = 0.0
        while not rec["done"] and waited < cap:
            await asyncio.sleep(0.05)
            waited += 0.05

    @app.get("/health")
    async def health() -> dict:
        health_metadata = getattr(engine, "health_metadata", None)
        metadata = await health_metadata() if callable(health_metadata) else {}
        return {
            "ok": True, "service": "echo-fusion-worker", "version": WORKER_VERSION,
            "profile": app.state.profile, "seats_fingerprint": app.state.fingerprint,
            "active_runs": sum(1 for r in app.state.runs.values() if not r["done"]),
            **metadata,
        }

    @app.post("/run")
    async def run(req: RunRequest) -> JSONResponse:
        if req.idempotency_key and req.idempotency_key in app.state.idem:
            rid = app.state.idem[req.idempotency_key]
            log.info("run.idempotent_hit key=%s run_id=%s", req.idempotency_key, rid)
            rec = app.state.runs.get(rid)
            if req.wait and rec is not None:
                if not rec["done"]:
                    await _await_run(rid, WAIT_CAP_SECONDS)
                    rec = app.state.runs[rid]
                if rec["done"]:
                    if rec["error"]:
                        raise HTTPException(status_code=500, detail=rec["error"])
                    return JSONResponse(
                        status_code=200,
                        content={"run_id": rid, "phase": "done", "done": True,
                                 "result": rec["result"]},
                    )
            return JSONResponse(status_code=202,
                                content={"run_id": rid,
                                         "phase": (rec or {}).get("phase", "running")})
        budget = clamp_budget(Budget(**req.budget) if req.budget else None)
        rid = _start(req.objective, req.context or {}, budget)
        if req.idempotency_key:
            app.state.idem[req.idempotency_key] = rid
        if req.wait:
            await _await_run(rid, WAIT_CAP_SECONDS)
            rec = app.state.runs[rid]
            if rec["done"]:
                if rec["error"]:
                    raise HTTPException(status_code=500, detail=rec["error"])
                return JSONResponse(status_code=200,
                                    content={"run_id": rid, "phase": "done",
                                             "done": True, "result": rec["result"]})
        return JSONResponse(status_code=202, content={"run_id": rid, "phase": "running"})

    @app.get("/runs/{run_id}")
    async def get_run(run_id: str) -> dict:
        rec = app.state.runs.get(run_id)
        if rec is None:
            restore = getattr(engine, "get_run", None)
            rec = restore(run_id) if callable(restore) else None
        if rec is None:
            raise HTTPException(status_code=404, detail=f"unknown run_id {run_id}")
        return {"run_id": run_id, "phase": rec["phase"], "done": rec["done"],
                "result": rec["result"], "error": rec["error"]}

    @app.post("/resume")
    async def resume(req: ResumeRequest) -> JSONResponse:
        rid = req.run_id
        log.info("run.resume run_id=%s", rid)

        async def _do_resume() -> None:
            try:
                result = await engine.resume(rid)
                app.state.runs[rid] = {"phase": "done", "done": True,
                                       "result": result.model_dump(mode="json"), "error": None}
            except Exception as exc:  # noqa: BLE001
                log.exception("resume.error run_id=%s", rid)
                app.state.runs[rid] = {"phase": "error", "done": True, "result": None,
                                       "error": repr(exc)}

        asyncio.create_task(_do_resume())
        return JSONResponse(status_code=202, content={"run_id": rid, "phase": "resuming"})

    @app.post("/selftest")
    async def selftest() -> dict:
        """Run a fixed objective through the configured engine end-to-end."""
        budget = clamp_budget(None)
        create_state = getattr(engine, "create_state", None)
        state = (
            create_state("selftest: name one U.S. state capital", {"selftest": True}, budget)
            if callable(create_state)
            else RunState(objective="selftest: name one U.S. state capital", budget=budget)
        )
        result = await engine.drive_state(state)
        ok = bool(result.answer)
        log.info("selftest ok=%s run_id=%s", ok, result.run_id)
        return {"ok": ok, "run_id": result.run_id, "answer": result.answer,
                "confidence": result.confidence, "abstained": result.abstained,
                "profile": app.state.profile}

    return app


def _build_from_env() -> FastAPI:
    seats_path = os.environ.get(
        "FUSION_SEATS_PATH",
        os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
            os.path.abspath(__file__)))), "config", "seats.yaml"),
    )
    profile = os.environ.get("FUSION_PROFILE", "stub")
    if profile == "live":
        import echo_fusion_worker.live_adapters  # noqa: F401 — registers the "live" profile
    elif profile == "reconstructed_v05":
        import echo_fusion_worker.portable_core  # noqa: F401 — exact 0.5.0 portable core
    cfg = load_seats(seats_path)   # fail-closed: bad/missing config aborts boot
    fingerprint = seats_fingerprint(cfg)
    log.info("boot seats=%s profile=%s fingerprint=%s", seats_path, profile, fingerprint)
    engine = build_engine(cfg, profile=profile)
    return create_app(engine=engine, profile=profile, fingerprint=fingerprint)


# Module-level ASGI app for `uvicorn echo_fusion_worker.app:app`.
app = _build_from_env()
