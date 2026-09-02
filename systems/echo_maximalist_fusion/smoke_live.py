#!/usr/bin/env python3
"""Fail-closed live smoke for the reconstructed Fusion worker.

The smoke talks to the deployed loopback service rather than an in-process test
client.  It never enables the deterministic provider profile.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from typing import Any
from urllib.parse import urlsplit

DEFAULT_BASE = "http://127.0.0.1:8358"
EXPECTED_WORKER_VERSION = "0.2.2"
EXPECTED_PROFILE = "MAXIMALIST_RECONSTRUCTED"
EXPECTED_CORE_VERSION = "0.5.3"
EXPECTED_CORE_SHA = "de84ad35d6cc9a9140c6c0448ad1ba700c0a2b4f"
EXPECTED_CAPABILITY_PROFILE = "echo_full_read"
EXPECTED_CAPABILITY_IDS = (
    "echo.arcanum.search",
    "echo.arcanum.enrich",
    "echo.knowledge.search",
    "echo.wolfram.llm",
    "echo.context.recall",
    "echo.brain.search",
    "echo.doctrine.search",
    "echo.caps.search",
    "echo.engine.query",
    "echo.wolfram.health",
    "echo.dr.phoenix_status",
)
RUN_ID = re.compile(r"^run_[0-9a-f]{32}$")


class SmokeFailure(RuntimeError):
    """A release-blocking smoke failure with a non-secret diagnostic."""


def validated_base(value: str) -> str:
    parsed = urlsplit(value.strip())
    if (
        parsed.scheme != "http"
        or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
        or parsed.port is None
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
    ):
        raise SmokeFailure("worker base must be an explicit loopback HTTP origin")
    return value.strip().rstrip("/")


def request_json(
    base: str,
    method: str,
    path: str,
    body: dict[str, Any] | None = None,
    *,
    timeout: float,
) -> tuple[int, dict[str, Any]]:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(
        base + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        response = urllib.request.urlopen(request, timeout=timeout)
    except urllib.error.HTTPError as exc:
        response = exc
    with response:
        raw = response.read(1_048_577)
        if len(raw) > 1_048_576:
            raise SmokeFailure(f"{method} {path} returned an oversized response")
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise SmokeFailure(f"{method} {path} returned invalid JSON") from exc
        if not isinstance(payload, dict):
            raise SmokeFailure(f"{method} {path} did not return a JSON object")
        return response.status, payload


def require(name: str, condition: bool, detail: str) -> None:
    if not condition:
        raise SmokeFailure(f"{name}: {detail}")
    print(f"PASS {name}")


def validate_health(status: int, health: dict[str, Any]) -> None:
    selected = health.get("selected_capability_ids")
    require(
        "health.http", status == 200 and health.get("ok") is True, f"status={status}"
    )
    require(
        "health.service",
        health.get("service") == "echo-fusion-worker",
        "service mismatch",
    )
    require(
        "health.worker_version",
        health.get("version") == EXPECTED_WORKER_VERSION,
        "version mismatch",
    )
    require(
        "health.profile", health.get("profile") == EXPECTED_PROFILE, "profile mismatch"
    )
    require(
        "health.non_parity",
        health.get("historical_parity") is False,
        "historical parity must be false",
    )
    require(
        "health.core_identity",
        health.get("core_version") == EXPECTED_CORE_VERSION
        and health.get("core_sha") == EXPECTED_CORE_SHA,
        "core version or source SHA mismatch",
    )
    require(
        "health.roster",
        health.get("configured_seat_count") == 40
        and health.get("trinity_separate") is True,
        "expected 40 swarm seats and separate Trinity",
    )
    require(
        "health.live_provider",
        health.get("provider_mode") == "live" and health.get("ready") is True,
        "live provider route is not ready",
    )
    require(
        "health.live_capabilities",
        health.get("capability_profile") == EXPECTED_CAPABILITY_PROFILE
        and health.get("capability_mode") == "live"
        and health.get("capability_ready") is True
        and health.get("degraded_capability_ids") == []
        and selected == list(EXPECTED_CAPABILITY_IDS),
        "one or more required Echo SDK capability routes are not ready",
    )
    require(
        "health.secret_boundary",
        health.get("credential_values_exposed") is False,
        "credential exposure guard is not asserted",
    )
    require(
        "health.state",
        isinstance(health.get("seats_fingerprint"), str)
        and bool(health["seats_fingerprint"])
        and isinstance(health.get("active_runs"), int),
        "state identity is incomplete",
    )


def validate_result(result: Any) -> None:
    require(
        "run.result_object",
        isinstance(result, dict),
        "completed run has no result object",
    )
    assert isinstance(result, dict)
    provenance = result.get("provenance")
    require(
        "run.answer",
        isinstance(result.get("answer"), str) and bool(result["answer"].strip()),
        "empty answer",
    )
    require("run.provenance", isinstance(provenance, dict), "missing provenance")
    assert isinstance(provenance, dict)
    require(
        "run.identity",
        provenance.get("profile") == EXPECTED_PROFILE
        and provenance.get("historical_parity") is False
        and provenance.get("core_version") == EXPECTED_CORE_VERSION
        and provenance.get("core_sha") == EXPECTED_CORE_SHA
        and provenance.get("trinity_separate") is True,
        "result identity does not match the reconstructed core",
    )
    require(
        "run.live_mode",
        provenance.get("provider_mode") == "live"
        and provenance.get("capability_mode") == "live",
        "test provider or non-live capability mode detected",
    )


def poll_complete(
    call: Callable[[str, str, dict[str, Any] | None], tuple[int, dict[str, Any]]],
    run_id: str,
    *,
    poll_timeout: float,
    poll_interval: float,
) -> dict[str, Any]:
    deadline = time.monotonic() + poll_timeout
    last_phase = "unknown"
    while time.monotonic() < deadline:
        status, body = call("GET", f"/runs/{run_id}", None)
        if status != 200:
            raise SmokeFailure(f"run.poll_http: status={status}")
        last_phase = str(body.get("phase", "unknown"))
        if body.get("done") is True:
            require("run.no_error", not body.get("error"), "worker recorded an error")
            validate_result(body.get("result"))
            return body
        time.sleep(poll_interval)
    raise SmokeFailure(
        f"run did not complete in {poll_timeout:.1f}s; last_phase={last_phase}"
    )


def run_smoke(
    base: str,
    *,
    request_timeout: float,
    poll_timeout: float,
    poll_interval: float,
) -> None:
    origin = validated_base(base)

    def call(method: str, path: str, body: dict[str, Any] | None = None):
        return request_json(origin, method, path, body, timeout=request_timeout)

    status, health = call("GET", "/health")
    validate_health(status, health)

    status, started = call(
        "POST",
        "/run",
        {
            "objective": "live smoke: identify the capital of Texas",
            "context": {"verification": "maximalist-reconstructed-live-smoke"},
            "budget": {"max_calls": 120, "max_cost_usd": 5.0, "max_wall_s": 2_400.0},
            "idempotency_key": "maximalist-reconstructed-live-smoke-v053",
        },
    )
    run_id = started.get("run_id")
    require(
        "run.async_start",
        status == 202
        and isinstance(run_id, str)
        and RUN_ID.fullmatch(run_id) is not None,
        f"status={status}",
    )
    assert isinstance(run_id, str)
    completed = poll_complete(
        call,
        run_id,
        poll_timeout=poll_timeout,
        poll_interval=poll_interval,
    )
    original_answer = completed["result"]["answer"]

    status, resumed = call("POST", "/resume", {"run_id": run_id})
    require(
        "resume.accepted",
        status == 202
        and resumed.get("run_id") == run_id
        and resumed.get("phase") == "resuming",
        f"status={status}",
    )
    resumed_result = poll_complete(
        call,
        run_id,
        poll_timeout=poll_timeout,
        poll_interval=poll_interval,
    )
    require(
        "resume.same_answer",
        resumed_result["result"]["answer"] == original_answer,
        "restart-safe resume changed the persisted answer",
    )

    status, _ = call("GET", "/runs/nope-not-real")
    require("unknown_run_404", status == 404, f"status={status}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base-url",
        default=os.environ.get("FUSION_WORKER_BASE", DEFAULT_BASE),
        help="explicit loopback worker origin",
    )
    parser.add_argument("--request-timeout", type=float, default=60.0)
    parser.add_argument("--poll-timeout", type=float, default=2_460.0)
    parser.add_argument("--poll-interval", type=float, default=0.5)
    args = parser.parse_args()
    if min(args.request_timeout, args.poll_timeout, args.poll_interval) <= 0:
        parser.error("timeouts and poll interval must be positive")
    return args


def main() -> int:
    args = parse_args()
    try:
        run_smoke(
            args.base_url,
            request_timeout=args.request_timeout,
            poll_timeout=args.poll_timeout,
            poll_interval=args.poll_interval,
        )
    except (SmokeFailure, OSError, TimeoutError) as exc:
        print(f"SMOKE FAILED: {exc}", file=sys.stderr)
        return 1
    print("SMOKE GREEN")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
