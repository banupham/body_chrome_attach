import ctypes
import json
import sys
import time
from ctypes import wintypes

if sys.platform != "win32":
    print("ERROR: windows_only", file=sys.stderr)
    raise SystemExit(2)

user32 = ctypes.WinDLL("user32", use_last_error=True)
INPUT_MOUSE = 0
INPUT_KEYBOARD = 1
INPUT_HARDWARE = 2
KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_UNICODE = 0x0004
ULONG_PTR = ctypes.c_size_t
VK = {"BACKSPACE":0x08,"TAB":0x09,"ENTER":0x0D,"SHIFT":0x10,"CONTROL":0x11,"CTRL":0x11,"ALT":0x12,"ESCAPE":0x1B,"ESC":0x1B,"SPACE":0x20,"PAGEUP":0x21,"PAGEDOWN":0x22,"END":0x23,"HOME":0x24,"ARROWLEFT":0x25,"ARROWUP":0x26,"ARROWRIGHT":0x27,"ARROWDOWN":0x28,"INSERT":0x2D,"DELETE":0x2E,"META":0x5B,"WIN":0x5B,"EQUAL":0xBB,"PLUS":0xBB,"MINUS":0xBD,"F1":0x70,"F2":0x71,"F3":0x72,"F4":0x73,"F5":0x74,"F6":0x75,"F7":0x76,"F8":0x77,"F9":0x78,"F10":0x79,"F11":0x7A,"F12":0x7B}

class MOUSEINPUT(ctypes.Structure):
    _fields_=[("dx",wintypes.LONG),("dy",wintypes.LONG),("mouseData",wintypes.DWORD),("dwFlags",wintypes.DWORD),("time",wintypes.DWORD),("dwExtraInfo",ULONG_PTR)]
class KEYBDINPUT(ctypes.Structure):
    _fields_=[("wVk",wintypes.WORD),("wScan",wintypes.WORD),("dwFlags",wintypes.DWORD),("time",wintypes.DWORD),("dwExtraInfo",ULONG_PTR)]
class HARDWAREINPUT(ctypes.Structure):
    _fields_=[("uMsg",wintypes.DWORD),("wParamL",wintypes.WORD),("wParamH",wintypes.WORD)]
class _INPUTUNION(ctypes.Union):
    _fields_=[("mi",MOUSEINPUT),("ki",KEYBDINPUT),("hi",HARDWAREINPUT)]
class INPUT(ctypes.Structure):
    _anonymous_=("u",)
    _fields_=[("type",wintypes.DWORD),("u",_INPUTUNION)]

user32.SendInput.argtypes=(wintypes.UINT,ctypes.POINTER(INPUT),ctypes.c_int)
user32.SendInput.restype=wintypes.UINT

def layout_selftest():
    pointer_size=ctypes.sizeof(ctypes.c_void_p)
    expected_input_size=40 if pointer_size==8 else 28
    expected_mouse_size=32 if pointer_size==8 else 24
    expected_keyboard_size=24 if pointer_size==8 else 16
    actual={
        "pointerSize":pointer_size,
        "inputSize":ctypes.sizeof(INPUT),
        "mouseInputSize":ctypes.sizeof(MOUSEINPUT),
        "keyboardInputSize":ctypes.sizeof(KEYBDINPUT),
        "hardwareInputSize":ctypes.sizeof(HARDWAREINPUT),
    }
    expected={
        "inputSize":expected_input_size,
        "mouseInputSize":expected_mouse_size,
        "keyboardInputSize":expected_keyboard_size,
        "hardwareInputSize":8,
    }
    for key,value in expected.items():
        if actual[key]!=value:
            raise RuntimeError(f"win32_input_abi_mismatch:{key}:expected={value}:actual={actual[key]}")
    return actual

def send_vk(vk,up=False):
    flags=KEYEVENTF_KEYUP if up else 0
    inp=INPUT(type=INPUT_KEYBOARD,ki=KEYBDINPUT(vk,0,flags,0,0))
    ctypes.set_last_error(0)
    sent=user32.SendInput(1,ctypes.byref(inp),ctypes.sizeof(INPUT))
    if sent!=1: raise ctypes.WinError(ctypes.get_last_error())

def key_to_vk(name):
    raw=str(name); up=raw.upper()
    if up in VK: return VK[up]
    if len(raw)==1:
        ch=raw.upper()
        if "A"<=ch<="Z" or "0"<=ch<="9": return ord(ch)
    raise ValueError(f"unsupported_key:{name}")

def send_combo(spec):
    parts=[p for p in str(spec).split("+") if p]
    if not parts: raise ValueError("empty_combo")
    modifier_names={"CTRL","CONTROL","ALT","SHIFT","META","WIN"}
    mods=[p for p in parts if p.upper() in modifier_names]
    keys=[p for p in parts if p.upper() not in modifier_names]
    for m in mods: send_vk(key_to_vk(m),False); time.sleep(0.010)
    for k in keys:
        vk=key_to_vk(k); send_vk(vk,False); time.sleep(0.022); send_vk(vk,True); time.sleep(0.010)
    for m in reversed(mods): send_vk(key_to_vk(m),True); time.sleep(0.010)

def send_key(name):
    vk=key_to_vk(name); send_vk(vk,False); time.sleep(0.032); send_vk(vk,True)

def send_text(text):
    for ch in text:
        code=ord(ch)
        down=INPUT(type=INPUT_KEYBOARD,ki=KEYBDINPUT(0,code,KEYEVENTF_UNICODE,0,0))
        up=INPUT(type=INPUT_KEYBOARD,ki=KEYBDINPUT(0,code,KEYEVENTF_UNICODE|KEYEVENTF_KEYUP,0,0))
        ctypes.set_last_error(0)
        if user32.SendInput(1,ctypes.byref(down),ctypes.sizeof(INPUT))!=1: raise ctypes.WinError(ctypes.get_last_error())
        time.sleep(0.004)
        ctypes.set_last_error(0)
        if user32.SendInput(1,ctypes.byref(up),ctypes.sizeof(INPUT))!=1: raise ctypes.WinError(ctypes.get_last_error())
        time.sleep(0.004)

def execute(mode,value):
    mode=str(mode).lower()
    if mode=="combo": send_combo(value)
    elif mode=="key": send_key(value)
    elif mode=="text": send_text(value)
    else: raise ValueError(f"unsupported_mode:{mode}")

def worker():
    layout_selftest()
    for raw in sys.stdin:
        raw=raw.strip()
        if not raw: continue
        request_id=None
        try:
            msg=json.loads(raw); request_id=msg.get("id")
            execute(msg.get("mode"),msg.get("value",""))
            print(json.dumps({"id":request_id,"ok":True},separators=(",",":")),flush=True)
        except Exception as exc:
            print(json.dumps({"id":request_id,"ok":False,"error":str(exc)},separators=(",",":")),flush=True)
    return 0

def main():
    if len(sys.argv)<2:
        print("usage: windows_input.py selftest | worker | combo|key|text [VALUE via stdin]",file=sys.stderr); return 2
    mode=sys.argv[1].lower()
    if mode=="selftest":
        print(json.dumps({"ok":True,"layout":layout_selftest()},separators=(",",":"))); return 0
    if mode=="worker": return worker()
    value=" ".join(sys.argv[2:]) if len(sys.argv)>=3 else sys.stdin.read()
    execute(mode,value); print("OK"); return 0

if __name__=="__main__":
    try: raise SystemExit(main())
    except Exception as e:
        print(f"ERROR: {e}",file=sys.stderr); raise SystemExit(1)
