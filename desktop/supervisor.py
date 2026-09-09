from __future__ import annotations

import json
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

    @property
    def runtime_state_dir(self) -> Path:
        return self.body_data_dir / "state"

    @property
    def runtime_lock_path(self) -> Path:
        return self.runtime_state_dir / "runtime.lock"

    @property
    def runtime_endpoint_path(self) -> Path:
        return self.runtime_state_dir / "runtime-endpoint.json"

    def _port_open(self) -> bool:
        try:
            with socket.create_connection((self.config.host, self.config.port), timeout=0.25):
                return True
        except OSError:
            return False

    def _remove_state_file(self, path: Path) -> bool:
        try:
            path.unlink()
            return True
        except FileNotFoundError:
            return False
        except OSError as exc:
            raise SupervisorError(f"runtime_state_cleanup_failed:{path.name}:{type(exc).__name__}") from exc

    @staticmethod
    def _state_owner_pid(path: Path) -> int | None:
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            pid = int(raw.get("pid", 0))
            return pid if pid > 0 else None
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            return None

    def _recover_stale_runtime_state(self) -> list[str]:
        """Recover ownership artifacts left behind by a force-killed worker.

        The product runtime has one fixed localhost bootstrap port. If that port is
        closed, no previous BODY process can still own the production transport.
        Therefore stale PID files are evidence only, never stronger than the real
        socket. This also handles Windows PID reuse by unrelated Chrome processes.
        """
        if self._port_open():
            raise SupervisorError(f"body_runtime_port_in_use:{self.config.port}")
        removed: list[str] = []
        for path in (self.runtime_lock_path, self.runtime_endpoint_path):
            if path.exists() and self._remove_state_file(path):
                removed.append(path.name)
        if removed:
            self.logger.write(
                "runtime_stale_state_recovered",
                port=self.config.port,
                files=removed,
                authority="localhost_port_closed",
            )
        return removed

    def _cleanup_runtime_state_for_pid(self, pid: int | None) -> list[str]:
        if not pid:
            return []
        removed: list[str] = []
        port_open = self._port_open()
        for path in (self.runtime_lock_path, self.runtime_endpoint_path):
            if not path.exists():
                continue
            owner = self._state_owner_pid(path)
            # Remove state owned by the worker we just stopped. If a force-kill
            # damaged the JSON, it is also safe to remove once the product port is
            # confirmed closed. Never delete a different live runtime's state.
            if owner == int(pid) or (owner is None and not port_open):
                if self._remove_state_file(path):
                    removed.append(path.name)
        if removed:
            self.logger.write("runtime_state_cleaned_after_worker_stop", workerPid=int(pid), files=removed)
        return removed

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
        self._recover_stale_runtime_state()
        env = {
            "BODY_RUNTIME_PORT": str(self.config.port),
            "BODY_RUNTIME_DATA_DIR": str(self.body_data_dir),
            "BODY_DESKTOP_HOSTED": "1",
        }
        native_helper = self._native_helper()
        if native_helper is not None:
            env["BODY_WINDOWS_INPUT_HELPER_EXE"] = str(native_helper)
        command = [
            self._node(),
            "-r",
            str(self.daemon_dir / "src" / "sticky_runtime_port_preload.js"),
            str(self.daemon_dir / "guardian_bootstrap.js"),
        ]
        spec = WorkerSpec(
            name="body-runtime",
            command=command,
            cwd=self.root,
            env=env,
            log_path=self.paths["logs"] / "body-runtime.log",
            required=True,
            startup_timeout_seconds=self.config.startup_timeout_seconds,
        )
        try:
            self.process = self.workers.start(
                spec,
                readiness_probe=lambda: self._port_open() and self.controller_token_path.exists(),
            )
        except WorkerStartError as exc:
            failed = self.workers.process("body-runtime")
            if failed is not None:
                self._cleanup_runtime_state_for_pid(failed.pid)
            self.process = None
            raise SupervisorError(str(exc)) from exc
        return self.process

    def read_controller_token(self) -> str:
        if not self.controller_token_path.exists():
            raise SupervisorError("controller_token_unavailable")
        token = self.controller_token_path.read_text(encoding="utf-8").strip()
        if not token:
            raise SupervisorError("controller_token_empty")
        self.logger.register_secret(token)
        return token

    def health(self) -> dict[str, dict[str, object]]:
        return self.workers.poll()

    def stop(self) -> None:
        process = self.process or self.workers.process("body-runtime")
        pid = process.pid if process is not None else None
        self.workers.stop("body-runtime")
        if pid is not None:
            self._cleanup_runtime_state_for_pid(pid)
        self.process = None

    def __enter__(self) -> "BodyRuntimeSupervisor":
        self.start()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.stop()
