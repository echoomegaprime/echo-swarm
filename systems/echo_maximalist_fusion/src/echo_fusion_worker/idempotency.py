"""Durable, fail-closed idempotency records for the Fusion worker.

The worker must commit an idempotency key before it schedules provider work.
Only SHA-256 digests of caller keys are persisted or logged.  Each key is also
bound to a canonical request digest so accidental key reuse cannot return an
unrelated run.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

IDEMPOTENCY_SCHEMA = "echo.maximalist.idempotency.v1"
PROFILE_NAME = "MAXIMALIST_RECONSTRUCTED"
RUN_ID_RE = re.compile(r"^run_[0-9a-f]{12,32}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


class IdempotencyStoreError(RuntimeError):
    """Persistent idempotency state is unavailable or invalid."""


class IdempotencyConflict(IdempotencyStoreError):
    """A key was reused for a request other than the one it originally named."""


def _canonical_json(value: Any) -> bytes:
    try:
        encoded = json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=True,
        )
    except (TypeError, ValueError) as exc:
        raise IdempotencyStoreError("idempotency input is not canonical JSON") from exc
    return encoded.encode("utf-8")


def key_sha256(key: str) -> str:
    if not key or len(key) > 512 or any(ord(character) < 32 for character in key):
        raise IdempotencyStoreError(
            "idempotency key must be 1-512 printable characters"
        )
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def request_sha256(*, objective: str, context: dict[str, Any], budget: Any) -> str:
    """Bind a key to caller intent, excluding transient budget counters/timestamps."""

    def budget_value(name: str) -> Any:
        return budget[name] if isinstance(budget, dict) else getattr(budget, name)

    normalized_budget = {
        "max_calls": int(budget_value("max_calls")),
        "max_cost_usd": float(budget_value("max_cost_usd")),
        "max_wall_s": float(budget_value("max_wall_s")),
    }
    payload = {
        "objective": objective,
        "context": context,
        "budget": normalized_budget,
    }
    return hashlib.sha256(_canonical_json(payload)).hexdigest()


class IdempotencyStore:
    """Atomic JSON idempotency map; ``path=None`` is explicitly process-local."""

    def __init__(self, path: str | Path | None = None) -> None:
        self.path = Path(path) if path is not None else None
        self._lock = threading.RLock()
        self._entries: dict[str, dict[str, Any]] = {}
        if self.path is not None:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self._entries = self._load()

    @property
    def persistent(self) -> bool:
        return self.path is not None

    @property
    def entry_count(self) -> int:
        with self._lock:
            return len(self._entries)

    def lookup(self, key: str, expected_request_sha256: str) -> str | None:
        digest = key_sha256(key)
        if not SHA256_RE.fullmatch(expected_request_sha256):
            raise IdempotencyStoreError("request digest is invalid")
        with self._lock:
            entry = self._entries.get(digest)
            if entry is None:
                return None
            if entry["request_sha256"] != expected_request_sha256:
                raise IdempotencyConflict(
                    "idempotency key is already bound to a different request"
                )
            return str(entry["run_id"])

    def bind(self, key: str, request_digest: str, run_id: str) -> str:
        digest = key_sha256(key)
        if not SHA256_RE.fullmatch(request_digest):
            raise IdempotencyStoreError("request digest is invalid")
        if not RUN_ID_RE.fullmatch(run_id):
            raise IdempotencyStoreError(
                "run_id is not a canonical Fusion run identifier"
            )
        with self._lock:
            existing = self._entries.get(digest)
            if existing is not None:
                if existing["request_sha256"] != request_digest:
                    raise IdempotencyConflict(
                        "idempotency key is already bound to a different request"
                    )
                if existing["run_id"] != run_id:
                    raise IdempotencyConflict(
                        "idempotency key is already bound to a different run"
                    )
                return run_id
            self._entries[digest] = {
                "run_id": run_id,
                "request_sha256": request_digest,
                "created_at": time.time(),
            }
            try:
                self._persist()
            except Exception:
                self._entries.pop(digest, None)
                raise
            return run_id

    def _load(self) -> dict[str, dict[str, Any]]:
        assert self.path is not None
        if not self.path.exists():
            return {}
        try:
            with self.path.open("r", encoding="utf-8") as handle:
                document = json.load(handle)
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise IdempotencyStoreError(
                f"idempotency store cannot be read safely: {self.path}"
            ) from exc
        if (
            not isinstance(document, dict)
            or document.get("schema") != IDEMPOTENCY_SCHEMA
            or document.get("profile") != PROFILE_NAME
            or document.get("historical_parity") is not False
            or not isinstance(document.get("entries"), dict)
        ):
            raise IdempotencyStoreError(
                "idempotency store provenance or schema is invalid"
            )
        entries: dict[str, dict[str, Any]] = {}
        for digest, raw in document["entries"].items():
            if (
                not isinstance(digest, str)
                or not SHA256_RE.fullmatch(digest)
                or not isinstance(raw, dict)
                or not RUN_ID_RE.fullmatch(str(raw.get("run_id", "")))
                or not SHA256_RE.fullmatch(str(raw.get("request_sha256", "")))
                or not isinstance(raw.get("created_at"), (int, float))
            ):
                raise IdempotencyStoreError(
                    "idempotency store contains an invalid entry"
                )
            entries[digest] = {
                "run_id": str(raw["run_id"]),
                "request_sha256": str(raw["request_sha256"]),
                "created_at": float(raw["created_at"]),
            }
        return entries

    def _document(self) -> dict[str, Any]:
        return {
            "schema": IDEMPOTENCY_SCHEMA,
            "profile": PROFILE_NAME,
            "historical_parity": False,
            "entries": self._entries,
        }

    def _persist(self) -> None:
        if self.path is None:
            return
        descriptor = -1
        temporary = ""
        try:
            descriptor, temporary = tempfile.mkstemp(
                prefix=f".{self.path.name}.", suffix=".tmp", dir=self.path.parent
            )
            try:
                os.chmod(temporary, 0o600)
            except OSError:
                pass
            with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
                descriptor = -1
                json.dump(self._document(), handle, indent=2, sort_keys=True)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.path)
            temporary = ""
            try:
                os.chmod(self.path, 0o600)
            except OSError:
                pass
        except OSError as exc:
            raise IdempotencyStoreError(
                f"idempotency store cannot be committed atomically: {self.path}"
            ) from exc
        finally:
            if descriptor >= 0:
                os.close(descriptor)
            if temporary and os.path.exists(temporary):
                os.unlink(temporary)


def seed_completed_run(
    *,
    store_path: str | Path,
    state_dir: str | Path,
    run_id: str,
    key: str,
    request: dict[str, Any],
) -> dict[str, Any]:
    """Operator migration for a verified completed run; never seeds partial state."""
    if not RUN_ID_RE.fullmatch(run_id):
        raise IdempotencyStoreError("run_id is not a canonical Fusion run identifier")
    if set(request) != {"objective", "context", "budget"}:
        raise IdempotencyStoreError(
            "seed request must contain exactly objective, context, and budget"
        )
    if not isinstance(request["objective"], str) or not request["objective"].strip():
        raise IdempotencyStoreError("seed objective must be non-empty")
    if not isinstance(request["context"], dict) or not isinstance(
        request["budget"], dict
    ):
        raise IdempotencyStoreError("seed context and budget must be JSON objects")

    checkpoint_path = Path(state_dir) / f"{run_id}.json"
    try:
        with checkpoint_path.open("r", encoding="utf-8") as handle:
            checkpoint = json.load(handle)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise IdempotencyStoreError("completed run checkpoint is unavailable") from exc
    if (
        not isinstance(checkpoint, dict)
        or checkpoint.get("profile") != PROFILE_NAME
        or checkpoint.get("historical_parity") is not False
        or checkpoint.get("run_id") != run_id
        or checkpoint.get("status") != "completed"
        or not isinstance(checkpoint.get("result"), dict)
    ):
        raise IdempotencyStoreError(
            "seed target is not a completed MAXIMALIST_RECONSTRUCTED checkpoint"
        )

    digest = request_sha256(
        objective=request["objective"],
        context=request["context"],
        budget=request["budget"],
    )
    store = IdempotencyStore(store_path)
    existing = store.lookup(key, digest)
    if existing is not None and existing != run_id:
        raise IdempotencyConflict("seed key is already bound to another completed run")
    store.bind(key, digest, run_id)
    return {
        "schema": IDEMPOTENCY_SCHEMA,
        "profile": PROFILE_NAME,
        "historical_parity": False,
        "run_id": run_id,
        "key_sha256": key_sha256(key),
        "request_sha256": digest,
        "seeded": existing is None,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Seed one verified completed Fusion run into a durable idempotency map."
    )
    parser.add_argument("--store", required=True)
    parser.add_argument("--state-dir", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--request-file", required=True)
    args = parser.parse_args(argv)
    key = sys.stdin.readline().rstrip("\r\n")
    try:
        with Path(args.request_file).open("r", encoding="utf-8") as handle:
            request = json.load(handle)
        if not isinstance(request, dict):
            raise IdempotencyStoreError("seed request file must contain a JSON object")
        result = seed_completed_run(
            store_path=args.store,
            state_dir=args.state_dir,
            run_id=args.run_id,
            key=key,
            request=request,
        )
    except (OSError, UnicodeError, json.JSONDecodeError, IdempotencyStoreError) as exc:
        print(f"IDEMPOTENCY_SEED_FAIL {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    print("IDEMPOTENCY_SEED_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
