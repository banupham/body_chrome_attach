from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    entry = (ROOT / "desktop" / "main.py").read_text(encoding="utf-8")
    status = (ROOT / "desktop" / "body_status_client.py").read_text(encoding="utf-8")
    build = (ROOT / "tools" / "build_bodybrain_release.py").read_text(encoding="utf-8")
    health = (ROOT / "desktop" / "health.py").read_text(encoding="utf-8")

    for forbidden in ["from brain", "import brain", "GoalRunner", "BrainStore", "--youtube-search", "desktop.body_client"]:
        if forbidden in entry:
            raise AssertionError(f"production entrypoint contains Brain dependency: {forbidden}")
    for forbidden in ["BODY_STEP", "BODY_OBSERVE", "TASK_CREATE", "TASK_START", "TASK_CANCEL", "Input.dispatchMouseEvent", "Input.dispatchKeyEvent"]:
        if forbidden in status:
            raise AssertionError(f"production status client exposes non-status capability: {forbidden}")
    if '"BODY_STATUS"' not in status:
        raise AssertionError("production status client must expose BODY_STATUS")
    if 'ROOT / "brain"' in build or 'add_data(ROOT / "brain"' in build:
        raise AssertionError("release builder must not bundle Brain")
    if '"brain": {"state": "NOT_CONFIGURED"' not in health:
        raise AssertionError("health must report Brain NOT_CONFIGURED")

    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    if "Brain R&D is excluded" not in str(package.get("description", "")):
        raise AssertionError("package description must state Brain exclusion")
    print("bodybrain_no_brain_contract: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
