from __future__ import annotations

import ctypes
import os
import sys
from pathlib import Path


RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
RUN_VALUE = "BodyBrain"


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


def install_autostart() -> dict[str, object]:
    _require_windows_packaged()
    import winreg

    command = autostart_command(sys.executable)
    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
        winreg.SetValueEx(key, RUN_VALUE, 0, winreg.REG_SZ, command)
    return {"installed": True, "command": command}


def remove_autostart() -> dict[str, object]:
    _require_windows_packaged()
    import winreg

    removed = False
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
            winreg.DeleteValue(key, RUN_VALUE)
            removed = True
    except FileNotFoundError:
        pass
    return {"installed": False, "removed": removed}


def autostart_status() -> dict[str, object]:
    _require_windows_packaged()
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_QUERY_VALUE) as key:
            command, _kind = winreg.QueryValueEx(key, RUN_VALUE)
            return {"installed": True, "command": str(command)}
    except FileNotFoundError:
        return {"installed": False, "command": None}


def hide_console_window() -> bool:
    """Hide the console for background startup while retaining one console EXE.

    A console build is kept so `--check` and CI can capture diagnostics. Normal
    packaged background operation hides the console immediately on Windows.
    """
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
