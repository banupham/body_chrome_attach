from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

from .config import RuntimeConfig, SOURCE_ROOT, ensure_runtime_dirs
from .host_logging import HostLogger
from .worker_supervisor import WorkerSpec, WorkerStartError, WorkerSupervisor


class SupervisorError(RuntimeError):
    pass


class BodyRuntimeSupervisor:
    """Owns the required Guardian worker and the hidden BODY worker."""

    def __init__(self, config: RuntimeConfig, root: Path = SOURCE_ROOT, *, bootstrap_name: str = "body_bootstrap.js", guardian_mode: str | None = None):
        self.config = config
        self.root = Path(root)
        self.daemon_dir = self.root / "daemon"
        self.bootstrap_name = str(bootstrap_name or "body_bootstrap.js")
        self.guardian_mode = str(guardian_mode).strip() if guardian_mode else None
        self.paths = ensure_runtime_dirs()
        self.logger = HostLogger(self.paths["logs"] / "desktop-host.log")
        self.workers = WorkerSupervisor(logger=self.logger, stop_timeout_seconds=5.0)
        self.process: subprocess.Popen[bytes] | None = None
        self.guardian_process: subprocess.Popen[bytes] | None = None
        self._guardian_watch_stop = threading.Event()
        self._guardian_watch_thread: threading.Thread | None = None

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

    @property
    def guardian_entry_path(self) -> Path:
        return self.root / "guardian" / "main.js"

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

    def _guardian_alive(self) -> bool:
        process = self.guardian_process or self.workers.process("guardian-runtime")
        return process is not None and process.poll() is None

    def _body_alive(self) -> bool:
        process = self.process or self.workers.process("body-runtime")
        return process is not None and process.poll() is None

    def _start_guardian(self) -> subprocess.Popen[bytes]:
        entry = self.guardian_entry_path
        if not entry.exists():
            raise SupervisorError(f"guardian_runtime_missing:{entry}")
        spec = WorkerSpec(
            name="guardian-runtime",
            command=[self._node(), str(entry)],
            cwd=self.root,
            env={
                "BODY_RUNTIME_DATA_DIR": str(self.body_data_dir),
                "BODY_DESKTOP_PARENT_PID": str(os.getpid()),
            },
            log_path=self.paths["logs"] / "guardian-runtime.log",
            required=True,
            startup_timeout_seconds=self.config.startup_timeout_seconds,
        )
        try:
            self.guardian_process = self.workers.start(spec)
        except WorkerStartError as exc:
            self.guardian_process = None
            raise SupervisorError(str(exc)) from exc
        time.sleep(0.1)
        if not self._guardian_alive():
            self.workers.poll()
            self.guardian_process = None
            raise SupervisorError("guardian_required_before_body")
        self.logger.write("guardian_required_ready_for_body", pid=self.guardian_process.pid)
        return self.guardian_process

    def _guardian_watch_loop(self) -> None:
        while not self._guardian_watch_stop.wait(0.1):
            body = self.process or self.workers.process("body-runtime")
            if body is None or body.poll() is not None:
                return
            if self._guardian_alive():
                continue
            self.logger.write("guardian_lost_stopping_body", bodyPid=body.pid)
            self.workers.poll()
            self.workers.stop("body-runtime")
            self._cleanup_runtime_state_for_pid(body.pid)
            self.process = None
            return

    def _start_guardian_watch(self) -> None:
        self._guardian_watch_stop.clear()
        current = self._guardian_watch_thread
        if current is not None and current.is_alive():
            return
        self._guardian_watch_thread = threading.Thread(
            target=self._guardian_watch_loop,
            name="BodyBrainGuardianWatch",
            daemon=True,
        )
        self._guardian_watch_thread.start()

    def start(self) -> subprocess.Popen[bytes]:
        if self._body_alive() and self._guardian_alive():
            return self.process or self.workers.process("body-runtime")  # type: ignore[return-value]
        if self._body_alive() or self._guardian_alive():
            self.stop()
        self._recover_stale_runtime_state()
        self._guardian_watch_stop.clear()
        self._start_guardian()
        if not self._guardian_alive():
            raise SupervisorError("guardian_required_before_body")
        env = {
            "BODY_RUNTIME_PORT": str(self.config.port),
            "BODY_RUNTIME_DATA_DIR": str(self.body_data_dir),
            "BODY_DESKTOP_HOSTED": "1",
            "BODY_DESKTOP_PARENT_PID": str(os.getpid()),
        }
        if self.guardian_mode:
            env["BODY_GUARDIAN_MODE"] = self.guardian_mode
        native_helper = self._native_helper()
        if native_helper is not None:
            env["BODY_WINDOWS_INPUT_HELPER_EXE"] = str(native_helper)
        command = [
            self._node(),
            "-r",
            str(self.daemon_dir / "src" / "sticky_runtime_port_preload.js"),
            str(self.daemon_dir / self.bootstrap_name),
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
                readiness_probe=lambda: self._port_open() and self.controller_token_path.exists() and self._guardian_alive(),
            )
        except WorkerStartError as exc:
            failed = self.workers.process("body-runtime")
            if failed is not None:
                self._cleanup_runtime_state_for_pid(failed.pid)
            self.process = None
            self.workers.stop("guardian-runtime")
            self.guardian_process = None
            raise SupervisorError(str(exc)) from exc
        self._start_guardian_watch()
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
        snapshot = self.workers.poll()
        body = snapshot.get("body-runtime") or {}
        guardian = snapshot.get("guardian-runtime") or {}
        if body.get("state") == "RUNNING" and guardian.get("state") != "RUNNING":
            process = self.process or self.workers.process("body-runtime")
            pid = process.pid if process is not None else None
            self.logger.write("guardian_unhealthy_stopping_body", guardianState=guardian.get("state"), bodyPid=pid)
            self.workers.stop("body-runtime")
            self._cleanup_runtime_state_for_pid(pid)
            self.process = None
            snapshot = self.workers.poll()
        return snapshot

    def stop(self) -> None:
        self._guardian_watch_stop.set()
        process = self.process or self.workers.process("body-runtime")
        pid = process.pid if process is not None else None
        # BODY must never outlive Guardian. During an intentional shutdown BODY
        # is stopped first, then the required Guardian worker is stopped.
        self.workers.stop("body-runtime")
        if pid is not None:
            self._cleanup_runtime_state_for_pid(pid)
        self.process = None
        self.workers.stop("guardian-runtime")
        self.guardian_process = None
        watcher = self._guardian_watch_thread
        if watcher is not None and watcher.is_alive() and watcher is not threading.current_thread():
            watcher.join(timeout=1.0)
        self._guardian_watch_thread = None

    def __enter__(self) -> "BodyRuntimeSupervisor":
        self.start()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.stop()
