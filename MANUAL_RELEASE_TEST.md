# Manual Real Chrome Release Test

Production acceptance is fully manual: no Puppeteer, CDP browser automation, automatic Chrome launch, or automatic Extension installation.

## Release outputs

Only these two files are user-facing:

```text
artifacts\BodyBrain.exe
artifacts\BodyChromeAttach-v0.8.0-PROTECTED.zip
```

`dist\`, `dist_protected\`, `.release-build\`, `build\`, logs and test files are build/runtime internals and must not be distributed.

## 1. Build clean release

From the repository root:

```cmd
git pull origin feat/bodybrain-onefile-release
npm install
npm run clean
npm run extension:protected:test
python -m pip install -r requirements-release.txt
python tools\build_bodybrain_release.py
```

Expected Extension outputs:

```text
dist_protected\
artifacts\BodyChromeAttach-v0.8.0-PROTECTED.zip
```

Expected Windows output:

```text
artifacts\BodyBrain.exe
```

`python tests\bodybrain_exe_smoke.py artifacts\BodyBrain.exe` is a no-Chrome smoke test. Run it only with Chrome/Extension isolated; do not mix it with the real-Chrome acceptance below.

## 2. Load protected Extension manually

1. Extract `BodyChromeAttach-v0.8.0-PROTECTED.zip` to a permanent folder, or use local `dist_protected\`.
2. Open normal Chrome manually.
3. Open `chrome://extensions/`.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the protected folder containing `manifest.json`.
7. Verify **Body Chrome Attach 0.8.0** is enabled.
8. Open a normal web page.

Never distribute the repository `src\` tree or normal `dist\` directory.

## 3. First-start BODY check

Keep Chrome and the protected Extension open. Run:

```cmd
artifacts\BodyBrain.exe --check --json --ready-timeout 8
```

PASS requires:

- `product = BodyBrain`
- `desktop = RUNNING`
- `bodyRuntime = CONNECTED`
- `brain = NOT_CONFIGURED`
- `health.extensionConnectivity.state = READY`
- at least one browser in `guardianReadiness.browsers`
- no browser with `reason = browser_offline`
- Guardian remains authoritative and fail-closed

## 4. Restart/token reuse

Record pairing state:

```cmd
type "%LOCALAPPDATA%\BodyBrain\body\profiles\.auth\extensions.json"
```

Keep Chrome open and run again:

```cmd
artifacts\BodyBrain.exe --check --json --ready-timeout 8
```

Read pairing state again. The same Extension entry must keep the same `tokenHash` and return to `READY`.

## 5. Failure logs

If `BodyBrain.exe --check` returns `state=ERROR`, inspect only these persistent logs:

```cmd
powershell -NoProfile -Command "Get-Content (Join-Path $env:LOCALAPPDATA 'BodyBrain\logs\body-runtime.log') -Tail 100"
powershell -NoProfile -Command "Get-Content (Join-Path $env:LOCALAPPDATA 'BodyBrain\logs\desktop-host.log') -Tail 100"
```

## Acceptance

Release is accepted only when the protected offline Extension reaches `READY`, Desktop restart reconnects, `tokenHash` is reused, Brain remains `NOT_CONFIGURED`, Guardian remains fail-closed, and the two user-facing files above are the only distributed artifacts.