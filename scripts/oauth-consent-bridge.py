#!/usr/bin/env python3
"""Narrow stdin/stdout adapter to the installed Commander consent service.

Reuse its protected database, outbox, expiry, attempts and decision ceremony.
Swarm can only operate its own namespaced requests for its pinned MCP resource.
Approval secrets never appear in argv, diagnostics, or returned gate receipts.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import types
from urllib.parse import urlparse

MODULE_SHA256 = "c7d218137f56628cfec97b2d41355a6c4d55b70318fe074176c72fd9f56d2fe2"
NAMESPACE = "echo-swarm::"


def load_owner():
    source = Path(os.getenv("SWARM_CONSENT_MODULE_PATH", "/home/forge/echo-unified-mcp-bridge/oauth_consent.py"))
    raw = source.read_bytes()
    if hashlib.sha256(raw).hexdigest() != MODULE_SHA256:
        raise ValueError("consent dependency changed")
    owner = types.ModuleType("swarm_commander_consent")
    owner.__file__ = str(source)
    # Execute precisely the reviewed bytes, without reopening the dependency.
    exec(compile(raw, str(source), "exec"), owner.__dict__)
    if not owner.ENABLED:
        raise ValueError("Commander consent disabled")
    return owner


def dispatch(c, data):
    origin = os.getenv("SWARM_OAUTH_PUBLIC_ORIGIN", "https://swarm-app.echo-op.com").rstrip("/")
    parsed = urlparse(origin)
    if parsed.scheme != "https" or not parsed.hostname or parsed.path or parsed.query or parsed.fragment or parsed.username:
        raise ValueError("invalid public origin")
    resource = origin + "/api/plugin/mcp"

    def owned(row):
        return bool(row and re.fullmatch(r"echo-swarm::swarm-[0-9a-f]{32}", row["client_id"])
                    and row["resource"] == resource)

    action = data.get("action")
    rid = str(data.get("request") or "")
    if action == "assets":
        return {"ok": True, "headers": c.SECURITY_HEADERS, "css": c.APPROVAL_CSS,
                "poll_js": c.POLL_JS, "consent_js": c.CONSENT_JS, "shell": c.consent_shell_page()}
    if action == "gate":
        client = str(data.get("client_id") or "")
        if not re.fullmatch(r"swarm-[0-9a-f]{32}", client) or data.get("resource") != resource:
            return {"ok": False, "status": 400, "error": "invalid_request"}
        client = NAMESPACE + client
        scope = str(data.get("scope") or "")
        if c.is_consented(client, data["redirect_uri"], set(scope.split()), ""):
            return {"ok": True, "consented": True}
        result = c.create_pending(
            client_id=client, client_name="Echo Swarm", redirect_uri=data["redirect_uri"],
            scope=scope, resource=resource, code_challenge=data["code_challenge"],
            state=data.get("state") or "", fixed_client_id="", source=data.get("source") or "",
            user_agent=data.get("user_agent") or "", public_host=origin,
        )
        if result.get("ok") and not result.get("paged") and not result.get("deduplicated"):
            # A failed enqueue must not suppress a later real delivery as a duplicate.
            if not result.get("page_rate_limited"):
                with c._Tx() as conn:
                    conn.execute("UPDATE pending SET paged=0 WHERE handle=? AND status='pending'",
                                 (c._sha(result["request_id"]),))
            return {"ok": False, "status": 503, "error": "telegram_notification_unavailable"}
        return result
    if action == "link":
        token = str(data.get("token") or "")
        with c._Tx() as conn:
            raw = conn.execute("SELECT * FROM pending WHERE link_hash=?", (c._sha(token),)).fetchone()
            row = dict(raw) if raw else None
        if not owned(row):
            return {"ok": False, "status": 404, "error": "unknown_request"}
        # Check ownership before any view or decision, including in the shared DB.
        return c.link_action(token, str(data.get("decision") or "view"))
    row = c.get_pending(rid) if rid else None
    if not owned(row):
        return {"ok": False, "status": 410, "error": "unknown_request"}
    if action == "status":
        return {"ok": True, "status": c.effective_status(row)}
    if action == "page":
        status = c.effective_status(row)
        return {"ok": True, "status": status, "headers": c.SECURITY_HEADERS,
                "html": c.pending_page(row, rid, str(data.get("message") or "")) if status == "pending" else ""}
    if action == "otp":
        return c.approve_with_otp(rid, str(data.get("code") or ""), data.get("source") or "")
    if action == "complete":
        row = c.take_for_completion(rid)
        if not owned(row):
            return {"ok": False, "status": 410, "error": "request_not_completable"}
        return {"ok": True, "decision": row["status"], "client_id": row["client_id"][len(NAMESPACE):],
                **{key: row[key] for key in ("redirect_uri", "scope", "resource", "code_challenge", "state")}}
    return {"ok": False, "status": 400, "error": "invalid_action"}


def main():
    try:
        raw = sys.stdin.buffer.read(32769)
        if len(raw) > 32768:
            raise ValueError("oversized input")
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("invalid input")
        result = dispatch(load_owner(), data)
    except Exception:
        # Dependency paths, request bodies, codes, tokens and traceback stay private.
        result = {"ok": False, "status": 503, "error": "commander_consent_unavailable"}
    print(json.dumps(result))


if __name__ == "__main__":
    main()
