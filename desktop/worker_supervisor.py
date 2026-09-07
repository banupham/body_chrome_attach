from __future__ import annotations

import os
import signal
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Mapping, Sequence

from .host_logging import HostLogger


class WorkerError(RuntimeError):
    pass


class WorkerStartError(WorkerError):
    pass


@dataclass(frozen=True)
class WorkerSpec:
    name: str
    command: Sequence[str]
    cwd: Path | str | None = None
    env: Mapping[str, str] | None = None
    log_path: Path | str | None = None
    required: bool = True
    startup_timeout_seconds: float = 5.0

    def validate(self) -> "WorkerSpec":
        if not str(self.name or "").strip():
            raise WorkerStartError("worker_name_required")
        if not self.command or not str(self.command[0] or "").strip():
            raise WorkerStartError(f"worker_command_required:{self.name}")
        if float(self.startup_timeout_seconds) <= 0:
            raise WorkerStartError(f"worker_startup_timeout_invalid:{self.name}")
        return self


@dataclass
class _WorkerRecord:
    spec: WorkerSpec
    process: subprocess.Popen[bytes]
    log_handle: object | None = None
    state: str = "STARTING"
    started_at: float = field(default_factory=time.monotonic)
    exit_code: int | None = None
    expected_stop: bool = False
    error: str | None = None


class WorkerSupervisor:
    def __init__(self, *, logger: HostLogger | None = None, stop_timeout_seconds: float = 5.0):
        self.logger = logger
        self.stop_timeout_seconds = max(0.1, float(stop_timeout_seconds))
        self._lock = threading.RLock()
        self._workers: dict[str, _WorkerRecord] = {}

    def _log(self, event: str, **fields: object) -> None:
        if self.logger is not None:
            self.logger.write(event, **fields)

    def _open_log(self, spec: WorkerSpec):
        if spec.log_path is None:
            return subprocess.DEVNULL
        path = Path(spec.log_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        return path.open("ab", buffering=0)

    def _spawn(self, spec: WorkerSpec, log_handle) -> subprocess.Popen[bytes]:
        env = os.environ.copy()
        if spec.env:
            env.update({str(key): str(value) for key, value in spec.env.items()})
        kwargs: dict[str, object] = {}
        if os.name == "nt":
            kwargs["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(subprocess, "CREATE_NO_WINDOW", 0)
        else:
            kwargs["start_new_session"] = True
        return subprocess.Popen(
            [str(item) for item in spec.command],
            cwd=str(spec.cwd) if spec.cwd is not None else None,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            **kwargs,
        )

    def start(self, spec: WorkerSpec, *, readiness_probe: Callable[[], bool] | None = None) -> subprocess.Popen[bytes]:
        spec.validate()
        name = str(spec.name).strip()
        with self._lock:
            current = self._workers.get(name)
            if current and current.process.poll() is None:
                return current.process
            if current:
                self._close_log(current)
                self._workers.pop(name, None)

            handle = self._open_log(spec)
            try:
                process = self._spawn(spec, handle)
            except Exception as exc:
                if handle not in (None, subprocess.DEVNULL):
                    try:
                        handle.close()
                    except Exception:
                        pass
                raise WorkerStartError(f"worker_spawn_failed:{name}:{type(exc).__name__}") from exc

            record = _WorkerRecord(spec=spec, process=process, log_handle=None if handle == subprocess.DEVNULL else handle)
            self._workers[name] = record
            self._log("worker_started", worker=name, pid=process.pid, required=spec.required)

        if readiness_probe is None:
            with self._lock:
                record.state = "RUNNING"
            return process

        deadline = time.monotonic() + float(spec.startup_timeout_seconds)
        last_probe_error: str | None = None
        while time.monotonic() < deadline:
            code = process.poll()
            if code is not None:
                with self._lock:
                    record.state = "ERROR"
                    record.exit_code = code
                    record.error = f"worker_exited_during_startup:{code}"
                self._close_log(record)
                raise WorkerStartError(f"worker_exited_during_startup:{name}:{code}")
            try:
                if readiness_probe():
                    with self._lock:
                        record.state = "RUNNING"
                    return process
            except Exception as exc:
                last_probe_error = type(exc).__name__
            time.sleep(0.05)

        self.stop(name)
        suffix = f":{last_probe_error}" if last_probe_error else ""
        raise WorkerStartError(f"worker_startup_timeout:{name}{suffix}")

    def poll(self) -> dict[str, dict[str, object]]:
        with self._lock:
            for name, record in self._workers.items():
                code = record.process.poll()
                if code is None:
                    continue
                record.exit_code = int(code)
                if record.state not in {"STOPPED", "ERROR", "EXITED"}:
                    record.state = "STOPPED" if record.expected_stop else "EXITED"
                    if not record.expected_stop:
                        record.error = f"worker_exited:{code}"
                        self._log("worker_exited", worker=name, exitCode=code, required=record.spec.required)
                self._close_log(record)
            return self.snapshot()

    def _terminate_tree(self, record: _WorkerRecord) -> None:
        process = record.process
        if os.name == "nt":
            # taskkill /T is used while the parent PID is still alive so descendants cannot be orphaned.
            try:
                subprocess.run(
                    ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=self.stop_timeout_seconds,
                    check=False,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
            except Exception:
                try:
                    process.kill()
                except Exception:
                    pass
            return

        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        except Exception:
            try:
                process.terminate()
            except Exception:
                pass

        try:
            process.wait(timeout=self.stop_timeout_seconds)
        except subprocess.TimeoutExpired:
            pass

        # The parent may exit before one of its descendants. The process group is
        # still addressable by the original leader PID, so finish the whole tree.
        try:
            os.killpg(process.pid, 0)
        except ProcessLookupError:
            return
        except Exception:
            pass

        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        except Exception:
            try:
                process.kill()
            except Exception:
                pass

    def stop(self, name: str) -> None:
        key = str(name or "").strip()
        with self._lock:
            record = self._workers.get(key)
            if record is None:
                return
            record.expected_stop = True
            process = record.process

        if process.poll() is None:
            self._terminate_tree(record)
            try:
                process.wait(timeout=self.stop_timeout_seconds)
            except Exception:
                try:
                    process.kill()
                except Exception:
                    pass

        with self._lock:
            record.exit_code = process.poll()
            record.state = "STOPPED"
            record.error = None
            self._close_log(record)
            self._log("worker_stopped", worker=key, exitCode=record.exit_code)

    def stop_all(self) -> None:
        with self._lock:
            names = list(self._workers.keys())
        for name in reversed(names):
            self.stop(name)

    def _close_log(self, record: _WorkerRecord) -> None:
        handle = record.log_handle
        record.log_handle = None
        if handle is not None:
            try:
                handle.close()
            except Exception:
                pass

    def process(self, name: str) -> subprocess.Popen[bytes] | None:
        with self._lock:
            record = self._workers.get(str(name or "").strip())
            return record.process if record else None

    def snapshot(self) -> dict[str, dict[str, object]]:
        with self._lock:
            return {
                name: {
                    "state": record.state,
                    "pid": record.process.pid,
                    "exitCode": record.exit_code,
                    "required": record.spec.required,
                    "error": record.error,
                }
                for name, record in self._workers.items()
            }
