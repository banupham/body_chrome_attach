# BODY Product Roadmap

## Production target

Current production is **BODY only**:

```text
BodyBrain.exe
├── Desktop Host
├── Guardian
└── BODY Core
        ↕ authenticated local channel
Chrome BODY Extension
```

Brain remains a separate R&D track and must report `NOT_CONFIGURED` in production.

## User-facing release

A user receives exactly two distributable files:

```text
BodyBrain.exe
BodyChromeAttach-v0.8.0.zip
```

`BodyChromeAttach-v0.8.0.zip` is already the protected/obfuscated offline build. There is no second normal ZIP, no `-PROTECTED` duplicate name, and no CRX release path.

The user extracts the ZIP to a permanent folder and installs it through `chrome://extensions/` → **Load unpacked**.

## Exact release output policy

After the Windows release build, `artifacts/` must contain exactly:

```text
artifacts/
├── BodyBrain.exe
├── BodyChromeAttach-v0.8.0.zip
└── bodybrain-release-v0.8.0.json
```

Only the first two are user-facing. `bodybrain-release-v0.8.0.json` is internal integrity metadata containing the SHA-256 values and production boundary information.

The release contract fails if any extra file is left in `artifacts/`.

## Repository cleanliness rules

- Never commit generated binaries, ZIPs, CRXs, signing keys, Base64 binary payload parts, logs, temp extraction files, or build directories.
- `dist/`, `artifacts/`, `.release-build/` and `build/` are generated/ignored only.
- `dist/` is an Extension build intermediate and is removed after the protected ZIP is produced.
- `.release-build/` is removed after the Windows EXE build completes.
- There is no `dist_protected/` staging tree.
- There is no separate Extension protection JSON; integrity metadata lives in the single BodyBrain release manifest.
- There is no Puppeteer/browser automation in production acceptance.
- Persistent BODY state belongs only under `%LOCALAPPDATA%\BodyBrain\body`.

## Locked boundaries

- Guardian owns ALLOW/BLOCK and remains fail-closed.
- BODY owns physical implementation, observation, provenance, StepLedger and motor learning.
- Chrome Extension is part of BODY.
- Desktop production status access is read-only; Desktop does not reason about WHAT/WHY/NEXT.
- Human and Agent provenance remain separate.
- Production packaging does not import or bundle Brain modules.

## Delivery stages

| Stage | Scope | Gate | Status |
|---|---|---|---|
| A | BODY Contract + provenance + at-most-once execution | Contract/regression tests | DONE |
| B | Protected offline Chrome Extension | One protected ZIP only; no source/signing material | DONE |
| C | Desktop Host | Persistent paths, redacted logs, worker lifecycle, clean process-tree shutdown | DONE |
| D | Guardian + BODY runtime lifecycle | Start/restart without stale ownership or orphan runtime; fail-closed | HARDENING |
| E | One-file Windows build | `BodyBrain.exe` build + isolated smoke + exact release hashes | DONE |
| F | Real release acceptance | Windows + real Chrome first start/restart/token reuse + final security review | BLOCKED ON D RETEST |

## Current blocker: Windows runtime ownership retest

Real Windows testing exposed a stale runtime ownership failure after a prior worker had been force-stopped. A stale PID can later belong to an unrelated process, so PID existence alone cannot prove ownership.

The current hardening uses the real fixed localhost BODY port as the primary liveness authority before startup, removes stale lock/endpoint state when that port is closed, cleans worker-owned state after forced shutdown, and keeps active port ownership fail-closed.

Stage D is complete only after the updated build passes CI and a real Windows Chrome restart test confirms the second `BodyBrain.exe --check` starts cleanly.

## Release acceptance

Stage F becomes PASS only when all of the following are true:

1. `npm run verify` passes on CI.
2. Windows native/Desktop contracts pass.
3. Actual `BodyBrain.exe` isolated smoke passes.
4. Protected Extension loaded in real Chrome reaches `READY`.
5. A second `BodyBrain.exe --check` reconnects cleanly without stale-runtime failure.
6. Extension `tokenHash` is reused across Desktop restart.
7. Brain remains `NOT_CONFIGURED` and Guardian remains authoritative/fail-closed.
8. `artifacts/` contains exactly `BodyBrain.exe`, `BodyChromeAttach-v0.8.0.zip`, and `bodybrain-release-v0.8.0.json`.

Do not merge PR #12 until Stage F is explicitly accepted.
