from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts"


def sha256(pathname: Path) -> str:
    digest = hashlib.sha256()
    with pathname.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    runtime = json.loads((ROOT / "config" / "bodybrain-runtime.json").read_text(encoding="utf-8"))
    manifest_path = ARTIFACTS / f"bodybrain-release-v{package['version']}.json"
    executable = ARTIFACTS / "BodyBrain.exe"
    extension = ARTIFACTS / f"body-chrome-attach-v{package['version']}.zip"
    for pathname in (manifest_path, executable, extension):
        if not pathname.exists() or pathname.stat().st_size <= 0:
            raise AssertionError(f"release artifact missing or empty: {pathname}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("product") != "BodyBrain" or manifest.get("version") != package["version"]:
        raise AssertionError("release manifest product/version mismatch")
    if manifest.get("bodyContractVersion") != runtime["bodyContractVersion"]:
        raise AssertionError("release manifest BODY contract mismatch")
    if int(manifest.get("controlProtocolVersion", 0)) != int(runtime["controlProtocolVersion"]):
        raise AssertionError("release manifest control protocol mismatch")
    if (manifest.get("runtimeBootstrap") or {}).get("port") != runtime["port"]:
        raise AssertionError("release manifest bootstrap port mismatch")

    artifacts = manifest.get("artifacts") or {}
    desktop = artifacts.get("BodyBrain.exe") or {}
    ext = artifacts.get(extension.name) or {}
    if desktop.get("sha256") != sha256(executable):
        raise AssertionError("BodyBrain.exe SHA-256 mismatch")
    if ext.get("sha256") != sha256(extension):
        raise AssertionError("Chrome BODY Extension SHA-256 mismatch")
    signing = str(desktop.get("authenticodeStatus") or "").upper()
    if signing not in {"VALID", "NOTSIGNED", "UNKNOWN"}:
        raise AssertionError(f"unexpected Authenticode status: {signing}")

    forbidden = [path for path in ARTIFACTS.iterdir() if path.suffix.lower() in {".py", ".pyc", ".js", ".map", ".pem", ".pfx"}]
    if forbidden:
        raise AssertionError(f"release directory contains forbidden loose code/key files: {forbidden}")
    print("bodybrain_release_manifest_contract: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
