from __future__ import annotations

import json
import os
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


_SENSITIVE_KEY_PARTS = ("token", "secret", "password", "passwd", "authorization", "cookie", "credential")
_INLINE_SECRET = re.compile(
    r"(?i)(token|secret|password|passwd|authorization|cookie|credential)(\s*[:=]\s*)([^\n,;]+)"
)


def _sensitive_key(key: object) -> bool:
    normalized = str(key or "").replace("-", "").replace("_", "").lower()
    return any(part in normalized for part in _SENSITIVE_KEY_PARTS)


def redact_text(value: str, secrets: Iterable[str] = ()) -> str:
    text = str(value)
    for secret in secrets:
        secret_value = str(secret or "")
        if secret_value:
            text = text.replace(secret_value, "[REDACTED]")
    return _INLINE_SECRET.sub(lambda match: f"{match.group(1)}{match.group(2)}[REDACTED]", text)


def redact_value(value: Any, secrets: Iterable[str] = ()) -> Any:
    secret_values = tuple(str(item) for item in secrets if str(item or ""))
    if isinstance(value, dict):
        return {
            str(key): "[REDACTED]" if _sensitive_key(key) else redact_value(item, secret_values)
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [redact_value(item, secret_values) for item in value]
    if isinstance(value, str):
        return redact_text(value, secret_values)
    return value


class HostLogger:
    def __init__(self, path: Path | str, *, secrets: Iterable[str] = ()):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._secrets = {str(value) for value in secrets if str(value or "")}

    def register_secret(self, value: str | None) -> None:
        secret = str(value or "")
        if secret:
            with self._lock:
                self._secrets.add(secret)

    def write(self, event: str, *, level: str = "INFO", **fields: Any) -> None:
        with self._lock:
            payload = {
                "ts": datetime.now(timezone.utc).isoformat(),
                "level": str(level or "INFO").upper(),
                "event": redact_text(str(event), self._secrets),
                **redact_value(fields, self._secrets),
            }
            with self.path.open("a", encoding="utf-8", newline="\n") as handle:
                handle.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
            if os.name != "nt":
                try:
                    os.chmod(self.path, 0o600)
                except OSError:
                    pass
