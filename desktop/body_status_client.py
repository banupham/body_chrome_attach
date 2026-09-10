from __future__ import annotations

import base64
import hashlib
import json
import os
import socket
import struct
import time
import uuid
from typing import Any

from .config import RuntimeConfig

_WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


class BodyStatusClientError(RuntimeError):
    pass


class BodyStatusTransportClosed(BodyStatusClientError):
    pass


def _recv_exact(sock: socket.socket, size: int) -> bytes:
    chunks: list[bytes] = []
    remaining = size
    while remaining:
        chunk = sock.recv(remaining)
        if not chunk:
            raise BodyStatusTransportClosed("body_transport_closed")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def _encode_client_frame(payload: bytes, opcode: int = 0x1) -> bytes:
    first = 0x80 | (opcode & 0x0F)
    length = len(payload)
    mask = os.urandom(4)
    if length < 126:
        header = bytes((first, 0x80 | length))
    elif length <= 0xFFFF:
        header = bytes((first, 0x80 | 126)) + struct.pack("!H", length)
    else:
        header = bytes((first, 0x80 | 127)) + struct.pack("!Q", length)
    masked = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
    return header + mask + masked


def _read_frame(sock: socket.socket) -> tuple[bool, int, bytes]:
    first, second = _recv_exact(sock, 2)
    final = bool(first & 0x80)
    opcode = first & 0x0F
    masked = bool(second & 0x80)
    length = second & 0x7F
    if length == 126:
        length = struct.unpack("!H", _recv_exact(sock, 2))[0]
    elif length == 127:
        length = struct.unpack("!Q", _recv_exact(sock, 8))[0]
    if length > 16 * 1024 * 1024:
        raise BodyStatusClientError("body_transport_frame_too_large")
    mask = _recv_exact(sock, 4) if masked else None
    payload = _recv_exact(sock, length) if length else b""
    if mask:
        payload = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
    return final, opcode, payload


class LocalWebSocket:
    def __init__(self, host: str, port: int, timeout: float = 10.0):
        if host != "127.0.0.1":
            raise BodyStatusClientError("body_transport_must_be_localhost")
        self.host, self.port, self.timeout = host, int(port), float(timeout)
        self.sock: socket.socket | None = None

    def connect(self) -> None:
        sock = socket.create_connection((self.host, self.port), timeout=self.timeout)
        sock.settimeout(self.timeout)
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        request = ("GET / HTTP/1.1\r\n" f"Host: {self.host}:{self.port}\r\n" "Upgrade: websocket\r\n" "Connection: Upgrade\r\n" f"Sec-WebSocket-Key: {key}\r\n" "Sec-WebSocket-Version: 13\r\n\r\n").encode("ascii")
        sock.sendall(request)
        response = bytearray()
        while b"\r\n\r\n" not in response:
            chunk = sock.recv(4096)
            if not chunk:
                sock.close(); raise BodyStatusTransportClosed("body_transport_handshake_closed")
            response.extend(chunk)
            if len(response) > 32768:
                sock.close(); raise BodyStatusClientError("body_transport_handshake_too_large")
        header_bytes, _, _ = bytes(response).partition(b"\r\n\r\n")
        lines = header_bytes.decode("iso-8859-1").split("\r\n")
        if not lines or " 101 " not in f" {lines[0]} ":
            sock.close(); raise BodyStatusClientError("body_transport_handshake_failed")
        headers: dict[str, str] = {}
        for line in lines[1:]:
            if ":" in line:
                name, value = line.split(":", 1); headers[name.strip().lower()] = value.strip()
        expected = base64.b64encode(hashlib.sha1((key + _WS_GUID).encode("ascii")).digest()).decode("ascii")
        if headers.get("sec-websocket-accept") != expected:
            sock.close(); raise BodyStatusClientError("body_transport_handshake_accept_invalid")
        self.sock = sock

    def _require(self) -> socket.socket:
        if self.sock is None:
            raise BodyStatusTransportClosed("body_transport_not_connected")
        return self.sock

    def set_timeout(self, timeout: float) -> None:
        self.timeout = float(timeout); self._require().settimeout(self.timeout)

    def send_text(self, text: str) -> None:
        self._require().sendall(_encode_client_frame(text.encode("utf-8"), 0x1))

    def recv_text(self) -> str:
        fragments: list[bytes] = []
        started = False
        while True:
            final, opcode, payload = _read_frame(self._require())
            if opcode == 0x8:
                self.sock = None; raise BodyStatusTransportClosed("body_transport_remote_close")
            if opcode == 0x9:
                self._require().sendall(_encode_client_frame(payload, 0xA)); continue
            if opcode == 0xA:
                continue
            if opcode == 0x1:
                if started: raise BodyStatusClientError("body_transport_unexpected_text_frame")
                started = True; fragments.append(payload)
            elif opcode == 0x0:
                if not started: raise BodyStatusClientError("body_transport_unexpected_continuation")
                fragments.append(payload)
            else:
                raise BodyStatusClientError(f"body_transport_unsupported_opcode:{opcode}")
            if final:
                return b"".join(fragments).decode("utf-8")

    def close(self) -> None:
        sock, self.sock = self.sock, None
        if sock is None: return
        try: sock.sendall(_encode_client_frame(struct.pack("!H", 1000), 0x8))
        except OSError: pass
        try: sock.shutdown(socket.SHUT_RDWR)
        except OSError: pass
        sock.close()


class BodyStatusClient:
    """Read-only Desktop Host control-plane client; it never owns Brain control."""

    def __init__(self, config: RuntimeConfig, token: str, controller_id: str = "bodybrain-desktop-status"):
        self.config = config
        self.token = str(token).strip()
        if not self.token: raise BodyStatusClientError("controller_token_required")
        self.controller_id = controller_id
        self.transport = LocalWebSocket(config.host, config.port, timeout=config.startup_timeout_seconds)
        self.connected = False

    def _recv_json(self) -> dict[str, Any]:
        try: value = json.loads(self.transport.recv_text())
        except json.JSONDecodeError as exc: raise BodyStatusClientError("body_transport_invalid_json") from exc
        if not isinstance(value, dict): raise BodyStatusClientError("body_transport_message_not_object")
        return value

    def connect(self) -> dict[str, Any]:
        self.transport.connect()
        self.transport.send_text(json.dumps({"type":"HELLO","role":"status_client","protocolVersion":self.config.control_protocol_version,"controllerId":self.controller_id,"token":self.token}, separators=(",", ":")))
        while True:
            message = self._recv_json()
            kind = message.get("type")
            if kind == "AUTH_ERROR": raise BodyStatusClientError(f"controller_auth_failed:{message.get('error', 'unknown')}")
            if kind != "HELLO_ACK": continue
            if str(message.get("role") or "") != "status_client": raise BodyStatusClientError("status_client_role_mismatch")
            if int(message.get("protocolVersion", -1)) != self.config.control_protocol_version: raise BodyStatusClientError("control_protocol_version_mismatch")
            if str(message.get("bodyContractVersion", "")) != self.config.body_contract_version: raise BodyStatusClientError("body_contract_version_mismatch")
            self.connected = True; return message

    def status(self) -> dict[str, Any]:
        if not self.connected: raise BodyStatusClientError("status_client_not_connected")
        request_id = uuid.uuid4().hex
        self.transport.set_timeout(15.0)
        self.transport.send_text(json.dumps({"type":"BODY_STATUS","requestId":request_id}, separators=(",", ":")))
        while True:
            message = self._recv_json()
            if message.get("requestId") != request_id: continue
            if message.get("type") == "STATUS_ERROR" or message.get("ok") is False: raise BodyStatusClientError(str(message.get("error") or "body_status_failed"))
            return dict(message.get("result") or {})

    @staticmethod
    def readiness_from_status(status: dict[str, Any]) -> dict[str, Any]:
        all_browsers = list(status.get("browsers") or [])
        browsers = [browser for browser in all_browsers if browser.get("online") is True]
        protection = (((status.get("environment") or {}).get("protection") or {}).get("browsers") or {})
        rows: list[dict[str, Any]] = []
        for browser in browsers:
            browser_id = str(browser.get("browserInstanceId") or "")
            guard = protection.get(browser_id) or {}; initial = guard.get("initialCheck") or {}; environment = browser.get("environment") or {}; browser_state = str(browser.get("state") or "UNKNOWN")
            if guard.get("blocked") is True or browser_state in {"QUARANTINED", "ERROR"}:
                reasons = list(guard.get("reasons") or []); state, reason = "BLOCKED", (reasons[0] if reasons else str(browser.get("stateReason") or "browser_blocked"))
            elif environment.get("eligible") is not True: state, reason = "CHECKING", "environment_pending"
            elif initial.get("complete") is not True: state, reason = "CHECKING", "guardian_initial_check_pending"
            else: state, reason = "READY", None
            rows.append({"browserInstanceId":browser_id,"state":state,"reason":reason,"browserState":browser_state,"environment":environment.get("status") or "UNKNOWN","guardian":initial.get("status") or "PENDING"})
        overall = "READY" if any(row["state"] == "READY" for row in rows) else ("BLOCKED" if rows and all(row["state"] == "BLOCKED" for row in rows) else "CHECKING")
        return {"state":overall,"browsers":rows,"reason":None if rows else "browser_waiting","ignoredOfflineBrowserCount":max(0,len(all_browsers)-len(browsers))}

    def readiness(self) -> dict[str, Any]: return self.readiness_from_status(self.status())

    def wait_for_ready(self, timeout: float | None = None) -> dict[str, Any]:
        deadline = time.monotonic() + (self.config.startup_timeout_seconds if timeout is None else float(timeout))
        last = {"state":"CHECKING","browsers":[],"reason":"browser_waiting"}
        while time.monotonic() < deadline:
            last = self.readiness()
            if last.get("state") == "READY": return last
            time.sleep(self.config.readiness_poll_seconds)
        return last

    def close(self) -> None:
        self.connected = False; self.transport.close()