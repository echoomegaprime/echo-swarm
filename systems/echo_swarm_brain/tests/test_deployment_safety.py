from __future__ import annotations

import importlib.util
import re
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]


def test_service_is_loopback_and_secret_referenced() -> None:
    unit = (ROOT / "echo-swarm-brain.service").read_text()
    assert "--host 127.0.0.1" in unit
    assert "--host 0.0.0.0" not in unit
    assert "Environment=PGPASSWORD=" not in unit
    assert "EnvironmentFile=-/etc/echo/echo-swarm-brain.env" in unit


def test_dns_helper_uses_fail_closed_environment_configuration() -> None:
    source = (ROOT / "register_dns.py").read_text()
    for name in ("CF_EMAIL", "CF_ZONE_NAME", "CF_RECORD_NAME", "CF_TUNNEL_CNAME"):
        assert f'os.environ.get("{name}"' in source
        assert f'"{name}":' in source
    assert not re.search(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", source)
    assert not re.search(r"[0-9a-f]{8}-[0-9a-f-]{27,}", source, re.IGNORECASE)


def test_dns_helper_reports_missing_zone(monkeypatch: pytest.MonkeyPatch) -> None:
    path = ROOT / "register_dns.py"
    spec = importlib.util.spec_from_file_location("echo_swarm_brain_register_dns_test", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "CF_EMAIL", "operator@example.invalid")
    monkeypatch.setattr(module, "ZONE_NAME", "missing.example.invalid")
    monkeypatch.setattr(module, "RECORD_NAME", "swarm.missing.example.invalid")
    monkeypatch.setattr(module, "TUNNEL_CNAME", "tunnel.example.invalid")
    monkeypatch.setattr(module, "vault_get", lambda _service: "test-only-key")
    monkeypatch.setattr(module, "cf_request", lambda *_args, **_kwargs: {"result": []})
    with pytest.raises(RuntimeError, match="zone not found"):
        module.main()


def test_dns_helper_rejects_cloudflare_success_false(monkeypatch: pytest.MonkeyPatch) -> None:
    path = ROOT / "register_dns.py"
    spec = importlib.util.spec_from_file_location("echo_swarm_brain_register_dns_error_test", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    class FailedResponse:
        @staticmethod
        def read() -> bytes:
            return b'{"success":false,"errors":[{"code":1000,"message":"test failure"}]}'

    monkeypatch.setattr(module.urllib.request, "urlopen", lambda *_args, **_kwargs: FailedResponse())
    with pytest.raises(RuntimeError, match="cloudflare API error"):
        module.cf_request("test-only-key", "GET", "/zones")


def test_dns_helper_rejects_missing_cloudflare_success(monkeypatch: pytest.MonkeyPatch) -> None:
    path = ROOT / "register_dns.py"
    spec = importlib.util.spec_from_file_location("echo_swarm_brain_register_dns_missing_success", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    class MissingSuccessResponse:
        @staticmethod
        def read() -> bytes:
            return b'{"result":[]}'

    monkeypatch.setattr(
        module.urllib.request, "urlopen", lambda *_args, **_kwargs: MissingSuccessResponse()
    )
    with pytest.raises(RuntimeError, match="cloudflare API error"):
        module.cf_request("test-only-key", "GET", "/zones")


def test_tunnel_helper_has_no_embedded_production_route() -> None:
    source = (ROOT / "register_tunnel_route.py").read_text()
    for name in (
        "CF_ACCOUNT_ID",
        "CF_TUNNEL_ID",
        "CF_EMAIL",
        "CF_TUNNEL_HOSTNAME",
        "CF_TUNNEL_SERVICE",
    ):
        assert f'os.environ.get("{name}"' in source
        assert f'"{name}":' in source
    assert not re.search(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", source)
    assert not re.search(r"https?://(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)", source)


def test_tunnel_order_helper_has_no_embedded_production_route() -> None:
    source = (ROOT / "fix_tunnel_order.py").read_text()
    for name in (
        "CF_ACCOUNT_ID",
        "CF_TUNNEL_ID",
        "CF_EMAIL",
        "CF_TUNNEL_HOSTNAME",
        "CF_TUNNEL_SERVICE",
    ):
        assert f'os.environ.get("{name}"' in source
        assert f'"{name}":' in source
    assert not re.search(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", source)
    assert not re.search(r"https?://(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)", source)


def test_llm_default_is_loopback() -> None:
    source = (ROOT / "llm.py").read_text()
    app_source = (ROOT / "app.py").read_text()
    assert 'ALPHA_LLM_BASE", "http://127.0.0.1:8200/v1"' in source
    assert not re.search(r"https?://(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)", source)
    assert 'parsed.hostname or "127.0.0.1"' in app_source
    assert "--host 0.0.0.0" not in app_source
    assert not re.search(r"(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)", app_source)


def test_perf_verifier_uses_an_unpredictable_health_file() -> None:
    source = (ROOT / "verify_perf_pass.sh").read_text()
    assert "mktemp -t echo-swarm-brain-health" in source
    assert 'HEALTH_PATH="$HEALTH_JSON"' in source
    assert "/tmp/echo-swarm-brain-health.json" not in source
