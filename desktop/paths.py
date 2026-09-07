from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping


@dataclass(frozen=True)
class DesktopPaths:
    root: Path
    runtime: Path
    data: Path
    logs: Path
    brain: Path
    body: Path

    @classmethod
    def from_root(cls, root: Path | str) -> "DesktopPaths":
        base = Path(root).expanduser().resolve()
        return cls(
            root=base,
            runtime=base / "runtime",
            data=base / "data",
            logs=base / "logs",
            # Preserve the existing on-disk locations used by later merged phases.
            brain=base / "brain",
            body=base / "body",
        )

    def ensure(self) -> "DesktopPaths":
        for path in (self.root, self.runtime, self.data, self.logs, self.brain, self.body):
            path.mkdir(parents=True, exist_ok=True)
        return self

    def as_dict(self) -> dict[str, Path]:
        return {
            "root": self.root,
            "runtime": self.runtime,
            "data": self.data,
            "logs": self.logs,
            "brain": self.brain,
            "body": self.body,
        }


def default_desktop_root(
    *,
    env: Mapping[str, str] | None = None,
    platform_name: str | None = None,
    home: Path | None = None,
) -> Path:
    values = os.environ if env is None else env
    explicit = str(values.get("BODYBRAIN_HOME", "")).strip()
    if explicit:
        return Path(explicit).expanduser().resolve()

    platform_value = os.name if platform_name is None else platform_name
    if platform_value == "nt":
        local_app_data = str(values.get("LOCALAPPDATA", "")).strip()
        if local_app_data:
            return (Path(local_app_data).expanduser() / "BodyBrain").resolve()

    home_dir = Path.home() if home is None else Path(home)
    return (home_dir.expanduser() / ".bodybrain").resolve()


def resolve_desktop_paths(root: Path | str | None = None) -> DesktopPaths:
    return DesktopPaths.from_root(default_desktop_root() if root is None else root)
