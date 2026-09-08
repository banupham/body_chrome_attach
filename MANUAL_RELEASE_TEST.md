# Manual Real Chrome Release Test

Production acceptance is fully manual: no Puppeteer, CDP browser automation, automatic Chrome launch, or automatic Extension installation.

## User-facing release

Give the user exactly these two files:

```text
BodyBrain.exe
BodyChromeAttach-v0.8.0.zip
```

The ZIP is already the protected/obfuscated Extension build. Internal integrity metadata is kept separately as `bodybrain-release-v0.8.0.json`.

## 1. Build clean release

From the repository root:

```cmd
git pull --ff-only origin feat/bodybrain-onefile-release
npm install --no-package-lock
npm run clean
npm run extension:protected:test
python -m pip install -r requirements-release.txt
python tools\build_bodybrain_release.py
python tests\bodybrain_exe_smoke.py artifacts\BodyBrain.exe
python tests\bodybrain_release_manifest_contract.py
```

After the build, `artifacts\` must contain exactly:

```text
BodyBrain.exe
BodyChromeAttach-v0.8.0.zip
bodybrain-release-v0.8.0.json
```

The isolated EXE smoke is a no-Chrome diagnostic test. Do not run that smoke while the real Chrome acceptance session is active.

## 2. Extract and load Extension manually

Use a permanent folder outside the repository:

```cmd
rmdir /s /q C:\BodyBrain\Extension-v0.8.0 2>nul
powershell -NoProfile -Command "Expand-Archive -Force 'artifacts\BodyChromeAttach-v0.8.0.zip' 'C:\BodyBrain\Extension-v0.8.0'"
```

Then manually:

1. Open normal Chrome.
2. Open `chrome://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select `C:\BodyBrain\Extension-v0.8.0`.
6. Verify **Body Chrome Attach 0.8.0** is enabled.
7. Open a normal web page.

Never distribute repository source, `dist\`, tests, signing keys, or build directories.

## 3. Diagnostic READY check

With Chrome and the Extension open, run once:

```cmd
artifacts\BodyBrain.exe --check --json --ready-timeout 8
```

`--check` is an explicit diagnostic mode and intentionally exits after reporting readiness. The normal user application described below is tray-owned and does not use this exit behavior.

PASS requires:

- `product = BodyBrain`
- `desktop = RUNNING`
- `bodyRuntime = CONNECTED`
- `brain = NOT_CONFIGURED`
- `health.extensionConnectivity.state = READY`
- at least one browser in `guardianReadiness.browsers`
- no browser with `reason = browser_offline`
- Guardian remains authoritative and fail-closed

## 4. Tray + read-only daemon log acceptance

Start the normal application:

```cmd
start "" artifacts\BodyBrain.exe
```

PASS requires all of the following:

1. A **BodyBrain tray icon** appears in the Windows notification area at the bottom-right.
2. A window titled **BodyBrain - Daemon Logs (read-only)** appears near the top-right of the Windows work area.
3. The window displays the persistent daemon log from `%LOCALAPPDATA%\BodyBrain\logs\body-runtime.log` and follows new output.
4. The log box allows selection/copy but typing cannot modify its contents.
5. Clicking the window **X** only hides the log window. It must not stop BodyBrain, Guardian, or BODY runtime.
6. Left-clicking the tray icon shows/hides the log window.
7. Right-clicking the tray icon exposes **Quit BodyBrain**.

After hiding the log window with X, verify BodyBrain is still alive:

```cmd
tasklist /FI "IMAGENAME eq BodyBrain.exe"
netstat -ano | findstr :43147
```

`BodyBrain.exe` must still be present and port `43147` must still be LISTENING.

Now right-click the tray icon and choose **Quit BodyBrain**. Wait a few seconds, then run:

```cmd
tasklist /FI "IMAGENAME eq BodyBrain.exe"
netstat -ano | findstr :43147
```

PASS requires no running `BodyBrain.exe` and no listener on `127.0.0.1:43147`. This proves the tray Quit path stopped the Desktop Host and complete BODY worker tree rather than merely hiding the UI.

## 5. Restart + token reuse

Start BodyBrain normally again:

```cmd
start "" artifacts\BodyBrain.exe
```

Wait for the log window status to report READY, then record pairing state:

```cmd
type "%LOCALAPPDATA%\BodyBrain\body\profiles\.auth\extensions.json"
```

Right-click the tray icon → **Quit BodyBrain**, verify the process/port are gone, then start the EXE again and read the same file again.

The same Extension entry must preserve the same `tokenHash` and return to READY after restart.

## 6. Persistent failure logs

The tray window is intentionally read-only. The underlying persistent logs remain:

```cmd
powershell -NoProfile -Command "Get-Content (Join-Path $env:LOCALAPPDATA 'BodyBrain\logs\body-runtime.log') -Tail 100"
powershell -NoProfile -Command "Get-Content (Join-Path $env:LOCALAPPDATA 'BodyBrain\logs\desktop-host.log') -Tail 100"
```

## Acceptance

Release is accepted only when the protected offline Extension reaches READY, the tray icon is present, the read-only daemon log behaves correctly, window X hides without stopping BODY, tray **Quit BodyBrain** fully removes the process/runtime listener, restart reconnects with the same `tokenHash`, Brain remains `NOT_CONFIGURED`, Guardian remains fail-closed, and the user distribution still contains only `BodyBrain.exe` plus `BodyChromeAttach-v0.8.0.zip`.
