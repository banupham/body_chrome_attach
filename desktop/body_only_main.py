from __future__ import annotations

import argparse
import json
import signal
import sys
import time
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from desktop.body_status_client import BodyStatusClient, BodyStatusClientError
from desktop.config import load_runtime_config
from desktop.supervisor import BodyRuntimeSupervisor, SupervisorError


class StopRequested:
    value = False


def _stop(_signum=None, _frame=None) -> None:
    StopRequested.value = True


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description="BODY Core test host with Guardian detached")
    value.add_argument("--check", action="store_true", help="start BODY core, verify detached Guardian boundary, report and exit")
    value.add_argument("--json", action="store_true", help="emit compact JSON")
    return value


def emit(payload: dict, compact: bool) -> None:
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":") if compact else None, indent=None if compact else 2), flush=True)


def run(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    config = load_runtime_config()
    supervisor = BodyRuntimeSupervisor(config, bootstrap_name="body_bootstrap.js", guardian_mode="detached")
    client: BodyStatusClient | None = None
    try:
        supervisor.start()
        token = supervisor.read_controller_token()
        client = BodyStatusClient(config, token, controller_id="body-core-test-status")
        hello = client.connect()
        status = client.status()
        guardian = dict(status.get("environment") or {})
        if str(guardian.get("mode") or "").upper() != "DETACHED":
            raise RuntimeError(f"body_core_guardian_not_detached:{guardian.get('mode')}")
        payload = {
            "product": "BodyCore",
            "state": "RUNNING",
            "guardian": "DETACHED",
            "taskGate": "FAIL_CLOSED",
            "bodyContractVersion": hello.get("bodyContractVersion"),
            "controlProtocolVersion": hello.get("protocolVersion"),
            "browserCount": len(list(status.get("browsers") or [])),
        }
        emit(payload, args.json)
        if args.check:
            return 0
        signal.signal(signal.SIGINT, _stop)
        if hasattr(signal, "SIGTERM"):
            signal.signal(signal.SIGTERM, _stop)
        while not StopRequested.value:
            time.sleep(0.2)
        return 0
    except (SupervisorError, BodyStatusClientError, RuntimeError) as exc:
        emit({"product":"BodyCore","state":"ERROR","error":str(exc)}, args.json)
        return 1
    finally:
        if client is not None:
            try: client.close()
            except Exception: pass
        supervisor.stop()


if __name__ == "__main__":
    raise SystemExit(run())
