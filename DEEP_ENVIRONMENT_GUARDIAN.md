# Deep Environment Guardian

This integration ports the useful read-only diagnostics from Fingerprint Guard Deep into the existing Company Runtime Environment Guardian. It does not turn the diagnostic extension into a second runtime and it does not add any fingerprint/proxy mutation or evasion path.

## Architecture

```text
EnvironmentGuardian (daemon authority)
  -> ENVIRONMENT_PROBE
       -> Extension environment_probe
            -> basic page environment
            -> read-only proxy observation
            -> public egress observation
            -> Deep Environment Probe
                 -> MAIN realm snapshot
                 -> ISOLATED realm snapshot
                 -> same-origin iframe snapshot
                 -> Worker snapshot
                 -> extension/runtime hardware snapshot
                 -> read-only privacy snapshot
  -> compact deep result
  -> policy evaluation
  -> ACTIVE or QUARANTINED
```

The Daemon remains authoritative for Browser state, Task eligibility and quarantine decisions. BODY/CDP execution is unchanged.

## Deep signals

The deep probe currently evaluates a bounded subset of the uploaded Fingerprint Guard Deep scanner:

- MAIN vs ISOLATED realm consistency for UA/platform/languages/CPU/RAM/webdriver/timezone/screen.
- Same-origin iframe and Worker consistency.
- Repeated Canvas stability and MAIN/ISOLATED consistency.
- Repeated WebGL readPixels stability and renderer/vendor/limit consistency.
- Repeated Audio fingerprint stability and MAIN/ISOLATED consistency.
- Native-function source/native-code integrity checks.
- Navigator property descriptor consistency.
- Known automation/instrumentation global markers and `navigator.webdriver`.
- Runtime OS consistency using `chrome.runtime.getPlatformInfo()`.
- Page CPU/RAM claims vs `chrome.system.cpu` / `chrome.system.memory`.
- Page screen/DPR vs `chrome.system.display`.
- Read-only privacy settings coverage.

The probe intentionally does not implement fingerprint spoofing, anti-bot evasion, proxy/VPN mutation, cookie/history/password inspection, installed-extension enumeration, or raw WebRTC-address persistence.

## Persistence and privacy

Raw deep samples are returned only inside the Extension-side probe execution and are reduced before daemon persistence.

`daemon/state/environment.json` persists only the compact deep result:

```json
{
  "available": true,
  "score": 0,
  "verdict": "LOW",
  "suspected": false,
  "highSuspicion": false,
  "stableHash": "...",
  "coverage": {
    "percent": 100,
    "available": 11,
    "total": 11
  },
  "signalIds": []
}
```

Signal detail strings and raw Canvas/WebGL/Audio samples are not persisted by the Guardian.

## Guardian policy

New policy variables:

```text
BODY_ENV_DEEP_FINGERPRINT_ENABLED=true
BODY_ENV_DEEP_BLOCK_HIGH_SUSPICION=true
BODY_ENV_DEEP_MIN_COVERAGE_PERCENT=50
```

Behavior:

- Deep probe unavailable: recorded as unavailable; it does not independently fail the existing basic environment probe.
- Deep finding below HIGH_SUSPICION: retained as evidence and does not independently quarantine.
- HIGH_SUSPICION with coverage below the configured minimum: retained as evidence and does not independently quarantine.
- HIGH_SUSPICION with sufficient coverage and `BODY_ENV_DEEP_BLOCK_HIGH_SUSPICION=true`: Guardian adds `DEEP_FINGERPRINT_HIGH_SUSPICION`, making the Browser ineligible.

The feature can be disabled without removing permissions:

```text
BODY_ENV_DEEP_FINGERPRINT_ENABLED=false
```

or kept as observation-only:

```text
BODY_ENV_DEEP_BLOCK_HIGH_SUSPICION=false
```

## Chrome permissions added

The Body Chrome Attach manifest adds the following read/observation capabilities required by the deep probe:

```text
scripting
privacy
system.cpu
system.memory
system.display
```

Existing `debugger`, `tabs`, `activeTab`, `storage`, `proxy` and host permissions remain unchanged. The deep-probe module itself has regression checks forbidding proxy/privacy mutation calls and `chrome.debugger` use.

## Execution boundary

Deep Environment Probe is not an actuator. It cannot call BODY, cannot issue CDP commands, cannot switch Tabs, and cannot complete Tasks.

The execution path remains:

```text
Remote/Brain -> Daemon -> Task/Planner -> ExecutionLane -> BODY -> Extension -> Chrome
```

The deep probe participates only in the eligibility gate before Task assignment/execution.

## Verification

Regression contracts:

```text
tests/deep_environment_probe_contract.js
daemon/deep_guardian_contract.js
```

They cover clean vs suspicious scoring, closure-free `chrome.scripting.executeScript` injection, read-only source constraints, required permissions, compact persistence, Browser quarantine for configured high-suspicion results, and observation-only handling for lower-severity findings.
