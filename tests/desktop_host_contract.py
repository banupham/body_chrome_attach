from __future__ import annotations

import json
import struct
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from desktop.autostart import autostart_command
from desktop.body_client import BodyClient, _encode_client_frame
from desktop.config import load_runtime_config


class DesktopHostContractTest(unittest.TestCase):
    def test_shared_runtime_contract_is_local_and_versioned(self):
        config = load_runtime_config(ROOT / "config" / "bodybrain-runtime.json")
        self.assertEqual(config.host, "127.0.0.1")
        self.assertGreaterEqual(config.port, 1024)
        self.assertLess(config.port, 49152, "fixed product listener should stay below the default Windows dynamic port range")
        self.assertEqual(config.control_protocol_version, 7)
        self.assertEqual(config.body_contract_version, "1.0")

    def test_client_websocket_frames_are_masked(self):
        payload = b'{"type":"BODY_STATUS"}'
        frame = _encode_client_frame(payload)
        self.assertEqual(frame[0] & 0x0F, 0x1)
        self.assertTrue(frame[1] & 0x80)
        length = frame[1] & 0x7F
        offset = 2
        if length == 126:
            length = struct.unpack("!H", frame[offset:offset + 2])[0]
            offset += 2
        elif length == 127:
            length = struct.unpack("!Q", frame[offset:offset + 8])[0]
            offset += 8
        mask = frame[offset:offset + 4]
        offset += 4
        decoded = bytes(value ^ mask[index % 4] for index, value in enumerate(frame[offset:offset + length]))
        self.assertEqual(decoded, payload)

    def test_guardian_readiness_is_fail_closed(self):
        checking = BodyClient.readiness_from_status({"browsers": []})
        self.assertEqual(checking["state"], "CHECKING")

        status = {
            "browsers": [{
                "browserInstanceId": "browser-a",
                "online": True,
                "state": "ACTIVE",
                "environment": {"eligible": True, "status": "ELIGIBLE"},
            }],
            "environment": {
                "protection": {
                    "browsers": {
                        "browser-a": {
                            "blocked": False,
                            "reasons": [],
                            "initialCheck": {"complete": True, "status": "PASSED"},
                        }
                    }
                }
            },
        }
        ready = BodyClient.readiness_from_status(status)
        self.assertEqual(ready["state"], "READY")

        status["environment"]["protection"]["browsers"]["browser-a"]["blocked"] = True
        status["environment"]["protection"]["browsers"]["browser-a"]["reasons"] = ["EXTERNAL_CONTROLLER_CONFLICT"]
        blocked = BodyClient.readiness_from_status(status)
        self.assertEqual(blocked["state"], "BLOCKED")
        self.assertEqual(blocked["browsers"][0]["reason"], "EXTERNAL_CONTROLLER_CONFLICT")

    def test_python_brain_boundary_has_no_lower_level_motor_shortcuts(self):
        source = (ROOT / "desktop" / "body_client.py").read_text(encoding="utf-8")
        for forbidden in ["Input.dispatchMouseEvent", "Input.dispatchKeyEvent", "Runtime.evaluate", "MotorPlanner", "native_input"]:
            self.assertNotIn(forbidden, source)
        for required in ['"BODY_STEP"', '"BODY_OBSERVE"', '"TASK_CREATE"', '"TASK_START"']:
            self.assertIn(required, source)

    def test_release_endpoint_and_desktop_share_one_bootstrap_port(self):
        runtime = json.loads((ROOT / "config" / "bodybrain-runtime.json").read_text(encoding="utf-8"))
        build = (ROOT / "build.js").read_text(encoding="utf-8")
        supervisor = (ROOT / "desktop" / "supervisor.py").read_text(encoding="utf-8")
        self.assertIn("bodybrain-runtime.json", build)
        self.assertIn('env["BODY_RUNTIME_PORT"]', supervisor)
        self.assertIn('env["BODY_RUNTIME_DATA_DIR"]', supervisor)
        self.assertIn('env["BODY_WINDOWS_INPUT_HELPER_EXE"]', supervisor)
        self.assertIn('runtime" / "node" / "node.exe"', supervisor)
        self.assertEqual(runtime["port"], 43147)

    def test_packaged_runtime_uses_persistent_auth_and_evidence_roots(self):
        supervisor = (ROOT / "desktop" / "supervisor.py").read_text(encoding="utf-8")
        main = (ROOT / "desktop" / "main.py").read_text(encoding="utf-8")
        self.assertIn('self.body_data_dir / "profiles" / ".auth" / "brain.token"', supervisor)
        self.assertIn('evidence_root=paths["body"] / "evidence"', main)

    def test_windows_launcher_preserves_python_exit_code(self):
        launcher = (ROOT / "bodybrain.cmd").read_text(encoding="utf-8").lower()
        self.assertNotIn("if %errorlevel%", launcher)
        self.assertIn("goto use_py", launcher)
        self.assertIn("goto use_python", launcher)
        self.assertGreaterEqual(launcher.count("exit /b %errorlevel%"), 2)

    def test_packaged_autostart_runs_same_executable_in_background(self):
        command = autostart_command(Path("C:/Program Files/BodyBrain/BodyBrain.exe"))
        self.assertTrue(command.startswith('"'))
        self.assertTrue(command.endswith('" --background'))
        main = (ROOT / "desktop" / "main.py").read_text(encoding="utf-8")
        self.assertIn("hide_console_window()", main)
        self.assertIn("--install-autostart", main)
        self.assertIn("--remove-autostart", main)

    def test_windows_input_prefers_bundled_helper_when_supplied(self):
        source = (ROOT / "daemon" / "src" / "windows_native_input.js").read_text(encoding="utf-8")
        self.assertIn("BODY_WINDOWS_INPUT_HELPER_EXE", source)
        self.assertIn("[[bundled,['worker']]]", source)


if __name__ == "__main__":
    unittest.main()
