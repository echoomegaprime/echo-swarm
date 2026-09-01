"""Fail-closed adapter for the governed TEMPER Personality Forge service.

Persona output is external evidence, never authority.  A completion is accepted
only when the live service reports the pinned runtime identity and an Ed25519
routing receipt binds the requested persona, challenge, selected adapter, and
response bytes without fallback.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
from typing import Any
from urllib.parse import urlsplit

import httpx
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from maximalist_reconstructed.capabilities import (
    CapabilityError,
    CapabilityReadiness,
    CapabilityRequest,
    CapabilitySpec,
)


RECEIPT_SCHEMA = "echo.family-routing-receipt/v1"
DEFAULT_BASE_URL = "http://127.0.0.1:18420"
DEFAULT_EXPECTED_COMMIT = "a0907f5da9f624dde4406cfd4d371e6497372654"
DEFAULT_EXPECTED_RELEASE = "20260804T084943Z-86b01e275844"
DEFAULT_EXPECTED_RUNTIME_ENV = "py312-torch2.11.0-cu128-bnb0.50.1"
DEFAULT_MODEL = "echo-gs343"
_HEX_40 = re.compile(r"^[0-9a-f]{40}$")
_HEX_64 = re.compile(r"^[0-9a-f]{64}$")


def _canonical_json(value: dict[str, Any]) -> bytes:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")


class PersonalityForgeCapabilityAdapter:
    """Read-only exact-persona client with cryptographic routing verification."""

    def __init__(
        self,
        *,
        base_url: str = DEFAULT_BASE_URL,
        expected_commit: str = DEFAULT_EXPECTED_COMMIT,
        expected_release: str = DEFAULT_EXPECTED_RELEASE,
        expected_runtime_env: str = DEFAULT_EXPECTED_RUNTIME_ENV,
        expected_model: str = DEFAULT_MODEL,
        transport: httpx.AsyncBaseTransport | None = None,
        readiness_timeout_seconds: float = 20.0,
    ) -> None:
        parsed = urlsplit(base_url.strip())
        if (
            parsed.scheme not in {"http", "https"}
            or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError(
                "Personality Forge base URL must be an absolute credential-free loopback URL"
            )
        normalized_commit = expected_commit.strip().lower()
        if not _HEX_40.fullmatch(normalized_commit):
            raise ValueError("Personality Forge expected commit must be a full lowercase SHA-1")
        if not expected_release.strip() or not expected_runtime_env.strip():
            raise ValueError("Personality Forge expected release and runtime environment are required")
        if not re.fullmatch(r"echo-[a-z0-9-]{1,63}", expected_model.strip()):
            raise ValueError("Personality Forge expected model is invalid")
        self.base_url = base_url.strip().rstrip("/")
        self.expected_commit = normalized_commit
        self.expected_release = expected_release.strip()
        self.expected_runtime_env = expected_runtime_env.strip()
        self.expected_model = expected_model.strip()
        self.transport = transport
        self.readiness_timeout_seconds = min(
            max(float(readiness_timeout_seconds), 1.0),
            30.0,
        )

    @classmethod
    def from_environment(cls) -> "PersonalityForgeCapabilityAdapter":
        return cls(
            base_url=os.environ.get("PERSONALITY_FORGE_BASE_URL", DEFAULT_BASE_URL),
            expected_commit=os.environ.get(
                "PERSONALITY_FORGE_EXPECTED_COMMIT", DEFAULT_EXPECTED_COMMIT
            ),
            expected_release=os.environ.get(
                "PERSONALITY_FORGE_EXPECTED_RELEASE", DEFAULT_EXPECTED_RELEASE
            ),
            expected_runtime_env=os.environ.get(
                "PERSONALITY_FORGE_EXPECTED_RUNTIME_ENV", DEFAULT_EXPECTED_RUNTIME_ENV
            ),
            expected_model=os.environ.get("PERSONALITY_FORGE_MODEL", DEFAULT_MODEL),
        )

    async def _request_json(
        self,
        method: str,
        path: str,
        *,
        timeout_seconds: float,
        payload: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(
                base_url=self.base_url,
                timeout=min(max(float(timeout_seconds), 1.0), 120.0),
                transport=self.transport,
                follow_redirects=False,
            ) as client:
                response = await client.request(
                    method,
                    path,
                    json=payload,
                    headers=headers,
                )
        except (httpx.TimeoutException, httpx.NetworkError) as exc:
            raise CapabilityError(
                "personality_unreachable",
                "Personality Forge is unreachable within the bounded timeout",
                status="unavailable",
                retryable=True,
            ) from exc
        if response.status_code != 200:
            status = "unauthorized" if response.status_code in {401, 403} else "unavailable"
            raise CapabilityError(
                "personality_http_error",
                f"Personality Forge returned HTTP {response.status_code}",
                status=status,
                retryable=response.status_code >= 500,
            )
        if len(response.content) > 1_000_000:
            raise CapabilityError(
                "personality_response_too_large",
                "Personality Forge response exceeded 1 MiB",
            )
        try:
            decoded = response.json()
        except (ValueError, json.JSONDecodeError) as exc:
            raise CapabilityError(
                "personality_invalid_json",
                "Personality Forge returned invalid JSON",
            ) from exc
        if not isinstance(decoded, dict):
            raise CapabilityError(
                "personality_invalid_shape",
                "Personality Forge response must be a JSON object",
            )
        return decoded

    async def _verified_identity(self, *, timeout_seconds: float) -> dict[str, Any]:
        ready = await self._request_json(
            "GET", "/readyz", timeout_seconds=timeout_seconds
        )
        models = await self._request_json(
            "GET", "/v1/models", timeout_seconds=timeout_seconds
        )
        attestation = await self._request_json(
            "GET", "/v1/routing/attestation", timeout_seconds=timeout_seconds
        )
        if ready.get("status") != "ready" or ready.get("node") != "temper":
            raise CapabilityError(
                "personality_not_ready",
                "Personality Forge did not report ready on TEMPER",
                status="unavailable",
            )
        exact_identity = {
            "runtime_commit": self.expected_commit,
            "certified_release": self.expected_release,
            "runtime_env": self.expected_runtime_env,
        }
        if any(ready.get(field) != value for field, value in exact_identity.items()):
            raise CapabilityError(
                "personality_identity_mismatch",
                "Personality Forge runtime identity does not match the pinned release",
                status="unavailable",
            )
        loaded = {str(item) for item in ready.get("loaded") or []}
        model_ids = {
            str(item.get("id"))
            for item in models.get("data") or []
            if isinstance(item, dict) and item.get("id")
        }
        if self.expected_model not in loaded or self.expected_model not in model_ids:
            raise CapabilityError(
                "personality_model_unavailable",
                "The pinned Personality Forge model is not loaded and listed",
                status="unavailable",
            )
        realized = {str(item) for item in (ready.get("device_map") or {}).values()}
        if not (realized & {"0", "cuda:0"}) or not (realized & {"1", "cuda:1"}):
            raise CapabilityError(
                "personality_gpu_placement_mismatch",
                "Personality Forge did not report the required two-GPU placement",
                status="unavailable",
            )
        requested_models = {str(item) for item in attestation.get("requested_models") or []}
        if self.expected_model not in requested_models:
            raise CapabilityError(
                "personality_model_unattested",
                "The pinned Personality Forge model is not in the routing attestation",
                status="unavailable",
            )
        key_id = attestation.get("key_id")
        public_key_pem = attestation.get("public_key_pem")
        server_build_digest = str(attestation.get("server_build_digest") or "")
        if (
            not isinstance(key_id, str)
            or not key_id.startswith("ed25519:")
            or not isinstance(public_key_pem, str)
            or not _HEX_64.fullmatch(server_build_digest)
        ):
            raise CapabilityError(
                "personality_attestation_invalid",
                "Personality Forge routing attestation is incomplete",
                status="unavailable",
            )
        try:
            public_key = serialization.load_pem_public_key(public_key_pem.encode("ascii"))
        except (TypeError, ValueError) as exc:
            raise CapabilityError(
                "personality_attestation_key_invalid",
                "Personality Forge routing key is invalid",
                status="unavailable",
            ) from exc
        if not isinstance(public_key, Ed25519PublicKey):
            raise CapabilityError(
                "personality_attestation_key_type",
                "Personality Forge routing key is not Ed25519",
                status="unavailable",
            )
        return {
            "ready": ready,
            "key_id": key_id,
            "public_key": public_key,
            "server_build_digest": server_build_digest,
        }

    async def readiness(self, spec: CapabilitySpec) -> CapabilityReadiness:
        if spec.capability_id != "echo.personality.family_consult":
            return CapabilityReadiness(
                spec.capability_id,
                "misconfigured",
                reason="adapter is bound only to echo.personality.family_consult",
            )
        try:
            await self._verified_identity(
                timeout_seconds=min(spec.timeout_seconds, self.readiness_timeout_seconds)
            )
        except CapabilityError as exc:
            status = "unauthorized" if exc.status == "unauthorized" else "unavailable"
            return CapabilityReadiness(
                spec.capability_id,
                status,
                network_verified=False,
                reason=f"{exc.code}: {exc}",
            )
        return CapabilityReadiness(
            spec.capability_id,
            "ready",
            network_verified=True,
            reason="TEMPER identity, model listing, two-GPU placement, and Ed25519 attestation verified",
        )

    async def invoke(self, request: CapabilityRequest) -> dict[str, Any]:
        if request.spec.capability_id != "echo.personality.family_consult":
            raise CapabilityError(
                "personality_capability_mismatch",
                "Personality Forge adapter received an unexpected capability",
            )
        model = str(request.params.get("model") or "").strip()
        if model != self.expected_model:
            raise CapabilityError(
                "personality_model_mismatch",
                "Requested model does not match the pinned Personality Forge persona",
            )
        prompt = str(request.params.get("prompt") or request.objective).strip()
        if not prompt or len(prompt) > 12_000:
            raise CapabilityError(
                "personality_prompt_invalid",
                "Personality Forge prompt must contain 1..12000 characters",
            )
        try:
            max_tokens = int(request.params.get("max_tokens", 192))
            temperature = float(request.params.get("temperature", 0))
        except (TypeError, ValueError) as exc:
            raise CapabilityError(
                "personality_parameters_invalid",
                "Personality Forge generation parameters are invalid",
            ) from exc
        if not 1 <= max_tokens <= 256 or not 0 <= temperature <= 1:
            raise CapabilityError(
                "personality_parameters_out_of_bounds",
                "Personality Forge generation parameters exceed the bounded policy",
            )
        if request.params.get("ground", False) is not False:
            raise CapabilityError(
                "personality_grounding_not_allowed",
                "Personality Forge consultation must remain independently ungrounded",
            )

        identity = await self._verified_identity(
            timeout_seconds=min(request.spec.timeout_seconds, self.readiness_timeout_seconds)
        )
        challenge_material = (
            f"{request.run_id}\n{request.spec.capability_id}\n{request.objective}"
        ).encode("utf-8")
        challenge = "fusion:" + hashlib.sha256(challenge_material).hexdigest()
        completion = await self._request_json(
            "POST",
            "/v1/chat/completions",
            timeout_seconds=request.spec.timeout_seconds,
            headers={"X-Echo-Routing-Challenge": challenge},
            payload={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": max_tokens,
                "temperature": temperature,
                "ground": False,
            },
        )
        if completion.get("model") != model:
            raise CapabilityError(
                "personality_completion_model_mismatch",
                "Personality Forge completion did not preserve the requested persona",
            )
        choices = completion.get("choices") or []
        message = choices[0].get("message") if choices and isinstance(choices[0], dict) else None
        response_text = str((message or {}).get("content") or "").strip()
        if (message or {}).get("role") != "assistant" or not response_text:
            raise CapabilityError(
                "personality_completion_empty",
                "Personality Forge returned no assistant response",
            )
        if len(response_text) > 12_000:
            raise CapabilityError(
                "personality_completion_too_large",
                "Personality Forge assistant response exceeded the bounded payload",
            )
        receipt = completion.get("routing_receipt") or {}
        receipt_payload = receipt.get("payload") if isinstance(receipt, dict) else None
        if not isinstance(receipt_payload, dict):
            raise CapabilityError(
                "personality_receipt_missing",
                "Personality Forge routing receipt is missing",
            )
        expected_exact = {
            "schema": RECEIPT_SCHEMA,
            "challenge_nonce": challenge,
            "requested_model": model,
            "registry_adapter_id": model,
            "selected_adapter_id": model,
            "routing_mode": "lora_adapter",
            "signature_key_id": identity["key_id"],
            "server_build_digest": identity["server_build_digest"],
        }
        if any(receipt_payload.get(field) != value for field, value in expected_exact.items()):
            raise CapabilityError(
                "personality_receipt_identity_mismatch",
                "Personality Forge routing receipt does not match the exact request and build",
            )
        if receipt.get("key_id") != identity["key_id"]:
            raise CapabilityError(
                "personality_receipt_key_mismatch",
                "Personality Forge routing receipt key identity changed",
            )
        if any(
            receipt_payload.get(field) is not True
            for field in ("adapter_applied", "persona_applied", "persona_enabled")
        ):
            raise CapabilityError(
                "personality_persona_not_applied",
                "Personality Forge did not attest that the persona adapter was applied",
            )
        if receipt_payload.get("fallback_used") is not False:
            raise CapabilityError(
                "personality_fallback_detected",
                "Personality Forge used or reported a fallback route",
            )
        for field in (
            "active_adapter_ids",
            "active_adapter_ids_before",
            "active_adapter_ids_after",
        ):
            if receipt_payload.get(field) != [model]:
                raise CapabilityError(
                    "personality_active_adapter_mismatch",
                    "Personality Forge active adapter identity changed during the request",
                )
        response_bytes = response_text.encode("utf-8")
        response_sha256 = hashlib.sha256(response_bytes).hexdigest()
        if (
            receipt_payload.get("response_sha256") != response_sha256
            or receipt_payload.get("response_size_bytes") != len(response_bytes)
        ):
            raise CapabilityError(
                "personality_response_binding_mismatch",
                "Personality Forge routing receipt does not bind the response bytes",
            )
        adapter_digest = str(receipt_payload.get("selected_adapter_digest") or "")
        request_id = str(receipt_payload.get("request_id") or "")
        if not _HEX_64.fullmatch(adapter_digest) or not request_id:
            raise CapabilityError(
                "personality_receipt_incomplete",
                "Personality Forge routing receipt lacks an adapter digest or request identity",
            )
        signature_b64 = receipt.get("signature_b64")
        try:
            signature = base64.b64decode(signature_b64, validate=True)
        except (TypeError, ValueError) as exc:
            raise CapabilityError(
                "personality_signature_encoding",
                "Personality Forge routing signature encoding is invalid",
            ) from exc
        try:
            identity["public_key"].verify(signature, _canonical_json(receipt_payload))
        except InvalidSignature as exc:
            raise CapabilityError(
                "personality_signature_invalid",
                "Personality Forge routing signature verification failed",
            ) from exc

        return {
            "model": model,
            "reply": response_text,
            "external_data": True,
            "runtime": {
                "node": "temper",
                "runtime_commit": self.expected_commit,
                "certified_release": self.expected_release,
                "runtime_env": self.expected_runtime_env,
                "two_gpu_verified": True,
            },
            "routing_receipt": {
                "schema": RECEIPT_SCHEMA,
                "key_id": identity["key_id"],
                "request_id": request_id,
                "requested_model": model,
                "selected_adapter_digest": adapter_digest,
                "server_build_digest": identity["server_build_digest"],
                "response_sha256": response_sha256,
                "fallback_used": False,
                "signature_verified": True,
            },
        }
