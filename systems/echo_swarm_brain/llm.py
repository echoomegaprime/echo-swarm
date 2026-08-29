"""OpenAI-compatible client for the ALPHA family server (echo-prime)."""
from __future__ import annotations

import logging
import os
import time
from typing import Any

import requests

logger = logging.getLogger("echo_swarm_brain.llm")

ALPHA_BASE = os.environ.get("ALPHA_LLM_BASE", "http://127.0.0.1:8200/v1").rstrip("/")
DEFAULT_MODEL = os.environ.get("ALPHA_LLM_MODEL", "echo-prime")
REQUEST_TIMEOUT = float(os.environ.get("LLM_TIMEOUT_SECONDS", "120"))
MAX_RETRIES = max(1, int(os.environ.get("LLM_RETRY_ATTEMPTS", "2")))


def chat_completion(
    *,
    system: str,
    user: str,
    model: str | None = None,
    temperature: float = 0.3,
    max_tokens: int = 2000,
    images: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """Call ALPHA echo-prime; returns {text, tokens, model}."""
    model_id = model or DEFAULT_MODEL
    if images:
        content: list[dict[str, Any]] = [{"type": "text", "text": user}]
        for img in images:
            data = img.get("data", "")
            mime = img.get("type", "image/jpeg")
            if data:
                content.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:{mime};base64,{data}"},
                })
        user_message: dict[str, Any] = {"role": "user", "content": content}
    else:
        user_message = {"role": "user", "content": user}

    payload = {
        "model": model_id,
        "messages": [
            {"role": "system", "content": system},
            user_message,
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    last_err: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.post(
                f"{ALPHA_BASE}/chat/completions",
                json=payload,
                timeout=REQUEST_TIMEOUT,
            )
            if resp.status_code >= 500 and attempt < MAX_RETRIES - 1:
                time.sleep(0.5 * (attempt + 1))
                continue
            resp.raise_for_status()
            data = resp.json()
            text = data.get("choices", [{}])[0].get("message", {}).get("content", "") or ""
            usage = data.get("usage", {})
            tokens = (usage.get("prompt_tokens") or 0) + (usage.get("completion_tokens") or 0)
            return {"text": text.strip(), "tokens": tokens, "model": model_id}
        except Exception as exc:
            last_err = exc
            logger.warning("llm_call_failed attempt=%s err=%s", attempt + 1, exc)
            if images and attempt == 0:
                # Retry without images if multimodal rejected or unreachable.
                return chat_completion(
                    system=system,
                    user=user + "\n\n[Note: cover photographs were provided but could not be processed visually.]",
                    model=model_id,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    images=None,
                )
            if attempt < MAX_RETRIES - 1:
                time.sleep(0.5 * (attempt + 1))
    raise RuntimeError(f"LLM call failed after {MAX_RETRIES} attempts: {last_err}")
