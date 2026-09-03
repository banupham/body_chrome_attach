# body_chrome_attach

Local-first **Company Runtime** for Chrome observation, Human-only motor learning, Browser/Task management, read-only Browser environment validation and audited BODY execution.

> Canonical architecture/sequencing: [ROADMAP.md](ROADMAP.md)  
> Brain data producer/consumer contract: [BRAIN_DATA_CONTRACT.md](BRAIN_DATA_CONTRACT.md)

## Product model

One Company may own multiple Devices. By default each Device runs **one Company Runtime application**. The daemon/BODY engine, Local Identity, Browser Manager, Task Manager, Environment Guardian, Data Factory and later Brain are modules of this same application — never one app/daemon per Task, Tab or Chrome.

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

A single Chrome/Browser Instance may have many Tabs performing different legitimate Tasks. Tabs in the same Browser naturally share that Browser's environment/network identity and are **not** treated as duplicate Browsers.

## Current roadmap state

```text
PHASE 1 BODY CORE                                  COMPLETE
PHASE 2 LOCAL IDENTITY                             COMPLETE
PHASE 3 BROWSER + TASK MANAGER / TASKWORKSPACE    COMPLETE
PHASE 4 ENVIRONMENT GUARDIAN / CHROME VALIDATOR   COMPLETE
PHASE 5 SEMANTIC OBSERVATION + RAW EVIDENCE       NEXT
```

## Identity

```text
companyId
 -> deviceId
    -> browserInstanceId
       -> extensionInstanceId
          -> platform/account/channel identity
```

Persistent local files:

```text
daemon/identity/company.json
daemon/identity/device.json
daemon/identity/browsers.json
```

Chrome stores its persistent Browser/Extension identity and paired auth token in `chrome.storage.local`. Existing v5 profiles without `bodyBrowserInstanceId` migrate to `browser-<extensionInstanceId>`.

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

A Browser comes online in `ENV_CHECK`. It cannot receive Task work until the Guardian marks it Environment-eligible.

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

A spam/RESTRICTED Task is rejected without automatically quarantining a healthy Browser.

## Environment Guardian / Chrome Validator

Phase 4 is **read-only and fail-closed**.

Browser flow:

```text
Browser online
 -> ENV_CHECK
 -> read environment evidence
 -> evaluate Company policy
 -> ACTIVE        when eligible
 -> QUARANTINED   when ineligible
```

The Guardian observes per **Browser Instance**, never per Tab. Therefore 10 Tabs in one Chrome still produce one Browser eligibility decision.

Current evidence includes:

```text
browser-visible environment signature (stored as SHA-256 hash)
public egress IP observed through that Chrome
Chrome proxy mode (read-only chrome.proxy.settings.get)
device proxy environment-variable presence
Windows WinINet / WinHTTP proxy presence (read-only query/show commands)
VPN/tunnel interface-name signals
extension/environment probe availability
```

Default Company policy:

```text
BODY_ENV_DIRECT_ONLY=true
BODY_ENV_REQUIRE_UNIQUE_PUBLIC_IP=true
BODY_ENV_REQUIRE_UNIQUE_SIGNATURE=true
BODY_ENV_STRICT_CONSISTENCY=false
BODY_ENV_OBSERVATION_TTL_MS=300000
BODY_PUBLIC_IP_ENDPOINT=https://api.ipify.org?format=json
```

Meaning by default:

- Proxy/VPN/tunnel signals make the Browser ineligible under DIRECT_ONLY.
- Two **different Browser Instances** with the same observed public egress are quarantined while both are online.
- Two different Browser Instances with the same browser-visible environment signature are quarantined while both are online.
- Tabs of the **same Browser Instance** sharing those values are normal.
- If one duplicate Browser goes offline, remaining online Browsers are re-evaluated.

`BODY_PUBLIC_IP_ENDPOINT` must be HTTPS. The request uses `credentials: omit`; only the resulting public IP/provider evidence is stored locally.

Environment state is local at:

```text
daemon/state/environment.json
```

Raw browser environment fields are not persisted; only the signature hash and evidence flags are stored.

### Guardian safety boundary

The Guardian can only:

```text
OBSERVE
DETECT
SCORE/EVALUATE
REPORT
ALLOW
QUARANTINE
```

It has **no** code path to:

```text
set/clear Chrome proxy
change Windows proxy
turn VPN on/off
change route/DNS/IP
spoof/change browser fingerprint
hide proxy/VPN
evade anti-bot/detection systems
```

VPN detection in this MVP is evidence-based/heuristic (for example tunnel interface names), not a claim of perfect VPN classification.

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

require `taskId`. Task Manager resolves Browser/Extension/Tab ownership, and Browser environment eligibility is checked before BODY execution.

The daemon console and `body.cmd` remain diagnostic/test paths, not production Brain control.

## BODY invariants

- Page actions use only `Input.dispatchMouseEvent` and `Input.dispatchKeyEvent`.
- Browser UI actions use the separate Windows `SendInput` path.
- Content scripts observe/read only; no DOM action mutations.
- Only `source=human` may become Human behavior/habit ground truth.
- Agent data is telemetry/evaluation only.
- `delivered`, `observed`, `verified`, `taskSuccess` are separate truths.
- Physical work for one Chrome is serialized through the execution lane.

## Install / verify

```bat
git checkout main
git pull origin main
npm install
npm run verify
```

Load `dist/` from `chrome://extensions`, then start the development entrypoint:

```bat
daemon.cmd
```

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

`npm run verify` checks Body contracts, persistence/auth, Local Identity, Browser/Task ownership and recovery, Task policy, Environment Guardian, read-only environment probes, extension contracts and build. CI also validates the Windows native helper syntax.

## Branch policy

`main` is the working branch. Keep architecture changes synchronized with `ROADMAP.md`; do not accumulate feature branches after integration.
