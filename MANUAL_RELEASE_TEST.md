# Manual Real Chrome Release Test

This acceptance test intentionally uses no Puppeteer, CDP automation, scripted clicking, browser assertions, automatic Chrome launch, or automatic Extension installation.

## 1. Prepare the packaged Extension and EXE

From the repository root:

```cmd
git pull origin feat/bodybrain-onefile-release
npm run extension:package
python tools\build_bodybrain_release.py
python tests\bodybrain_exe_smoke.py artifacts\BodyBrain.exe
```

The unpacked Extension for Chrome Developer Mode is:

```text
dist\
```

The packaged Extension ZIP is:

```text
artifacts\body-chrome-attach-v0.8.0.zip
```

The ZIP is the distributable package. Chrome's **Load unpacked** button must point to the `dist` directory, not to the ZIP file.

## 2. Load BODY Extension manually in Chrome

1. Open your normal Chrome manually.
2. Open `chrome://extensions/`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select the repository `dist` directory.
6. Verify **Body Chrome Attach** is present and enabled.
7. Open a normal web page, for example `https://example.com/`.

No launcher or browser automation is used.

## 3. First-start BODY check

Keep Chrome open. In CMD from the repository root, run:

```cmd
artifacts\BodyBrain.exe --check --json --ready-timeout 8
```

Read the final JSON line manually. Acceptance criteria:

- `product` is `BodyBrain`.
- `desktop` is `RUNNING`.
- `bodyRuntime` is `CONNECTED`.
- `brain` is `NOT_CONFIGURED`.
- `health.extensionConnectivity.state` is `READY`.
- `guardianReadiness.browsers` contains at least one browser.
- No browser has `reason` equal to `browser_offline`.
- Guardian remains authoritative and fail-closed.

## 4. Record pairing token hash

```cmd
type "%LOCALAPPDATA%\BodyBrain\body\profiles\.auth\extensions.json"
```

Record the Extension `tokenHash`.

## 5. Desktop restart check

Leave Chrome open and run again:

```cmd
artifacts\BodyBrain.exe --check --json --ready-timeout 8
```

The Extension must reconnect and return to `READY`; the browser must not be `browser_offline`.

Read the pairing state again:

```cmd
type "%LOCALAPPDATA%\BodyBrain\body\profiles\.auth\extensions.json"
```

The same Extension entry must retain the same `tokenHash`.

## Manual release acceptance

The real-Chrome portion is accepted only when a human has observed:

1. BODY Extension was loaded manually from `dist` using Chrome Developer Mode.
2. First-start Extension state is `READY` with no `browser_offline`.
3. Desktop restart reconnects the same Chrome session.
4. Pairing `tokenHash` is reused across the Desktop restart.
5. Brain remains `NOT_CONFIGURED`.
6. Guardian remains fail-closed and authoritative.
