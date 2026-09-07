from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


def run_check(executable: Path, local_app_data: Path) -> dict:
    env = os.environ.copy(); env["LOCALAPPDATA"] = str(local_app_data)
    result = subprocess.run([str(executable),"--check","--json","--ready-timeout","0.5"], env=env, capture_output=True, text=True, timeout=45, check=False)
    if result.returncode != 2: raise AssertionError(f"BodyBrain.exe expected fail-closed CHECKING exit 2 without Chrome; got {result.returncode}; stdout={result.stdout!r} stderr={result.stderr!r}")
    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    if not lines: raise AssertionError(f"BodyBrain.exe emitted no status; stderr={result.stderr!r}")
    payload = json.loads(lines[-1])
    if payload.get("product") != "BodyBrain" or payload.get("desktop") != "RUNNING" or payload.get("bodyRuntime") != "CONNECTED": raise AssertionError(f"packaged BODY worker did not connect: {payload}")
    if payload.get("brain") != "NOT_CONFIGURED" or (payload.get("health") or {}).get("brain",{}).get("state") != "NOT_CONFIGURED": raise AssertionError(f"packaged production must not enable Brain: {payload}")
    if "brainResult" in payload: raise AssertionError("packaged production unexpectedly emitted a Brain result")
    if payload.get("bodyContractVersion") != "1.0" or int(payload.get("controlProtocolVersion", 0)) != 7: raise AssertionError(f"packaged contract mismatch: {payload}")
    readiness = payload.get("guardianReadiness") or {}
    if readiness.get("state") != "CHECKING" or readiness.get("reason") != "browser_waiting": raise AssertionError(f"Guardian must fail closed without Chrome: {readiness}")
    return payload


def main() -> int:
    if len(sys.argv) != 2: raise SystemExit("usage: bodybrain_exe_smoke.py <BodyBrain.exe>")
    executable = Path(sys.argv[1]).resolve()
    if not executable.exists(): raise AssertionError(f"BodyBrain.exe missing: {executable}")
    with tempfile.TemporaryDirectory(prefix="bodybrain-exe-smoke-") as tmp:
        local_app_data = Path(tmp); run_check(executable, local_app_data); product_root = local_app_data / "BodyBrain"; body_root = product_root / "body"; token_path = body_root / "profiles" / ".auth" / "brain.token"; company_path = body_root / "identity" / "company.json"; device_path = body_root / "identity" / "device.json"
        if not token_path.exists() or not company_path.exists() or not device_path.exists(): raise AssertionError("packaged runtime did not persist control auth/identity under LocalAppData")
        first_token = token_path.read_text(encoding="utf-8").strip(); first_company = company_path.read_text(encoding="utf-8"); first_device = device_path.read_text(encoding="utf-8")
        if not first_token: raise AssertionError("packaged controller token is empty")
        run_check(executable, local_app_data)
        if token_path.read_text(encoding="utf-8").strip() != first_token: raise AssertionError("controller token changed across one-file runs")
        if company_path.read_text(encoding="utf-8") != first_company: raise AssertionError("company identity changed across one-file runs")
        if device_path.read_text(encoding="utf-8") != first_device: raise AssertionError("device identity changed across one-file runs")
        loose_code = [path for path in product_root.rglob("*") if path.is_file() and path.suffix.lower() in {".py",".pyc",".js",".map"}]
        if loose_code: raise AssertionError(f"LocalAppData must contain data only, not packaged source: {loose_code[:10]}")
    print("bodybrain_exe_smoke: PASS"); return 0


if __name__ == "__main__": raise SystemExit(main())
