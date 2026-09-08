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

With Chrome and the Extension open, run once before starting tray mode:

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
- at least one online browser in `guardianReadiness.browsers`
- historical/offline Browser registrations do not make the current online Browser fail readiness
- Guardian remains authoritative and fail-closed

## 4. Multi-Chrome learning + focused-window acceptance

This gate is required because multiple Chrome profiles/windows can be connected to one BODY runtime.

Use at least two real Chrome sessions with the protected Extension loaded manually. For two separate Chrome profiles, each profile should have its own stable Browser identity. Multiple windows belonging to the same Chrome profile may legitimately share one Browser identity.

1. Keep an HTTP/HTTPS page such as YouTube open in **Chrome A**.
2. Open **Chrome B** with the same protected Extension package and an HTTP/HTTPS page.
3. In each Chrome, open the Body Chrome Attach popup. It must show diagnostic text similar to:

```text
Browser browser-xxxx · Học: N sự kiện · Tab 123
```

4. If A and B are separate Chrome profiles, record their Browser IDs and confirm they differ. If they are two windows of one profile, the Browser ID may be the same, but the active Tab must follow the focused window.
5. Move/click/type normally in Chrome A for a few seconds. Chrome A's **Học** count must increase and the daemon log must emit `[HỌC]` for Chrome A's Browser identity.
6. Focus Chrome B without closing Chrome A. Move/click/type normally in Chrome B. Chrome B's **Học** count must increase and the daemon log must emit `[HỌC]` for Chrome B's Browser identity. Learning must not remain stuck on the first Chrome.
7. Switch focus A → B → A again. The focused tab/window context must follow each switch and learning input must continue from whichever Chrome is being used.
8. Reload the Extension from `chrome://extensions/` while a normal web tab is already open. Do **not** manually reload the web page. The Extension must repair its packaged content script on that existing tab, return to status checking/READY, and resume increasing the **Học** count.
9. A normal existing web tab must not remain indefinitely at `HTTP_TAB_REQUIRED_FOR_ENVIRONMENT_PROBE`; receiving a web tab context must allow the Guardian probe to continue.
10. Human learning remains isolated by stable `browserInstanceId`; data from separate Browser identities must not be silently merged merely because both Chrome sessions are online.

While tray mode is running, use the Extension popup and the BodyBrain daemon log for this acceptance. Do not launch a second `BodyBrain.exe --check` concurrently with the tray-owned runtime because the production runtime port is single-owner.

## 5. Tray + read-only daemon log acceptance

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

## 6. Restart + token reuse

Start BodyBrain normally again:

```cmd
start "" artifacts\BodyBrain.exe
```

Wait for the log window status to report READY, then record pairing state:

```cmd
type "%LOCALAPPDATA%\BodyBrain\body\profiles\.auth\extensions.json"
```

Right-click the tray icon → **Quit BodyBrain**, verify the process/port are gone, then start the EXE again and read the same file again.

Every existing Extension entry must preserve its own `tokenHash` and return to READY after restart.

## 7. Persistent failure logs

The tray window is intentionally read-only. The underlying persistent logs remain:

```cmd
powershell -NoProfile -Command "Get-Content (Join-Path $env:LOCALAPPDATA 'BodyBrain\logs\body-runtime.log') -Tail 100"
powershell -NoProfile -Command "Get-Content (Join-Path $env:LOCALAPPDATA 'BodyBrain\logs\desktop-host.log') -Tail 100"
```

## Acceptance

Release is accepted only when the protected offline Extension reaches READY, multi-Chrome learning follows the Chrome/profile actually being used, already-open web tabs self-repair after Extension reload, the tray icon is present, the read-only daemon log behaves correctly, window X hides without stopping BODY, tray **Quit BodyBrain** fully removes the process/runtime listener, restart reconnects with the same per-Extension `tokenHash`, Brain remains `NOT_CONFIGURED`, Guardian remains fail-closed, and the user distribution still contains only `BodyBrain.exe` plus `BodyChromeAttach-v0.8.0.zip`.
