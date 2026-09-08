# Manual Real Chrome Release Test

This acceptance test uses no Puppeteer, CDP automation, scripted clicking, automatic Chrome launch, or automatic Extension installation.

## 1. Prepare offline protected release artifacts

From the repository root:

```cmd
git pull origin feat/bodybrain-onefile-release
npm install
npm run extension:protected
node tests\protected_extension_contract.js
python tools\build_bodybrain_release.py
python tests\bodybrain_exe_smoke.py artifacts\BodyBrain.exe
```

Offline protected Extension directory for Chrome **Load unpacked**:

```text
dist_protected\
```

Offline package to distribute to users:

```text
artifacts\BodyChromeAttach-v0.8.0-PROTECTED.zip
```

Protection manifest containing source/protected SHA-256 values:

```text
artifacts\BodyChromeAttach-v0.8.0-PROTECTED.json
```

The normal `dist\` directory and `artifacts\body-chrome-attach-v0.8.0.zip` are development/regression outputs and are not the preferred offline user package.

The signed CRX remains available as a release identity artifact where Chrome policy permits CRX installation:

```text
artifacts\BodyChromeAttach-v0.8.0.crx
Extension ID: lgjlhlfiihfbehgjghpbkmngfpdnclhc
SHA-256: 80aad0d0e86f6676481cdf82cf7173e624c74784384d63ae4763178c4bb06fd2
```

The private signing key is not stored in the repository or release artifacts.

## 2. Load the offline protected Extension manually

1. Extract `BodyChromeAttach-v0.8.0-PROTECTED.zip` to a permanent folder, or use the generated `dist_protected\` directory directly.
2. Open normal Chrome manually.
3. Open `chrome://extensions/`.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the protected folder containing `manifest.json` (for a local build this is `dist_protected\`).
7. Verify **Body Chrome Attach 0.8.0** is enabled.
8. Open a normal web page.

Do not give users the repository `src\` tree or the normal `dist\` directory.

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

1. The installed offline Extension came from `dist_protected\` / `BodyChromeAttach-v0.8.0-PROTECTED.zip`.
2. `protected_extension_contract.js` passes before distribution.
3. First-start Extension state is `READY` with no `browser_offline`.
4. Desktop restart reconnects the same Chrome session.
5. Pairing `tokenHash` is reused across the Desktop restart.
6. Brain remains `NOT_CONFIGURED`.
7. Guardian remains fail-closed and authoritative.
