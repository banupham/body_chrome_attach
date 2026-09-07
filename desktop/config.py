from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path


SOURCE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG_PATH = SOURCE_ROOT / "config" / "bodybrain-runtime.json"


@dataclass(frozen=True)
class RuntimeConfig:
    host: str
    port: int
    control_protocol_version: int
    body_contract_version: str
    startup_timeout_seconds: float
    readiness_poll_seconds: float

    @property
    def ws_url(self) -> str:
        return f"ws://{self.host}:{self.port}"


def load_runtime_config(path: Path | str = DEFAULT_CONFIG_PATH) -> RuntimeConfig:
    pathname = Path(path)
    raw = json.loads(pathname.read_text(encoding="utf-8"))
    if int(raw.get("schemaVersion", 0)) != 1:
        raise ValueError("bodybrain_runtime_config_version_invalid")
    host = str(raw.get("host", "")).strip()
    if host != "127.0.0.1":
        raise ValueError("bodybrain_runtime_host_must_be_localhost")
    port = int(raw.get("port", 0))
    if port < 1 or port > 65535:
        raise ValueError("bodybrain_runtime_port_invalid")
    protocol = int(raw.get("controlProtocolVersion", 0))
    if protocol <= 0:
        raise ValueError("bodybrain_control_protocol_invalid")
    contract = str(raw.get("bodyContractVersion", "")).strip()
    if not contract:
        raise ValueError("bodybrain_body_contract_version_required")
    startup_timeout = float(raw.get("startupTimeoutSeconds", 15))
    readiness_poll = float(raw.get("readinessPollSeconds", 2))
    if startup_timeout <= 0 or readiness_poll <= 0:
        raise ValueError("bodybrain_timing_config_invalid")
    return RuntimeConfig(
        host=host,
        port=port,
        control_protocol_version=protocol,
        body_contract_version=contract,
        startup_timeout_seconds=startup_timeout,
        readiness_poll_seconds=readiness_poll,
    )


def local_app_data_dir() -> Path:
    if os.name == "nt":
        base = os.environ.get("LOCALAPPDATA")
        if base:
            return Path(base) / "BodyBrain"
    return Path.home() / ".bodybrain"


def ensure_runtime_dirs() -> dict[str, Path]:
    root = local_app_data_dir()
    paths = {
        "root": root,
        "logs": root / "logs",
        "brain": root / "brain",
        "body": root / "body",
    }
    for path in paths.values():
        path.mkdir(parents=True, exist_ok=True)
    return paths
