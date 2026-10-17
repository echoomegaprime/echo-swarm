"""Exercise the actual reviewed Commander module in isolated local state."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("swarm_adapter", Path(__file__).with_name("oauth-consent-bridge.py"))
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)
SOURCE = os.getenv("SWARM_TEST_CONSENT_MODULE")


@unittest.skipUnless(SOURCE, "SWARM_TEST_CONSENT_MODULE must identify the reviewed Commander module")
class ConsentAdapterTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="swarm-consent-unit-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        env = patch.dict(os.environ, {
            "SWARM_CONSENT_MODULE_PATH": SOURCE, "UMB_STATE_DIR": str(self.root),
            "ECHO_MCP_CONSENT_DB": str(self.root / "consent.sqlite3"),
            "ECHO_MCP_CONSENT_PAGE_DIR": str(self.root / "pages"),
            "ECHO_MCP_CONSENT_REQUIRED": "1",
        })
        env.start()
        self.addCleanup(env.stop)
        self.owner = adapter.load_owner()
        self.request = {"action": "gate", "client_id": "swarm-" + "a" * 32,
                        "redirect_uri": "http://localhost:47911/callback", "scope": "swarm.read",
                        "resource": "https://swarm-app.echo-op.com/api/plugin/mcp",
                        "code_challenge": "a" * 43, "state": "fixture-state"}

    def pages(self):
        return [json.loads(p.read_text()) for p in (self.root / "pages").glob("*.json")]

    def test_expired_request_cannot_complete(self):
        result = adapter.dispatch(self.owner, self.request)
        row = self.owner.get_pending(result["request_id"])
        with patch.object(self.owner, "_now", return_value=row["expires_at"] + 1):
            status = adapter.dispatch(self.owner, {"action": "status", "request": result["request_id"]})
            self.assertEqual(status["status"], "expired")
            done = adapter.dispatch(self.owner, {"action": "complete", "request": result["request_id"]})
            self.assertFalse(done["ok"])

    def test_queue_failure_is_visible_and_retry_can_really_queue(self):
        with patch.object(self.owner, "queue_page", return_value=False):
            result = adapter.dispatch(self.owner, self.request)
        self.assertEqual(result["status"], 503)
        self.assertEqual(len(self.pages()), 0)
        retried = adapter.dispatch(self.owner, self.request)
        self.assertTrue(retried["paged"])
        self.assertEqual(len(self.pages()), 1)

    def test_refreshing_pending_page_does_not_send_duplicate_notifications(self):
        first = adapter.dispatch(self.owner, self.request)
        second = adapter.dispatch(self.owner, self.request)
        self.assertTrue(first["paged"])
        self.assertTrue(second["deduplicated"])
        self.assertEqual(len(self.pages()), 1)

    def test_swarm_cannot_view_or_decide_another_services_request(self):
        pending = self.owner.create_pending(
            client_id="another-service-client", client_name="unrelated fixture",
            redirect_uri=self.request["redirect_uri"], scope="unrelated.read",
            resource=self.request["resource"], code_challenge="b" * 43,
            state="unrelated-state", fixed_client_id="", public_host="https://mcp.echo-op.com",
        )
        text = self.pages()[0]["text"]
        token = text.split("#t=", 1)[1].split()[0]
        result = adapter.dispatch(self.owner, {"action": "link", "token": token, "decision": "approve"})
        self.assertFalse(result["ok"])
        self.assertEqual(self.owner.approval_status(pending["request_id"]), "pending")
        result = adapter.dispatch(self.owner, {"action": "complete", "request": pending["request_id"]})
        self.assertFalse(result["ok"])

    def test_changed_dependency_is_rejected_before_execution(self):
        altered = self.root / "altered.py"
        altered.write_bytes(Path(SOURCE).read_bytes() + b"\n# changed fixture\n")
        with patch.dict(os.environ, {"SWARM_CONSENT_MODULE_PATH": str(altered)}):
            with self.assertRaises(ValueError):
                adapter.load_owner()

    def test_swarm_namespace_does_not_allow_a_different_resource(self):
        pending = self.owner.create_pending(
            client_id=adapter.NAMESPACE + self.request["client_id"], client_name="other resource fixture",
            redirect_uri=self.request["redirect_uri"], scope="swarm.read",
            resource="https://mcp.echo-op.com/mcp", code_challenge="b" * 43,
            state="unrelated-state", fixed_client_id="", public_host="https://mcp.echo-op.com",
        )
        token = self.pages()[0]["text"].split("#t=", 1)[1].split()[0]
        result = adapter.dispatch(self.owner, {"action": "link", "token": token, "decision": "approve"})
        self.assertFalse(result["ok"])
        self.assertEqual(self.owner.approval_status(pending["request_id"]), "pending")

    def test_disabling_owner_consent_does_not_auto_approve_swarm(self):
        with patch.dict(os.environ, {"ECHO_MCP_CONSENT_REQUIRED": "0"}):
            with self.assertRaises(ValueError):
                adapter.load_owner()


if __name__ == "__main__":
    unittest.main()
