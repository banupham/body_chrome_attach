from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from desktop.body_status_client import LocalWebSocket, BodyStatusClientError
from desktop.config import load_runtime_config
from desktop.paths import resolve_desktop_paths


def runtime_paths() -> dict[str, Path]:
    paths = resolve_desktop_paths().ensure()
    return {
        "token": paths.body / "profiles" / ".auth" / "client.token",
        "endpoint": paths.body / "state" / "runtime-endpoint.json",
        "log": paths.logs / "body-runtime.log",
    }


def read_runtime() -> tuple[str, int, str]:
    files = runtime_paths()
    if not files["token"].exists():
        raise RuntimeError(f"debug_token_missing:{files['token']}")
    if not files["endpoint"].exists():
        raise RuntimeError(f"runtime_endpoint_missing:{files['endpoint']}")
    token = files["token"].read_text(encoding="utf-8").strip()
    endpoint = json.loads(files["endpoint"].read_text(encoding="utf-8"))
    if endpoint.get("active") is not True:
        raise RuntimeError("body_runtime_not_active")
    host = str(endpoint.get("host") or "")
    port = int(endpoint.get("port") or 0)
    if host != "127.0.0.1" or not (1 <= port <= 65535):
        raise RuntimeError("body_runtime_endpoint_invalid")
    return host, port, token


class DebugClient:
    def __init__(self):
        config = load_runtime_config()
        host, port, token = read_runtime()
        self.protocol = config.control_protocol_version
        self.token = token
        self.transport = LocalWebSocket(host, port, timeout=15.0)

    def connect(self) -> None:
        self.transport.connect()
        self.transport.send_text(json.dumps({
            "type": "HELLO",
            "role": "debug_client",
            "protocolVersion": self.protocol,
            "controllerId": "body-cmd-test",
            "token": self.token,
        }, separators=(",", ":")))
        while True:
            message = json.loads(self.transport.recv_text())
            if message.get("type") == "AUTH_ERROR":
                raise RuntimeError(f"debug_auth_failed:{message.get('error')}")
            if message.get("type") == "HELLO_ACK":
                if message.get("authenticated") is not True:
                    raise RuntimeError("debug_auth_not_authenticated")
                return

    def command(self, command: str):
        request_id = uuid.uuid4().hex
        self.transport.send_text(json.dumps({
            "type": "COMMAND",
            "requestId": request_id,
            "command": str(command),
        }, separators=(",", ":")))
        while True:
            message = json.loads(self.transport.recv_text())
            if message.get("requestId") != request_id:
                continue
            if message.get("ok") is False:
                raise RuntimeError(str(message.get("error") or "body_command_failed"))
            return message.get("result")

    def close(self) -> None:
        self.transport.close()


def print_result(command: str, result) -> None:
    print(f"> {command}")
    if isinstance(result, str):
        print(result)
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))


def tail_log(lines: int) -> int:
    path = runtime_paths()["log"]
    if not path.exists():
        print(f"log_missing:{path}", file=sys.stderr)
        return 1
    rows = path.read_text(encoding="utf-8", errors="replace").splitlines()
    for row in rows[-max(1, int(lines)):]:
        print(row)
    return 0


def visible_suite(args: argparse.Namespace) -> list[str]:
    x, y, x2, y2 = args.x, args.y, args.x2, args.y2
    text = args.text
    url = args.url
    find_text = args.find_text
    # Order minimizes destructive surprises while still exercising every
    # currently exposed visible BODY debug capability.
    return [
        "status",
        "exts",
        "tabs",
        "pointer",
        f"move {x} {y}",
        f"hover {x} {y}",
        f"scroll {args.scroll}",
        f"scroll {-args.scroll}",
        f"hscroll {args.hscroll}",
        f"hscroll {-args.hscroll}",
        f"click {x} {y}",
        f"doubleclick {x} {y}",
        f"drag {x} {y} {x2} {y2}",
        f"type {x} {y} {text}",
        "key Escape",
        "combo CTRL+L",
        "key Escape",
        "back",
        "forward",
        "reload",
        "hardreload",
        "browserstop",
        "browsernewtab",
        "__DYNAMIC_TAB_SWITCH__",
        "browsernexttab",
        "browserprevtab",
        "browseraddressbar",
        f"address {url}",
        "browserfind",
        f"browserfindtext {find_text}",
        "browserdownloads",
        "browserhistory",
        "browserdevtools",
        "browserfullscreen",
        "browserfullscreen",
        "browserbookmark",
        "browserzoomin",
        "browserzoomout",
        "browserzoomreset",
        "browsernewwindow",
        "browserclosetab",
        "browserreopentab",
    ]


def run_commands(commands: list[str], *, continue_on_error: bool) -> int:
    client = DebugClient()
    failed = 0
    try:
        client.connect()
        for command in commands:
            try:
                if command == "__DYNAMIC_TAB_SWITCH__":
                    tabs = client.command("tabs")
                    print_result("tabs", tabs)
                    if not isinstance(tabs, list) or len(tabs) < 2:
                        raise RuntimeError("tab_switch_test_requires_two_tabs")
                    active = next((row for row in tabs if row.get("active") is True), tabs[-1])
                    target = next((row for row in tabs if int(row.get("id", -1)) != int(active.get("id", -1))), None)
                    if target is None:
                        raise RuntimeError("tab_switch_target_unavailable")
                    switch_command = f"switch {int(target['id'])}"
                    switch_result = client.command(switch_command)
                    print_result(switch_command, switch_result)
                    back_command = f"switch {int(active['id'])}"
                    back_result = client.command(back_command)
                    print_result(back_command, back_result)
                    continue
                result = client.command(command)
                print_result(command, result)
            except Exception as exc:
                failed += 1
                print(f"> {command}\nERROR: {exc}", file=sys.stderr)
                if not continue_on_error:
                    break
    finally:
        client.close()
    return 1 if failed else 0


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="CMD client for BODY-only visible capability testing")
    p.add_argument("--log", type=int, metavar="N", help="print last N BODY runtime log lines")
    p.add_argument("--suite-visible", action="store_true", help="run the visible BODY capability suite")
    p.add_argument("--x", type=int, default=500)
    p.add_argument("--y", type=int, default=350)
    p.add_argument("--x2", type=int, default=650)
    p.add_argument("--y2", type=int, default=350)
    p.add_argument("--scroll", type=int, default=500)
    p.add_argument("--hscroll", type=int, default=300)
    p.add_argument("--text", default="BODY_TEST")
    p.add_argument("--url", default="https://example.com")
    p.add_argument("--find-text", default="BODY_TEST")
    p.add_argument("--continue-on-error", action="store_true")
    p.add_argument("command", nargs=argparse.REMAINDER, help="single BODY debug command")
    return p


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    if args.log is not None:
        return tail_log(args.log)
    if args.suite_visible:
        return run_commands(visible_suite(args), continue_on_error=True)
    command = " ".join(args.command).strip()
    if not command:
        parser().print_help()
        return 2
    return run_commands([command], continue_on_error=args.continue_on_error)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, BodyStatusClientError, OSError, json.JSONDecodeError) as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
