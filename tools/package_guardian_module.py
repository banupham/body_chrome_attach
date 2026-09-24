from __future__ import annotations

import json
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "split-artifacts" / "guardian"
FILES = [
    "guardian/README.txt",
    "guardian/authority_contract.js",
    "guardian/body_client.js",
    "guardian/browser_registry.js",
    "guardian/heartbeat.js",
    "guardian/runtime.js",
    "guardian/main.js",
    "guardian/package.json",
    "daemon/src/environment_guardian.js",
    "daemon/src/behavior_guardian.js",
    "daemon/src/external_controller_probe.js",
    "daemon/src/device_network_probe.js",
    "daemon/src/safe_json_persistence.js",
    "daemon/src/runtime_data_dir.js",
]
DIRECTORIES = [
    "node_modules/ws",
]


def add_tree(zf: zipfile.ZipFile, relative: str) -> None:
    source = ROOT / relative
    if not source.exists():
        raise RuntimeError(f"guardian_module_directory_missing:{relative}")
    for item in source.rglob("*"):
        if item.is_file():
            zf.write(item, item.relative_to(ROOT).as_posix())


def main() -> int:
    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True, exist_ok=True)
    archive = OUT / "GuardianModule.zip"
    for relative in FILES:
        if not (ROOT / relative).exists():
            raise RuntimeError(f"guardian_module_file_missing:{relative}")
    manifest = {
        "schemaVersion": 2,
        "component": "Guardian",
        "kind": "standalone-module",
        "entry": "guardian/main.js",
        "run": "node guardian/main.js",
        "files": FILES,
        "directories": DIRECTORIES,
        "authorityOrder": "HUMAN > GUARDIAN > BRAIN > BODY",
        "bodyCoupling": "external-authority-contract-only",
        "cdpOwnership": "BODY",
        "decisionOwnership": "Guardian",
    }
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for relative in FILES:
            zf.write(ROOT / relative, relative)
        for relative in DIRECTORIES:
            add_tree(zf, relative)
        zf.writestr("guardian/module-manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(archive)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
