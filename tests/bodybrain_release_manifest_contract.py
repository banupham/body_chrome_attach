from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]; ARTIFACTS = ROOT / "artifacts"


def sha256(pathname: Path) -> str:
    digest = hashlib.sha256()
    with pathname.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""): digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8")); runtime = json.loads((ROOT / "config" / "bodybrain-runtime.json").read_text(encoding="utf-8")); manifest_path = ARTIFACTS / f"bodybrain-release-v{package['version']}.json"; executable = ARTIFACTS / "BodyBrain.exe"; extension = ARTIFACTS / f"BodyChromeAttach-v{package['version']}-PROTECTED.zip"
    expected = {manifest_path.name, executable.name, extension.name}
    actual = {path.name for path in ARTIFACTS.iterdir() if path.is_file()}
    if actual != expected: raise AssertionError(f"release directory must contain exactly {sorted(expected)}, got {sorted(actual)}")
    for pathname in (manifest_path, executable, extension):
        if not pathname.exists() or pathname.stat().st_size <= 0: raise AssertionError(f"release artifact missing or empty: {pathname}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schemaVersion") != 3: raise AssertionError("release manifest schema must be v3")
    if manifest.get("product") != "BodyBrain" or manifest.get("version") != package["version"]: raise AssertionError("release manifest product/version mismatch")
    if manifest.get("bodyContractVersion") != runtime["bodyContractVersion"] or int(manifest.get("controlProtocolVersion",0)) != int(runtime["controlProtocolVersion"]): raise AssertionError("release manifest protocol mismatch")
    brain = manifest.get("brain") or {}
    if brain.get("included") is not False or brain.get("state") != "NOT_CONFIGURED": raise AssertionError(f"release manifest must exclude Brain: {brain}")
    artifacts = manifest.get("artifacts") or {}; desktop = artifacts.get("BodyBrain.exe") or {}; ext = artifacts.get(extension.name) or {}
    if set(artifacts) != {"BodyBrain.exe", extension.name}: raise AssertionError(f"manifest must list only two distributables: {list(artifacts)}")
    if desktop.get("sha256") != sha256(executable): raise AssertionError("BodyBrain.exe SHA-256 mismatch")
    if ext.get("sha256") != sha256(extension): raise AssertionError("Chrome BODY Extension SHA-256 mismatch")
    if ext.get("protectionProfile") != "offline-obfuscated-v1" or ext.get("target") != "browser-no-eval": raise AssertionError("Extension protection profile missing")
    signing = str(desktop.get("authenticodeStatus") or "").upper()
    if signing not in {"VALID","NOTSIGNED","UNKNOWN"}: raise AssertionError(f"unexpected Authenticode status: {signing}")
    print("bodybrain_release_manifest_contract: PASS"); return 0


if __name__ == "__main__": raise SystemExit(main())