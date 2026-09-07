from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

from .config import RuntimeConfig, SOURCE_ROOT, ensure_runtime_dirs


class SupervisorError(RuntimeError):
    pass


class BodyRuntimeSupervisor:
    """Owns the hidden BODY/Guardian worker for the desktop product."""

    def __init__(self, config: RuntimeConfig, root: Path = SOURCE_ROOT):
        self.config = config
        self.root = Path(root)
        self.daemon_dir = self.root / "daemon"
        self.process: subprocess.Popen[bytes] | None = None
        self.log_handle = None
        self.paths = ensure_runtime_dirs()

    @property
    def body_data_dir(self) -> Path:
        return self.paths["body"]

    @property
    def brain_token_path(self) -> Path:
        return self.body_data_dir / "profiles" / ".auth" / "brain.token"

    def _port_open(self) -> bool:
        try:
            with socket.create_connection((self.config.host, self.config.port), timeout=0.25):
                return True
        except OSError:
            return False

    def _node(self) -> str:
        if getattr(sys, "frozen", False):
            bundled = self.root / "runtime" / "node" / "node.exe"
            if not bundled.exists():
                raise SupervisorError(f"bundled_node_runtime_missing:{bundled}")
            return str(bundled)
        explicit = os.environ.get("BODY_NODE_PATH", "").strip()
        if explicit:
            path = Path(explicit)
            if not path.exists():
                raise SupervisorError(f"body_node_not_found:{path}")
            return str(path)
        located = shutil.which("node")
        if not located:
            raise SupervisorError("node_runtime_not_found")
        return located

    def _native_helper(self) -> Path | None:
        if not getattr(sys, "frozen", False):
            return None
        helper = self.root / "runtime" / "BodyWinInput.exe"
        if not helper.exists():
            raise SupervisorError(f"bundled_windows_input_helper_missing:{helper}")
        return helper

    def start(self) -> subprocess.Popen[bytes]:
        if self.process and self.process.poll() is None:
            return self.process
        if self._port_open():
            raise SupervisorError(f"body_runtime_port_in_use:{self.config.port}")

        log_path = self.paths["logs"] / "body-runtime.log"
        self.log_handle = open(log_path, "ab", buffering=0)
        env = os.environ.copy()
        env["BODY_RUNTIME_PORT"] = str(self.config.port)
        env["BODY_RUNTIME_DATA_DIR"] = str(self.body_data_dir)
        env["BODY_DESKTOP_HOSTED"] = "1"
        native_helper = self._native_helper()
        if native_helper is not None:
            env["BODY_WINDOWS_INPUT_HELPER_EXE"] = str(native_helper)
        command = [
            self._node(),
            "-r",
            str(self.daemon_dir / "src" / "sticky_runtime_port_preload.js"),
            str(self.daemon_dir / "guardian_bootstrap.js"),
        ]
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
        try:
            self.process = subprocess.Popen(
                command,
                cwd=str(self.root),
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=self.log_handle,
                stderr=subprocess.STDOUT,
                creationflags=creationflags,
            )
        except Exception:
            self._close_log()
            raise

        deadline = time.monotonic() + self.config.startup_timeout_seconds
        while time.monotonic() < deadline:
            code = self.process.poll()
            if code is not None:
                self._close_log()
                raise SupervisorError(f"body_runtime_exited_during_startup:{code}")
            if self._port_open() and self.brain_token_path.exists():
                return self.process
            time.sleep(0.1)

        self.stop()
        raise SupervisorError("body_runtime_startup_timeout")

    def read_brain_token(self) -> str:
        if not self.brain_token_path.exists():
            raise SupervisorError("brain_token_unavailable")
        token = self.brain_token_path.read_text(encoding="utf-8").strip()
        if not token:
            raise SupervisorError("brain_token_empty")
        return token

    def _close_log(self) -> None:
        handle = self.log_handle
        self.log_handle = None
        if handle:
            try:
                handle.close()
            except Exception:
                pass

    def stop(self) -> None:
        process = self.process
        self.process = None
        if process and process.poll() is None:
            try:
                process.terminate()
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
            except Exception:
                try:
                    process.kill()
                except Exception:
                    pass
        self._close_log()

    def __enter__(self) -> "BodyRuntimeSupervisor":
        self.start()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.stop()
