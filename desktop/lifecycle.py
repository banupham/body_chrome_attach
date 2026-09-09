from __future__ import annotations

import atexit
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

from .health import HealthModel
from .host_logging import HostLogger
from .paths import DesktopPaths, resolve_desktop_paths
from .worker_supervisor import WorkerSpec, WorkerStartError, WorkerSupervisor


class HostLifecycleError(RuntimeError):
    pass


class HostStartupError(HostLifecycleError):
    pass


@dataclass(frozen=True)
class WorkerLaunch:
    spec: WorkerSpec
    readiness_probe: Callable[[], bool] | None = None


class DesktopHost:
    """Phase-2 host foundation. It owns process lifecycle, paths, logs, workers and host health only."""

    def __init__(
        self,
        *,
        paths: DesktopPaths | None = None,
        root: Path | str | None = None,
        logger: HostLogger | None = None,
        worker_supervisor: WorkerSupervisor | None = None,
        stop_timeout_seconds: float = 5.0,
    ) -> None:
        self.paths = (paths or resolve_desktop_paths(root)).ensure()
        self.logger = logger or HostLogger(self.paths.logs / "desktop-host.log")
        self.workers = worker_supervisor or WorkerSupervisor(
            logger=self.logger,
            stop_timeout_seconds=stop_timeout_seconds,
        )
        self.health = HealthModel()
        self._lock = threading.RLock()
        self._started = False
        self._atexit_installed = False

    def _install_cleanup(self) -> None:
        if self._atexit_installed:
            return
        atexit.register(self.stop)
        self._atexit_installed = True

    def start(self, launches: Iterable[WorkerLaunch] = ()) -> dict[str, object]:
        with self._lock:
            current = self.health.snapshot()["desktopHost"]["state"]
            if self._started and current in {"STARTING", "READY", "DEGRADED"}:
                return self.refresh_health()
            self.health.set_desktop("STARTING")
            self._started = True
            self._install_cleanup()
            self.logger.write("desktop_host_starting")

        started: list[str] = []
        try:
            for launch in launches:
                if not isinstance(launch, WorkerLaunch):
                    raise HostStartupError("desktop_worker_launch_invalid")
                probe = launch.readiness_probe if callable(launch.readiness_probe) else None
                self.workers.start(launch.spec, readiness_probe=probe)
                started.append(launch.spec.name)
            snapshot = self.refresh_health()
            if snapshot["desktopHost"]["state"] != "READY":
                raise HostStartupError("desktop_host_not_ready_after_start")
            self.logger.write("desktop_host_ready", workerCount=len(started))
            return snapshot
        except Exception as exc:
            self.workers.stop_all()
            self.health.set_workers(self.workers.snapshot())
            self.health.set_desktop("ERROR", f"startup_failed:{type(exc).__name__}")
            self.logger.write("desktop_host_start_failed", level="ERROR", error=type(exc).__name__)
            if isinstance(exc, HostStartupError):
                raise
            if isinstance(exc, WorkerStartError):
                raise HostStartupError(str(exc)) from exc
            raise HostStartupError(f"desktop_host_startup_failed:{type(exc).__name__}") from exc

    def refresh_health(self) -> dict[str, object]:
        with self._lock:
            current = self.health.snapshot()["desktopHost"]["state"]
            workers = self.workers.poll()
            self.health.set_workers(workers)
            if current in {"STOPPING", "STOPPED", "BLOCKED", "ERROR"}:
                return self.health.snapshot()

            required_failure = any(
                row.get("required") is True and row.get("state") in {"EXITED", "ERROR"}
                for row in workers.values()
            )
            optional_failure = any(
                row.get("required") is False and row.get("state") in {"EXITED", "ERROR"}
                for row in workers.values()
            )
            pending = any(row.get("state") == "STARTING" for row in workers.values())

            if required_failure:
                self.health.set_desktop("ERROR", "required_worker_failed")
            elif optional_failure:
                self.health.set_desktop("DEGRADED", "optional_worker_failed")
            elif pending:
                self.health.set_desktop("STARTING", "worker_starting")
            else:
                self.health.set_desktop("READY")
            return self.health.snapshot()

    def set_subsystem(self, name: str, state: str, reason: str | None = None) -> dict[str, object]:
        self.health.set_subsystem(name, state, reason)
        return self.health.snapshot()

    def stop(self) -> dict[str, object]:
        with self._lock:
            state = self.health.snapshot()["desktopHost"]["state"]
            if state == "STOPPED":
                return self.health.snapshot()
            self.health.set_desktop("STOPPING")
            self.logger.write("desktop_host_stopping")

        self.workers.stop_all()
        self.health.set_workers(self.workers.snapshot())
        self.health.set_desktop("STOPPED")
        self._started = False
        self.logger.write("desktop_host_stopped")
        return self.health.snapshot()
