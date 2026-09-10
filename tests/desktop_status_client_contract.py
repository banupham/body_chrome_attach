from __future__ import annotations

import json
import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from desktop.body_status_client import BodyStatusClient
from desktop.config import RuntimeConfig


class FakeTransport:
    def __init__(self):
        self.sent: list[dict] = []
        self.connected = False

    def connect(self) -> None:
        self.connected = True

    def send_text(self, text: str) -> None:
        self.sent.append(json.loads(text))

    def recv_text(self) -> str:
        return json.dumps({
            "type": "HELLO_ACK",
            "role": "status_client",
            "protocolVersion": 7,
            "bodyContractVersion": "1.0",
            "authenticated": True,
            "controller": {"controller": "none", "brainOnline": False, "exclusive": True},
        })

    def set_timeout(self, _timeout: float) -> None:
        pass

    def close(self) -> None:
        pass


class DesktopStatusClientContractTest(unittest.TestCase):
    def test_desktop_status_client_never_claims_brain_role(self):
        config = RuntimeConfig("127.0.0.1", 43147, 7, "1.0", 1.0, 0.1)
        client = BodyStatusClient(config, "test-token")
        transport = FakeTransport()
        client.transport = transport
        hello = client.connect()
        self.assertEqual(hello["role"], "status_client")
        self.assertEqual(transport.sent[0]["role"], "status_client")
        self.assertNotEqual(transport.sent[0]["role"], "brain")

    def test_runtime_status_role_is_read_only_and_does_not_take_controller_lease(self):
        server = (ROOT / "daemon" / "server.js").read_text(encoding="utf-8")
        status_branch = "if(requestedRole==='status_client')"
        self.assertIn(status_branch, server)
        self.assertIn("role='status_client'", server)
        self.assertIn("handleStatusClientMessage", server)
        self.assertIn("status_client_read_only", server)
        start = server.index(status_branch)
        end = server.index("if(requestedRole==='debug_client')", start)
        self.assertNotIn("controller.attachBrain", server[start:end])
        brain_start = server.index("if(requestedRole==='brain')")
        brain_end = server.index(status_branch, brain_start)
        self.assertIn("controller.attachBrain", server[brain_start:brain_end])

    def test_debug_cli_defaults_to_bodybrain_production_runtime_on_windows(self):
        cli = (ROOT / "body_cli.js").read_text(encoding="utf-8")
        self.assertIn("BODY_RUNTIME_DATA_DIR", cli)
        self.assertIn("LOCALAPPDATA", cli)
        self.assertIn("'BodyBrain','body'", cli)
        self.assertNotIn("daemon.cmd", cli)


if __name__ == "__main__":
    unittest.main()
