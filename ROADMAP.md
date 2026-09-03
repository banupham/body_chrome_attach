# PRODUCT ROADMAP — Distributed Agent Company Network

> **Canonical architecture and sequencing reference.** A Phase is a module boundary inside the product, not a separate end-user application. Update/review this file before changing architecture.

## 0. Mission

Build a local-first distributed agent system in which each Company owns 1..N Devices. Each Device runs one **Company Runtime application** by default. That one application validates/manages Chrome resources, hosts daemon/BODY, manages many Tasks, learns locally, and later hosts Data Factory / Offline Analyst / Director Brain modules.

YouTube is the first reference platform. Do not expand platforms until the YouTube path works end-to-end.

```text
RAW HUMAN/BROWSER EVIDENCE
        -> Data Factory
        -> Brain-Ready Semantic Memory
        -> Director Brain

RAW DATA != BRAIN INPUT
```

## 1. Local Application Invariant

```text
Company
  -> 1..N Devices
       -> ONE Company Runtime application per Device by default
            -> Local Identity
            -> Browser Manager
            -> Task Manager / TaskWorkspace
            -> Environment Guardian / Chrome Validator
            -> Daemon / BODY Runtime
            -> Data Factory
            -> later Offline Analyst + Director Brain
```

Do **not** create one application or daemon per Task, Tab, Browser or Chrome profile.

One Company Runtime may manage 1..N Browser Instances, 1..N Tabs per Browser and 1..N Tasks. A single Browser with multiple Tabs performing different legitimate Tasks is valid.

## 2. Responsibility Boundaries

### Human

```text
Human Authority > Brain Authority > BODY
```

Human is the highest local authority.

### Company Runtime Application

Operational container for daemon/BODY, Identity, Browser Manager, Task Manager, Guardian, Data Factory, UI and later Brain.

### Central

Owns network registry, presence, policy, high-level goals/task routing and summaries. It does not directly execute mouse, keyboard, scroll, DOM interaction, browser navigation or raw motor replay. Raw private text, passwords, cookies, session tokens, raw Human trajectories and complete personality models stay local.

### Browser Manager

Daemon-side authoritative Browser/Tab coordinator keyed by `browserInstanceId`. Extension is an Adapter/transport, not the Manager.

### Task Manager

Owns Task lifecycle, TaskWorkspace, Task policy, Task -> Browser/Tab ownership and recovery state. Task validity is separate from Browser validity.

### Environment Guardian / Chrome Validator

Observes Browser/device/environment/network evidence and decides Browser eligibility. It may OBSERVE, DETECT, SCORE/EVALUATE, REPORT, ALLOW and QUARANTINE. It must never spoof fingerprint, conceal proxy/VPN, rotate IP/identity for evasion, alter DNS/routes to bypass policy, or interfere with detection systems.

### BODY

Physical execution only. BODY has no high-level goal/personality. Page motor is CDP HUMAN_MOTOR; Browser UI uses the separate native input path.

### Data Factory / Offline Analyst / Director Brain

Data Factory compiles evidence. Offline Analyst is data-analysis only and has zero BODY authority. Director Brain consumes Brain-ready semantic packs rather than raw input timelines.

## 3. Identity Model

```text
companyId
  -> deviceId
       -> browserInstanceId
            -> extensionInstanceId
                 -> platform/account/channel identity
```

Rules:

```text
companyId != deviceId
BrowserInstance != Task
Tab != Task
```

- One Company may have multiple Devices.
- One Device/application may manage multiple Browser Instances.
- One Browser may have many Tabs and Tasks.
- Tabs inside one Browser naturally share that Browser's environment/network identity. This is not a duplicate Browser condition.
- Platform/account/channel identity stays separate from Browser identity.

## 4. Browser Eligibility vs Task Eligibility

These are independent gates.

### Browser/environment gate

Evidence may include persistent Browser identity, extension authentication/binding, runtime health, browser-visible environment signature, public egress/network identity, Chrome/system proxy signals and VPN/tunnel signals.

```text
Browser online -> ENV_CHECK -> ACTIVE or QUARANTINED
```

Ineligible Browser cannot receive autonomous work.

### Task policy gate

```text
SAFE_AUTO
  discovery
  open/navigation
  review/classification
  collect metadata
  internal analysis

HUMAN_APPROVED
  external interaction requiring explicit owner approval
  unknown/unproven task requiring approval

RESTRICTED
  spam
  repetitive unsolicited interaction
  fake/coordinated engagement
  metric manipulation
  pretending independent accounts are unrelated humans
  detector/anti-bot evasion
  fingerprint manipulation
  proxy/VPN concealment
```

```text
Browser ELIGIBLE + Task SAFE_AUTO       -> may execute
Browser ELIGIBLE + Task HUMAN_APPROVED  -> wait for approval
Browser ELIGIBLE + Task RESTRICTED      -> reject Task; Browser may remain healthy
Browser INELIGIBLE                      -> no autonomous Task executes
```

Spam is a **Task-policy failure**, not proof that Browser itself is invalid.

## 5. TaskWorkspace Model

```text
Task
  -> TaskWorkspace
       -> browserInstanceId
       -> primaryTabId
       -> tabIds [1..N]
```

Permanent invariants:

```text
one Tab -> at most one active TaskWorkspace
one TaskWorkspace -> may own multiple Tabs
one Browser -> may host multiple TaskWorkspaces on different Tabs
```

Physical BODY actions are arbitrated/serialized.

## 6. Human vs Agent / Model Separation

```text
source=human -> may become Human ground truth
source=agent -> telemetry/evaluation/verification only
```

Knowledge, Habit, Motor and Evidence remain separate. Brain does not contain low-level motor generation. BODY does not contain Personality. Inference never overwrites fact. Model confidence never directly unlocks autonomy.

## 7. YouTube-First Capability Framework

```text
youtube.search
youtube.open_video
youtube.open_channel
youtube.navigation
youtube.back
youtube.tab_switch
youtube.content_discovery
youtube.content_review
youtube.collect_metadata
```

Use YouTube to prove Task ownership, Browser eligibility, evidence, Brain-ready memory, reasoning, BODY execution and Human override before adding platforms.

# 8. Development Roadmap

## PHASE 1 — BODY CORE

**Status: COMPLETE.**

Implemented: canonical HUMAN_MOTOR planner, strict CDP allowlist, separate BROWSER_UI path, persistent Windows native worker, Human/Agent provenance, resilient persistence, exclusive Brain lease, execution lanes and separate `delivered / observed / verified / taskSuccess` truth.

Gate A: PASSED.

---

## PHASE 2 — LOCAL IDENTITY

**Status: COMPLETE (v0.5.0).**

Implemented `companyId`, `deviceId`, `browserInstanceId`, `extensionInstanceId`, `runtimeExtensionId`, persistent identity files, Browser-Extension binding, platform identity namespace, and identity propagation into status/events/execution.

```text
daemon/identity/company.json
daemon/identity/device.json
daemon/identity/browsers.json
```

Gate B: PASSED.

---

## PHASE 3 — BROWSER MANAGER + TASK MANAGER + TASK WORKSPACE

**Status: COMPLETE (v0.6.0).**

Implemented BrowserManager keyed by `browserInstanceId`, persistent TaskManager, TaskWorkspace ownership, one-Tab/max-one-active-Task invariant, multi-Tab Task, multi-Task Browser, Task Policy Gate, reconnect reconciliation, `RECOVERY_REQUIRED`, and Brain protocol v7 requiring `taskId` for physical execution.

Gate C: PASSED.

---

## PHASE 4 — ENVIRONMENT GUARDIAN / CHROME VALIDATOR MVP

**Status: COMPLETE (v0.7.0).**

Goal: decide whether each Browser Instance is eligible before Task assignment/BODY execution.

Implemented read-only evidence:

```text
browser-visible environment signature -> persisted as SHA-256 hash only
public egress IP observed through each Browser
Chrome proxy mode via chrome.proxy.settings.get
proxy environment-variable presence
Windows WinINet / WinHTTP proxy presence via read-only query/show commands
VPN/tunnel interface-name signals
extension/environment probe availability
Browser-level quarantine and re-evaluation
```

Default policy:

```text
DIRECT_ONLY = true
REQUIRE_UNIQUE_PUBLIC_IP = true
REQUIRE_UNIQUE_ENVIRONMENT_SIGNATURE = true
STRICT_SAME_BROWSER_CONSISTENCY = false
OBSERVATION_TTL = 5 minutes
```

Rules:

- Validation is Browser-scoped, never Tab-scoped.
- Same Browser's Tabs sharing IP/environment is expected and valid.
- Different online Browser Instances sharing public egress are ineligible under default uniqueness policy.
- Different online Browser Instances sharing browser-visible environment signature are ineligible under default uniqueness policy.
- Under DIRECT_ONLY, detected Browser/system proxy or VPN/tunnel evidence makes Browser ineligible.
- Guardian fails closed while evidence is unavailable/stale.
- Browser starts `ENV_CHECK`; only eligible Browser becomes `ACTIVE`; failures become `QUARANTINED`.
- Taking one duplicate Browser offline re-evaluates remaining Browsers.
- Guardian refuses live re-probe while Browser is `BUSY`.
- Raw browser environment fields are not persisted; signature hash + evidence flags remain local.
- Public-IP endpoint must be HTTPS and is configurable with `BODY_PUBLIC_IP_ENDPOINT`.

Safety boundary:

```text
Guardian MAY: observe, detect, evaluate, report, allow, quarantine
Guardian MUST NOT: set proxy, hide proxy/VPN, change IP, change DNS/routes,
                   spoof fingerprint, rotate identity for evasion, bypass detection
```

VPN detection is an MVP evidence heuristic and not a guarantee of perfect classification.

Gate: PASSED when v0.7.0 contracts + CI are green.

---

## PHASE 5 — SEMANTIC OBSERVATION + RAW EVIDENCE

**Status: NEXT.**

Goal: immutable semantic evidence with Raw Evidence Store, BeforeState, Action, AfterState, ObservedEffect, Outcome, Context, demonstration timeline, YouTube page-state adapter and provenance IDs.

Exit criteria:

- Human `youtube.search` can be reconstructed semantically rather than from raw coordinates alone.
- Human/Agent provenance is preserved.
- Sensitive raw data remains local/redacted.
- Browser/Task/Environment identity is attached to evidence.

---

## PHASE 6 — DATA FACTORY + OFFLINE ANALYST

```text
Raw Evidence
 -> Deterministic Normalizer
 -> Action Segmenter
 -> Session Builder
 -> Rules/Statistics
 -> Offline Analyst (~0.6B, semantic classification only)
 -> Semantic Experience Compiler
 -> Brain-Ready Memory
 -> Context/Situation Pack Retriever
```

Analyst cannot control BODY, hold controller lease, mutate raw evidence or unlock autonomy.

---

## PHASE 7 — NEWBORN DIRECTOR BRAIN

Initial autonomy `0 = OBSERVE / REASON / PREDICT ONLY`. Brain reads Brain-ready packs, distinguishes known/unknown capability and requests evidence rather than inventing certainty.

---

## PHASE 8 — IDENTITY / HABIT BRAIN

Learn evidence-backed Human strategy preferences while keeping Habit, Knowledge and Motor independent.

---

## PHASE 9 — HUMAN OVERRIDE

Human input interrupts active BODY plan. Browser enters HUMAN_CONTROL. Later add Browser/OS native input observation. Resume requires policy eligibility.

---

## PHASE 10 — IMITATION + ASSISTED AUTONOMY

```text
0 NEWBORN
1 IMITATION
2 ASSISTED
3 CONTEXT AUTONOMY
4 MATURE CAPABILITY
```

Autonomy is per capability; failed/novel context causes wait/downgrade/replan.

---

## PHASE 11 — MATURE LOCAL COMPANY

Prove at least one YouTube capability repeatedly succeeds locally through:

```text
Goal -> Director -> Policy -> Browser/Task Manager -> Guardian -> BODY
     -> Observation -> ObservedEffect -> semantic verification
```

Environment eligibility and Human Override must work before Central routing.

---

## PHASE 12 — CENTRAL REGISTRY + PRESENCE + TOPIC DIRECTIVES

Central receives Company/Device/Browser/Channel registration, presence and summaries; sends high-level goals/topics; never sends raw physical actions.

---

## PHASE 13 — DISTRIBUTED CAPABILITY WORKERS

Bounded Discovery/Relevance/Registry/Policy/Execution-planning workers under Director. No worker bypasses Policy/Manager or directly gains BODY authority.

---

## PHASE 14 — CENTRAL TASK ROUTING + NETWORK SCORES

Keep Environment, Network, Capability, Participation and Online scores separate.

```text
Network Score != Brain Autonomy
```

---

## PHASE 15 — PLATFORM / NETWORK EXPANSION

Only after YouTube local maturity, add platform adapters. All platforms reuse the same Company Runtime / Manager / BODY architecture.

# 9. Architecture Gates

```text
Gate A BODY before Brain autonomy                         PASSED
Gate B Identity before multi-browser operation           PASSED
Gate C Manager before complex multi-Task operation       PASSED
Gate D Semantic Evidence before Director Brain           NEXT
Gate E Data Factory before mature Brain
Gate F Analyst has zero execution authority
Gate G Local maturity before production Central Router
Gate H Human Override before higher autonomy
Gate I Policy before distributed interaction             TASK POLICY FOUNDATION PASSED
```

# 10. Permanent Guardrails

1. Human is highest local authority.
2. One Device uses one Company Runtime application by default.
3. Task/Tab/Browser never creates a separate daemon application.
4. Company, Device, Browser, Extension and platform identities remain distinct.
5. One Browser may contain many Tabs and valid Tasks.
6. Tabs of one Browser sharing environment/IP is normal.
7. One Tab belongs to at most one active TaskWorkspace.
8. Browser eligibility and Task policy are separate gates.
9. Spam/fake engagement/metric manipulation are RESTRICTED Tasks.
10. RESTRICTED Task rejection does not automatically quarantine healthy Browser.
11. Guardian does not spoof fingerprint, conceal proxy/VPN, rotate IP for evasion or bypass detection.
12. Browser Manager is daemon-side authoritative; Extension is Adapter/transport.
13. Production Brain uses structured protocol and cannot bypass Task Manager/Guardian.
14. `daemon.cmd` / `body.cmd` are development/diagnostic entrypoints, not separate products.
15. One Brain holds BODY controller lease at a time.
16. Human and Agent evidence stay separate.
17. Knowledge, Habit, Motor and Evidence stay separate.
18. Raw evidence is not Director Brain API.
19. Analyst inference cannot overwrite Human fact or unlock autonomy.
20. Autonomy is per capability.
21. Central receives summaries/evidence, not raw sensitive Human streams.
22. Browser quarantine isolates bad Browser before whole Company when possible.
23. YouTube remains reference platform until local end-to-end maturity.
24. Production Central routing comes only after Mature Local Company proof.

# 11. Current Priority

```text
PHASE 1 BODY CORE                                  COMPLETE
PHASE 2 LOCAL IDENTITY                             COMPLETE
PHASE 3 BROWSER + TASK MANAGER / TASKWORKSPACE    COMPLETE
PHASE 4 ENVIRONMENT GUARDIAN / CHROME VALIDATOR   COMPLETE
PHASE 5 RAW + SEMANTIC EVIDENCE                    NEXT
PHASE 6 DATA FACTORY + OFFLINE ANALYST
PHASE 7 BRAIN-READY MEMORY / NEWBORN DIRECTOR
```

Immediate next proof:

```text
Human performs youtube.search on an ELIGIBLE Browser/TaskWorkspace
 -> immutable BeforeState / Action / AfterState / ObservedEffect created
 -> evidence carries Company/Device/Browser/Task/provenance IDs
 -> raw sensitive fields stay local/redacted
 -> demonstration can later compile into Brain-ready semantic memory
```
