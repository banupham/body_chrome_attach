# PRODUCT ROADMAP — Distributed Agent Company Network

> **Canonical product direction.** This file is the reference roadmap for architecture and sequencing. If a proposed implementation conflicts with this document, update and review the roadmap first instead of silently changing the architecture.

## 0. Mission

Build a local-first distributed agent system in which:

```text
CENTRAL
  = manages the NETWORK

COMPANY NODE
  = autonomous local operating unit

LOCAL BRAIN
  = decides WHAT should be done

IDENTITY / HABIT BRAIN
  = decides HOW this Human usually prefers to do it strategically

BROWSER MANAGER
  = authoritative local browser/task coordinator

EXTENSION ADAPTER
  = Chrome observation + execution bridge

BODY
  = performs HOW physically

OBSERVATION
  = reports WHAT HAPPENED

HUMAN
  = teacher + operator + highest local authority
```

The first reference platform is **YouTube**. Do not expand to Facebook, TikTok, Instagram, or other platforms until the YouTube architecture is stable end-to-end.

---

# 1. Target Architecture

```text
                                 CENTRAL
                           Registry / Presence
                      Capability / Task Routing
                                  |
                 +----------------+----------------+
                 |                                 |
                 v                                 v
          COMPANY NODE A                    COMPANY NODE B
             Local Device                      Local Device
                 |                                 |
        +--------+--------+                        ...
        |                 |
 Environment Guardian   Local Brain
                          |
                 +--------+---------+
                 |                  |
          Director Brain      Identity/Habit Brain
                 |                  |
                 +--------+---------+
                          |
                    Browser Manager
                          |
              +-----------+-----------+
              |           |           |
              v           v           v
          Browser A1   Browser A2   Browser A3
              |           |           |
         Extension    Extension    Extension
          Adapter      Adapter      Adapter
              |           |           |
              +-----------+-----------+
                          |
                         BODY
                    /             \
                   v               v
             PAGE HUMAN_MOTOR    BROWSER_UI
                   |               |
                  CDP          Native Input
                   |               |
                   +-------+-------+
                           |
                         Chrome
                           |
                      Observation
                           |
                     ObservedEffect
                           |
                         Brain
```

## Important correction from the original proposal

**Manager is not the Extension.**

The authoritative Manager is daemon-side/local-process state:

```text
Browser Manager
  -> owns browser/task/workspace state
  -> coordinates multiple Browser Instances
  -> selects the target Browser/Tab
  -> maintains task ownership

Extension Adapter
  -> observes Chrome
  -> reports tab/browser state
  -> exposes audited execution bridge
  -> must not be the authoritative task database
```

Reason: Chrome MV3 service workers may sleep/restart. Task ownership and local orchestration must survive extension lifecycle changes.

---

# 2. Identity Model

Do not use one ID for all levels.

```text
companyId
  |
  +-- deviceId
        |
        +-- browserInstanceId
              |
              +-- extensionInstanceId
                    |
                    +-- platform/channel identity
```

Initial deployment may use:

```text
1 Company Node -> 1 Device
```

but the data model **must not hard-code**:

```text
companyId === deviceId
```

Future-safe model:

```text
1 Company Node -> 1..N Devices
1 Device       -> 1..N Browser Instances
1 Browser      -> 1 Extension Adapter
1 Browser      -> many Tabs
```

Channel/account identity is separate from browser identity.

---

# 3. Responsibility Boundaries

## Human

Highest local authority.

```text
Human Authority > Brain Authority > BODY
```

When Human actively takes control, Brain must yield within the allowed detection scope.

## Central

Central manages the network, not Chrome mechanics.

Central may own:

```text
company/device/browser/channel registry
presence + heartbeat
health summaries
capability registry
capability score
participation score
network score
task routing
task history
trust/reputation summaries
```

Central must not directly perform:

```text
mouse movement
keyboard input
scroll
DOM interaction
browser navigation
raw motor replay
```

Central should not receive raw Human keyboard/mouse trajectories, passwords, cookies, session tokens, private text, or the complete local personality model.

## Director Brain

Answers:

```text
WHAT SHOULD BE DONE?
```

Owns goal reasoning, task decomposition, planning, replanning, failure handling, and semantic success evaluation.

## Identity / Habit Brain

Answers:

```text
HOW WOULD THIS HUMAN USUALLY DO IT STRATEGICALLY?
```

Learns preference and strategy, not low-level motor generation.

Examples:

```text
keyboard vs mouse preference
Enter vs click preference
new-tab preference
navigation style
correction style
decision latency
action tempo
```

## Browser Manager

Daemon-side authoritative coordinator.

Owns:

```text
Browser Instance registry
active browser/tab state
TaskWorkspace ownership
task -> browser/tab assignment
browser eligibility
Brain controller lease integration
BODY execution state
```

## Extension Adapter

Per-Chrome adapter only.

Owns:

```text
Chrome observation bridge
page observation
CDP execution bridge
browser/tab telemetry
agent provenance markers
read-only page context
```

## BODY

BODY has no high-level goal and no personality.

BODY owns physical execution:

```text
move
click
double click
drag
scroll
type
key
combo
browser navigation
browser tab/window controls
address bar controls
```

BODY may learn only low-level motor characteristics such as trajectory and timing.

---

# 4. Knowledge, Personality, Motor — Keep Separate

Do not merge these models.

## Knowledge

```text
What is YouTube search?
Which page state represents a result page?
Which effect indicates video navigation succeeded?
What capability is being attempted?
```

## Personality / Habit

```text
Does this Human prefer Enter or click?
Does this Human prefer a new tab?
How does this Human usually correct text?
```

## Motor

```text
mouse trajectory
typing timing
key hold timing
scroll timing
```

Rules:

```text
Brain does not contain Motor.
BODY does not contain Personality.
Knowledge does not automatically become Personality.
```

---

# 5. Human vs Agent Data

This is a permanent invariant.

```text
source = human
  -> may become training ground truth

source = agent
  -> telemetry / evaluation / verification only
```

Never create the feedback loop:

```text
Brain executes
-> stored as Human
-> Brain learns its own output as Human preference
-> confidence rises artificially
```

Raw Human learning remains local-first at the Company Node.

---

# 6. Newborn Brain Definition

The Brain is **newborn in experience and personality**, not blank about foundational schemas.

A Newborn Brain may already know:

```text
action ontology
observation schema
task/effect schema
browser concepts
capability framework
policy/safety rules
how to compare before/after state
```

It initially does **not** know:

```text
Human preference
Human habit
site-specific strategy
capability confidence
Human personality
which strategy this Human would choose
which unfamiliar task it can safely perform
```

A complete Human demonstration should be represented as:

```text
BeforeState
+ Human Action
+ Context
+ AfterState
+ ObservedEffect
+ Outcome
```

Do not train semantic behavior from coordinates alone.

---

# 7. Task Workspace Model

A Tab is not an Agent.

Do not hard-code:

```text
1 Task = 1 Tab
```

Use:

```text
Task
  -> TaskWorkspace
       -> primaryTabId
       -> 1..N Tabs
```

Recommended invariant:

```text
one Tab belongs to at most one active TaskWorkspace at a time
```

This allows research tasks to use multiple tabs while preserving ownership and recovery semantics.

---

# 8. Environment Guardian

Environment Guardian is a local Company module separate from Brain and Extension.

Purpose:

> Verify that the browser/device is operating in a normal, consistent environment that satisfies local/network policy.

It may:

```text
OBSERVE
DETECT
SCORE
REPORT
ALLOW
QUARANTINE
```

It must not:

```text
fake fingerprint
hide proxy/VPN
change IP to bypass checks
automatically disable VPN/proxy
change DNS/routes to evade policy
interfere with detection systems
```

Signals may include:

```text
device health
network stability
system proxy / Chrome proxy policy
network adapters / VPN signals
DNS/default route changes
Chrome health
extension health
CDP/debugger health
unexpected launch flags
```

A single signal must not automatically equal a violation.

Quarantine is **Browser-level** whenever possible:

```text
Browser A1 -> ACTIVE
Browser A2 -> ACTIVE
Browser A3 -> QUARANTINED
```

Do not disable an entire Company Node because one Browser Instance is unhealthy.

---

# 9. Scores Must Stay Separate

Do not collapse everything into one Agent score.

Maintain distinct concepts:

```text
Environment Score
  -> is this browser/device environment healthy?

Network Score
  -> is network identity/stability reliable?

Capability Score
  -> how well has this Brain demonstrated this capability?

Participation Score
  -> how reliably does this Company participate?

Online Score
  -> uptime / presence / latency / disconnect behavior
```

Company Trust may aggregate these later, but the source scores remain inspectable.

**Network Score must never grant Brain autonomy.**

---

# 10. Capability-Specific Autonomy

Never use one global Brain maturity level to unlock all actions.

Example:

```json
{
  "youtube.search": {
    "autonomy": 4,
    "confidence": 0.98
  },
  "youtube.navigation": {
    "autonomy": 3,
    "confidence": 0.90
  },
  "youtube.unknown_task": {
    "autonomy": 0,
    "confidence": 0.05
  }
}
```

Autonomy changes only from evidence such as:

```text
human demonstration count
successful imitation count
failure rate
context coverage
Human agreement/test approval
ObservedEffect accuracy
strategy consistency
```

Time online alone must never increase autonomy.

---

# 11. YouTube-First Reference Capabilities

Initial reference capability set:

```text
youtube.search
youtube.open_video
youtube.open_channel
youtube.navigation
youtube.back
youtube.tab_switch
```

The purpose of YouTube-first is to stabilize:

```text
task model
observation model
semantic effects
capability evidence
Brain learning
Browser Manager
BODY
Human override
```

Only after these work end-to-end should another platform adapter be added.

---

# 12. Development Roadmap

## PHASE 1 — BODY CORE

**Status: CORE LARGELY IMPLEMENTED; stabilization continues.**

Goal: one auditable physical execution layer.

Deliverables:

```text
CanonicalMotorPlanner
CdpInputGateway
separate BROWSER_UI path
persistent native Windows input worker
ObservedEffect
Human/Agent provenance
buffered recorder/data persistence
Brain/debug auth separation
exclusive Brain controller lease
```

Must preserve:

```text
page HUMAN_MOTOR -> Input.dispatchMouseEvent / Input.dispatchKeyEvent only
content script -> READ/OBSERVE only
linear bootstrap when no Human trajectory exists
Human-only training ground truth
```

Exit criteria:

- CI green for all Body contracts.
- One Chrome can record Human events and replay audited page/browser actions.
- Agent events never become Human ground truth.
- Brain lease and debug lock are deterministic.
- Page and Browser UI execution return truthful delivered/observed/verified semantics.

---

## PHASE 2 — LOCAL IDENTITY

**Status: NEXT FOUNDATION.**

Goal: stable multi-level identity before multi-browser orchestration expands.

Deliverables:

```text
companyId
deviceId
browserInstanceId
extensionInstanceId
platform/channel identity
persistent identity files
registration metadata
```

Rules:

- Do not hard-code Company == Device.
- Browser identity survives tab churn.
- Extension identity is not Channel identity.

Exit criteria:

- Restarting daemon/browser does not accidentally create a different logical identity unless explicitly re-registered.
- Multiple Browser Instances on one Device remain distinguishable.
- Identity is available to all later health/task/capability records.

---

## PHASE 3 — BROWSER MANAGER + TASK WORKSPACE

Goal: make daemon-side Browser Manager authoritative for browser/task state.

Deliverables:

```text
BrowserRegistry enriched with browserInstanceId
Browser state machine
TaskWorkspace model
Task -> Browser/Tab ownership
multi-browser selection
busy/idle state
controller ownership integration
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

- One Device can coordinate at least two Browser Instances independently.
- One TaskWorkspace may safely own multiple tabs.
- Extension reconnect does not lose authoritative task ownership.
- A task cannot accidentally execute on the wrong Browser Instance.

---

## PHASE 4 — ENVIRONMENT GUARDIAN MVP

Goal: decide whether a Browser Instance is eligible for autonomous work.

Deliverables:

```text
device health
browser health
extension/CDP health
network stability
proxy/VPN/environment signals
environment score
Browser-level quarantine
```

Exit criteria:

- Unhealthy Browser can be quarantined without stopping healthy browsers.
- Guardian reports evidence; it does not modify network configuration to evade policy.
- Brain/Manager cannot schedule autonomous work onto QUARANTINED browser state.

---

## PHASE 5 — SEMANTIC OBSERVATION LAYER

Goal: turn raw interaction history into reusable demonstrations.

Deliverables:

```text
BeforeState schema
Action schema
AfterState schema
ObservedEffect schema
Outcome schema
Context schema
YouTube page-state adapter
Demonstration timeline
```

Target record:

```text
Context
+ Intent candidate
+ Human strategy
+ BeforeState
+ Human Action
+ AfterState
+ ObservedEffect
+ Outcome
```

Exit criteria:

- `youtube.search` Human demonstrations can be reconstructed without relying on raw coordinates alone.
- Navigation/focus/tab effects have stable semantic representation.
- Sensitive raw Human data remains local/redacted according to policy.

---

## PHASE 6 — NEWBORN BRAIN

Goal: a Brain that can observe, remember, compare, associate, evaluate, and learn evidence without autonomous action.

Autonomy:

```text
0 = OBSERVE ONLY
```

Deliverables:

```text
foundational action/observation ontology
Knowledge Store
Demonstration Store
Capability Evidence Store
confidence model
context coverage model
prediction/evaluation API
```

Exit criteria:

- Brain can explain what evidence it has for `youtube.search`.
- Brain can distinguish unknown capability from known capability.
- Brain confidence cannot increase from Agent self-execution data alone.

---

## PHASE 7 — IDENTITY / HABIT BRAIN

Goal: learn how the Human tends to choose strategies while keeping Knowledge and Motor separate.

Deliverables:

```text
Human preference model
site habits
task habits
keyboard/mouse preference
navigation/tab preference
correction style
decision latency/action tempo
strategy ranking
```

Exit criteria:

- For a known context, Brain can rank Human-like strategies with evidence/confidence.
- Identity/Habit model can be reset without deleting Knowledge.
- Motor model can be reset without deleting Personality/Habit.

---

## PHASE 8 — HUMAN OVERRIDE

Goal: Human always wins local control.

### V1 — Page-level override

```text
Human page input detected
-> Brain yields
-> active BODY plan pauses/cancels safely
-> Browser enters HUMAN_CONTROL
```

### V2 — Browser/OS-level override

Later add native input observation for browser chrome actions that content scripts cannot see.

Exit criteria:

- Human page interaction reliably interrupts autonomous page execution.
- Body does not race Human input.
- Resume requires explicit policy eligibility, not a blind timer.

---

## PHASE 9 — IMITATION + ASSISTED AUTONOMY

Goal: allow only proven capability-specific behavior.

Progression:

```text
Level 0 NEWBORN
  observe only

Level 1 IMITATION
  predict Human action/strategy
  compare against real Human behavior

Level 2 ASSISTED
  execute explicitly approved capabilities

Level 3 CONTEXT AUTONOMY
  autonomous only in known contexts with sufficient evidence
```

Deliverables:

```text
prediction tests
Human agreement tests
capability-specific permission
failure budget
recovery rules
ObservedEffect validation
```

Exit criteria:

- At least one YouTube capability reaches assisted autonomy through evidence, not manual score inflation.
- Failure lowers/blocks confidence according to policy.
- Unknown contexts fall back to WAIT/OBSERVE instead of improvising unrestricted actions.

---

## PHASE 10 — MATURE LOCAL COMPANY

Goal: demonstrate a complete local autonomous loop before building full Central task routing.

Target loop:

```text
Goal
-> Director Brain
-> Identity/Habit strategy
-> Browser Manager
-> BODY
-> Observation
-> ObservedEffect
-> Brain verification
-> retry/replan if required
-> Learning/Evidence update
```

Reference target: at least one YouTube workflow with capability-specific autonomy and Human override.

Exit criteria — **hard gate before Central Task Router**:

- Local Company completes selected YouTube capability end-to-end.
- Browser eligibility is enforced.
- Human override is demonstrated.
- Success/failure is determined semantically, not by input delivery alone.
- Capability confidence has reproducible evidence.
- Company operates even when Central is unavailable.

---

## PHASE 11 — CENTRAL REGISTRY + PRESENCE

Goal: connect proven Local Companies without centralizing their raw Human data.

Deliverables:

```text
Company Registry
Device Registry
Browser Registry
Channel Registry
Presence
Heartbeat
health summaries
Online Score
```

Central still does **not** route autonomous tasks at this phase unless explicitly experimental.

Exit criteria:

- Multiple Company Nodes can register/reconnect safely.
- Central failure does not stop local Human observation/learning.
- Raw Human event streams remain local.

---

## PHASE 12 — CENTRAL TASK ROUTING + NETWORK SCORES

**Blocked until Phase 10 exit criteria are met.**

Goal: route Goals to capable Company Nodes rather than control Chrome directly.

Deliverables:

```text
Capability Registry
Capability Score
Participation Score
Network Score
Task Router
Task History
Trust/Reputation aggregation
```

Routing inputs may include:

```text
platform
category
required capability
browser eligibility
capability confidence
availability
participation/reliability
```

Central output:

```text
Goal / Task assignment
```

Central must never output raw mouse/keyboard action plans for a remote Browser.

Exit criteria:

- Router selects among multiple eligible Company Nodes.
- Network/Environment scores do not grant capability autonomy.
- Task result summaries are sufficient for network coordination without uploading raw local personality/motor data.

---

## PHASE 13 — NETWORK EXPANSION

Only after YouTube end-to-end architecture is stable.

Possible adapters:

```text
Facebook
TikTok
Instagram
other platforms
```

Each new platform must define:

```text
capability ontology
observation/state model
semantic success effects
policy boundaries
platform-specific tests
```

Do not duplicate BODY motor implementations per platform.

---

# 13. Central Build Gate

A minimal Central registry can be prototyped earlier for testing multi-device presence.

However, **full Central Task Router, Trust routing, and production Capability routing are forbidden milestones until a Mature Local Company proves at least one YouTube capability end-to-end.**

Reason:

```text
Do not design distributed routing around capabilities that have not yet been proven locally.
```

---

# 14. Current Repository Responsibility

`body_chrome_attach` remains the reference implementation for the physical/local browser execution boundary.

This repo should contain or own interfaces for:

```text
BODY runtime
Canonical page motor
Browser UI input
Extension Adapter
Human/Agent provenance
local observation/effect transport
Browser runtime registry
Brain control lease / Body API boundary
Body-side performance and audit contracts
```

Brain and Central may live in separate repositories/processes later.

**Do not move high-level goal reasoning or Central network logic into BODY simply because this repository already has a daemon.**

---

# 15. Permanent Guardrails

These rules require an explicit architecture review before changing:

1. **Human is highest local authority.**
2. **Central never directly drives Chrome motor actions.**
3. **Brain uses structured contracts, not free-form CMD strings as the product control plane.**
4. **`daemon.cmd` is Body runtime; CMD input and `body.cmd` are debug/test surfaces only.**
5. **Only one Brain controller may hold the execution lease at a time.**
6. **Manager is daemon-side Browser Manager; Extension is an Adapter, not authoritative task state.**
7. **Company/Device relationship is not hard-coded 1:1 in the data model.**
8. **Tab is a workspace resource, not an Agent. Tasks may own multiple tabs.**
9. **Newborn Brain is blank in experience/personality, not blank in foundational schemas.**
10. **Knowledge, Personality/Habit, and Motor are separate models.**
11. **Human data and Agent data remain separate. Agent output never becomes Human ground truth automatically.**
12. **Page execution remains audited HUMAN_MOTOR CDP input only; content scripts remain READ/OBSERVE only.**
13. **BODY contains physical HOW, not high-level goals or personality.**
14. **Autonomy is capability-specific and evidence-based.**
15. **Network/Environment/Participation scores do not unlock Brain autonomy.**
16. **Environment Guardian observes/reports/quarantines; it does not hide or manipulate the environment to evade checks.**
17. **Raw Human learning is local-first. Central receives summaries, not unnecessary raw personal interaction data.**
18. **YouTube is the first reference platform. Do not expand platforms before the local loop is proven.**
19. **Full Central Task Router is blocked until Phase 10 local maturity gate passes.**
20. **No duplicate per-platform motor implementation; platforms adapt semantics above the common BODY.**

---

# 16. Decision Rule for Future Changes

Before implementing a major feature, answer:

```text
Which phase does this belong to?
What exit criterion does it satisfy?
Does it preserve the permanent guardrails?
Does it introduce responsibility into the wrong layer?
Does it create a second execution/control path?
Does it depend on a later phase that has not passed its gate?
```

If a feature cannot answer those questions, it should not be merged yet.

---

# 17. Immediate Next Target

The next architectural target after BODY stabilization is:

```text
PHASE 2 — LOCAL IDENTITY
        ↓
PHASE 3 — BROWSER MANAGER + TASK WORKSPACE
        ↓
PHASE 4 — ENVIRONMENT GUARDIAN MVP
        ↓
PHASE 5 — SEMANTIC OBSERVATION
        ↓
PHASE 6 — NEWBORN BRAIN
```

Do **not** jump directly from the current BODY to a full Central network or a fully autonomous Brain.

The near-term success condition is not “many Agents online”. It is:

> **One Local Company can identify its browsers, observe a Human, represent a semantic demonstration, let a Brain reason over it, execute through BODY, observe the effect, and preserve Human authority.**
