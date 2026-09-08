# Manual Real Chrome Release Test

This is the production acceptance test for real Chrome. It intentionally does not use Puppeteer, CDP automation, scripted clicking, browser assertions, or automated Extension installation.

The only helper is `tools\start_manual_chrome_test.cmd`. It starts Chrome for Testing with the built BODY Extension present at browser startup through Chrome command-line switches. All acceptance decisions are made manually from the product status and persisted pairing state.

## 1. Prepare the build

From the repository root:

```cmd
git pull origin feat/bodybrain-onefile-release
npm run extension:package
python tools\build_bodybrain_release.py
python tests\bodybrain_exe_smoke.py artifacts\BodyBrain.exe
```

The smoke test must print:

```text
bodybrain_exe_smoke: PASS
```

## 2. Start real Chrome with BODY Extension loaded automatically

Close other Chrome for Testing sessions that use the same manual profile, then run:

```cmd
tools\start_manual_chrome_test.cmd
```

The launcher must open Chrome for Testing with both `chrome://extensions/` and `https://example.com/`.

In `chrome://extensions/`, verify manually that **Body Chrome Attach** is present and enabled.

Do not load the Extension from the UI and do not use Puppeteer. The launcher passes the built `dist` directory at Chrome startup.

## 3. First-start BODY check

Keep that Chrome window open. In a second CMD window, from the repository root, run:

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
- Guardian remains authoritative. `READY`, `BLOCKED`, or a fail-closed waiting state can be valid depending on the observed environment; do not override Guardian.

## 4. Record the pairing token hash

Run:

```cmd
type "%LOCALAPPDATA%\BodyBrain\body\profiles\.auth\extensions.json"
```

Record the Extension `tokenHash` value.

## 5. Desktop restart check

Leave Chrome open and run the EXE check again:

```cmd
artifacts\BodyBrain.exe --check --json --ready-timeout 8
```

Apply the same acceptance criteria as first-start. The Extension must reconnect and return to `READY`; the browser must not be `browser_offline`.

Read the pairing state again:

```cmd
type "%LOCALAPPDATA%\BodyBrain\body\profiles\.auth\extensions.json"
```

The same Extension entry must retain the same `tokenHash`. A changed token hash means the restart/reuse acceptance check failed.

## 6. Optional fail-closed check

Close the manual Chrome window, then run:

```cmd
artifacts\BodyBrain.exe --check --json --ready-timeout 0.5
```

With no active BODY browser, the product must remain fail-closed. On a clean identity this can appear as `CHECKING` / `browser_waiting`; after a browser has previously been registered it can appear as `BLOCKED` / `browser_offline`. Both are acceptable fail-closed outcomes. It must never report a disconnected browser as ready.

## Reset only the manual Chrome profile

Close the manual Chrome window first, then:

```cmd
rmdir /s /q artifacts\manual-chrome-profile
```

This resets only the isolated manual Chrome profile. It does not delete BODY production state under `%LOCALAPPDATA%\BodyBrain`.

## Manual release acceptance

The real-Chrome portion is accepted only when a human has observed:

1. BODY Extension loaded automatically at Chrome startup.
2. First-start Extension state `READY` with no `browser_offline`.
3. Desktop restart reconnects the same Chrome session.
4. Pairing `tokenHash` is reused across the Desktop restart.
5. Brain remains `NOT_CONFIGURED`.
6. Guardian remains fail-closed and authoritative.
