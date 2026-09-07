from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
from pathlib import Path

from .config import RuntimeConfig, SOURCE_ROOT, ensure_runtime_dirs
from .host_logging import HostLogger
from .worker_supervisor import WorkerSpec, WorkerStartError, WorkerSupervisor


class SupervisorError(RuntimeError):
    pass


class BodyRuntimeSupervisor:
    """Owns the hidden BODY/Guardian worker and its complete process tree."""

    def __init__(self, config: RuntimeConfig, root: Path = SOURCE_ROOT):
        self.config = config
        self.root = Path(root)
        self.daemon_dir = self.root / "daemon"
        self.paths = ensure_runtime_dirs()
        self.logger = HostLogger(self.paths["logs"] / "desktop-host.log")
        self.workers = WorkerSupervisor(logger=self.logger, stop_timeout_seconds=5.0)
        self.process: subprocess.Popen[bytes] | None = None

    @property
    def body_data_dir(self) -> Path:
        return self.paths["body"]

    @property
    def controller_token_path(self) -> Path:
        # Protocol v7 legacy filename; it authenticates the local control plane.
        return self.body_data_dir / "profiles" / ".auth" / "brain.token"

    def _port_open(self) -> bool:
        try:
            with socket.create_connection((self.config.host, self.config.port), timeout=0.25): return True
        except OSError: return False

    def _node(self) -> str:
        if getattr(sys, "frozen", False):
            bundled = self.root / "runtime" / "node" / "node.exe"
            if not bundled.exists(): raise SupervisorError(f"bundled_node_runtime_missing:{bundled}")
            return str(bundled)
        explicit = os.environ.get("BODY_NODE_PATH", "").strip()
        if explicit:
            path = Path(explicit)
            if not path.exists(): raise SupervisorError(f"body_node_not_found:{path}")
            return str(path)
        located = shutil.which("node")
        if not located: raise SupervisorError("node_runtime_not_found")
        return located

    def _native_helper(self) -> Path | None:
        if not getattr(sys, "frozen", False): return None
        helper = self.root / "runtime" / "BodyWinInput.exe"
        if not helper.exists(): raise SupervisorError(f"bundled_windows_input_helper_missing:{helper}")
        return helper

    def start(self) -> subprocess.Popen[bytes]:
        if self.process and self.process.poll() is None: return self.process
        if self._port_open(): raise SupervisorError(f"body_runtime_port_in_use:{self.config.port}")
        env = {"BODY_RUNTIME_PORT":str(self.config.port),"BODY_RUNTIME_DATA_DIR":str(self.body_data_dir),"BODY_DESKTOP_HOSTED":"1"}
        native_helper = self._native_helper()
        if native_helper is not None: env["BODY_WINDOWS_INPUT_HELPER_EXE"] = str(native_helper)
        command = [self._node(), "-r", str(self.daemon_dir / "src" / "sticky_runtime_port_preload.js"), str(self.daemon_dir / "guardian_bootstrap.js")]
        spec = WorkerSpec(name="body-runtime", command=command, cwd=self.root, env=env, log_path=self.paths["logs"] / "body-runtime.log", required=True, startup_timeout_seconds=self.config.startup_timeout_seconds)
        try:
            self.process = self.workers.start(spec, readiness_probe=lambda: self._port_open() and self.controller_token_path.exists())
        except WorkerStartError as exc:
            self.process = None; raise SupervisorError(str(exc)) from exc
        return self.process

    def read_controller_token(self) -> str:
        if not self.controller_token_path.exists(): raise SupervisorError("controller_token_unavailable")
        token = self.controller_token_path.read_text(encoding="utf-8").strip()
        if not token: raise SupervisorError("controller_token_empty")
        self.logger.register_secret(token)
        return token

    def health(self) -> dict[str, dict[str, object]]:
        return self.workers.poll()

    def stop(self) -> None:
        self.workers.stop("body-runtime")
        self.process = None

    def __enter__(self) -> "BodyRuntimeSupervisor": self.start(); return self
    def __exit__(self, exc_type, exc, tb) -> None: self.stop()
