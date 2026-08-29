#!/usr/bin/env python3
"""Register an environment-configured hostname on a Cloudflare tunnel."""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.request
from pathlib import Path

SOVEREIGN_KEY_FILE = Path(os.environ.get("ECHO_SOVEREIGN_KEY_FILE", "/home/forge/.echo_sovereign_key"))
ECHO_BASE = os.environ.get("ECHO_BASE", "http://127.0.0.1:8000").rstrip("/")
ACCOUNT_ID = os.environ.get("CF_ACCOUNT_ID", "").strip()
TUNNEL_ID = os.environ.get("CF_TUNNEL_ID", "").strip()
CF_API = "https://api.cloudflare.com/client/v4"
CF_EMAIL = os.environ.get("CF_EMAIL", "").strip()

HOSTNAME = os.environ.get("CF_TUNNEL_HOSTNAME", "").strip()
SERVICE = os.environ.get("CF_TUNNEL_SERVICE", "").strip()
WILDCARD_HOSTS = {
    host.strip()
    for host in os.environ.get("CF_TUNNEL_WILDCARD_HOSTS", "").split(",")
    if host.strip()
}


def require_config() -> None:
    missing = [
        name
        for name, value in {
            "CF_ACCOUNT_ID": ACCOUNT_ID,
            "CF_TUNNEL_ID": TUNNEL_ID,
            "CF_EMAIL": CF_EMAIL,
            "CF_TUNNEL_HOSTNAME": HOSTNAME,
            "CF_TUNNEL_SERVICE": SERVICE,
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


def vault_get(service: str, username: str | None = None) -> str:
    body = {
        "envelope_version": 1,
        "capability": "echo.vault.get",
        "params": {"command": "get", "service": service, **({"username": username} if username else {})},
        "context": {"bypass_reason": "echo-swarm-brain tunnel route registration"},
    }
    req = urllib.request.Request(
        f"{ECHO_BASE}/sdk/invoke",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "X-Echo-API-Key": sovereign_key()},
    )
    resp = json.loads(urllib.request.urlopen(req, timeout=15).read())
    return resp["result"]["body"]["secret"]


def fetch_config(global_key: str) -> list[dict]:
    req = urllib.request.Request(
        f"{CF_API}/accounts/{ACCOUNT_ID}/cfd_tunnel/{TUNNEL_ID}/configurations",
        headers={"X-Auth-Email": CF_EMAIL, "X-Auth-Key": global_key},
    )
    data = json.loads(urllib.request.urlopen(req, timeout=20).read())
    if not data.get("success"):
        raise RuntimeError(f"cloudflare API error: {data.get('errors')}")
    return data["result"]["config"]["ingress"]


def put_config(global_key: str, ingress: list[dict]) -> None:
    payload = json.dumps({"config": {"ingress": ingress}}).encode()
    req = urllib.request.Request(
        f"{CF_API}/accounts/{ACCOUNT_ID}/cfd_tunnel/{TUNNEL_ID}/configurations",
        data=payload,
        headers={
            "X-Auth-Email": CF_EMAIL,
            "X-Auth-Key": global_key,
            "Content-Type": "application/json",
        },
        method="PUT",
    )
    data = json.loads(urllib.request.urlopen(req, timeout=30).read())
    if not data.get("success"):
        raise RuntimeError(f"cloudflare PUT error: {data.get('errors')}")


def main() -> int:
    require_config()
    global_key = vault_get("cloudflare_global_api_key")
    ingress = fetch_config(global_key)

    if any(
        rule.get("hostname") == HOSTNAME and rule.get("service") == SERVICE
        for rule in ingress
    ):
        print(f"already_registered hostname={HOSTNAME} service={SERVICE}")
        return 0
    ingress = [r for r in ingress if r.get("hostname") != HOSTNAME]

    wildcard_idx = next(
        (
            i
            for i, rule in enumerate(ingress)
            if rule.get("hostname") in WILDCARD_HOSTS or not rule.get("hostname")
        ),
        len(ingress),
    )
    ingress.insert(wildcard_idx, {"hostname": HOSTNAME, "service": SERVICE})
    put_config(global_key, ingress)
    print(f"registered hostname={HOSTNAME} service={SERVICE} before_wildcard_idx={wildcard_idx}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
