"""Cryptographic contract tests for the Personality Forge capability adapter."""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import sys
from pathlib import Path

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


REPO_ROOT = Path(__file__).resolve().parents[3]
CORE_WHEEL = (
    REPO_ROOT
    / "systems"
    / "maximalist_reconstructed_core"
    / "vendor"
    / "maximalist_reconstructed-0.6.0-py3-none-any.whl"
)
WORKER_SRC = REPO_ROOT / "systems" / "echo_maximalist_fusion" / "src"
sys.path.insert(0, str(CORE_WHEEL))
sys.path.insert(0, str(WORKER_SRC))

from echo_fusion_worker.personality_forge import (  # noqa: E402
    DEFAULT_EXPECTED_COMMIT,
    DEFAULT_EXPECTED_RELEASE,
    DEFAULT_EXPECTED_RUNTIME_ENV,
    PersonalityForgeCapabilityAdapter,
)
from maximalist_reconstructed.capabilities import (  # noqa: E402
    CapabilityError,
    CapabilityRequest,
    CapabilitySpec,
)


MODEL = "echo-gs343"
KEY_ID = "ed25519:030941e03db7cf24b7ad2a2e8993a791"
SERVER_BUILD_DIGEST = "b" * 64
ADAPTER_DIGEST = "a" * 64


def _spec() -> CapabilitySpec:
    return CapabilitySpec(
        capability_id="echo.personality.family_consult",
        description="signed personality consultation",
        adapter="personality_forge",
        params={"model": MODEL},
        always=True,
        required_scope="personality.read",
        danger_tier=1,
        read_only=True,
        timeout_seconds=100,
        max_payload_chars=20_000,
        source_kind="personality-forge",
    )


def _request() -> CapabilityRequest:
    spec = _spec()
    objective = "Review this fusion result independently."
    return CapabilityRequest(
        run_id="run_personality_test",
        objective=objective,
        spec=spec,
        params={
            "model": MODEL,
            "prompt": objective,
            "max_tokens": 192,
            "temperature": 0,
            "ground": False,
        },
    )


def _transport(
    *,
    fallback_used: bool = False,
    tamper_signature: bool = False,
    runtime_commit: str = DEFAULT_EXPECTED_COMMIT,
) -> httpx.MockTransport:
    private_key = Ed25519PrivateKey.generate()
    public_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("ascii")

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/readyz":
            return httpx.Response(
                200,
                json={
                    "status": "ready",
                    "node": "temper",
                    "runtime_commit": runtime_commit,
                    "certified_release": DEFAULT_EXPECTED_RELEASE,
                    "runtime_env": DEFAULT_EXPECTED_RUNTIME_ENV,
                    "loaded": [MODEL, "echo-r2d2"],
                    "device_map": {"model.layers.0": "0", "model.layers.47": "1"},
                },
            )
        if request.url.path == "/v1/models":
            return httpx.Response(200, json={"data": [{"id": MODEL}, {"id": "echo-r2d2"}]})
        if request.url.path == "/v1/routing/attestation":
            return httpx.Response(
                200,
                json={
                    "key_id": KEY_ID,
                    "public_key_pem": public_pem,
                    "requested_models": [MODEL, "echo-r2d2"],
                    "server_build_digest": SERVER_BUILD_DIGEST,
                },
            )
        if request.url.path == "/v1/chat/completions":
            body = json.loads(request.content.decode("utf-8"))
            challenge = request.headers["x-echo-routing-challenge"]
            response_text = "Independent signed assessment."
            receipt_payload = {
                "schema": "echo.family-routing-receipt/v1",
                "request_id": "request-personality-1",
                "challenge_nonce": challenge,
                "requested_model": body["model"],
                "registry_adapter_id": MODEL,
                "selected_adapter_id": MODEL,
                "selected_adapter_digest": ADAPTER_DIGEST,
                "server_build_digest": SERVER_BUILD_DIGEST,
                "response_sha256": hashlib.sha256(response_text.encode()).hexdigest(),
                "response_size_bytes": len(response_text.encode()),
                "routing_mode": "lora_adapter",
                "adapter_applied": True,
                "persona_applied": True,
                "persona_enabled": True,
                "fallback_used": fallback_used,
                "active_adapter_ids": [MODEL],
                "active_adapter_ids_before": [MODEL],
                "active_adapter_ids_after": [MODEL],
                "signature_key_id": KEY_ID,
            }
            canonical = json.dumps(
                receipt_payload,
                sort_keys=True,
                separators=(",", ":"),
                ensure_ascii=False,
            ).encode("utf-8")
            signature = private_key.sign(canonical)
            if tamper_signature:
                signature = b"x" * len(signature)
            return httpx.Response(
                200,
                json={
                    "model": MODEL,
                    "choices": [
                        {"message": {"role": "assistant", "content": response_text}}
                    ],
                    "routing_receipt": {
                        "payload": receipt_payload,
                        "key_id": KEY_ID,
                        "signature_b64": base64.b64encode(signature).decode("ascii"),
                    },
                },
            )
        return httpx.Response(404, json={"detail": "not found"})

    return httpx.MockTransport(handler)


def test_live_readiness_and_signed_completion_are_verified() -> None:
    adapter = PersonalityForgeCapabilityAdapter(transport=_transport())

    readiness = asyncio.run(adapter.readiness(_spec()))
    assert readiness.status == "ready"
    assert readiness.network_verified is True

    result = asyncio.run(adapter.invoke(_request()))
    assert result["model"] == MODEL
    assert result["external_data"] is True
    assert result["runtime"] == {
        "node": "temper",
        "runtime_commit": DEFAULT_EXPECTED_COMMIT,
        "certified_release": DEFAULT_EXPECTED_RELEASE,
        "runtime_env": DEFAULT_EXPECTED_RUNTIME_ENV,
        "two_gpu_verified": True,
    }
    receipt = result["routing_receipt"]
    assert receipt["signature_verified"] is True
    assert receipt["fallback_used"] is False
    assert receipt["selected_adapter_digest"] == ADAPTER_DIGEST
    assert receipt["server_build_digest"] == SERVER_BUILD_DIGEST
    assert "signature_b64" not in json.dumps(result)
    assert "public_key_pem" not in json.dumps(result)


def test_readiness_fails_closed_on_runtime_identity_drift() -> None:
    adapter = PersonalityForgeCapabilityAdapter(
        transport=_transport(runtime_commit="f" * 40)
    )
    readiness = asyncio.run(adapter.readiness(_spec()))
    assert readiness.status == "unavailable"
    assert readiness.network_verified is False
    assert "identity_mismatch" in readiness.reason


@pytest.mark.parametrize(
    "adapter",
    [
        PersonalityForgeCapabilityAdapter(transport=_transport(fallback_used=True)),
        PersonalityForgeCapabilityAdapter(transport=_transport(tamper_signature=True)),
    ],
)
def test_invoke_rejects_fallback_and_invalid_signature(
    adapter: PersonalityForgeCapabilityAdapter,
) -> None:
    with pytest.raises(CapabilityError):
        asyncio.run(adapter.invoke(_request()))


def test_constructor_rejects_non_loopback_base_url() -> None:
    with pytest.raises(ValueError, match="loopback"):
        PersonalityForgeCapabilityAdapter(base_url="https://temper.example.test")
