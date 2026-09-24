from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    entry = (ROOT / "desktop" / "main.py").read_text(encoding="utf-8")
    status = (ROOT / "desktop" / "body_status_client.py").read_text(encoding="utf-8")
    build = (ROOT / "tools" / "build_bodybrain_release.py").read_text(encoding="utf-8")
    health = (ROOT / "desktop" / "health.py").read_text(encoding="utf-8")
    supervisor = (ROOT / "desktop" / "supervisor.py").read_text(encoding="utf-8")

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

    if 'add_data(guardian_dir,"guardian")' not in build:
        raise AssertionError("production release must bundle the Guardian runtime")
    if 'guardian_dir=ROOT / "guardian"' not in build or 'guardian_runtime_missing' not in build:
        raise AssertionError("release builder must fail when required Guardian runtime is absent")
    if 'name="guardian-runtime"' not in supervisor or 'self.root / "guardian" / "main.js"' not in supervisor:
        raise AssertionError("desktop supervisor must own a separate Guardian worker")
    start_block = supervisor[supervisor.index("    def start(self)"):supervisor.index("    def read_controller_token", supervisor.index("    def start(self)"))]
    if start_block.index("self._start_guardian()") > start_block.index('name="body-runtime"'):
        raise AssertionError("Guardian must start before BODY")
    if "guardian_required_before_body" not in supervisor:
        raise AssertionError("BODY startup must fail closed when Guardian is not alive")
    if "guardian_lost_stopping_body" not in supervisor or "guardian_unhealthy_stopping_body" not in supervisor:
        raise AssertionError("BODY must stop when the required Guardian worker is lost")
    stop_block = supervisor[supervisor.index("    def stop(self)"):supervisor.index("    def __enter__", supervisor.index("    def stop(self)"))]
    if stop_block.index('self.workers.stop("body-runtime")') > stop_block.index('self.workers.stop("guardian-runtime")'):
        raise AssertionError("intentional shutdown must stop BODY before Guardian")

    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    if "brain execution" in str(manifest.get("description", "")).lower():
        raise AssertionError("production Extension description must not advertise Brain execution")
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    if "Brain R&D is excluded" not in str(package.get("description", "")):
        raise AssertionError("package description must state Brain exclusion")
    print("bodybrain_no_brain_contract: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
