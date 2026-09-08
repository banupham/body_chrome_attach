# Manual Real Chrome Release Test

Production acceptance is fully manual: no Puppeteer, CDP browser automation, automatic Chrome launch, or automatic Extension installation.

## User-facing release

Give the user exactly these two files:

```text
BodyBrain.exe
BodyChromeAttach-v0.8.0.zip
```

The ZIP is already the protected/obfuscated Extension build.

Internal integrity metadata is kept separately as `bodybrain-release-v0.8.0.json` and does not need to be distributed to normal users.

## 1. Build clean release

From the repository root:

```cmd
git pull origin feat/bodybrain-onefile-release
npm install
npm run clean
npm run extension:protected:test
python -m pip install -r requirements-release.txt
python tools\build_bodybrain_release.py
python tests\bodybrain_release_manifest_contract.py
```

After the build, this directory must contain exactly three files:

```text
artifacts\BodyBrain.exe
artifacts\BodyChromeAttach-v0.8.0.zip
artifacts\bodybrain-release-v0.8.0.json
```

No duplicate or legacy Extension artifacts and no temporary release-build directory may remain after a successful build.

`python tests\bodybrain_exe_smoke.py artifacts\BodyBrain.exe` is a no-Chrome smoke test. Run it only with Chrome/Extension isolated; do not mix it with the real-Chrome acceptance below.

## 2. Extract and load Extension manually

Use a permanent folder outside the repository, for example:

```cmd
rmdir /s /q C:\BodyBrain\Extension-v0.8.0 2>nul
powershell -NoProfile -Command "Expand-Archive -Force 'artifacts\BodyChromeAttach-v0.8.0.zip' 'C:\BodyBrain\Extension-v0.8.0'"
```

Then:

1. Open normal Chrome manually.
2. Open `chrome://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select `C:\BodyBrain\Extension-v0.8.0`.
6. Verify **Body Chrome Attach 0.8.0** is enabled.
7. Open a normal web page.

Never distribute repository source, `dist\`, tests, signing keys, or build directories.

## 3. First-start BODY check

Keep Chrome and the Extension open. Run:

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

Release is accepted only when the protected offline Extension reaches `READY`, Desktop restart reconnects, `tokenHash` is reused, Brain remains `NOT_CONFIGURED`, Guardian remains fail-closed, and the user distribution contains only `BodyBrain.exe` plus `BodyChromeAttach-v0.8.0.zip`.
