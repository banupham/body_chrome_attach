# BodyBrain / Body Chrome Attach

Local-first BODY product for Chrome observation, Guardian-gated execution and Human-derived motor learning.

## Production product

```text
BodyBrain.exe
├── Desktop Host
├── Guardian
└── BODY Core
        ↕ authenticated localhost channel
Chrome BODY Extension
```

Production Brain is **not configured**. Brain code in this repository remains a separate R&D track and is not imported or bundled into the production executable.

Canonical production release plan: [ROADMAP_BODYBRAIN.md](ROADMAP_BODYBRAIN.md)  
Manual real-Chrome acceptance: [MANUAL_RELEASE_TEST.md](MANUAL_RELEASE_TEST.md)  
Extension release boundary: [EXTENSION_RELEASE.md](EXTENSION_RELEASE.md)  
BODY physical contract: [BODY_CONTRACT.md](BODY_CONTRACT.md)

## Release boundary

A release exposes exactly two user-facing files:

```text
BodyBrain.exe
BodyChromeAttach-v0.8.0.zip
```

`BodyChromeAttach-v0.8.0.zip` is already the protected/obfuscated offline Manifest V3 Extension. It is the only Extension distributable.

The internal Windows release directory is contractually limited to:

```text
artifacts/
├── BodyBrain.exe
├── BodyChromeAttach-v0.8.0.zip
└── bodybrain-release-v0.8.0.json
```

The JSON file is internal integrity metadata containing release hashes and production boundary information.

There is no production CRX path, no Base64 CRX payload, no second unprotected ZIP, no `-PROTECTED` duplicate, no protection JSON, and no `dist_protected/` staging tree.

## Clean build

From the repository root:

```cmd
git fetch origin
git checkout feat/bodybrain-onefile-release
git pull --ff-only origin feat/bodybrain-onefile-release
npm install
npm run clean
npm run verify
npm run extension:protected:test
python -m pip install -r requirements-release.txt
python tools\build_bodybrain_release.py
```

`npm run clean` removes current and legacy generated release directories. Generated output, dependency directories, logs, signing keys and temporary PyInstaller files are not committed.

## Offline Extension installation

Extract:

```text
artifacts\BodyChromeAttach-v0.8.0.zip
```

to a permanent folder. In Chrome:

```text
chrome://extensions/
→ Developer mode
→ Load unpacked
→ select the extracted folder containing manifest.json
```

No Puppeteer, scripted clicking, automatic Chrome launch or automatic Extension installation is part of production acceptance.

## Real Chrome check

Keep normal Chrome open with the protected Extension enabled, then run:

```cmd
artifacts\BodyBrain.exe --check --json --ready-timeout 8
```

A healthy connected release reports:

```text
product = BodyBrain
desktop = RUNNING
bodyRuntime = CONNECTED
brain = NOT_CONFIGURED
health.extensionConnectivity.state = READY
```

No browser may report `browser_offline`.

Run the same check a second time while Chrome remains open. The second start must recover cleanly without stale runtime ownership and the Extension pairing `tokenHash` must be reused.

## Runtime ownership

The production Desktop Host owns the fixed localhost BODY bootstrap port defined in `config/bodybrain-runtime.json`.

Before spawning BODY it treats the actual localhost port as the liveness authority. When the port is closed, stale `runtime.lock` and `runtime-endpoint.json` state from a force-stopped process is recovered. This prevents a reused Windows PID from permanently blocking a later BodyBrain start. When the port is genuinely active, startup remains fail-closed.

Persistent product state lives under:

```text
%LOCALAPPDATA%\BodyBrain\body
```

Persistent logs live under:

```text
%LOCALAPPDATA%\BodyBrain\logs
```

## Locked production invariants

- Guardian owns ALLOW/BLOCK and remains fail-closed.
- BODY owns physical execution, observation, provenance, StepLedger and motor learning.
- Human and Agent provenance remain separate.
- Desktop production status access is read-only.
- Production packaging does not import or bundle Brain modules.
- Chrome BODY Extension is part of BODY.
- Content scripts observe/read; physical page actions follow the BODY contract.
- Generated release files are never committed to the source tree.

## Development / R&D

Broader architecture documents and Brain modules remain in the repository for research and regression compatibility. They are not production release artifacts. Do not infer production Brain enablement from the presence of the `brain/` source directory.