from __future__ import annotations

import json
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "split-artifacts" / "guardian"
FILES = [
    "guardian/README.md",
    "daemon/src/guardian_module.js",
    "daemon/src/environment_guardian.js",
    "daemon/src/protection_supervisor.js",
    "daemon/src/behavior_guardian.js",
    "daemon/src/external_controller_probe.js",
    "daemon/src/device_network_probe.js",
]


def main() -> int:
    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True, exist_ok=True)
    archive = OUT / "GuardianModule.zip"
    for relative in FILES:
        if not (ROOT / relative).exists():
            raise RuntimeError(f"guardian_module_file_missing:{relative}")
    manifest = {
        "schemaVersion": 1,
        "component": "Guardian",
        "kind": "module",
        "entry": "daemon/src/guardian_module.js",
        "files": FILES,
        "bodyCoupling": "contract-only",
    }
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for relative in FILES:
            zf.write(ROOT / relative, relative)
        zf.writestr("guardian/module-manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(archive)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
