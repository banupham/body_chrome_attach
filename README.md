# body_chrome_attach

Local-first **Company Runtime** for Chrome observation, Human-only motor learning, Browser/Task management and audited BODY execution.

> Architecture/sequencing: [ROADMAP.md](ROADMAP.md)  
> Brain data producer/consumer contract: [BRAIN_DATA_CONTRACT.md](BRAIN_DATA_CONTRACT.md)

## Product model

One Company may own multiple Devices. By default, each Device runs **one Company Runtime application**. The daemon/BODY engine, Browser Manager, Task Manager, Chrome validation, Data Factory and later Brain are modules of that same application — not separate applications per Task/Tab/Chrome.

```text
Company
  -> Device
       -> Company Runtime
            -> Local Identity
            -> Browser Manager
            -> Task Manager / TaskWorkspace
            -> later Environment Guardian
            -> Daemon / BODY
                 -> 1..N Browser Instances
                      -> 1..N Tabs / Tasks
```

A single Chrome/Browser Instance may have many Tabs performing different legitimate Tasks. Tabs in the same Browser sharing browser/network environment is normal.

## Current roadmap state

```text
PHASE 1 BODY CORE                              COMPLETE
PHASE 2 LOCAL IDENTITY                         COMPLETE
PHASE 3 BROWSER + TASK MANAGER / TASKWORKSPACE COMPLETE
PHASE 4 ENVIRONMENT GUARDIAN / CHROME VALIDATOR NEXT
```

## Identity

Persistent local identity chain:

```text
companyId
 -> deviceId
    -> browserInstanceId
       -> extensionInstanceId
          -> platform/account/channel identity
```

Runtime identity files are local and git-ignored:

```text
daemon/identity/company.json
daemon/identity/device.json
daemon/identity/browsers.json
```

Chrome stores `bodyBrowserInstanceId`, `bodyDaemonExtensionInstanceId` and its paired auth token in `chrome.storage.local`. Existing v5 profiles without `bodyBrowserInstanceId` migrate to `browser-<extensionInstanceId>` so learned profile data is not silently detached.

## Browser Manager

`BrowserManager` is daemon-side authoritative Browser state keyed by `browserInstanceId`. `ExtensionRegistry` remains transport/connection state only.

Browser states:

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

Environment eligibility is intentionally `PENDING_PHASE4` until the Guardian is implemented.

## Task Manager / TaskWorkspace

A Task owns a workspace, not an application:

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
- Task execution cannot escape its assigned Browser or Tabs.
- If a reconnect no longer contains an owned Tab, the Task fails instead of executing on another Tab.
- A Task that was `RUNNING` when the daemon restarts becomes `RECOVERY_REQUIRED`; execution cannot resume blindly.

Task state is persisted locally under `daemon/state/tasks.json`.

## Task policy

Browser eligibility and Task policy are separate gates.

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

A RESTRICTED/spam Task is rejected without automatically quarantining an otherwise healthy Browser.

## Brain control protocol

Production Brain control protocol is **v7**. Extension transport remains compatible with extension protocols v5/v6.

Brain queries include:

```text
BODY_STATUS
EXTENSIONS_LIST
BROWSERS_LIST
TABS_LIST
TASKS_LIST
TASK_GET
```

Task lifecycle actions include:

```text
TASK_CREATE
TASK_APPROVE
TASK_START
TASK_COMPLETE
TASK_FAIL
TASK_CANCEL
```

Physical Brain actions:

```text
INTENT_EXECUTE
STRATEGY_EXECUTE
TAB_SWITCH
BROWSER_COMMAND
```

require `taskId`. Task Manager resolves Browser/Extension/Tab ownership before BODY runs. Brain cannot use the production structured socket to bypass TaskWorkspace ownership.

The daemon console, `body.cmd`, and `body_cli.js` remain diagnostic/test tools and may exercise low-level BODY directly while no Brain holds the exclusive controller lease.

## BODY invariants

- Page actions use only `Input.dispatchMouseEvent` and `Input.dispatchKeyEvent`.
- Browser UI actions use the separate Windows `SendInput` path.
- Content scripts are READ/OBSERVE only; no DOM click/focus/value/dispatch/navigation mutations.
- Only `source=human` may become Human behavior/habit ground truth.
- Agent events remain telemetry/evaluation only.
- `delivered`, `observed`, `verified`, and `taskSuccess` remain separate truths.
- Physical work for the same Chrome is serialized through the execution lane.

## Environment Guardian boundary

Phase 4 will observe Browser/device health, environment consistency, public egress/network identity and proxy/VPN/tunnel signals according to Company policy, then ALLOW or QUARANTINE a Browser.

It may verify/report/quarantine only. It must not spoof browser fingerprint, conceal proxy/VPN, rotate IP/identity to evade checks, modify DNS/routes to bypass policy, or interfere with detection systems.

## Install / verify

```bat
git checkout main
git pull origin main
npm install
npm run verify
```

Load `dist/` from `chrome://extensions`, then start the local Company Runtime development entrypoint:

```bat
daemon.cmd
```

Useful read-only debug commands:

```bat
body.cmd "status"
body.cmd "identity"
body.cmd "browsers"
body.cmd "tasks"
body.cmd "taskowners"
```

Example debug Task creation after a Browser is connected:

```bat
body.cmd "taskcreate {\"taskId\":\"demo\",\"capability\":\"youtube.search\",\"browserInstanceId\":\"browser-id\",\"primaryTabId\":123,\"tabIds\":[123]}"
```

`npm run verify` runs syntax checks, Body contracts, persistence/auth contracts, Local Identity contracts, Browser/Task/TaskWorkspace policy and recovery contracts, extension contracts and the production build. CI also validates the Windows native helper syntax.

## Branch policy

`main` is the working branch. Keep architecture changes synchronized with `ROADMAP.md`; do not accumulate feature branches after integration.
