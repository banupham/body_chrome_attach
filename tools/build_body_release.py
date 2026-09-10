from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts"
WORK = ROOT / ".release-build"
HELPER_DIST = WORK / "helper-dist"
HELPER_WORK = WORK / "helper-work"
BODY_WORK = WORK / "body-work"
SPEC_DIR = WORK / "spec"


class ReleaseBuildError(RuntimeError):
    pass


def run(command: list[str], *, cwd: Path = ROOT, expected: set[int] | None = None) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(command, cwd=str(cwd), text=True, capture_output=True, check=False)
    if result.returncode not in (expected or {0}):
        raise ReleaseBuildError(
            f"command_failed:{result.returncode}:{' '.join(command)}\nstdout={result.stdout}\nstderr={result.stderr}"
        )
    return result


def env_flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    return default if raw is None or not raw.strip() else raw.strip().lower() in {"1", "true", "yes", "on"}


def pyinstaller(*args: str) -> None:
    run([sys.executable, "-m", "PyInstaller", *args])


def add_data(source: Path, destination: str) -> str:
    return f"{source}{os.pathsep}{destination}"


def sha256(pathname: Path) -> str:
    digest = hashlib.sha256()
    with pathname.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def extension_artifact() -> Path:
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    return ARTIFACTS / f"BodyChromeAttach-v{package['version']}.zip"


def clean_release_artifacts() -> Path:
    extension = extension_artifact()
    if not extension.exists() or extension.stat().st_size <= 0:
        raise ReleaseBuildError("extension_release_artifact_missing:run_npm_run_extension_protected_test")
    for path in ARTIFACTS.iterdir():
        if path.resolve() == extension.resolve():
            continue
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
        else:
            try:
                path.unlink()
            except FileNotFoundError:
                pass
    return extension


def authenticode_status(executable: Path) -> str:
    if os.name != "nt":
        return "NOT_WINDOWS"
    command = [
        "powershell.exe",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        f"$s=Get-AuthenticodeSignature -LiteralPath '{str(executable).replace(chr(39), chr(39) * 2)}'; [Console]::Out.Write($s.Status.ToString())",
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=20, check=False)
    except Exception:
        return "UNKNOWN"
    return result.stdout.strip().upper() or "UNKNOWN"


def maybe_sign(executable: Path) -> str:
    pfx = os.environ.get("BODY_SIGN_PFX", "").strip() or os.environ.get("BODYBRAIN_SIGN_PFX", "").strip()
    require_signature = env_flag("BODY_REQUIRE_SIGNATURE", env_flag("BODYBRAIN_REQUIRE_SIGNATURE", False))
    if pfx:
        pfx_path = Path(pfx).expanduser().resolve()
        if not pfx_path.exists():
            raise ReleaseBuildError(f"body_sign_pfx_missing:{pfx_path}")
        run([
            "powershell.exe",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(ROOT / "tools" / "sign_bodybrain.ps1"),
            "-PfxPath",
            str(pfx_path),
            "-Executable",
            str(executable),
        ])
    status = authenticode_status(executable)
    if require_signature and status != "VALID":
        raise ReleaseBuildError(f"body_signature_required:{status}")
    return status


def build_native_helper() -> Path:
    pyinstaller(
        "--noconfirm", "--clean", "--onefile", "--console", "--noupx",
        "--name", "BodyWinInput",
        "--distpath", str(HELPER_DIST),
        "--workpath", str(HELPER_WORK),
        "--specpath", str(SPEC_DIR),
        str(ROOT / "daemon" / "native" / "windows_input.py"),
    )
    helper = HELPER_DIST / "BodyWinInput.exe"
    if not helper.exists():
        raise ReleaseBuildError("bodywininput_artifact_missing")
    run([str(helper), "selftest"])
    return helper


def build_body(helper: Path) -> Path:
    node = shutil.which("node")
    if not node:
        raise ReleaseBuildError("node_runtime_not_found")
    ws_dir = ROOT / "node_modules" / "ws"
    if not ws_dir.exists():
        raise ReleaseBuildError("node_modules_ws_missing:run_npm_install")
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    pyinstaller(
        "--noconfirm", "--clean", "--onefile", "--windowed", "--noupx",
        "--name", "BODY",
        "--distpath", str(ARTIFACTS),
        "--workpath", str(BODY_WORK),
        "--specpath", str(SPEC_DIR),
        "--paths", str(ROOT),
        "--hidden-import", "winreg",
        "--add-binary", add_data(Path(node), "runtime/node"),
        "--add-binary", add_data(helper, "runtime"),
        "--add-data", add_data(ROOT / "daemon", "daemon"),
        "--add-data", add_data(ROOT / "src", "src"),
        "--add-data", add_data(ws_dir, "node_modules/ws"),
        "--add-data", add_data(ROOT / "config", "config"),
        str(ROOT / "desktop" / "main.py"),
    )
    executable = ARTIFACTS / "BODY.exe"
    if not executable.exists():
        raise ReleaseBuildError("body_artifact_missing")
    return executable


def write_release_manifest(executable: Path, signing_status: str | None = None) -> Path:
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    runtime = json.loads((ROOT / "config" / "bodybrain-runtime.json").read_text(encoding="utf-8"))
    extension = extension_artifact()
    if not extension.exists():
        raise ReleaseBuildError("extension_release_artifact_missing:run_npm_run_extension_protected_test")
    manifest = {
        "schemaVersion": 3,
        "product": "BODY",
        "version": str(package["version"]),
        "bodyContractVersion": str(runtime["bodyContractVersion"]),
        "controlProtocolVersion": int(runtime["controlProtocolVersion"]),
        "runtimeBootstrap": {"host": runtime["host"], "port": int(runtime["port"])},
        "brain": {"included": False, "state": "NOT_CONFIGURED", "track": "separate-research"},
        "artifacts": {
            "BODY.exe": {
                "sha256": sha256(executable),
                "authenticodeStatus": signing_status or authenticode_status(executable),
            },
            extension.name: {
                "sha256": sha256(extension),
                "protectionProfile": "offline-obfuscated-v1",
                "target": "browser-no-eval",
            },
        },
        "distributionBoundary": {
            "desktop": "one-file Windows GUI BODY host with tray, Guardian and bundled runtime; Brain is not included",
            "extension": "single protected offline Manifest V3 ZIP; no source maps, source tree, CRX, or signing key",
        },
    }
    output = ARTIFACTS / f"body-release-v{package['version']}.json"
    output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return output


def main() -> int:
    if os.name != "nt":
        raise ReleaseBuildError("body_release_build_windows_only")
    clean_release_artifacts()
    shutil.rmtree(WORK, ignore_errors=True)
    try:
        SPEC_DIR.mkdir(parents=True, exist_ok=True)
        helper = build_native_helper()
        executable = build_body(helper)
        signing_status = maybe_sign(executable)
        manifest = write_release_manifest(executable, signing_status)
        print(f"Built BODY: {executable}")
        print(f"Authenticode status: {signing_status}")
        print(f"Release manifest: {manifest}")
        return 0
    finally:
        shutil.rmtree(WORK, ignore_errors=True)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ReleaseBuildError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
