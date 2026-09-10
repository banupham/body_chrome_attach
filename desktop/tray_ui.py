from __future__ import annotations

import os
import threading
import time
from pathlib import Path
from typing import Callable


class TrayUiError(RuntimeError):
    pass


if os.name == "nt":
    import ctypes
    from ctypes import wintypes

    LRESULT = ctypes.c_ssize_t
    UINT_PTR = ctypes.c_size_t
    HICON = getattr(wintypes, "HICON", wintypes.HANDLE)
    HCURSOR = getattr(wintypes, "HCURSOR", wintypes.HANDLE)
    HBRUSH = getattr(wintypes, "HBRUSH", wintypes.HANDLE)
    HFONT = getattr(wintypes, "HFONT", wintypes.HANDLE)
    HMENU = getattr(wintypes, "HMENU", wintypes.HANDLE)
    WNDPROC = ctypes.WINFUNCTYPE(
        LRESULT,
        wintypes.HWND,
        wintypes.UINT,
        wintypes.WPARAM,
        wintypes.LPARAM,
    )

    WM_DESTROY = 0x0002
    WM_SIZE = 0x0005
    WM_CLOSE = 0x0010
    WM_COMMAND = 0x0111
    WM_TIMER = 0x0113
    WM_NULL = 0x0000
    WM_LBUTTONUP = 0x0202
    WM_RBUTTONUP = 0x0205
    WM_APP = 0x8000
    WM_TRAY = WM_APP + 1
    WM_UI_STOP = WM_APP + 2
    WM_UI_SHOW = WM_APP + 3

    WS_CAPTION = 0x00C00000
    WS_SYSMENU = 0x00080000
    WS_THICKFRAME = 0x00040000
    WS_CHILD = 0x40000000
    WS_VISIBLE = 0x10000000
    WS_VSCROLL = 0x00200000
    ES_MULTILINE = 0x0004
    ES_AUTOVSCROLL = 0x0040
    ES_READONLY = 0x0800
    WS_EX_TOPMOST = 0x00000008
    WS_EX_TOOLWINDOW = 0x00000080

    SW_HIDE = 0
    SW_SHOWNORMAL = 1
    SW_SHOWNOACTIVATE = 4

    NIM_ADD = 0x00000000
    NIM_DELETE = 0x00000002
    NIF_MESSAGE = 0x00000001
    NIF_ICON = 0x00000002
    NIF_TIP = 0x00000004

    MF_STRING = 0x00000000
    MF_SEPARATOR = 0x00000800
    TPM_LEFTALIGN = 0x0000
    TPM_BOTTOMALIGN = 0x0020
    TPM_RIGHTBUTTON = 0x0002

    SPI_GETWORKAREA = 0x0030
    COLOR_WINDOW = 5
    IDC_ARROW = 32512
    IDI_APPLICATION = 32512
    TIMER_ID = 1
    TIMER_MS = 750
    EM_SETSEL = 0x00B1
    EM_SCROLLCARET = 0x00B7
    WM_SETFONT = 0x0030
    DEFAULT_CHARSET = 1
    OUT_DEFAULT_PRECIS = 0
    CLIP_DEFAULT_PRECIS = 0
    CLEARTYPE_QUALITY = 5
    FIXED_PITCH = 1
    FF_MODERN = 48

    MENU_SHOW = 1001
    MENU_HIDE = 1002
    MENU_QUIT = 1099

    class GUID(ctypes.Structure):
        _fields_ = [
            ("Data1", wintypes.DWORD),
            ("Data2", wintypes.WORD),
            ("Data3", wintypes.WORD),
            ("Data4", ctypes.c_ubyte * 8),
        ]

    class WNDCLASSEXW(ctypes.Structure):
        _fields_ = [
            ("cbSize", wintypes.UINT),
            ("style", wintypes.UINT),
            ("lpfnWndProc", WNDPROC),
            ("cbClsExtra", ctypes.c_int),
            ("cbWndExtra", ctypes.c_int),
            ("hInstance", wintypes.HINSTANCE),
            ("hIcon", HICON),
            ("hCursor", HCURSOR),
            ("hbrBackground", HBRUSH),
            ("lpszMenuName", wintypes.LPCWSTR),
            ("lpszClassName", wintypes.LPCWSTR),
            ("hIconSm", HICON),
        ]

    class NOTIFYICONDATAW(ctypes.Structure):
        _fields_ = [
            ("cbSize", wintypes.DWORD),
            ("hWnd", wintypes.HWND),
            ("uID", wintypes.UINT),
            ("uFlags", wintypes.UINT),
            ("uCallbackMessage", wintypes.UINT),
            ("hIcon", HICON),
            ("szTip", wintypes.WCHAR * 128),
            ("dwState", wintypes.DWORD),
            ("dwStateMask", wintypes.DWORD),
            ("szInfo", wintypes.WCHAR * 256),
            ("uTimeoutOrVersion", wintypes.UINT),
            ("dwInfoFlags", wintypes.DWORD),
            ("guidItem", GUID),
            ("hBalloonIcon", HICON),
        ]

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    shell32 = ctypes.WinDLL("shell32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)

    # ctypes defaults untyped Win32 arguments to c_int. That is unsafe for
    # handles/pointers on 64-bit Windows and caused real Windows 10 tray startup
    # failures. Keep every production call explicitly typed.
    kernel32.GetModuleHandleW.argtypes = [wintypes.LPCWSTR]
    kernel32.GetModuleHandleW.restype = wintypes.HMODULE

    user32.LoadIconW.argtypes = [wintypes.HINSTANCE, wintypes.LPCWSTR]
    user32.LoadIconW.restype = HICON
    user32.LoadCursorW.argtypes = [wintypes.HINSTANCE, wintypes.LPCWSTR]
    user32.LoadCursorW.restype = HCURSOR
    user32.RegisterClassExW.argtypes = [ctypes.POINTER(WNDCLASSEXW)]
    user32.RegisterClassExW.restype = wintypes.ATOM
    user32.CreateWindowExW.argtypes = [
        wintypes.DWORD,
        wintypes.LPCWSTR,
        wintypes.LPCWSTR,
        wintypes.DWORD,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        wintypes.HWND,
        HMENU,
        wintypes.HINSTANCE,
        wintypes.LPVOID,
    ]
    user32.CreateWindowExW.restype = wintypes.HWND
    user32.DefWindowProcW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user32.DefWindowProcW.restype = LRESULT
    user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user32.SendMessageW.restype = LRESULT
    user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user32.PostMessageW.restype = wintypes.BOOL
    user32.SetTimer.argtypes = [wintypes.HWND, UINT_PTR, wintypes.UINT, wintypes.LPVOID]
    user32.SetTimer.restype = UINT_PTR
    user32.KillTimer.argtypes = [wintypes.HWND, UINT_PTR]
    user32.KillTimer.restype = wintypes.BOOL
    user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.ShowWindow.restype = wintypes.BOOL
    user32.UpdateWindow.argtypes = [wintypes.HWND]
    user32.UpdateWindow.restype = wintypes.BOOL
    user32.GetMessageW.argtypes = [ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT]
    user32.GetMessageW.restype = wintypes.BOOL
    user32.TranslateMessage.argtypes = [ctypes.POINTER(wintypes.MSG)]
    user32.TranslateMessage.restype = wintypes.BOOL
    user32.DispatchMessageW.argtypes = [ctypes.POINTER(wintypes.MSG)]
    user32.DispatchMessageW.restype = LRESULT
    user32.SystemParametersInfoW.argtypes = [wintypes.UINT, wintypes.UINT, wintypes.LPVOID, wintypes.UINT]
    user32.SystemParametersInfoW.restype = wintypes.BOOL
    user32.GetSystemMetrics.argtypes = [ctypes.c_int]
    user32.GetSystemMetrics.restype = ctypes.c_int
    user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    user32.GetWindowRect.restype = wintypes.BOOL
    user32.GetClientRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    user32.GetClientRect.restype = wintypes.BOOL
    user32.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT]
    user32.SetWindowPos.restype = wintypes.BOOL
    user32.SetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPCWSTR]
    user32.SetWindowTextW.restype = wintypes.BOOL
    user32.MoveWindow.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.BOOL]
    user32.MoveWindow.restype = wintypes.BOOL
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.IsWindowVisible.restype = wintypes.BOOL
    user32.SetForegroundWindow.argtypes = [wintypes.HWND]
    user32.SetForegroundWindow.restype = wintypes.BOOL
    user32.CreatePopupMenu.argtypes = []
    user32.CreatePopupMenu.restype = HMENU
    user32.AppendMenuW.argtypes = [HMENU, wintypes.UINT, UINT_PTR, wintypes.LPCWSTR]
    user32.AppendMenuW.restype = wintypes.BOOL
    user32.GetCursorPos.argtypes = [ctypes.POINTER(wintypes.POINT)]
    user32.GetCursorPos.restype = wintypes.BOOL
    user32.TrackPopupMenu.argtypes = [HMENU, wintypes.UINT, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.HWND, wintypes.LPVOID]
    user32.TrackPopupMenu.restype = wintypes.BOOL
    user32.DestroyMenu.argtypes = [HMENU]
    user32.DestroyMenu.restype = wintypes.BOOL
    user32.DestroyWindow.argtypes = [wintypes.HWND]
    user32.DestroyWindow.restype = wintypes.BOOL
    user32.PostQuitMessage.argtypes = [ctypes.c_int]
    user32.PostQuitMessage.restype = None
    user32.RegisterWindowMessageW.argtypes = [wintypes.LPCWSTR]
    user32.RegisterWindowMessageW.restype = wintypes.UINT

    shell32.Shell_NotifyIconW.argtypes = [wintypes.DWORD, ctypes.POINTER(NOTIFYICONDATAW)]
    shell32.Shell_NotifyIconW.restype = wintypes.BOOL

    gdi32.CreateFontW.argtypes = [
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.LPCWSTR,
    ]
    gdi32.CreateFontW.restype = HFONT
    gdi32.DeleteObject.argtypes = [wintypes.HANDLE]
    gdi32.DeleteObject.restype = wintypes.BOOL

    def _resource(identifier: int):
        return ctypes.cast(ctypes.c_void_p(int(identifier) & 0xFFFF), wintypes.LPCWSTR)

    def _handle_value(value) -> int:
        if value is None:
            return 0
        if isinstance(value, int):
            return value
        raw = ctypes.cast(value, ctypes.c_void_p).value
        return int(raw or 0)


class BodyTray:
    """Native Windows tray + read-only daemon log viewer.

    The log window's close button only hides the window. Normal application
    shutdown is requested exclusively from the tray menu's Quit command.
    """

    def __init__(
        self,
        log_path: Path | str,
        on_quit: Callable[[], None],
        *,
        title: str = "BODY - Daemon Logs (read-only)",
        max_log_bytes: int = 256 * 1024,
        max_log_lines: int = 500,
    ):
        self.log_path = Path(log_path)
        self.on_quit = on_quit
        self.title = str(title)
        self.max_log_bytes = max(16 * 1024, int(max_log_bytes))
        self.max_log_lines = max(50, int(max_log_lines))
        self._thread: threading.Thread | None = None
        self._started = threading.Event()
        self._start_error: Exception | None = None
        self._start_stage = "not_started"
        self._quit_once = threading.Event()
        self._notice_lock = threading.RLock()
        self._notice = "Starting BODY runtime..."
        self._last_text = ""
        self._hwnd = None
        self._edit = None
        self._font = None
        self._nid = None
        self._wndproc = None
        self._icon = None
        self._instance = None
        self._taskbar_created = 0
        self._class_name = f"BODYTrayWindow_{os.getpid()}_{id(self)}"

    @staticmethod
    def supported() -> bool:
        return os.name == "nt"

    def start(self) -> None:
        if not self.supported():
            raise TrayUiError("windows_tray_ui_unavailable")
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._run, name="BODYTrayUI", daemon=False)
        self._thread.start()
        if not self._started.wait(5.0):
            raise TrayUiError("windows_tray_ui_start_timeout")
        if self._start_error is not None:
            detail = str(self._start_error).strip().replace("\r", " ").replace("\n", " ")
            raise TrayUiError(
                f"windows_tray_ui_start_failed:{self._start_stage}:"
                f"{type(self._start_error).__name__}:{detail or 'no_detail'}"
            ) from self._start_error

    def set_notice(self, value: str) -> None:
        with self._notice_lock:
            self._notice = str(value or "").strip()

    def show(self) -> None:
        if os.name == "nt" and self._hwnd:
            user32.PostMessageW(self._hwnd, WM_UI_SHOW, 0, 0)

    def stop(self) -> None:
        if os.name == "nt" and self._hwnd:
            user32.PostMessageW(self._hwnd, WM_UI_STOP, 0, 0)
        thread = self._thread
        if thread and thread.is_alive() and thread is not threading.current_thread():
            thread.join(timeout=5.0)

    def _request_quit(self) -> None:
        if self._quit_once.is_set():
            return
        self._quit_once.set()
        self.set_notice("Shutting down BODY runtime...")
        try:
            self.on_quit()
        except Exception:
            pass

    def _read_log_tail(self) -> str:
        path = self.log_path
        if not path.exists():
            return "[BODY] Waiting for daemon log..."
        try:
            with path.open("rb") as handle:
                handle.seek(0, 2)
                size = handle.tell()
                start = max(0, size - self.max_log_bytes)
                handle.seek(start)
                data = handle.read()
            text = data.decode("utf-8", errors="replace")
            lines = text.splitlines()
            if start > 0 and lines:
                lines = lines[1:]
            return "\r\n".join(lines[-self.max_log_lines:]) or "[BODY] Daemon log is empty."
        except OSError as exc:
            return f"[BODY] Unable to read daemon log: {type(exc).__name__}"

    def _display_text(self) -> str:
        with self._notice_lock:
            notice = self._notice
        log_text = self._read_log_tail()
        return f"[BODY] {notice}\r\n\r\n{log_text}" if notice else log_text

    if os.name == "nt":
        def _set_stage(self, stage: str) -> None:
            self._start_stage = stage

        def _add_tray_icon(self, *, retry: bool) -> bool:
            if self._nid is None:
                return False
            attempts = 12 if retry else 1
            for index in range(attempts):
                ctypes.set_last_error(0)
                if shell32.Shell_NotifyIconW(NIM_ADD, ctypes.byref(self._nid)):
                    return True
                if index + 1 < attempts:
                    time.sleep(0.25)
            return False

        def _run(self) -> None:
            try:
                self._set_stage("wndproc")
                self._wndproc = WNDPROC(self._window_proc)

                self._set_stage("module_handle")
                self._instance = kernel32.GetModuleHandleW(None)
                if not self._instance:
                    raise ctypes.WinError(ctypes.get_last_error())

                self._set_stage("stock_icon_cursor")
                self._icon = user32.LoadIconW(None, _resource(IDI_APPLICATION))
                cursor = user32.LoadCursorW(None, _resource(IDC_ARROW))
                if not self._icon or not cursor:
                    raise ctypes.WinError(ctypes.get_last_error())

                self._set_stage("window_class")
                wc = WNDCLASSEXW()
                wc.cbSize = ctypes.sizeof(WNDCLASSEXW)
                wc.lpfnWndProc = self._wndproc
                wc.hInstance = self._instance
                wc.hIcon = self._icon
                wc.hCursor = cursor
                wc.hbrBackground = COLOR_WINDOW + 1
                wc.lpszClassName = self._class_name
                wc.hIconSm = self._icon
                if not user32.RegisterClassExW(ctypes.byref(wc)):
                    raise ctypes.WinError(ctypes.get_last_error())

                self._set_stage("log_window")
                width, height = 680, 360
                x, y = self._top_right_xy(width, height)
                style = WS_CAPTION | WS_SYSMENU | WS_THICKFRAME
                ex_style = WS_EX_TOPMOST | WS_EX_TOOLWINDOW
                self._hwnd = user32.CreateWindowExW(
                    ex_style,
                    self._class_name,
                    self.title,
                    style,
                    x,
                    y,
                    width,
                    height,
                    None,
                    None,
                    self._instance,
                    None,
                )
                if not self._hwnd:
                    raise ctypes.WinError(ctypes.get_last_error())

                self._set_stage("readonly_edit")
                self._edit = user32.CreateWindowExW(
                    0,
                    "EDIT",
                    "",
                    WS_CHILD | WS_VISIBLE | WS_VSCROLL | ES_MULTILINE | ES_AUTOVSCROLL | ES_READONLY,
                    0,
                    0,
                    width,
                    height,
                    self._hwnd,
                    None,
                    self._instance,
                    None,
                )
                if not self._edit:
                    raise ctypes.WinError(ctypes.get_last_error())

                self._set_stage("font")
                self._font = gdi32.CreateFontW(
                    -15,
                    0,
                    0,
                    0,
                    400,
                    0,
                    0,
                    0,
                    DEFAULT_CHARSET,
                    OUT_DEFAULT_PRECIS,
                    CLIP_DEFAULT_PRECIS,
                    CLEARTYPE_QUALITY,
                    FIXED_PITCH | FF_MODERN,
                    "Consolas",
                )
                if self._font:
                    user32.SendMessageW(self._edit, WM_SETFONT, _handle_value(self._font), 1)

                self._set_stage("tray_data")
                self._nid = NOTIFYICONDATAW()
                self._nid.cbSize = ctypes.sizeof(NOTIFYICONDATAW)
                self._nid.hWnd = self._hwnd
                self._nid.uID = 1
                self._nid.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP
                self._nid.uCallbackMessage = WM_TRAY
                self._nid.hIcon = self._icon
                self._nid.szTip = "BODY - right-click for menu"
                self._taskbar_created = int(user32.RegisterWindowMessageW("TaskbarCreated") or 0)

                self._set_stage("tray_add")
                if not self._add_tray_icon(retry=True):
                    error = ctypes.get_last_error()
                    raise OSError(error, f"Shell_NotifyIconW(NIM_ADD) failed after retry; winerror={error}")

                self._set_stage("timer")
                if not user32.SetTimer(self._hwnd, TIMER_ID, TIMER_MS, None):
                    raise ctypes.WinError(ctypes.get_last_error())

                self._refresh_log(force=True)
                user32.ShowWindow(self._hwnd, SW_SHOWNOACTIVATE)
                user32.UpdateWindow(self._hwnd)
                self._set_stage("running")
                self._started.set()

                message = wintypes.MSG()
                while True:
                    result = user32.GetMessageW(ctypes.byref(message), None, 0, 0)
                    if result == -1:
                        raise ctypes.WinError(ctypes.get_last_error())
                    if result == 0:
                        break
                    user32.TranslateMessage(ctypes.byref(message))
                    user32.DispatchMessageW(ctypes.byref(message))
            except Exception as exc:
                self._start_error = exc
                self._started.set()
            finally:
                if self._nid is not None:
                    try:
                        shell32.Shell_NotifyIconW(NIM_DELETE, ctypes.byref(self._nid))
                    except Exception:
                        pass
                if self._font:
                    try:
                        gdi32.DeleteObject(self._font)
                    except Exception:
                        pass
                self._hwnd = None
                self._edit = None
                self._started.set()

        def _top_right_xy(self, width: int, height: int) -> tuple[int, int]:
            rect = wintypes.RECT()
            if user32.SystemParametersInfoW(SPI_GETWORKAREA, 0, ctypes.byref(rect), 0):
                return max(rect.left, rect.right - width - 12), rect.top + 12
            return max(0, user32.GetSystemMetrics(0) - width - 12), 12

        def _position_top_right(self) -> None:
            if not self._hwnd:
                return
            rect = wintypes.RECT()
            if not user32.GetWindowRect(self._hwnd, ctypes.byref(rect)):
                return
            width = max(320, rect.right - rect.left)
            height = max(180, rect.bottom - rect.top)
            x, y = self._top_right_xy(width, height)
            user32.SetWindowPos(self._hwnd, None, x, y, 0, 0, 0x0001 | 0x0004)

        def _refresh_log(self, *, force: bool = False) -> None:
            if not self._edit:
                return
            text = self._display_text()
            if not force and text == self._last_text:
                return
            self._last_text = text
            user32.SetWindowTextW(self._edit, text)
            user32.SendMessageW(self._edit, EM_SETSEL, len(text), len(text))
            user32.SendMessageW(self._edit, EM_SCROLLCARET, 0, 0)

        def _resize_edit(self) -> None:
            if not self._hwnd or not self._edit:
                return
            rect = wintypes.RECT()
            if user32.GetClientRect(self._hwnd, ctypes.byref(rect)):
                user32.MoveWindow(self._edit, 0, 0, rect.right - rect.left, rect.bottom - rect.top, True)

        def _show_logs(self) -> None:
            if not self._hwnd:
                return
            self._position_top_right()
            user32.ShowWindow(self._hwnd, SW_SHOWNORMAL)
            user32.SetForegroundWindow(self._hwnd)

        def _hide_logs(self) -> None:
            if self._hwnd:
                user32.ShowWindow(self._hwnd, SW_HIDE)

        def _toggle_logs(self) -> None:
            if self._hwnd and user32.IsWindowVisible(self._hwnd):
                self._hide_logs()
            else:
                self._show_logs()

        def _popup_menu(self) -> None:
            if not self._hwnd:
                return
            menu = user32.CreatePopupMenu()
            if not menu:
                return
            try:
                user32.AppendMenuW(menu, MF_STRING, MENU_SHOW, "Show daemon logs")
                user32.AppendMenuW(menu, MF_STRING, MENU_HIDE, "Hide daemon logs")
                user32.AppendMenuW(menu, MF_SEPARATOR, 0, None)
                user32.AppendMenuW(menu, MF_STRING, MENU_QUIT, "Quit BODY")
                point = wintypes.POINT()
                user32.GetCursorPos(ctypes.byref(point))
                user32.SetForegroundWindow(self._hwnd)
                user32.TrackPopupMenu(
                    menu,
                    TPM_LEFTALIGN | TPM_BOTTOMALIGN | TPM_RIGHTBUTTON,
                    point.x,
                    point.y,
                    0,
                    self._hwnd,
                    None,
                )
                user32.PostMessageW(self._hwnd, WM_NULL, 0, 0)
            finally:
                user32.DestroyMenu(menu)

        def _window_proc(self, hwnd, message, wparam, lparam):
            if self._taskbar_created and int(message) == self._taskbar_created:
                self._add_tray_icon(retry=False)
                return 0
            if message == WM_TRAY:
                event = int(lparam)
                if event == WM_LBUTTONUP:
                    self._toggle_logs()
                    return 0
                if event == WM_RBUTTONUP:
                    self._popup_menu()
                    return 0
            elif message == WM_COMMAND:
                command = int(wparam) & 0xFFFF
                if command == MENU_SHOW:
                    self._show_logs()
                    return 0
                if command == MENU_HIDE:
                    self._hide_logs()
                    return 0
                if command == MENU_QUIT:
                    self._request_quit()
                    return 0
            elif message == WM_TIMER and int(wparam) == TIMER_ID:
                self._refresh_log()
                return 0
            elif message == WM_SIZE:
                self._resize_edit()
                return 0
            elif message == WM_CLOSE:
                # Closing the log box only hides it; it never terminates BODY.
                self._hide_logs()
                return 0
            elif message == WM_UI_SHOW:
                self._show_logs()
                return 0
            elif message == WM_UI_STOP:
                user32.DestroyWindow(hwnd)
                return 0
            elif message == WM_DESTROY:
                user32.KillTimer(hwnd, TIMER_ID)
                if self._nid is not None:
                    shell32.Shell_NotifyIconW(NIM_DELETE, ctypes.byref(self._nid))
                    self._nid = None
                user32.PostQuitMessage(0)
                return 0
            return user32.DefWindowProcW(hwnd, message, wparam, lparam)