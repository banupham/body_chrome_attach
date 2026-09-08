# BODY Product Roadmap

## Production target

Current production is **BODY only**:

```text
BodyBrain.exe
├── Desktop Host + Windows tray UI
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

## Windows application UX

Normal `BodyBrain.exe` execution is tray-owned:

- BodyBrain icon stays in the Windows notification area.
- A read-only daemon log window is positioned near the top-right and tails `%LOCALAPPDATA%\BodyBrain\logs\body-runtime.log`.
- Closing the log window with **X** only hides it.
- Left-clicking the tray icon shows/hides the log window.
- The normal user-facing shutdown path is **right-click tray icon → Quit BodyBrain**.
- Quit must stop the Desktop Host and the complete Guardian/BODY worker tree before the process exits.
- `--check` remains an explicit diagnostic mode that reports readiness and exits; it is not the normal application lifecycle.

The tray/log UI is implemented with the Windows API and Python standard library only; no UI dependency or icon asset is added to the release.

## Multi-Chrome learning contract

BODY may have several Chrome profiles/windows connected at the same time.

- Every connected profile keeps its own stable `browserInstanceId` learning scope; Human data from different Browser identities is not silently mixed.
- Recorder/learning events are always routed by the Extension socket that produced them and must never depend on the daemon's interactive `selectedId`.
- The Extension repairs the packaged content script on already-open HTTP/HTTPS tabs, including tabs that existed before **Load unpacked** or an Extension reload.
- Switching Chrome windows updates BODY's logical active tab through the focused-window context instead of leaving the first window's tab selected.
- Human motor events that occur while the local WebSocket is reconnecting are bounded/queued and flushed after reconnect instead of being silently lost.
- Each Extension popup exposes its Browser identity, active tab, and observed Human learning-input event count so multiple Chrome profiles can be verified independently.

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
- Desktop production status access and daemon log display are read-only; Desktop does not reason about WHAT/WHY/NEXT.
- Human and Agent provenance remain separate.
- Production packaging does not import or bundle Brain modules.

## Delivery stages

| Stage | Scope | Gate | Status |
|---|---|---|---|
| A | BODY Contract + provenance + at-most-once execution | Contract/regression tests | DONE |
| B | Protected offline Chrome Extension | One protected ZIP only; no source/signing material | DONE |
| C | Desktop Host + tray UX | Persistent paths, redacted/read-only logs, tray-owned lifecycle, clean process-tree shutdown | IMPLEMENTED |
| D | Guardian + BODY runtime lifecycle | Start/restart without stale ownership or orphan runtime; fail-closed | IMPLEMENTED; MANUAL RETEST PENDING |
| E | One-file Windows build | `BodyBrain.exe` build + isolated smoke + exact release hashes | DONE |
| F | Real release acceptance | Real Chrome + multi-Chrome learning + tray UI + Quit shutdown + restart/token reuse + final security review | MANUAL GATE |

## Verified locally before tray upgrade

The latest user Windows build confirmed:

- clean succeeded without the earlier locked-artifact failure;
- all BODY/daemon/Desktop contracts passed;
- protected Extension contract passed;
- one-file `BodyBrain.exe` build passed;
- isolated EXE smoke passed;
- exact three-file release manifest contract passed.

The previous `EPERM` / stale-port release failure is therefore no longer the active blocker.

## Current manual gate

Automated Windows contracts exercise the native log window/message loop. Explorer notification-area behavior and real Chrome integration still require a human-operated Windows acceptance test.

Stage F becomes PASS only when all of the following are true on the release machine:

1. CI passes BODY, Desktop, tray, Extension and Windows release jobs.
2. Protected Extension loaded manually in real Chrome reaches `READY`.
3. With at least two Chrome profiles/windows connected, each popup shows a distinct Browser identity where appropriate and its `Học` event count increases when the user interacts in that Chrome; changing focus must not leave learning bound to the first Chrome.
4. An already-open web tab survives Extension reload/Load unpacked without requiring a manual page reload for learning/status recovery.
5. Normal `BodyBrain.exe` shows the tray icon and read-only top-right daemon log window.
6. Closing the log window with X hides it while `BodyBrain.exe` and port `43147` remain alive.
7. Right-click tray → **Quit BodyBrain** removes `BodyBrain.exe` and the `127.0.0.1:43147` listener.
8. Starting BodyBrain again reconnects to the same Extensions and preserves their `tokenHash` values.
9. Brain remains `NOT_CONFIGURED` and Guardian remains authoritative/fail-closed.
10. `artifacts/` contains exactly `BodyBrain.exe`, `BodyChromeAttach-v0.8.0.zip`, and `bodybrain-release-v0.8.0.json`.
11. Final diff/security review is accepted.

Do not merge PR #12 until Stage F is explicitly accepted.
