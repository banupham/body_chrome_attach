from __future__ import annotations

import argparse
import json
import signal
import sys
import time
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from desktop.autostart import AutostartError, autostart_status, hide_console_window, install_autostart, remove_autostart
from desktop.body_status_client import BodyStatusClient, BodyStatusClientError
from desktop.config import load_runtime_config
from desktop.health import HealthModel
from desktop.supervisor import BodyRuntimeSupervisor, SupervisorError


class StopRequested:
    value = False


def _install_signal_handlers() -> None:
    def stop(_signum, _frame): StopRequested.value = True
    signal.signal(signal.SIGINT, stop)
    if hasattr(signal, "SIGTERM"): signal.signal(signal.SIGTERM, stop)


def _print(payload, as_json: bool = False) -> None:
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":") if as_json else None, indent=None if as_json else 2))


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description="BodyBrain production host: Guardian + BODY Core + Chrome BODY Extension")
    mode = value.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="start BODY, report readiness, then exit")
    mode.add_argument("--install-autostart", action="store_true", help="start BodyBrain in the background at Windows sign-in")
    mode.add_argument("--remove-autostart", action="store_true", help="remove the per-user Windows autostart entry")
    mode.add_argument("--autostart-status", action="store_true", help="report the per-user Windows autostart state")
    value.add_argument("--background", action="store_true", help="hide the console and run the readiness monitor")
    value.add_argument("--json", action="store_true", help="emit machine-readable status lines")
    value.add_argument("--ready-timeout", type=float, default=None, help="seconds to wait for a READY Browser")
    return value


def _handle_autostart(args: argparse.Namespace) -> int | None:
    try:
        if args.install_autostart: _print({"product":"BodyBrain","autostart":install_autostart()}, args.json); return 0
        if args.remove_autostart: _print({"product":"BodyBrain","autostart":remove_autostart()}, args.json); return 0
        if args.autostart_status: _print({"product":"BodyBrain","autostart":autostart_status()}, args.json); return 0
    except AutostartError as exc:
        _print({"product":"BodyBrain","state":"ERROR","error":str(exc)}, args.json); return 1
    return None


def _apply_readiness(health: HealthModel, readiness: dict) -> None:
    rows = list(readiness.get("browsers") or [])
    health.set_subsystem("extensionConnectivity", "READY" if rows else "WAITING", None if rows else "extension_not_connected")
    state = str(readiness.get("state") or "CHECKING")
    if state == "READY": health.set_subsystem("guardian", "READY")
    elif state == "BLOCKED": health.set_subsystem("guardian", "BLOCKED", str(readiness.get("reason") or "browser_blocked"))
    else: health.set_subsystem("guardian", "WAITING", str(readiness.get("reason") or "guardian_check_pending"))
    health.set_subsystem("brain", "NOT_CONFIGURED", "separate_research_track")


def _status(health: HealthModel, hello: dict, readiness: dict) -> dict:
    return {"product":"BodyBrain","desktop":"RUNNING","bodyRuntime":"CONNECTED","brain":"NOT_CONFIGURED","bodyContractVersion":hello.get("bodyContractVersion"),"controlProtocolVersion":hello.get("protocolVersion"),"guardianReadiness":readiness,"health":health.snapshot()}


def run(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    autostart_result = _handle_autostart(args)
    if autostart_result is not None: return autostart_result
    if args.background or (getattr(sys, "frozen", False) and not args.check): hide_console_window()

    config = load_runtime_config(); _install_signal_handlers(); health = HealthModel(); health.set_desktop("STARTING"); health.set_subsystem("bodyRuntime", "WAITING", "runtime_starting"); health.set_subsystem("guardian", "WAITING", "runtime_starting")
    supervisor = BodyRuntimeSupervisor(config); client: BodyStatusClient | None = None
    try:
        supervisor.start(); health.set_subsystem("bodyRuntime", "READY"); health.set_workers(supervisor.health())
        token = supervisor.read_controller_token(); client = BodyStatusClient(config, token); hello = client.connect(); health.set_desktop("READY")
        wait_timeout = config.startup_timeout_seconds if args.ready_timeout is None else max(0.1, args.ready_timeout)
        readiness = client.wait_for_ready(wait_timeout); _apply_readiness(health, readiness); payload = _status(health, hello, readiness); _print(payload, args.json)
        if args.check: return 0 if readiness.get("state") == "READY" else 2
        last = json.dumps(readiness, sort_keys=True)
        while not StopRequested.value:
            time.sleep(config.readiness_poll_seconds)
            health.set_workers(supervisor.health())
            current = client.readiness(); _apply_readiness(health, current); serialized = json.dumps(current, sort_keys=True)
            if serialized != last: _print(_status(health, hello, current), args.json); last = serialized
        return 0
    except (SupervisorError, BodyStatusClientError, OSError, ValueError) as exc:
        health.set_desktop("ERROR", type(exc).__name__); _print({"product":"BodyBrain","state":"ERROR","error":str(exc),"health":health.snapshot()}, args.json); return 1
    finally:
        if client is not None:
            try: client.close()
            except Exception: pass
        supervisor.stop(); health.set_subsystem("bodyRuntime", "STOPPED"); health.set_subsystem("extensionConnectivity", "STOPPED"); health.set_subsystem("guardian", "STOPPED"); health.set_desktop("STOPPED")


if __name__ == "__main__": raise SystemExit(run())
