# Manual Real Chrome Release Test

This acceptance test uses no Puppeteer, CDP automation, scripted clicking, automatic Chrome launch, or automatic Extension installation.

## 1. Prepare release artifacts

From the repository root:

```cmd
git pull origin feat/bodybrain-onefile-release
npm run extension:package
python tools\build_bodybrain_release.py
python tests\bodybrain_exe_smoke.py artifacts\BodyBrain.exe
```

Primary signed packaged Extension:

```text
artifacts\BodyChromeAttach-v0.8.0.crx
```

Signed Extension identity:

```text
Extension ID: lgjlhlfiihfbehgjghpbkmngfpdnclhc
SHA-256: 80aad0d0e86f6676481cdf82cf7173e624c74784384d63ae4763178c4bb06fd2
```

Release ZIP retained for package regression/archive:

```text
artifacts\body-chrome-attach-v0.8.0.zip
```

The private signing key is not stored in the repository or release artifacts.

## 2. Install/load Extension manually

Use the signed `BodyChromeAttach-v0.8.0.crx` as the production packaged Extension where the Chrome deployment policy permits CRX installation. For Developer Mode functional testing, the built runtime remains available under `dist\` and may be loaded manually with **Load unpacked**.

No launcher or browser automation is used.

## 3. First-start BODY check

Keep Chrome with BODY Extension active. In CMD from the repository root, run:

```cmd
artifacts\BodyBrain.exe --check --json --ready-timeout 8
```

Acceptance criteria:

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

Read pairing state again:

```cmd
type "%LOCALAPPDATA%\BodyBrain\body\profiles\.auth\extensions.json"
```

The same Extension entry must retain the same `tokenHash`.

## Manual release acceptance

The real-Chrome portion is accepted only when a human has observed:

1. The intended packaged Extension is `artifacts\BodyChromeAttach-v0.8.0.crx` with the expected Extension ID and SHA-256.
2. First-start Extension state is `READY` with no `browser_offline`.
3. Desktop restart reconnects the same Chrome session.
4. Pairing `tokenHash` is reused across the Desktop restart.
5. Brain remains `NOT_CONFIGURED`.
6. Guardian remains fail-closed and authoritative.
