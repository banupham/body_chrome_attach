from __future__ import annotations

import argparse
import json
import os
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
from desktop.tray_ui import BodyBrainTray, TrayUiError


class StopRequested:
    value = False
    reason: str | None = None


def _request_stop(reason: str) -> None:
    StopRequested.value = True
    StopRequested.reason = str(reason or "stop_requested")


def _restore_windows_cli_streams() -> None:
    """Restore stdout/stderr for a frozen GUI-subsystem diagnostic invocation.

    PyInstaller windowed mode intentionally gives normal BodyBrain launches no
    console. For --check and maintenance commands we reuse inherited pipe/console
    handles when present, or attach to the parent CMD/PowerShell console.
    """
    if os.name != "nt" or not getattr(sys, "frozen", False):
        return
    try:
        import ctypes
        import io
        import msvcrt
        from ctypes import wintypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.GetStdHandle.argtypes = [wintypes.DWORD]
        kernel32.GetStdHandle.restype = wintypes.HANDLE
        kernel32.GetCurrentProcess.restype = wintypes.HANDLE
        kernel32.DuplicateHandle.argtypes = [wintypes.HANDLE,wintypes.HANDLE,wintypes.HANDLE,ctypes.POINTER(wintypes.HANDLE),wintypes.DWORD,wintypes.BOOL,wintypes.DWORD]
        kernel32.DuplicateHandle.restype = wintypes.BOOL
        kernel32.AttachConsole.argtypes = [wintypes.DWORD]
        kernel32.AttachConsole.restype = wintypes.BOOL

        invalid_handle = ctypes.c_void_p(-1).value
        duplicate_same_access = 0x00000002
        current_process = kernel32.GetCurrentProcess()

        def stream_from_handle(std_id: int):
            handle = kernel32.GetStdHandle(wintypes.DWORD(std_id & 0xFFFFFFFF))
            if not handle or int(handle) == invalid_handle:
                return None
            duplicate = wintypes.HANDLE()
            if not kernel32.DuplicateHandle(current_process, handle, current_process, ctypes.byref(duplicate), 0, True, duplicate_same_access):
                return None
            fd = msvcrt.open_osfhandle(int(duplicate.value), os.O_WRONLY)
            raw = os.fdopen(fd, "wb", buffering=0)
            return io.TextIOWrapper(raw, encoding="utf-8", errors="replace", write_through=True)

        stdout = stream_from_handle(-11)
        stderr = stream_from_handle(-12)
        if stdout is None or stderr is None:
            # ATTACH_PARENT_PROCESS = DWORD(-1). ERROR_ACCESS_DENIED simply means
            # the process is already attached to a console, which is acceptable.
            kernel32.AttachConsole(wintypes.DWORD(0xFFFFFFFF))
            if stdout is None:
                stdout = stream_from_handle(-11)
            if stderr is None:
                stderr = stream_from_handle(-12)
        if stdout is not None:
            sys.stdout = stdout
        if stderr is not None:
            sys.stderr = stderr
    except Exception:
        # Diagnostics must never make production startup fail merely because a
        # parent process supplied no usable standard handles.
        return


def _install_signal_handlers(*, tray_mode: bool) -> None:
    def stop(_signum, _frame):
        _request_stop("process_signal")

    # A normal Windows BodyBrain session is tray-owned. Ctrl+C must not become a
    # competing user-facing Quit path; system termination signals are still
    # honored so Windows can shut the process down.
    if tray_mode and hasattr(signal, "SIGINT"):
        signal.signal(signal.SIGINT, signal.SIG_IGN)
    else:
        signal.signal(signal.SIGINT, stop)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, stop)


def _print(payload, as_json: bool = False) -> None:
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":") if as_json else None, indent=None if as_json else 2)
    stream = sys.stdout
    if stream is None:
        return
    try:
        stream.write(text + "\n")
        stream.flush()
    except (OSError, ValueError):
        pass


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description="BodyBrain production host: Guardian + BODY Core + Chrome BODY Extension")
    mode = value.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="start BODY, report readiness, then exit")
    mode.add_argument("--install-autostart", action="store_true", help="start BodyBrain in the background at Windows sign-in")
    mode.add_argument("--remove-autostart", action="store_true", help="remove the per-user Windows autostart entry")
    mode.add_argument("--autostart-status", action="store_true", help="report the per-user Windows autostart state")
    value.add_argument("--background", action="store_true", help="hide the console and run the tray-owned readiness monitor")
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


def _readiness_reason(readiness: dict) -> str | None:
    reason = str(readiness.get("reason") or "").strip()
    if reason:
        return reason
    for row in list(readiness.get("browsers") or []):
        row_reason = str(row.get("reason") or "").strip()
        if row_reason:
            return row_reason
    return None


def _apply_readiness(health: HealthModel, readiness: dict) -> None:
    rows = list(readiness.get("browsers") or [])
    if rows:
        health.set_subsystem("extensionConnectivity", "READY")
    else:
        health.set_subsystem("extensionConnectivity", "WAITING", "extension_not_connected")

    state = str(readiness.get("state") or "CHECKING")
    reason = _readiness_reason(readiness)
    if state == "READY":
        health.set_subsystem("guardian", "READY")
    elif state == "BLOCKED":
        health.set_subsystem("guardian", "BLOCKED", reason or "browser_blocked")
    else:
        health.set_subsystem("guardian", "WAITING", reason or "guardian_check_pending")
    health.set_subsystem("brain", "NOT_CONFIGURED", "separate_research_track")


def _status(health: HealthModel, hello: dict, readiness: dict) -> dict:
    return {"product":"BodyBrain","desktop":"RUNNING","bodyRuntime":"CONNECTED","brain":"NOT_CONFIGURED","bodyContractVersion":hello.get("bodyContractVersion"),"controlProtocolVersion":hello.get("protocolVersion"),"guardianReadiness":readiness,"health":health.snapshot()}


def _hold_error_for_tray(tray: BodyBrainTray, message: str) -> None:
    tray.set_notice(f"ERROR: {message} - right-click the tray icon and choose Quit BodyBrain to stop.")
    tray.show()
    while not StopRequested.value:
        time.sleep(0.2)


def run(argv: list[str] | None = None) -> int:
    raw_args = list(sys.argv[1:] if argv is None else argv)
    cli_output_flags = {"--check","--install-autostart","--remove-autostart","--autostart-status","--help","-h"}
    if any(flag in raw_args for flag in cli_output_flags):
        _restore_windows_cli_streams()
    args = parser().parse_args(raw_args)
    autostart_result = _handle_autostart(args)
    if autostart_result is not None:
        return autostart_result

    StopRequested.value = False
    StopRequested.reason = None
    tray_mode = os.name == "nt" and not args.check
    if args.background or (getattr(sys, "frozen", False) and not args.check):
        hide_console_window()

    config = load_runtime_config()
    _install_signal_handlers(tray_mode=tray_mode)
    health = HealthModel()
    health.set_desktop("STARTING")
    health.set_subsystem("bodyRuntime", "WAITING", "runtime_starting")
    health.set_subsystem("guardian", "WAITING", "runtime_starting")
    supervisor = BodyRuntimeSupervisor(config)
    client: BodyStatusClient | None = None
    tray: BodyBrainTray | None = None
    tray_started = False

    try:
        if tray_mode:
            tray = BodyBrainTray(
                supervisor.paths["logs"] / "body-runtime.log",
                on_quit=lambda: _request_stop("tray_quit"),
            )
            tray.start()
            tray_started = True
            tray.set_notice("Starting Guardian + BODY runtime...")

        supervisor.start()
        health.set_subsystem("bodyRuntime", "READY")
        health.set_workers(supervisor.health())
        token = supervisor.read_controller_token()
        client = BodyStatusClient(config, token)
        hello = client.connect()
        health.set_desktop("READY")
        if tray is not None:
            tray.set_notice("BODY runtime connected. Waiting for Chrome BODY Extension...")

        wait_timeout = config.startup_timeout_seconds if args.ready_timeout is None else max(0.1, args.ready_timeout)
        readiness = client.wait_for_ready(wait_timeout)
        _apply_readiness(health, readiness)
        payload = _status(health, hello, readiness)
        _print(payload, args.json)
        if args.check:
            return 0 if readiness.get("state") == "READY" else 2

        if tray is not None:
            tray.set_notice(
                "READY - BODY + Guardian + Chrome Extension connected."
                if readiness.get("state") == "READY"
                else f"Running - Guardian state: {readiness.get('state') or 'CHECKING'}"
            )

        last = json.dumps(readiness, sort_keys=True)
        while not StopRequested.value:
            time.sleep(config.readiness_poll_seconds)
            if StopRequested.value:
                break
            health.set_workers(supervisor.health())
            current = client.readiness()
            _apply_readiness(health, current)
            serialized = json.dumps(current, sort_keys=True)
            if serialized != last:
                _print(_status(health, hello, current), args.json)
                if tray is not None:
                    tray.set_notice(
                        "READY - BODY + Guardian + Chrome Extension connected."
                        if current.get("state") == "READY"
                        else f"Running - Guardian state: {current.get('state') or 'CHECKING'}"
                    )
                last = serialized
        return 0
    except (SupervisorError, BodyStatusClientError, TrayUiError, OSError, ValueError) as exc:
        health.set_desktop("ERROR", type(exc).__name__)
        _print({"product":"BodyBrain","state":"ERROR","error":str(exc),"health":health.snapshot()}, args.json)
        if tray is not None and tray_started and not args.check:
            _hold_error_for_tray(tray, str(exc))
        return 1
    finally:
        if tray is not None and tray_started:
            tray.set_notice("Shutting down BODY runtime...")
        if client is not None:
            try:
                client.close()
            except Exception:
                pass
        supervisor.stop()
        health.set_subsystem("bodyRuntime", "STOPPED")
        health.set_subsystem("extensionConnectivity", "STOPPED")
        health.set_subsystem("guardian", "STOPPED")
        health.set_desktop("STOPPED")
        if tray is not None:
            tray.stop()


if __name__ == "__main__":
    raise SystemExit(run())
