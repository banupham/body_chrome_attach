from __future__ import annotations

import argparse
import json
import signal
import sys
import time
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from brain.runtime import BrainRuntimeError, GoalRunner
from brain.store import BrainStore
from desktop.autostart import (
    AutostartError,
    autostart_status,
    hide_console_window,
    install_autostart,
    remove_autostart,
)
from desktop.body_client import BodyClient, BodyClientError
from desktop.config import ensure_runtime_dirs, load_runtime_config
from desktop.supervisor import BodyRuntimeSupervisor, SupervisorError


class StopRequested:
    value = False


def _install_signal_handlers() -> None:
    def stop(_signum, _frame):
        StopRequested.value = True

    signal.signal(signal.SIGINT, stop)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, stop)


def _print(payload, as_json: bool = False) -> None:
    if as_json:
        print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
        return
    if isinstance(payload, str):
        print(payload)
    else:
        print(json.dumps(payload, ensure_ascii=False, indent=2))


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description="BodyBrain desktop host: Guardian + Brain + BODY Core")
    mode = value.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="start runtime, report one readiness snapshot, then exit")
    mode.add_argument("--youtube-search", metavar="QUERY", help="run the first proven Brain capability through BODY Contract v1")
    mode.add_argument("--install-autostart", action="store_true", help="start BodyBrain in the background at Windows sign-in")
    mode.add_argument("--remove-autostart", action="store_true", help="remove the per-user Windows autostart entry")
    mode.add_argument("--autostart-status", action="store_true", help="report the per-user Windows autostart state")
    value.add_argument("--background", action="store_true", help="hide the console and run the normal readiness monitor")
    value.add_argument("--json", action="store_true", help="emit machine-readable status lines")
    value.add_argument("--ready-timeout", type=float, default=None, help="seconds to wait for a READY Browser")
    return value


def _run_goal(client: BodyClient, query: str, as_json: bool) -> int:
    paths = ensure_runtime_dirs()
    with BrainStore(paths["brain"] / "brain.db") as store:
        runner = GoalRunner(
            client,
            store,
            evidence_root=paths["body"] / "evidence",
        )
        result = runner.run_youtube_search(query)
        _print({"product": "BodyBrain", "brainResult": result, "brainStore": store.counts()}, as_json)
        return 0 if result.get("status") == "COMPLETED" else 3


def _handle_autostart(args: argparse.Namespace) -> int | None:
    try:
        if args.install_autostart:
            _print({"product": "BodyBrain", "autostart": install_autostart()}, args.json)
            return 0
        if args.remove_autostart:
            _print({"product": "BodyBrain", "autostart": remove_autostart()}, args.json)
            return 0
        if args.autostart_status:
            _print({"product": "BodyBrain", "autostart": autostart_status()}, args.json)
            return 0
    except AutostartError as exc:
        _print({"product": "BodyBrain", "state": "ERROR", "error": str(exc)}, args.json)
        return 1
    return None


def run(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    autostart_result = _handle_autostart(args)
    if autostart_result is not None:
        return autostart_result

    # The shipped product is a console build so diagnostics remain capturable.
    # Normal packaged/background mode hides that console immediately.
    if args.background or (
        getattr(sys, "frozen", False)
        and not args.check
        and args.youtube_search is None
    ):
        hide_console_window()

    config = load_runtime_config()
    _install_signal_handlers()
    supervisor = BodyRuntimeSupervisor(config)
    client: BodyClient | None = None
    try:
        supervisor.start()
        client = BodyClient(config, supervisor.read_brain_token())
        hello = client.connect()
        wait_timeout = config.startup_timeout_seconds if args.ready_timeout is None else max(0.1, args.ready_timeout)
        readiness = client.wait_for_ready(wait_timeout)
        status = {
            "product": "BodyBrain",
            "desktop": "RUNNING",
            "bodyRuntime": "CONNECTED",
            "bodyContractVersion": hello.get("bodyContractVersion"),
            "controlProtocolVersion": hello.get("protocolVersion"),
            "guardianReadiness": readiness,
        }
        _print(status, args.json)
        if args.check:
            return 0 if readiness.get("state") == "READY" else 2
        if args.youtube_search is not None:
            if readiness.get("state") != "READY":
                _print({"product": "BodyBrain", "brainResult": {"status": "WAIT", "reason": "guardian_not_ready"}}, args.json)
                return 2
            return _run_goal(client, args.youtube_search, args.json)

        last = json.dumps(readiness, sort_keys=True)
        while not StopRequested.value:
            time.sleep(config.readiness_poll_seconds)
            try:
                current = client.readiness()
            except (BodyClientError, OSError) as exc:
                _print({"product": "BodyBrain", "state": "ERROR", "error": str(exc)}, args.json)
                return 1
            serialized = json.dumps(current, sort_keys=True)
            if serialized != last:
                _print({"product": "BodyBrain", "guardianReadiness": current}, args.json)
                last = serialized
        return 0
    except (SupervisorError, BodyClientError, BrainRuntimeError, OSError, ValueError) as exc:
        _print({"product": "BodyBrain", "state": "ERROR", "error": str(exc)}, args.json)
        return 1
    finally:
        if client is not None:
            try:
                client.close()
            except Exception:
                pass
        supervisor.stop()


if __name__ == "__main__":
    raise SystemExit(run())
