from __future__ import annotations

import ctypes
import os
import sys
from pathlib import Path


RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
RUN_VALUE = "BODY"
LEGACY_RUN_VALUE = "BodyBrain"


class AutostartError(RuntimeError):
    pass


def autostart_command(executable: Path | str) -> str:
    path = str(Path(executable).resolve())
    escaped = path.replace('"', '""')
    return f'"{escaped}" --background'


def _require_windows_packaged() -> None:
    if os.name != "nt":
        raise AutostartError("autostart_windows_only")
    if not getattr(sys, "frozen", False):
        raise AutostartError("autostart_requires_packaged_executable")


def _delete_value(key, name: str) -> bool:
    import winreg

    try:
        winreg.DeleteValue(key, name)
        return True
    except FileNotFoundError:
        return False


def install_autostart() -> dict[str, object]:
    _require_windows_packaged()
    import winreg

    command = autostart_command(sys.executable)
    legacy_removed = False
    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
        winreg.SetValueEx(key, RUN_VALUE, 0, winreg.REG_SZ, command)
        legacy_removed = _delete_value(key, LEGACY_RUN_VALUE)
    return {"installed": True, "command": command, "legacyRemoved": legacy_removed}


def remove_autostart() -> dict[str, object]:
    _require_windows_packaged()
    import winreg

    removed = False
    legacy_removed = False
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
            removed = _delete_value(key, RUN_VALUE)
            legacy_removed = _delete_value(key, LEGACY_RUN_VALUE)
    except FileNotFoundError:
        pass
    return {"installed": False, "removed": removed, "legacyRemoved": legacy_removed}


def autostart_status() -> dict[str, object]:
    _require_windows_packaged()
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_QUERY_VALUE) as key:
            try:
                command, _kind = winreg.QueryValueEx(key, RUN_VALUE)
                return {"installed": True, "command": str(command), "legacy": False}
            except FileNotFoundError:
                try:
                    command, _kind = winreg.QueryValueEx(key, LEGACY_RUN_VALUE)
                    return {"installed": True, "command": str(command), "legacy": True}
                except FileNotFoundError:
                    return {"installed": False, "command": None, "legacy": False}
    except FileNotFoundError:
        return {"installed": False, "command": None, "legacy": False}


def hide_console_window() -> bool:
    """Hide the console for background startup while retaining CLI diagnostics."""
    if os.name != "nt":
        return False
    try:
        hwnd = ctypes.windll.kernel32.GetConsoleWindow()
        if not hwnd:
            return False
        ctypes.windll.user32.ShowWindow(hwnd, 0)
        return True
    except Exception:
        return False
