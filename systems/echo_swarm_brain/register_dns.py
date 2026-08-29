#!/usr/bin/env python3
"""Create an idempotent Cloudflare DNS CNAME from environment configuration."""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

SOVEREIGN_KEY_FILE = Path(os.environ.get("ECHO_SOVEREIGN_KEY_FILE", "/home/forge/.echo_sovereign_key"))
ECHO_BASE = os.environ.get("ECHO_BASE", "http://127.0.0.1:8000").rstrip("/")
CF_API = "https://api.cloudflare.com/client/v4"
CF_EMAIL = os.environ.get("CF_EMAIL", "").strip()
ZONE_NAME = os.environ.get("CF_ZONE_NAME", "").strip()
RECORD_NAME = os.environ.get("CF_RECORD_NAME", "").strip()
TUNNEL_CNAME = os.environ.get("CF_TUNNEL_CNAME", "").strip()


def require_config() -> None:
    missing = [
        name
        for name, value in {
            "CF_EMAIL": CF_EMAIL,
            "CF_ZONE_NAME": ZONE_NAME,
            "CF_RECORD_NAME": RECORD_NAME,
            "CF_TUNNEL_CNAME": TUNNEL_CNAME,
        }.items()
        if not value
    ]
    if missing:
        raise RuntimeError(f"missing required environment variables: {', '.join(missing)}")


def sovereign_key() -> str:
    text = SOVEREIGN_KEY_FILE.read_text()
    match = re.search(r"SOVEREIGN_KEY\s*=\s*(\S+)", text)
    if not match:
        raise RuntimeError("SOVEREIGN_KEY not found")
    return match.group(1)


def vault_get(service: str) -> str:
    body = {
        "envelope_version": 1,
        "capability": "echo.vault.get",
        "params": {"command": "get", "service": service},
        "context": {"bypass_reason": "swarm-brain DNS registration"},
    }
    req = urllib.request.Request(
        f"{ECHO_BASE}/sdk/invoke",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "X-Echo-API-Key": sovereign_key()},
    )
    resp = json.loads(urllib.request.urlopen(req, timeout=15).read())
    return resp["result"]["body"]["secret"]


def cf_request(global_key: str, method: str, path: str, payload: dict | None = None) -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        f"{CF_API}{path}",
        data=data,
        headers={
            "X-Auth-Email": CF_EMAIL,
            "X-Auth-Key": global_key,
            "Content-Type": "application/json",
        },
        method=method,
    )
    response = json.loads(urllib.request.urlopen(req, timeout=20).read())
    if not isinstance(response, dict):
        raise RuntimeError("cloudflare API returned a malformed response")
    if response.get("success") is not True:
        raise RuntimeError(f"cloudflare API error: {response.get('errors')!r}")
    return response


def main() -> int:
    require_config()
    global_key = vault_get("cloudflare_global_api_key")
    zones = cf_request(global_key, "GET", f"/zones?name={urllib.parse.quote(ZONE_NAME)}")
    results = zones.get("result") or []
    if not results:
        raise RuntimeError(f"zone not found for name={ZONE_NAME!r}")
    zone_id = results[0]["id"]
    existing = cf_request(
        global_key,
        "GET",
        f"/zones/{zone_id}/dns_records?name={urllib.parse.quote(RECORD_NAME)}&type=CNAME",
    )
    for rec in existing.get("result", []):
        if rec.get("content") == TUNNEL_CNAME:
            print(f"already_registered name={RECORD_NAME} cname={TUNNEL_CNAME}")
            return 0
    if existing.get("result"):
        rec_id = existing["result"][0]["id"]
        cf_request(
            global_key,
            "PATCH",
            f"/zones/{zone_id}/dns_records/{rec_id}",
            {"type": "CNAME", "name": RECORD_NAME, "content": TUNNEL_CNAME, "proxied": True},
        )
        print(f"updated name={RECORD_NAME} cname={TUNNEL_CNAME}")
        return 0
    cf_request(
        global_key,
        "POST",
        f"/zones/{zone_id}/dns_records",
        {"type": "CNAME", "name": RECORD_NAME, "content": TUNNEL_CNAME, "proxied": True},
    )
    print(f"created name={RECORD_NAME} cname={TUNNEL_CNAME}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
