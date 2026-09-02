# body_chrome_attach

Chrome MV3 **Generic Body** for visible, auditable browser automation and user-motor learning.

## Core invariants

- Page actions are **HUMAN_MOTOR** only: `Input.dispatchMouseEvent` and `Input.dispatchKeyEvent`.
- Chrome browser UI actions are separate **BROWSER_UI** actions backed by Windows `SendInput`.
- Content scripts are **READ / OBSERVE only**. DOM JavaScript actions/mutations are forbidden.
- Only `source=human` is behavior/habit ground truth; agent events are telemetry/evaluation only.
- Site learning is scoped by `extensionInstanceId + siteKey` with same-extension `__global__` fallback only.
- No synthetic human-looking bootstrap. With no learned trajectory, mouse movement is linear.
- `delivered`, `observedEffect`, `verified`, and `taskSuccess` are different concepts.

## Architecture

```text
Brain / CMD / Socket
        |
        v
 authenticated daemon :8765
        |
        +--------------------------+
        |                          |
        v                          v
PAGE intent                    BROWSER intent
        |                          |
        v                          v
CanonicalMotorPlanner          BrowserUiAdapter
        |                          |
        v                          v
CdpInputGateway               persistent WindowsInputWorker
        |                          |
 dispatchMouseEvent              SendInput
 dispatchKeyEvent                  |
        +------------+-------------+
                     |
                 Observation
                     |
              ObservedEffect
                     |
                 Brain/Verifier
```

## Canonical page motor

The old duplicate planner/executor path is removed from production. The shared page motor is:

```text
src/page_motor_core.js
        ^
src/canonical_motor_planner.js
        ^
daemon/src/motor_planner.js   (re-export only)
```

`CanonicalMotorPlanner` rejects browser-only `back`, `forward`, and `reload`; CMD aliases for those actions are routed to Browser UI.

The canonical page motor retains learned USER trajectories, deterministic learned-template selection, linear bootstrap, learned typing/scroll timing, and the full Shift/modifier/punctuation encoder.

## Daemon-only production writes

The extension service worker no longer exposes `body.executeText` or `body.cdpInput`. Production actions go through `body.cmd` / `body_cli.js` -> `ws://127.0.0.1:8765` -> daemon.

Read-only runtime surfaces remain:

```text
body.profile
body.virtualCursorStatus
body.getObservedUserMotor
```

## Recorder performance

- `mousemove` no longer performs a DOM target-context lookup.
- Target context is enriched at `mousedown` / `mouseup` and keyboard boundaries.
- Dataset rows are buffered in RAM and written asynchronously in batches (default 100 rows or about 300 ms).
- Under buffer pressure, coalescible mousemove rows may be replaced while boundary/key events remain queued.
- Rebuild and shutdown paths flush pending rows before reading/exiting.

## ObservedEffect

Page HUMAN_MOTOR execution captures read-only state before and after a plan. Effects can report navigation, active-target, scroll, focus, and visibility changes.

`verified=true` means an observable effect changed. It does **not** mean the semantic user goal was proven. `taskSuccess` remains `null` unless a higher layer has sufficient goal context.

## Browser UI

Semantic Browser UI commands include navigation, tab/window control, omnibox/find, downloads/history/devtools, fullscreen/bookmark, and zoom controls. Browser input is delivered through one persistent Python worker per daemon process rather than spawning Python for every step. Text is sent over worker stdin JSONL and is not echoed in execution results.

## Local authentication

Loopback binding is not treated as authorization.

On daemon start a 256-bit client token is stored at:

```text
daemon/profiles/.auth/client.token
```

`body_cli.js` reads it automatically. External clients may set `BODY_DAEMON_TOKEN`.

Extension authentication uses trust-on-first-use pairing bound to `extensionInstanceId + runtimeExtensionId`. The paired token is stored in `chrome.storage.local`; daemon pairing metadata stores only its hash.

## Visible cursor and provenance

The existing audit cursor remains: USER, CDP, DOWN/UP, WHEEL, KEY, and CDP ERROR. CDP pending provenance is rolled back on dispatch failure. Browser UI tab changes are also marked agent-origin so they cannot become HUMAN tab-habit ground truth.

## Install / verify

```bat
git checkout main
git pull origin main
npm install
npm run verify
```

Load `dist/` from `chrome://extensions`, then:

```bat
daemon.cmd
body.cmd "status"
body.cmd "click 400 250 120 40 button"
body.cmd "type 400 250 hello world"
body.cmd "browsernewtab"
body.cmd "browseraddress https://example.com"
```

`npm run verify` checks the canonical planner, CDP allowlist/failure rollback, daemon-only production path, DOM read-only contract, recorder optimization, page ObservedEffect, per-site/HUMAN-only learning, linear bootstrap, keyboard encoding, buffered persistence/backpressure, local auth, semantic Browser UI, and extension build. CI also checks Python helper syntax.

## Deferred intentionally

- Windows global low-level input observer and browser-level human habit learning.
- iframe-aware recorder/coordinate transforms.
- Optional empirical trajectory sampling mode.
- macOS/Linux native Browser UI backends.

## Branch policy

`main` is the working branch. Do not accumulate feature branches after changes have been integrated.
