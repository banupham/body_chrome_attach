from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    result = subprocess.run([sys.executable,str(ROOT / "desktop" / "main.py"),"--check","--json","--ready-timeout","0.5"], cwd=str(ROOT), capture_output=True, text=True, timeout=25, check=False)
    if result.returncode != 2:
        explicit = str(os.environ.get("BODYBRAIN_HOME", "")).strip()
        if explicit:
            root = Path(explicit).expanduser()
        elif os.name == "nt" and str(os.environ.get("LOCALAPPDATA", "")).strip():
            root = Path(os.environ["LOCALAPPDATA"]).expanduser() / "BodyBrain"
        else:
            root = Path.home() / ".bodybrain"
        log_path = root / "logs" / "body-runtime.log"
        try:
            worker_log = log_path.read_text(encoding="utf-8", errors="replace")[-12000:]
        except OSError:
            worker_log = "<body-runtime.log unavailable>"
        raise AssertionError(f"desktop smoke expected CHECKING exit 2 without Chrome, got {result.returncode}; stdout={result.stdout!r} stderr={result.stderr!r}; worker_log={worker_log!r}")
    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    if not lines: raise AssertionError(f"desktop smoke produced no status; stderr={result.stderr!r}")
    payload = json.loads(lines[-1])
    if payload.get("product") != "BodyBrain" or payload.get("desktop") != "RUNNING" or payload.get("bodyRuntime") != "CONNECTED": raise AssertionError(f"unexpected desktop status: {payload}")
    if payload.get("brain") != "NOT_CONFIGURED": raise AssertionError(f"Brain must be absent from production: {payload}")
    health = payload.get("health") or {}
    if (health.get("brain") or {}).get("state") != "NOT_CONFIGURED": raise AssertionError(f"health must show Brain NOT_CONFIGURED: {health}")
    if payload.get("bodyContractVersion") != "1.0" or int(payload.get("controlProtocolVersion", 0)) != 7: raise AssertionError(f"desktop/runtime contract mismatch: {payload}")
    readiness = payload.get("guardianReadiness") or {}
    if readiness.get("state") != "CHECKING" or readiness.get("reason") != "browser_waiting": raise AssertionError(f"Guardian must fail closed while Chrome is absent: {readiness}")
    print("desktop_runtime_smoke: PASS"); return 0


if __name__ == "__main__": raise SystemExit(main())
