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
    allowed = expected or {0}
    if result.returncode not in allowed:
        raise ReleaseBuildError(
            f"command_failed:{result.returncode}:{' '.join(command)}\nstdout={result.stdout}\nstderr={result.stderr}"
        )
    return result


def env_flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


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


def authenticode_status(executable: Path) -> str:
    if os.name != "nt":
        return "NOT_WINDOWS"
    command = [
        "powershell.exe",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        f"$s=Get-AuthenticodeSignature -LiteralPath '{str(executable).replace(chr(39), chr(39)*2)}'; [Console]::Out.Write($s.Status.ToString())",
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=20, check=False)
    except Exception:
        return "UNKNOWN"
    value = result.stdout.strip().upper()
    return value or "UNKNOWN"


def maybe_sign(executable: Path) -> str:
    pfx = os.environ.get("BODYBRAIN_SIGN_PFX", "").strip()
    require_signature = env_flag("BODYBRAIN_REQUIRE_SIGNATURE", False)
    if pfx:
        pfx_path = Path(pfx).expanduser().resolve()
        if not pfx_path.exists():
            raise ReleaseBuildError(f"bodybrain_sign_pfx_missing:{pfx_path}")
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
        raise ReleaseBuildError(f"bodybrain_signature_required:{status}")
    return status


def build_native_helper() -> Path:
    pyinstaller(
        "--noconfirm",
        "--clean",
        "--onefile",
        "--console",
        "--noupx",
        "--name",
        "BodyWinInput",
        "--distpath",
        str(HELPER_DIST),
        "--workpath",
        str(HELPER_WORK),
        "--specpath",
        str(SPEC_DIR),
        str(ROOT / "daemon" / "native" / "windows_input.py"),
    )
    helper = HELPER_DIST / "BodyWinInput.exe"
    if not helper.exists():
        raise ReleaseBuildError("bodywininput_artifact_missing")
    run([str(helper), "selftest"])
    return helper


def build_bodybrain(helper: Path) -> Path:
    node = shutil.which("node")
    if not node:
        raise ReleaseBuildError("node_runtime_not_found")
    ws_dir = ROOT / "node_modules" / "ws"
    if not ws_dir.exists():
        raise ReleaseBuildError("node_modules_ws_missing:run_npm_install")

    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    pyinstaller(
        "--noconfirm",
        "--clean",
        "--onefile",
        "--console",
        "--noupx",
        "--name",
        "BodyBrain",
        "--distpath",
        str(ARTIFACTS),
        "--workpath",
        str(BODY_WORK),
        "--specpath",
        str(SPEC_DIR),
        "--paths",
        str(ROOT),
        "--hidden-import",
        "winreg",
        "--add-binary",
        add_data(Path(node), "runtime/node"),
        "--add-binary",
        add_data(helper, "runtime"),
        "--add-data",
        add_data(ROOT / "daemon", "daemon"),
        "--add-data",
        add_data(ROOT / "src", "src"),
        "--add-data",
        add_data(ws_dir, "node_modules/ws"),
        "--add-data",
        add_data(ROOT / "config", "config"),
        str(ROOT / "desktop" / "main.py"),
    )
    executable = ARTIFACTS / "BodyBrain.exe"
    if not executable.exists():
        raise ReleaseBuildError("bodybrain_artifact_missing")
    return executable


def write_release_manifest(executable: Path, signing_status: str | None = None) -> Path:
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    runtime = json.loads((ROOT / "config" / "bodybrain-runtime.json").read_text(encoding="utf-8"))
    extension = ARTIFACTS / f"body-chrome-attach-v{package['version']}.zip"
    if not extension.exists():
        raise ReleaseBuildError("extension_release_artifact_missing:run_npm_run_extension_package")
    status = signing_status or authenticode_status(executable)
    manifest = {
        "schemaVersion": 1,
        "product": "BodyBrain",
        "version": str(package["version"]),
        "bodyContractVersion": str(runtime["bodyContractVersion"]),
        "controlProtocolVersion": int(runtime["controlProtocolVersion"]),
        "runtimeBootstrap": {"host": runtime["host"], "port": int(runtime["port"])},
        "artifacts": {
            "BodyBrain.exe": {
                "sha256": sha256(executable),
                "authenticodeStatus": status,
            },
            extension.name: {"sha256": sha256(extension)},
        },
        "distributionBoundary": {
            "desktop": "one-file executable; internal Node/JS/native helper resources extract only at runtime",
            "extension": "bundled/minified Manifest V3 upload ZIP; no source maps or development source tree",
        },
    }
    output = ARTIFACTS / f"bodybrain-release-v{package['version']}.json"
    output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return output


def main() -> int:
    if os.name != "nt":
        raise ReleaseBuildError("bodybrain_release_build_windows_only")
    shutil.rmtree(WORK, ignore_errors=True)
    SPEC_DIR.mkdir(parents=True, exist_ok=True)
    helper = build_native_helper()
    executable = build_bodybrain(helper)
    signing_status = maybe_sign(executable)
    manifest = write_release_manifest(executable, signing_status)
    print(f"Built BodyBrain: {executable}")
    print(f"Authenticode status: {signing_status}")
    print(f"Release manifest: {manifest}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ReleaseBuildError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
