# body_chrome_attach

Chrome MV3 **Generic Body** for visible, auditable browser automation and user-motor learning.

> **Canonical roadmap:** [ROADMAP.md](ROADMAP.md). Major architecture or sequencing changes must be reconciled with that roadmap before implementation so the project does not drift across layers or skip required maturity gates.

## Product direction

`daemon.cmd` is the **Body runtime process**, not the product's primary command interface. It stays alive to receive extension telemetry, learn user behavior, maintain Body state, and execute approved Body plans.

The text prompt shown in the daemon window and `body.cmd` / `body_cli.js` are **diagnostic/test harnesses only**. They exist so the Body can be developed and smoke-tested before the real Brain is connected.

The intended product architecture is one Brain taking over the Body through a structured Brain API. When Brain is attached it holds an exclusive controller lease; mutating CMD/debug commands are rejected so two controllers cannot race the browser. If Brain disconnects, Body continues observing and learning.

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
                         BRAIN
                           |
                  structured Body API
                           |
                     exclusive lease
                           |
                           v
                    Body runtime daemon
                 ws://127.0.0.1:8765
                   (internal transport)
                     /           \
                    /             \
                   v               v
             PAGE intent       BROWSER intent
                   |               |
                   v               v
       CanonicalMotorPlanner   BrowserUiAdapter
                   |               |
                   v               v
          CdpInputGateway    persistent WindowsInputWorker
                   |               |
        dispatchMouseEvent        SendInput
        dispatchKeyEvent            |
                   +-------+---------+
                           |
                       Observation
                           |
                    ObservedEffect
                           |
                          Brain

Extension telemetry -----------------> Body runtime
CMD prompt / body.cmd ----------------> debug/test only
```

The `:8765` socket is an internal local Body transport. It is not treated as the product's main user-facing port or as the Brain itself.

## Brain takeover contract

The control protocol has three roles:

```text
extension     = telemetry + execution bridge
brain         = exclusive structured controller
debug_client  = manual diagnostics/smoke tests
```

Brain does **not** send free-form CMD strings. Its control surface is structured:

```text
BODY_STATUS
EXTENSIONS_LIST
TABS_LIST
INTENT_EXECUTE
STRATEGY_EXECUTE
TAB_SWITCH
BROWSER_COMMAND
```

Body can stream high-level `BODY_EVENT` messages such as tab/extension state changes to the connected Brain.

Only one Brain controller can hold the lease at a time. While Brain is connected:

```text
read-only debug commands  -> allowed
mutating debug commands   -> rejected: brain_controller_active
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

`CanonicalMotorPlanner` rejects browser-only `back`, `forward`, and `reload`; debug aliases for those actions are routed to Browser UI.

The canonical page motor retains learned USER trajectories, deterministic learned-template selection, linear bootstrap, learned typing/scroll timing, and the full Shift/modifier/punctuation encoder.

## Production execution boundary

The extension service worker does not expose direct production write APIs such as `body.executeText` or `body.cdpInput`.

Production control is intended to be:

```text
Brain
  -> structured Body API
  -> Body runtime
  -> page/browser motor
  -> Chrome
```

Read-only runtime surfaces remain available for diagnostics:

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

`verified=true` means an observable effect changed. It does **not** mean the semantic user goal was proven. `taskSuccess` remains `null` unless Brain or another higher semantic layer has sufficient goal context.

## Browser UI

Semantic Browser UI commands include navigation, tab/window control, omnibox/find, downloads/history/devtools, fullscreen/bookmark, and zoom controls. Browser input is delivered through one persistent Python worker per daemon process rather than spawning Python for every step. Text is sent over worker stdin JSONL and is not echoed in execution results.

## Local authentication

Loopback binding is not treated as authorization.

Daemon creates separate credentials:

```text
daemon/profiles/.auth/brain.token   -> Brain controller
daemon/profiles/.auth/client.token  -> debug client only
```

`body_cli.js` reads the debug token automatically. `BODY_DEBUG_TOKEN` can override it for development.

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

Load `dist/` from `chrome://extensions`, then start the Body runtime:

```bat
daemon.cmd
```

For manual development testing only, either type commands in that daemon window or use:

```bat
body.cmd "status"
body.cmd "click 400 250 120 40 button"
body.cmd "browsernewtab"
```

When Brain is attached, write/test commands above are intentionally blocked; read-only diagnostics such as `status`, `extensions`, `tabs`, `dataset`, and `model` remain available.

`npm run verify` checks the canonical planner, CDP allowlist/failure rollback, DOM read-only contract, recorder optimization, page ObservedEffect, per-site/HUMAN-only learning, linear bootstrap, keyboard encoding, buffered persistence/backpressure, local auth, exclusive Brain controller lease, semantic Browser UI, and extension build. CI also checks Python helper syntax.

## Deferred intentionally

- Real Brain implementation / planner is external to this Body repository.
- Windows global low-level input observer and browser-level human habit learning.
- iframe-aware recorder/coordinate transforms.
- Optional empirical trajectory sampling mode.
- macOS/Linux native Browser UI backends.

## Branch policy

`main` is the working branch. Do not accumulate feature branches after changes have been integrated.
