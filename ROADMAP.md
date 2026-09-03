# PRODUCT ROADMAP — Distributed Agent Company Network

> **Canonical architecture and sequencing reference.** If implementation conflicts with this file, update/review the roadmap first. A Phase is a module boundary, not a separate end-user application.

## 0. Mission

Build a local-first distributed agent system in which each Company can own one or more Devices. Each Device runs one **Company Runtime application** that validates/manages Chrome resources, hosts the daemon/BODY runtime, manages many Tasks, learns locally, and later hosts the Data/Brain modules.

YouTube is the first reference platform. Do not expand platforms until the YouTube path works end-to-end.

Permanent data rule:

```text
RAW HUMAN/BROWSER EVIDENCE
        -> Data Factory
        -> Brain-Ready Semantic Memory
        -> Director Brain

RAW DATA != BRAIN INPUT
```

## 1. Local Application Invariant

Default deployment:

```text
Company
  -> 1..N Devices
       -> exactly one Company Runtime application per Device by default
            -> Local Identity
            -> Chrome Validator / Environment Guardian
            -> Browser Manager
            -> Task Manager / TaskWorkspace
            -> Daemon / BODY Runtime
            -> Data Factory
            -> later Offline Analyst + Director Brain
```

Do **not** create one application or one daemon per Task, Tab, Browser, or Chrome profile.

One Company Runtime application may manage:

```text
1..N Browser Instances
1..N Tabs per Browser
1..N concurrent Tasks
```

A single Chrome/Browser Instance with many Tabs performing different legitimate Tasks is valid.

## 2. Target Architecture

```text
CENTRAL
  Registry / Presence / Policy / high-level Goal directives
                         |
                         v
COMPANY
  +-- Device A --------------------------------------------------+
  |    COMPANY RUNTIME APPLICATION                              |
  |      +-- Local Identity                                     |
  |      +-- Chrome Validator / Environment Guardian            |
  |      +-- Browser Manager                                    |
  |      +-- Task Manager / TaskWorkspace                       |
  |      +-- Data Factory / later Brain                         |
  |      +-- Daemon / BODY Runtime                              |
  |               |                                             |
  |        +------+------+                                      |
  |        |             |                                      |
  |   Browser A1     Browser A2                                 |
  |        |             |                                      |
  |   N Tabs/Tasks   N Tabs/Tasks                               |
  +--------------------------------------------------------------+
                         |
                        BODY
                    /           \
             PAGE HUMAN_MOTOR   BROWSER_UI
                    |           |
                   CDP       Native Input
                    \           /
                       Chrome
                         |
                    Observation
                         |
                   ObservedEffect
                         |
                  Raw Evidence Store
```

## 3. Permanent Responsibility Boundaries

### Human

```text
Human Authority > Brain Authority > BODY
```

Human is always the highest local authority.

### Company Runtime Application

The single Device application is the operational container. The daemon, Chrome validation, managers, data plane, UI and later Brain are modules/services of this same product.

### Central

Central manages network-level registry, presence, policy, goals, task routing and summaries. Central does not directly execute mouse, keyboard, scroll, DOM interaction, browser navigation or raw motor replay.

Central does not receive raw private text, passwords, cookies, session tokens, raw Human trajectories or complete local personality models.

### Browser Manager

Daemon-side authoritative Browser/Tab coordinator. The Extension is never the authoritative Manager.

### Task Manager

Owns Task lifecycle, TaskWorkspace ownership, task policy classification and task-to-browser/tab assignment. Task validity is distinct from Browser validity.

### Environment Guardian / Chrome Validator

Observes and decides Browser eligibility. It may OBSERVE, DETECT, SCORE, REPORT, ALLOW and QUARANTINE. It must never spoof browser fingerprint, hide proxy/VPN, rotate identity to evade checks, change IP/DNS/routes to bypass policy, or interfere with detection systems.

### Extension Adapter

Per-Browser bridge for Chrome observation, CDP page execution, browser/tab telemetry and agent provenance. It is not a manager.

### BODY

BODY owns physical execution only: move, click, drag, scroll, type, key/combo and browser UI controls. BODY has no high-level goal and no personality.

### Data Factory / Offline Analyst / Director Brain

Data Factory transforms evidence. Offline Analyst may classify/label derived data but has zero execution authority. Director Brain reasons over Brain-ready semantic packs, not raw mouse/keyboard streams.

## 4. Identity Model

Use separate identities:

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
- One Device has one Company Runtime application by default.
- One Device/application may manage multiple Browser Instances.
- One Browser may have many Tabs and many Tasks.
- One Browser Instance has one logical environment/network identity at a given observation point.
- Tabs inside the same Browser naturally share Browser environment/network identity. This is **not** a duplicate Browser condition.
- Platform/account/channel identity is separate from Browser identity.

## 5. Browser Eligibility vs Task Eligibility

These are two independent gates.

### Browser/environment gate

Examples of evidence:

```text
persistent browser identity
extension authentication/binding
CDP/runtime health
browser/version compatibility
observed environment consistency
observed public egress/network identity
proxy/VPN/tunnel signals when relevant to policy
Company duplicate-identity/network policy
```

Possible result:

```text
ACTIVE / ELIGIBLE
QUARANTINED / INELIGIBLE
ERROR
```

A Browser failing environment policy must not receive autonomous Tasks.

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
  prepare/draft external interaction

RESTRICTED
  spam
  repetitive unsolicited interaction
  coordinated fake views/likes/comments
  metric manipulation
  pretending independent accounts are unrelated humans
  detector/anti-bot evasion
  stealth/fingerprint manipulation
```

Important matrix:

```text
Browser ELIGIBLE + Task SAFE_AUTO       -> may execute
Browser ELIGIBLE + Task HUMAN_APPROVED  -> wait for approval
Browser ELIGIBLE + Task RESTRICTED      -> reject Task; Browser may remain healthy
Browser INELIGIBLE                      -> no autonomous Task executes
```

Spam is a **Task-policy failure**, not proof that the Browser itself is invalid.

## 6. TaskWorkspace Model

A Tab is a resource, not an Agent.

```text
Task
  -> TaskWorkspace
       -> browserInstanceId
       -> primaryTabId
       -> tabIds [1..N]
```

Invariants:

```text
one Tab belongs to at most one active TaskWorkspace
one TaskWorkspace may own multiple Tabs
one Browser may host multiple TaskWorkspaces on different Tabs
```

Example:

```text
Browser B01
  Tab 101 -> Task A
  Tab 102 -> Task B
  Tab 103 -> Task A
```

This is valid. Physical BODY actions are arbitrated/serialized so Tasks cannot click/type over each other.

## 7. Human vs Agent Evidence

```text
source=human -> may become Human ground truth
source=agent -> telemetry/evaluation/verification only
```

Never learn agent output back as Human preference.

Facts and inferences remain separate and provenance is mandatory. Model confidence never directly grants autonomy.

## 8. Knowledge, Habit, Motor and Evidence Separation

```text
Knowledge    = what a capability/page/effect means
Habit        = how this Human tends to choose a strategy
Motor        = low-level trajectory/timing
Evidence     = what actually happened and who caused it
```

Brain does not contain Motor generation. BODY does not contain Personality. Knowledge does not automatically become Habit.

## 9. YouTube-First Capability Framework

Initial reference capabilities:

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

Use YouTube to prove task ownership, browser eligibility, evidence, Brain-ready memory, reasoning, BODY execution and Human override before adding other platforms.

# 10. Development Roadmap

## PHASE 1 — BODY CORE

**Status: COMPLETE.**

Goal: one auditable physical execution layer.

Implemented foundation includes canonical page motor, CDP method allowlist, separate Browser UI path, persistent native input worker, Human/Agent provenance, resilient persistence, exclusive Brain lease, serialized execution lanes and separated execution truth (`delivered / observed / verified / taskSuccess`).

Exit gate: PASSED.

---

## PHASE 2 — LOCAL IDENTITY

**Status: COMPLETE after v0.5.0 identity integration.**

Goal: stable identity before Browser Manager orchestration.

Deliverables:

```text
companyId
deviceId
browserInstanceId
extensionInstanceId
runtimeExtensionId
persistent identity files
browser-extension binding
platform/account/channel binding namespace
identity on status/events/execution records
```

Persistence:

```text
daemon/identity/company.json
daemon/identity/device.json
daemon/identity/browsers.json
```

Exit criteria:

- Daemon restart preserves Company/Device identity.
- Browser/extension restart preserves intended Browser Instance identity.
- Multiple Browser Instances on one Device remain distinguishable.
- Multiple Tabs in one Browser remain one Browser identity, not duplicates.
- Browser/extension binding mismatch fails closed.

---

## PHASE 3 — BROWSER MANAGER + TASK MANAGER + TASK WORKSPACE

**Status: NEXT.**

Goal: the one Company Runtime application coordinates many Browsers/Tabs/Tasks safely.

Deliverables:

```text
BrowserRegistry keyed by browserInstanceId
Browser state machine
TaskRegistry / Task lifecycle
TaskWorkspace
Task -> Browser/Tab ownership
one Tab -> max one active TaskWorkspace
multi-browser selection
busy/idle state
BODY scheduling/arbitration
controller ownership integration
Task Policy Gate
```

Recommended Browser states:

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

Exit criteria:

- One Device coordinates at least two Browser Instances independently.
- One Browser can run multiple valid Tasks on different Tabs.
- TaskWorkspace may safely own multiple Tabs.
- Extension reconnect does not lose Browser/Task ownership.
- Task cannot execute on the wrong Browser/Tab.
- RESTRICTED/spam Task is rejected without automatically invalidating a healthy Browser.

---

## PHASE 4 — ENVIRONMENT GUARDIAN / CHROME VALIDATOR MVP

Goal: decide whether each Browser Instance is eligible for autonomous work.

Deliverables:

```text
device health
browser health
extension/CDP health
browser identity consistency
observed environment signature
network stability
observed public egress/network identity
proxy/VPN/tunnel signals
environment score/evidence
Browser-level quarantine
Company policy: DIRECT_ONLY / duplicate network rules where configured
```

Rules:

- Validation is Browser-scoped, not Tab-scoped.
- Same Browser's Tabs sharing IP/environment is expected.
- Separate Browser Instances require distinct managed browser identities.
- Network uniqueness is an explicit Company policy, not inferred from Tabs.
- Under `DIRECT_ONLY`, detected proxy/VPN/tunnel makes the Browser ineligible.
- Guardian only verifies/reports/quarantines; it never spoofs fingerprint, conceals proxy/VPN, changes IP or evades detection.

Exit criteria:

- Unhealthy Browser can be quarantined without stopping healthy Browsers.
- Ineligible Browser cannot receive autonomous work.
- Evidence explains every eligibility decision.

---

## PHASE 5 — SEMANTIC OBSERVATION + RAW EVIDENCE

Goal: create immutable evidence for later analysis.

Deliverables: Raw Evidence Store, BeforeState, Action, AfterState, ObservedEffect, Outcome, Context, demonstration timeline, YouTube page-state adapter and provenance IDs.

Exit: a Human `youtube.search` demonstration can be reconstructed semantically; Human/Agent provenance is preserved; sensitive raw data remains local/redacted.

---

## PHASE 6 — DATA FACTORY + OFFLINE ANALYST

Goal: turn raw evidence into Brain-ready semantic data.

Pipeline:

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

Goal: reason from Brain-ready packs only.

Initial autonomy:

```text
0 = OBSERVE / REASON / PREDICT ONLY
```

Exit: Brain can distinguish known/unknown capability, select candidate strategies with evidence and request more evidence rather than invent certainty.

---

## PHASE 8 — IDENTITY / HABIT BRAIN

Goal: learn Human strategy preferences while keeping Habit, Knowledge and Motor separate.

Exit: ranked Human-preferred strategies are evidence-backed; Habit can reset independently of Knowledge/Motor.

---

## PHASE 9 — HUMAN OVERRIDE

Goal: Human always wins local control.

V1 page input interrupts active BODY plan and Browser enters `HUMAN_CONTROL`. V2 later adds native Browser/OS input observation. Resume requires policy eligibility, not a blind timer.

---

## PHASE 10 — IMITATION + ASSISTED AUTONOMY

Capability-specific progression:

```text
0 NEWBORN
1 IMITATION
2 ASSISTED
3 CONTEXT AUTONOMY
4 MATURE CAPABILITY
```

Autonomy is per capability. Novel/failed context causes wait/downgrade/replan.

---

## PHASE 11 — MATURE LOCAL COMPANY

Goal: prove one local Company Runtime works end-to-end before depending on Central routing.

Reference path:

```text
Goal -> Director -> Policy -> Browser Manager -> TaskWorkspace
     -> BODY -> Observation -> ObservedEffect -> semantic verification
```

Minimum proof: at least one YouTube capability repeatedly succeeds locally, environment eligibility is enforced, Human Override works, and success is semantic rather than mere input delivery.

---

## PHASE 12 — CENTRAL REGISTRY + PRESENCE + TOPIC DIRECTIVES

Central receives Company/Device/Browser/Channel registrations, presence, health/capability summaries and sends high-level topic/goal directives. It never sends mouse coordinates or raw motor sequences.

---

## PHASE 13 — DISTRIBUTED CAPABILITY WORKERS

Director may decompose legitimate high-level Tasks into bounded Discovery, Relevance, Registry, Policy and Execution-planning workers. Workers do not bypass Director/Policy/Manager and do not automatically receive BODY access.

---

## PHASE 14 — CENTRAL TASK ROUTING + NETWORK SCORES

Route goals only after local capability evidence exists. Keep Environment, Network, Capability, Participation and Online scores separate.

```text
Network Score != Brain Autonomy
```

---

## PHASE 15 — PLATFORM / NETWORK EXPANSION

Only after YouTube is stable, add other platform adapters. New platforms reuse the same Company Runtime / Manager / BODY architecture.

# 11. Architecture Gates

```text
Gate A BODY before Brain autonomy                         PASSED
Gate B Identity before multi-browser operation           PASSED
Gate C Manager before complex multi-Task operation       NEXT
Gate D Semantic Evidence before Director Brain
Gate E Data Factory before mature Brain
Gate F Offline Analyst has zero execution authority
Gate G Local maturity before production Central Router
Gate H Human Override before higher autonomy
Gate I Policy before distributed interaction
```

# 12. Permanent Guardrails

1. Human is highest local authority.
2. One Device uses one Company Runtime application by default.
3. Tasks, Tabs and Browsers do not create separate daemon applications.
4. Company, Device, Browser, Extension and platform identities remain distinct.
5. One Browser may contain many Tabs and many valid Tasks.
6. Tabs of one Browser sharing environment/IP is normal and not a duplicate Browser condition.
7. One Tab belongs to at most one active TaskWorkspace.
8. Browser eligibility and Task policy are separate gates.
9. Spam/fake engagement/metric manipulation are RESTRICTED Tasks.
10. Rejecting a RESTRICTED Task does not automatically quarantine a healthy Browser.
11. Environment Guardian observes/verifies only; no fingerprint spoofing, proxy/VPN concealment, IP rotation for evasion or detector bypass.
12. Browser Manager is daemon-side authoritative; Extension is an adapter.
13. Brain uses structured contracts, not free-form CMD as production control.
14. `daemon.cmd` is a development entrypoint to the internal Company Runtime/BODY engine, not a separate product.
15. One Brain holds the BODY controller lease at a time.
16. Human and Agent evidence stay separate.
17. Knowledge, Habit, Motor and Evidence stay separate.
18. Raw evidence is not the Director Brain API.
19. Analyst inference cannot overwrite Human fact or unlock autonomy.
20. Autonomy is per capability.
21. Central receives summaries/evidence, not raw sensitive Human streams.
22. Browser quarantine isolates the bad Browser before the whole Company when possible.
23. YouTube stays the reference platform until local end-to-end maturity.
24. Production Central routing comes only after Mature Local Company proof.

# 13. Current Priority

```text
PHASE 1 BODY CORE                                  COMPLETE
PHASE 2 LOCAL IDENTITY                             COMPLETE
PHASE 3 BROWSER + TASK MANAGER / TASKWORKSPACE    NEXT
PHASE 4 ENVIRONMENT GUARDIAN / CHROME VALIDATOR
PHASE 5 RAW + SEMANTIC EVIDENCE
PHASE 6 DATA FACTORY + OFFLINE ANALYST
PHASE 7 BRAIN-READY MEMORY / NEWBORN DIRECTOR
```

Immediate next proof:

```text
one Company Runtime application
 -> registers multiple Browser Instances by browserInstanceId
 -> one Browser exposes many Tabs
 -> many legitimate Tasks own different Tabs
 -> TaskWorkspace prevents cross-task/cross-browser execution
 -> BODY scheduler serializes physical actions
 -> Task Policy rejects spam/restricted work
 -> Browser eligibility remains an independent Guardian decision
```
