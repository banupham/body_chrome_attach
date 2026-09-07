from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from desktop.host_logging import HostLogger
from desktop.lifecycle import DesktopHost, HostStartupError, WorkerLaunch
from desktop.paths import DesktopPaths
from desktop.worker_supervisor import WorkerSpec


def process_alive(pid: int) -> bool:
    try:
        os.kill(int(pid), 0)
        return True
    except OSError:
        return False


class DesktopHostFoundationContractTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "BodyBrain"
        self.paths = DesktopPaths.from_root(self.root)
        self.host = DesktopHost(paths=self.paths, stop_timeout_seconds=1.5)

    def tearDown(self):
        try:
            self.host.stop()
        finally:
            self.temp.cleanup()

    def sleeper(self, name: str = "sleeper", required: bool = True) -> WorkerLaunch:
        return WorkerLaunch(
            WorkerSpec(
                name=name,
                command=(sys.executable, "-c", "import time; time.sleep(60)"),
                log_path=self.paths.logs / f"{name}.log",
                required=required,
                startup_timeout_seconds=2,
            )
        )

    def test_start_health_and_subsystems_are_explicit(self):
        snapshot = self.host.start([self.sleeper()])
        self.assertEqual(snapshot["desktopHost"]["state"], "READY")
        self.assertEqual(snapshot["workers"]["sleeper"]["state"], "RUNNING")
        self.assertEqual(snapshot["guardian"]["state"], "NOT_STARTED")
        self.assertEqual(snapshot["bodyRuntime"]["state"], "NOT_STARTED")
        self.assertEqual(snapshot["extensionConnectivity"]["state"], "UNKNOWN")
        self.assertEqual(snapshot["brain"]["state"], "NOT_STARTED")

    def test_stop_is_clean_and_shutdown_closes_worker(self):
        self.host.start([self.sleeper()])
        process = self.host.workers.process("sleeper")
        self.assertIsNotNone(process)
        snapshot = self.host.stop()
        self.assertEqual(snapshot["desktopHost"]["state"], "STOPPED")
        self.assertIsNotNone(process.poll())

    def test_double_start_does_not_duplicate_worker(self):
        launch = self.sleeper()
        first = self.host.start([launch])
        first_pid = first["workers"]["sleeper"]["pid"]
        second = self.host.start([launch])
        self.assertEqual(second["workers"]["sleeper"]["pid"], first_pid)

    def test_required_worker_crash_is_reflected_in_health(self):
        launch = WorkerLaunch(
            WorkerSpec(
                name="crasher",
                command=(sys.executable, "-c", "import time; time.sleep(0.15); raise SystemExit(7)"),
                required=True,
            )
        )
        self.host.start([launch])
        deadline = time.time() + 3
        snapshot = self.host.refresh_health()
        while time.time() < deadline and snapshot["desktopHost"]["state"] != "ERROR":
            time.sleep(0.05)
            snapshot = self.host.refresh_health()
        self.assertEqual(snapshot["desktopHost"]["state"], "ERROR")
        self.assertEqual(snapshot["workers"]["crasher"]["state"], "EXITED")
        self.assertEqual(snapshot["workers"]["crasher"]["exitCode"], 7)

    def test_paths_are_deterministic_and_separated(self):
        expected = {
            "root": self.root.resolve(),
            "runtime": self.root.resolve() / "runtime",
            "data": self.root.resolve() / "data",
            "logs": self.root.resolve() / "logs",
            "brain": self.root.resolve() / "brain",
            "body": self.root.resolve() / "body",
        }
        self.assertEqual(self.paths.as_dict(), expected)
        self.paths.ensure()
        for path in expected.values():
            self.assertTrue(path.is_dir())

    def test_logger_redacts_secret_and_token_material(self):
        logger = HostLogger(self.paths.logs / "redaction.log")
        secret = "super-secret-token-value"
        logger.register_secret(secret)
        logger.write(
            "redaction_test",
            token=secret,
            nested={"authorization": f"Bearer {secret}"},
            message=f"token={secret}",
        )
        text = (self.paths.logs / "redaction.log").read_text(encoding="utf-8")
        self.assertNotIn(secret, text)
        row = json.loads(text)
        self.assertEqual(row["token"], "[REDACTED]")
        self.assertEqual(row["nested"]["authorization"], "[REDACTED]")

    def test_phase2_foundation_has_no_physical_or_ledger_path(self):
        for relative in [
            "desktop/paths.py",
            "desktop/host_logging.py",
            "desktop/health.py",
            "desktop/worker_supervisor.py",
            "desktop/lifecycle.py",
        ]:
            source = (ROOT / relative).read_text(encoding="utf-8")
            for forbidden in [
                "BODY_STEP",
                "Input.dispatchMouseEvent",
                "Input.dispatchKeyEvent",
                "MotorLearning",
                "body_step_ledger",
                "HumanActionSegmenter",
                "source='human'",
                'source="human"',
                "source='agent'",
                'source="agent"',
            ]:
                self.assertNotIn(forbidden, source, f"{forbidden} leaked into {relative}")

    def test_startup_failure_is_fail_closed(self):
        launch = WorkerLaunch(
            WorkerSpec(
                name="missing",
                command=(str(self.root / "definitely-not-a-runtime"),),
                required=True,
            )
        )
        with self.assertRaises(HostStartupError):
            self.host.start([launch])
        snapshot = self.host.health.snapshot()
        self.assertEqual(snapshot["desktopHost"]["state"], "ERROR")
        self.assertFalse(any(row["state"] == "RUNNING" for row in snapshot["workers"].values()))
        self.assertEqual(self.host.refresh_health()["desktopHost"]["state"], "ERROR")

    def test_orphan_child_is_cleaned_with_worker_tree(self):
        pid_file = self.root / "runtime" / "child.pid"
        pid_file.parent.mkdir(parents=True, exist_ok=True)
        parent_code = (
            "import pathlib,subprocess,sys,time;"
            "p=subprocess.Popen([sys.executable,'-c','import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(60)']);"
            f"pathlib.Path({str(pid_file)!r}).write_text(str(p.pid), encoding='utf-8');"
            "time.sleep(60)"
        )
        launch = WorkerLaunch(
            WorkerSpec(
                name="parent-with-child",
                command=(sys.executable, "-c", parent_code),
                required=True,
            )
        )
        self.host.start([launch])
        deadline = time.time() + 3
        while time.time() < deadline and not pid_file.exists():
            time.sleep(0.05)
        self.assertTrue(pid_file.exists(), "child pid was not published")
        child_pid = int(pid_file.read_text(encoding="utf-8"))
        self.assertTrue(process_alive(child_pid))
        self.host.stop()
        deadline = time.time() + 3
        while time.time() < deadline and process_alive(child_pid):
            time.sleep(0.05)
        self.assertFalse(process_alive(child_pid), f"child process {child_pid} survived host shutdown")


if __name__ == "__main__":
    unittest.main()
