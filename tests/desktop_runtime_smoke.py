from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    command = [
        sys.executable,
        str(ROOT / "desktop" / "main.py"),
        "--check",
        "--json",
        "--ready-timeout",
        "0.5",
    ]
    result = subprocess.run(
        command,
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    if result.returncode != 2:
        raise AssertionError(
            f"desktop smoke expected CHECKING exit 2 without Chrome, got {result.returncode}; "
            f"stdout={result.stdout!r} stderr={result.stderr!r}"
        )
    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    if not lines:
        raise AssertionError(f"desktop smoke produced no status; stderr={result.stderr!r}")
    payload = json.loads(lines[-1])
    if payload.get("product") != "BodyBrain":
        raise AssertionError(f"unexpected desktop product status: {payload}")
    if payload.get("desktop") != "RUNNING" or payload.get("bodyRuntime") != "CONNECTED":
        raise AssertionError(f"desktop did not connect to BODY runtime: {payload}")
    if payload.get("bodyContractVersion") != "1.0" or int(payload.get("controlProtocolVersion", 0)) != 7:
        raise AssertionError(f"desktop/runtime contract mismatch: {payload}")
    readiness = payload.get("guardianReadiness") or {}
    if readiness.get("state") != "CHECKING" or readiness.get("reason") != "browser_waiting":
        raise AssertionError(f"Guardian must fail closed while Chrome is absent: {readiness}")
    print("desktop_runtime_smoke: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
