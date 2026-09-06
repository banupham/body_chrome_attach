# body_chrome_attach

Local-first **Company Runtime** for Chrome observation, Human-only motor learning, Browser/Task management, read-only Browser environment validation and audited BODY execution.

> Canonical architecture/sequencing: [ROADMAP.md](ROADMAP.md)  
> Brain data producer/consumer contract: [BRAIN_DATA_CONTRACT.md](BRAIN_DATA_CONTRACT.md)

## Product model

One Company may own multiple Devices. By default each Device runs **one Company Runtime application**. The daemon/BODY engine, Local Identity, Browser Manager, Task Manager, Environment Guardian, Data Factory and Brain-facing control plane are modules of this same application — never one daemon per Task, Tab or Chrome.

```text
Company
  -> Device
       -> ONE Company Runtime
            -> Local Identity
            -> Browser Manager
            -> Task Manager / TaskWorkspace
            -> Environment Guardian / Chrome Validator
            -> Daemon / BODY
                 -> 1..N Browser Instances
                      -> 1..N Tabs / Tasks
```

A single Chrome/Browser Instance may have many Tabs performing different legitimate Tasks. Tabs in the same Browser naturally share that Browser's environment/network identity and are not treated as duplicate Browsers.

## Foundation hardening state

The five foundation-hardening items on `feat/main-foundation-hardening` are implemented: Browser BUSY lifecycle, automatic local Extension authentication, debug routing + Browser UI fast path, Browser-scoped learning identity, and semantic observation + Evidence Store.

## Identity

```text
companyId
 -> deviceId
    -> browserInstanceId
       -> extensionInstanceId
          -> platform/account/channel identity
```

Persistent local identity files:

```text
daemon/identity/company.json
daemon/identity/device.json
daemon/identity/browsers.json
```

Chrome stores its persistent Browser/Extension identity and daemon auth token in `chrome.storage.local`. Persistent learning is scoped by `browserInstanceId`; Extension IDs remain transport provenance.

## Automatic Extension authentication

Manual pairing codes are removed. There is no `pair open` flow and no code entry in the Extension popup.

```text
Extension starts
 -> discovers current local daemon endpoint
 -> connects from chrome-extension://<runtimeExtensionId>
 -> daemon validates extensionInstanceId + browserInstanceId + runtimeExtensionId + Origin
 -> daemon automatically issues a persistent random token on first valid connection
 -> Extension stores the token in chrome.storage.local
 -> reconnect reuses the token
```

If the local token is missing or stale while the full stored binding still matches, the daemon rotates the token automatically. Runtime-ID, Browser-ID or Origin mismatches remain fail-closed.

Local maintenance commands:

```text
pair status
pair list
pair forget <extensionInstanceId>
```

`pair forget` revokes the current credential and disconnects the live socket. A later valid reconnect automatically receives a new token.

## Automatic daemon port discovery

The daemon does **not** use a hard-coded WebSocket port.

At startup it binds:

```text
127.0.0.1:0
```

The operating system selects an available TCP port. The daemon publishes the selected localhost endpoint to:

```text
daemon/state/runtime-endpoint.json
dist/runtime-endpoint.json
```

`body.cmd` reads the daemon state endpoint automatically. The Extension reads its own `dist/runtime-endpoint.json` resource and re-resolves it on reconnect, so a daemon restart may use a different port without manual configuration.

Only `127.0.0.1` is accepted. Runtime endpoint ownership is tied to the daemon PID so a second live Company Runtime cannot silently replace the first runtime's endpoint, and an old process cannot clear a newer runtime's endpoint.

## Browser Manager

`BrowserManager` is daemon-side authoritative state keyed by `browserInstanceId`; `ExtensionRegistry` is connection/transport state only.

```text
REGISTERED
OFFLINE
ENV_CHECK
ACTIVE
BUSY
HUMAN_CONTROL
QUARANTINED
ERROR
```

A Browser comes online in `ENV_CHECK`. It cannot receive Task work until the Guardian marks it Environment-eligible. Physical work remains BUSY from first enqueue through final queued completion.

## Task Manager / TaskWorkspace

```text
Task
 -> TaskWorkspace
      -> browserInstanceId
      -> primaryTabId
      -> tabIds [1..N]
```

Rules:

- One Tab belongs to at most one active TaskWorkspace.
- One Task may own multiple Tabs.
- One Browser may host many Tasks on different Tabs.
- A Task cannot escape its assigned Browser/Tabs.
- Missing owned Tabs after reconnect fail the Task rather than moving it elsewhere.
- A Task that was RUNNING when daemon restarts becomes `RECOVERY_REQUIRED`.

Task state is local at `daemon/state/tasks.json`.

## Task policy

Browser eligibility and Task eligibility are separate gates.

```text
SAFE_AUTO
  discovery, navigation, review/classification, metadata, internal analysis

HUMAN_APPROVED
  external interaction or unknown/unproven work requiring explicit approval

RESTRICTED
  spam, repetitive unsolicited interaction, fake engagement,
  metric manipulation, detector evasion, fingerprint manipulation,
  proxy/VPN concealment
```

A RESTRICTED Task is rejected without automatically quarantining a healthy Browser.

## Environment Guardian / Chrome Validator

The Guardian is read-only and fail-closed.

```text
Browser online
 -> ENV_CHECK
 -> read environment evidence
 -> evaluate Company policy
 -> ACTIVE        when eligible
 -> QUARANTINED   when ineligible
```

Current evidence includes browser-visible environment signature hash, public egress IP, read-only Chrome proxy mode, device proxy signals, Windows WinINet/WinHTTP proxy presence, VPN/tunnel interface-name signals, and probe availability.

Default policy:

```text
BODY_ENV_DIRECT_ONLY=true
BODY_ENV_REQUIRE_UNIQUE_PUBLIC_IP=true
BODY_ENV_REQUIRE_UNIQUE_SIGNATURE=true
BODY_ENV_STRICT_CONSISTENCY=false
BODY_ENV_OBSERVATION_TTL_MS=300000
BODY_PUBLIC_IP_ENDPOINT=https://api.ipify.org?format=json
```

The Guardian can observe, detect, evaluate, report, allow and quarantine. It does not set proxy/VPN/network identity, spoof browser identity or evade detection systems.

## Semantic observation and Evidence Store

The YouTube semantic observer is read-only. The current MVP can form conservative `youtube.search` Human evidence without storing the actual query text, account identity or arbitrary page text.

Evidence is stored separately from learning data:

```text
evidence/by-browser/<browserInstanceId>/<siteKey>/evidence.jsonl
```

Records preserve Browser identity plus Extension transport provenance and use an append-only SHA-256 hash chain. Evidence is not silently promoted to `taskSuccess` and is not silently inserted into Human motor training data.

## Brain control protocol

Production Brain control protocol is **v7**. Extension transport remains compatible with extension protocols v5/v6.

Brain can query:

```text
BODY_STATUS
EXTENSIONS_LIST
BROWSERS_LIST
TABS_LIST
TASKS_LIST
TASK_GET
ENVIRONMENT_STATUS
```

Manager actions include:

```text
TASK_CREATE / APPROVE / START / COMPLETE / FAIL / CANCEL
ENVIRONMENT_PROBE
ENVIRONMENT_PROBE_ALL
```

Physical actions:

```text
INTENT_EXECUTE
STRATEGY_EXECUTE
TAB_SWITCH
BROWSER_COMMAND
```

require `taskId`. Task Manager resolves Browser/Extension/Tab ownership and Browser environment eligibility before BODY execution.

The daemon console and `body.cmd` remain diagnostic/test paths, not production Brain control.

## BODY invariants

- Page actions use only `Input.dispatchMouseEvent` and `Input.dispatchKeyEvent`.
- Browser UI actions are separate from page HUMAN_MOTOR execution.
- Content scripts observe/read only; no DOM action mutations.
- Only `source=human` may become Human behavior/habit ground truth.
- Agent data is telemetry/evaluation only.
- `delivered`, `observed`, `verified`, `taskSuccess` are separate truths.
- Physical work for one Chrome is serialized through the execution lane.

## Install / verify

```bat
git fetch origin
git switch feat/main-foundation-hardening
git pull --ff-only origin feat/main-foundation-hardening
npm install
npm run verify
npm run build
```

Load `dist/` from `chrome://extensions`, then start:

```bat
daemon.cmd
```

No port or pairing-code configuration is required. The daemon prints the OS-assigned localhost WebSocket endpoint after startup.

Useful read-only debug commands:

```bat
body.cmd "status"
body.cmd "identity"
body.cmd "browsers"
body.cmd "environment"
body.cmd "tasks"
body.cmd "taskowners"
```

Manual Guardian checks:

```bat
body.cmd "envprobe <browserInstanceId>"
body.cmd "envprobeall"
```

`npm run verify` checks BODY contracts, persistence/auth, Local Identity, Browser/Task ownership and recovery, Task policy, Environment Guardian, endpoint discovery, Extension contracts, build and Windows native-input ABI.

## Branch policy

`main` remains unchanged until an explicit merge decision. Architecture changes on the hardening branch should stay synchronized with the roadmap and review documents.
