from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def find_chrome() -> Path:
    candidates: list[Path] = []
    explicit = str(os.environ.get("CHROME_PATH", "")).strip()
    if explicit:
        candidates.append(Path(explicit))
    for variable in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"):
        base = str(os.environ.get(variable, "")).strip()
        if base:
            candidates.append(Path(base) / "Google" / "Chrome" / "Application" / "chrome.exe")
            candidates.append(Path(base) / "Google" / "Chrome for Testing" / "Application" / "chrome.exe")
    located = shutil.which("chrome") or shutil.which("chrome.exe")
    if located:
        candidates.append(Path(located))
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    raise AssertionError(f"Chrome executable not found; checked: {[str(path) for path in candidates]}")


def parse_status(stdout: str) -> dict:
    for line in reversed([row.strip() for row in stdout.splitlines() if row.strip()]):
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict) and payload.get("product") == "BodyBrain":
            return payload
    raise AssertionError(f"BodyBrain emitted no JSON status: {stdout!r}")


def terminate_tree(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    if os.name == "nt":
        try:
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=15,
                check=False,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            return
        except Exception:
            pass
    try:
        process.terminate()
        process.wait(timeout=10)
    except Exception:
        try:
            process.kill()
        except Exception:
            pass


def main() -> int:
    if os.name != "nt":
        raise AssertionError("body_chrome_real_e2e_windows_only")
    if len(sys.argv) != 3:
        raise SystemExit("usage: body_chrome_real_e2e.py <BodyBrain.exe> <extension-dir>")

    executable = Path(sys.argv[1]).resolve()
    extension_dir = Path(sys.argv[2]).resolve()
    if not executable.is_file():
        raise AssertionError(f"BodyBrain.exe missing: {executable}")
    if not (extension_dir / "manifest.json").is_file():
        raise AssertionError(f"Extension dist missing manifest: {extension_dir}")
    chrome = find_chrome()

    with tempfile.TemporaryDirectory(prefix="body-real-chrome-e2e-") as tmp:
        temp_root = Path(tmp)
        local_app_data = temp_root / "local-app-data"
        user_data = temp_root / "chrome-profile"
        local_app_data.mkdir(parents=True, exist_ok=True)
        user_data.mkdir(parents=True, exist_ok=True)
        env = os.environ.copy()
        env["LOCALAPPDATA"] = str(local_app_data)

        chrome_process = subprocess.Popen(
            [
                str(chrome),
                f"--user-data-dir={user_data}",
                f"--disable-extensions-except={extension_dir}",
                f"--load-extension={extension_dir}",
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-component-update",
                "--disable-gpu",
                "--window-size=1280,800",
                "https://example.com/",
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        try:
            result = subprocess.run(
                [str(executable), "--check", "--json", "--ready-timeout", "25"],
                env=env,
                capture_output=True,
                text=True,
                timeout=75,
                check=False,
            )
            if result.returncode not in {0, 2}:
                raise AssertionError(
                    f"BodyBrain real-Chrome check failed rc={result.returncode}; stdout={result.stdout!r}; stderr={result.stderr!r}"
                )
            payload = parse_status(result.stdout)
            if payload.get("bodyRuntime") != "CONNECTED":
                raise AssertionError(f"BODY runtime not connected: {payload}")
            if payload.get("brain") != "NOT_CONFIGURED":
                raise AssertionError(f"Brain must remain excluded: {payload}")

            health = payload.get("health") or {}
            extension = health.get("extensionConnectivity") or {}
            guardian = health.get("guardian") or {}
            if extension.get("state") != "READY":
                raise AssertionError(f"real Chrome BODY Extension did not connect: {extension}; payload={payload}")
            if guardian.get("state") not in {"READY", "BLOCKED"}:
                raise AssertionError(f"Guardian did not resolve fail-closed readiness: {guardian}; payload={payload}")

            readiness = payload.get("guardianReadiness") or {}
            browsers = list(readiness.get("browsers") or [])
            if not browsers:
                raise AssertionError(f"real Chrome BrowserInstance missing: {payload}")
            if any(str(row.get("reason") or "") == "browser_offline" for row in browsers):
                raise AssertionError(f"real Chrome was stale/offline at readiness snapshot: {browsers}")

            paired_path = local_app_data / "BodyBrain" / "body" / "profiles" / ".auth" / "extensions.json"
            if not paired_path.is_file():
                raise AssertionError(f"Extension pairing state missing: {paired_path}")
            paired = json.loads(paired_path.read_text(encoding="utf-8"))
            if not isinstance(paired, dict) or not paired:
                raise AssertionError("Extension pairing state is empty")
        finally:
            terminate_tree(chrome_process)

    print("body_chrome_real_e2e: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
