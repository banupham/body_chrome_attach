from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "split-artifacts" / "body"
WORK = ROOT / ".split-test-build"
STAGE = WORK / "body-stage"
HELPER_DIST = WORK / "helper-dist"
HELPER_WORK = WORK / "helper-work"
BODY_WORK = WORK / "body-work"
SPEC_DIR = WORK / "spec"

GUARDIAN_IMPLEMENTATION_FILES = {
    "guardian_bootstrap.js",
    "src/guardian_module.js",
    "src/environment_guardian.js",
    "src/protection_supervisor.js",
    "src/behavior_guardian.js",
    "src/external_controller_probe.js",
    "src/device_network_probe.js",
}


class BuildError(RuntimeError):
    pass


def run(command: list[str]) -> None:
    result = subprocess.run(command, cwd=str(ROOT), text=True, capture_output=True, check=False)
    if result.returncode != 0:
        raise BuildError(f"command_failed:{result.returncode}:{' '.join(command)}\nstdout={result.stdout}\nstderr={result.stderr}")


def add_data(source: Path, destination: str) -> str:
    return f"{source}{os.pathsep}{destination}"


def pyinstaller(*args: str) -> None:
    run([sys.executable, "-m", "PyInstaller", *args])


def copy_body_daemon() -> Path:
    source = ROOT / "daemon"
    target = STAGE / "daemon"
    shutil.copytree(source, target, dirs_exist_ok=True)
    for relative in GUARDIAN_IMPLEMENTATION_FILES:
        path = target / Path(relative)
        if path.exists():
            path.unlink()
    for relative in GUARDIAN_IMPLEMENTATION_FILES:
        if (target / Path(relative)).exists():
            raise BuildError(f"guardian_file_leaked_into_body_stage:{relative}")
    required = [
        target / "body_bootstrap.js",
        target / "server.js",
        target / "src" / "daemon_runtime.js",
        target / "src" / "guardian_authority_gate.js",
    ]
    for path in required:
        if not path.exists():
            raise BuildError(f"body_stage_required_file_missing:{path.name}")
    return target


def build_helper() -> Path:
    pyinstaller(
        "--noconfirm","--clean","--onefile","--console","--noupx","--name","BodyWinInput",
        "--distpath",str(HELPER_DIST),"--workpath",str(HELPER_WORK),"--specpath",str(SPEC_DIR),
        str(ROOT / "daemon" / "native" / "windows_input.py"),
    )
    helper = HELPER_DIST / "BodyWinInput.exe"
    if not helper.exists():
        raise BuildError("bodywininput_missing")
    run([str(helper), "selftest"])
    return helper


def build() -> Path:
    if os.name != "nt":
        raise BuildError("body_core_build_windows_only")
    node = shutil.which("node")
    if not node:
        raise BuildError("node_runtime_not_found")
    ws_dir = ROOT / "node_modules" / "ws"
    if not ws_dir.exists():
        raise BuildError("node_modules_ws_missing")
    shutil.rmtree(WORK, ignore_errors=True)
    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True, exist_ok=True)
    SPEC_DIR.mkdir(parents=True, exist_ok=True)
    daemon_stage = copy_body_daemon()
    helper = build_helper()
    pyinstaller(
        "--noconfirm","--clean","--onefile","--console","--noupx","--name","BodyCore",
        "--distpath",str(OUT),"--workpath",str(BODY_WORK),"--specpath",str(SPEC_DIR),
        "--paths",str(ROOT),
        "--add-binary",add_data(Path(node),"runtime/node"),
        "--add-binary",add_data(helper,"runtime"),
        "--add-data",add_data(daemon_stage,"daemon"),
        "--add-data",add_data(ROOT / "src","src"),
        "--add-data",add_data(ws_dir,"node_modules/ws"),
        "--add-data",add_data(ROOT / "config","config"),
        str(ROOT / "desktop" / "body_only_main.py"),
    )
    executable = OUT / "BodyCore.exe"
    if not executable.exists():
        raise BuildError("body_core_executable_missing")
    run([str(executable), "--check", "--json"])
    return executable


if __name__ == "__main__":
    try:
        artifact = build()
        print(f"Built BODY-only artifact: {artifact}")
    except BuildError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
    finally:
        shutil.rmtree(WORK, ignore_errors=True)
