from __future__ import annotations

import threading
import time
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any


DESKTOP_STATES = frozenset({"STARTING", "READY", "DEGRADED", "BLOCKED", "STOPPING", "STOPPED", "ERROR"})
SUBSYSTEM_STATES = frozenset({"NOT_STARTED", "NOT_CONFIGURED", "UNKNOWN", "WAITING", "READY", "DEGRADED", "BLOCKED", "STOPPED", "ERROR"})


class HealthModel:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._started_monotonic: float | None = None
        self._desktop = {"state": "STOPPED", "reason": None}
        self._subsystems = {
            "guardian": {"state": "NOT_STARTED", "reason": None},
            "bodyRuntime": {"state": "NOT_STARTED", "reason": None},
            "extensionConnectivity": {"state": "WAITING", "reason": "extension_not_connected"},
            "brain": {"state": "NOT_CONFIGURED", "reason": "separate_research_track"},
        }
        self._workers: dict[str, dict[str, Any]] = {}

    def set_desktop(self, state: str, reason: str | None = None) -> None:
        normalized = str(state or "").upper()
        if normalized not in DESKTOP_STATES:
            raise ValueError(f"desktop_health_state_invalid:{normalized}")
        with self._lock:
            if normalized == "STARTING" and self._started_monotonic is None:
                self._started_monotonic = time.monotonic()
            if normalized == "STOPPED":
                self._started_monotonic = None
            self._desktop = {"state": normalized, "reason": reason}

    def set_subsystem(self, name: str, state: str, reason: str | None = None) -> None:
        key = str(name or "").strip()
        normalized = str(state or "").upper()
        if key not in self._subsystems:
            raise KeyError(f"desktop_health_subsystem_unknown:{key}")
        if normalized not in SUBSYSTEM_STATES:
            raise ValueError(f"desktop_subsystem_state_invalid:{normalized}")
        with self._lock:
            self._subsystems[key] = {"state": normalized, "reason": reason}

    def set_workers(self, workers: dict[str, dict[str, Any]]) -> None:
        with self._lock:
            self._workers = deepcopy(workers)

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            uptime_ms = None
            if self._started_monotonic is not None:
                uptime_ms = max(0, int((time.monotonic() - self._started_monotonic) * 1000))
            return {
                "desktopHost": {**deepcopy(self._desktop), "uptimeMs": uptime_ms},
                "guardian": deepcopy(self._subsystems["guardian"]),
                "bodyRuntime": deepcopy(self._subsystems["bodyRuntime"]),
                "extensionConnectivity": deepcopy(self._subsystems["extensionConnectivity"]),
                "brain": deepcopy(self._subsystems["brain"]),
                "workers": deepcopy(self._workers),
                "observedAt": datetime.now(timezone.utc).isoformat(),
            }
