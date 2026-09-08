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

A user receives exactly two files:

```text
BodyBrain.exe
BodyChromeAttach-v0.8.0-PROTECTED.zip
```

The protected ZIP is extracted and loaded manually through `chrome://extensions/` → **Load unpacked**.

## Repository cleanliness rules

- Do not commit generated binaries, ZIPs, CRXs, signing keys, Base64 binary payload parts, logs, temp extraction files, or build directories.
- `dist/`, `dist_protected/`, `artifacts/`, `.release-build/` and `build/` are generated/ignored outputs only.
- Keep source, tests, build tools and release documentation only when they have an active production purpose.
- No Puppeteer or browser automation in production acceptance.
- Do not create duplicate release manifests for the Extension; the protected ZIP SHA-256 is emitted by the build and CI stores the package artifact.
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
| B | Protected offline Chrome Extension | Protected ZIP only; no source/signing material | DONE |
| C | Desktop Host | Persistent paths, redacted logs, worker lifecycle, clean process-tree shutdown | DONE |
| D | Guardian + BODY runtime lifecycle | Start/restart without stale lock or orphan runtime; fail-closed | HARDENING |
| E | One-file Windows build | `BodyBrain.exe` build + isolated smoke + release hash | DONE |
| F | Real release acceptance | Windows + real Chrome first start/restart/token reuse + final security review | BLOCKED ON D |

## Current blocker: runtime ownership recovery

Real Windows testing exposed a stale runtime ownership failure:

```text
company_runtime_already_running:<stale-or-reused-pid>
```

The runtime lock must not trust PID existence alone because Windows can retain/reuse a PID after the original runtime is no longer valid. Stage D is complete only when runtime ownership uses a bounded lease/heartbeat, stale legacy locks recover safely, active runtimes remain protected from duplicate ownership, and Windows regression tests pass.

## Release acceptance

Stage F becomes PASS only when all of the following are true:

1. `npm run verify` passes on CI.
2. Windows native/Desktop contracts pass.
3. Actual `BodyBrain.exe` isolated smoke passes.
4. Protected Extension loaded in real Chrome reaches `READY`.
5. A second `BodyBrain.exe --check` reconnects cleanly without stale-lock failure.
6. Extension `tokenHash` is reused across Desktop restart.
7. Brain remains `NOT_CONFIGURED` and Guardian remains authoritative/fail-closed.
8. Final release artifact set contains only the two user-facing files plus CI/internal integrity metadata.

Do not merge PR #12 until Stage F is explicitly accepted.