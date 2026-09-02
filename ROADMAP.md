# PRODUCT ROADMAP — Distributed Agent Company Network

> **Canonical product direction.** This file is the architecture and sequencing reference for the project. If a proposed implementation conflicts with this roadmap, update and review the roadmap first instead of silently changing the architecture.

## 0. Mission

Build a **local-first distributed agent system** in which each Company Node can observe Human behavior, learn locally, build reusable semantic knowledge, receive high-level goals, reason through a Director Brain, coordinate Browser Instances, execute through one audited BODY, verify effects, and report only necessary summaries to Central.

The first reference platform is **YouTube**. Do not expand to Facebook, TikTok, Instagram, or other platforms until the YouTube architecture works end-to-end.

The central development principle is:

```text
RAW DATA
  !=
BRAIN INPUT

Raw Human/Browser observations
  -> Data Factory
  -> Brain-Ready Semantic Memory
  -> Director Brain
```

The Director Brain must not be designed to understand raw mouse/keyboard/DOM timelines directly.

---

# 1. Target Architecture

```text
                                  CENTRAL
                         Registry / Presence / Policy
                       Topic / Goal / Task Directives
                                  |
                  +---------------+---------------+
                  |                               |
                  v                               v
           COMPANY NODE A                  COMPANY NODE B
             Local Device                    Local Device
                  |
        +---------+----------+
        |                    |
Environment Guardian     DATA + BRAIN PLANE
                             |
                 +-----------+------------+
                 |                        |
             Data Factory            Director Brain
                 |                        |
      Offline Analyst ~0.6B         Goal / Plan / Replan
                 |                        |
     Brain-Ready Semantic Memory          |
                 |                        |
                 +-----------+------------+
                             |
                      Identity/Habit Brain
                             |
                      Capability Workers
                             |
                       Browser Manager
                             |
               +-------------+-------------+
               |             |             |
               v             v             v
           Browser A1    Browser A2    Browser A3
               |             |             |
          Extension     Extension     Extension
           Adapter       Adapter       Adapter
               |             |             |
               +-------------+-------------+
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
                     Raw Evidence Store
                              |
                         Data Factory
```

---

# 2. Permanent Responsibility Boundaries

## Human

Human is the highest local authority.

```text
Human Authority > Brain Authority > BODY
```

When Human takes control, autonomous execution must yield within the available detection scope.

## Central

Central manages the **network**, not Chrome mechanics.

Central may own:

```text
Company / Device / Browser / Channel registry
presence + heartbeat
health summaries
capability registry
policy
topic / goal directives
task routing
task history
network scores / participation summaries
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

Central should not receive raw Human mouse trajectories, raw private text, passwords, cookies, session tokens, or complete local personality models.

## Director Brain

Answers:

```text
WHAT SHOULD BE DONE?
```

Owns:

```text
goal interpretation
task decomposition
capability selection
worker assignment
planning
replanning
failure handling
semantic success evaluation
```

The Director Brain consumes **Brain-Ready Data**, not raw event streams.

## Identity / Habit Brain

Answers:

```text
HOW WOULD THIS HUMAN USUALLY PREFER TO DO IT STRATEGICALLY?
```

Owns Human preference and strategy ranking, not low-level motor generation.

## Data Factory

Transforms raw evidence into compact semantic records that Brain can understand immediately.

It owns:

```text
normalization
segmentation
session building
before/after state assembly
statistics
semantic labeling
experience compilation
knowledge candidates
habit candidates
Brain-ready indexes
```

## Offline Analyst (~0.6B or similar small model)

A **data-analysis worker**, not a Brain and not a controller.

It may:

```text
READ raw/normalized observations
classify context
label candidate intent
label strategy
interpret ObservedEffect
group similar demonstrations
extract knowledge/habit candidates
write derived semantic records
```

It must never:

```text
hold the Brain controller lease
send INTENT_EXECUTE
send BROWSER_COMMAND
send TAB_SWITCH
call BODY directly
mutate raw evidence
increase autonomy by itself
```

Default execution policy:

```text
Human active        -> Analyst OFF
Brain executing     -> Analyst OFF
machine busy        -> Analyst OFF
machine idle        -> Analyst MAY RUN
scheduled/offline   -> Analyst MAY RUN
```

"Offline" means outside the realtime control loop; Internet connectivity is not the deciding factor.

## Browser Manager

Daemon-side authoritative coordinator.

Owns:

```text
Browser Instance registry
active browser/tab state
TaskWorkspace ownership
task -> browser/tab assignment
browser eligibility
controller ownership integration
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

The Extension is **not** the authoritative Manager because MV3 service workers may sleep/restart.

## BODY

BODY has no high-level goal and no personality.

BODY owns physical execution only:

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

BODY may learn low-level motor characteristics such as trajectory and timing.

---

# 3. Identity Model

Do not use one identity for all layers.

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

but must **not hard-code**:

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

# 4. Knowledge, Personality, Motor and Evidence Must Stay Separate

## Knowledge

```text
What is YouTube search?
What page state represents search results?
What effect indicates navigation succeeded?
Which capability is being attempted?
```

## Personality / Habit

```text
Does this Human prefer Enter or click?
Does this Human prefer new tabs?
How does this Human usually correct text?
```

## Motor

```text
mouse trajectory
typing timing
key hold timing
scroll timing
```

## Evidence

```text
what actually happened
who caused it
before state
action
after state
observed effect
outcome
```

Rules:

```text
Brain does not contain Motor.
BODY does not contain Personality.
Knowledge does not automatically become Personality.
Inference does not overwrite Fact.
```

---

# 5. Human vs Agent Data

Permanent invariant:

```text
source = human
  -> may become Human ground truth

source = agent
  -> telemetry / evaluation / verification only
```

Never create:

```text
Brain executes
-> stored as Human
-> Brain learns its own output as Human preference
-> confidence rises artificially
```

Raw Human learning remains local-first.

---

# 6. Raw Evidence vs Derived Inference

Raw evidence is immutable from the Analyst's point of view.

```text
RAW EVIDENCE STORE
       |
       | READ ONLY
       v
DATA FACTORY / ANALYST
       |
       v
DERIVED SEMANTIC STORE
```

Every semantic conclusion must preserve provenance.

Example:

```json
{
  "evidence": {
    "source": "HUMAN",
    "eventIds": ["EV-1001", "EV-1002", "EV-1003"]
  },
  "inference": {
    "capabilityCandidate": "youtube.search",
    "strategyCandidate": "keyboard_enter",
    "confidence": 0.94,
    "producer": "offline-analyst"
  }
}
```

Facts and inferences must remain distinguishable.

Model confidence must **never directly grant autonomy**.

---

# 7. Brain-Ready Semantic Data Contract

The Director Brain should reason primarily over six normalized concepts:

```text
1. SITUATION
   Where am I and what is the current context?

2. CAPABILITY
   What can this Company/Brain currently do and with what evidence?

3. STRATEGY
   What known ways exist to perform this capability?

4. EXPERIENCE
   What happened in similar Human/Agent demonstrations before?

5. EFFECT
   What result should be observed if the action succeeds?

6. POLICY
   Is this action allowed in this context?
```

The Director Brain should receive a compact **Situation Pack**, not entire memory stores.

```text
Goal Pack
+ Situation Pack
+ Capability Pack
+ Strategy Pack
+ Experience Pack
+ Expected Effect
+ Policy Pack
-> Director Brain
```

Example:

```json
{
  "goal": {
    "capability": "youtube.search",
    "query": "robotics"
  },
  "situation": {
    "platform": "youtube",
    "pageType": "home",
    "humanActive": false
  },
  "capability": {
    "autonomy": 2,
    "confidence": 0.94
  },
  "strategies": [
    {
      "id": "SEARCH_ENTER",
      "steps": ["focus_search", "type_query", "press_enter"],
      "humanPreference": 0.91,
      "successRate": 0.97
    }
  ],
  "expectedEffect": {
    "pageType": "search_results"
  },
  "policy": {
    "eligible": true
  }
}
```

This contract is intended to let future Director models change size/vendor without redesigning Human-learning infrastructure.

---

# 8. Data Factory Pipeline

Target pipeline:

```text
Raw Human / Browser Events
          |
          v
Deterministic Normalizer
          |
          v
Action Segmenter
          |
          v
Session Builder
Before + Action + After + Effect
          |
          v
Rules / Statistics Engine
          |
          v
Offline Analyst ~0.6B
semantic classification only
          |
          v
Semantic Experience Compiler
          |
          +------------------+------------------+
          |                  |                  |
          v                  v                  v
      Knowledge           Habits           Experiences
          |                  |                  |
          +------------------+------------------+
                             |
                             v
                  Brain-Ready Memory Store
                             |
                             v
                    Context / Pack Retriever
                             |
                             v
                       Director Brain
```

Do not send huge raw mousemove streams to the model.

Example:

```text
300 mousemove events
-> deterministic trajectory/action feature
-> one compact semantic record
```

Use rules/statistics whenever possible. Use the small model only where semantic classification actually helps.

---

# 9. Newborn Director Brain Definition

The Brain is **newborn in experience and personality**, not blank about foundational schemas.

A Newborn Brain may already know:

```text
action ontology
Brain-ready data schema
task/effect schema
browser concepts
capability framework
policy rules
how to compare expected and observed effects
```

It initially does not know:

```text
Human preference
Human habit
site-specific strategy quality
capability confidence
Human personality
which unfamiliar task it can safely perform
```

The Data Factory exists specifically so the Director Brain does not need to learn how to decode raw event logs.

---

# 10. Task Workspace Model

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

---

# 11. Environment Guardian

Environment Guardian is a local Company module separate from Brain, Data Factory and Extension.

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

Quarantine should be Browser-level whenever possible.

---

# 12. Capability-Specific Autonomy

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
Human demonstration count
successful imitation count
failure rate
context coverage
Human agreement/test approval
ObservedEffect accuracy
strategy consistency
```

Time online, Analyst confidence, Network Score, or Agent self-execution alone must never increase autonomy.

---

# 13. YouTube-First Capability Framework

Initial low-level reference capabilities:

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

Higher-level semantic goals may later use combinations of these capabilities.

The first purpose is to stabilize:

```text
task model
semantic observations
Brain-ready memory
capability evidence
Director reasoning
Browser Manager
BODY
Human override
policy gates
```

---

# 14. Central Topic / Goal Directive Model

Central may later provide high-level Topic Directives rather than physical browser commands.

Example:

```json
{
  "taskType": "topic_campaign",
  "platform": "youtube",
  "topic": "AI robotics",
  "scope": "registered_network_channels",
  "allowedActions": [
    "discover",
    "open",
    "review",
    "collect_metadata"
  ]
}
```

Central responsibility:

```text
identify network-level topic/goal
select eligible Company Nodes
provide policy constraints
receive summaries
```

Local Director responsibility:

```text
understand topic
retrieve relevant channel/video candidates
check registry membership
check capability evidence
check environment
check Human presence
check policy
split work into subtasks
assign local workers/browser resources
verify results
report summary
```

Central must never send mouse coordinates or raw motor sequences.

---

# 15. Capability Workers Under Director Brain

"Subordinates" should normally be bounded capability workers, not independent unrestricted agents.

Example:

```text
Director Brain
   |
   +-- Discovery Worker
   |     -> candidate content/channel discovery
   |
   +-- Relevance Worker
   |     -> topic classification / semantic score
   |
   +-- Registry Worker
   |     -> registered Company/channel validation
   |
   +-- Policy Worker
   |     -> allowed action evaluation
   |
   +-- Execution Planner
         -> structured strategy for Browser Manager/BODY
```

Workers may be implemented with:

```text
rules
database queries
embeddings
small models
specialized deterministic logic
```

They do not automatically receive direct BODY access.

---

# 16. Interaction Policy Gate

The architecture must distinguish legitimate automation from coordinated inauthentic engagement.

Use three policy classes:

```text
SAFE_AUTO
  discovery
  open/navigation
  review/classification
  collect metadata
  internal analysis

HUMAN_APPROVED
  prepare/draft an external interaction
  actions requiring explicit account-owner approval

RESTRICTED
  coordinated fake views/likes/comments
  mass engagement intended to manipulate metrics
  pretending independent accounts are unrelated Humans
  detector/anti-bot evasion
  stealth or fingerprint manipulation
```

"Natural" behavior in this project means **consistent with learned Human preferences for permitted tasks**, not disguising automation or manipulating platform metrics.

---

# 17. Scores Must Stay Separate

Maintain distinct concepts:

```text
Environment Score
Network Score
Capability Score
Participation Score
Online Score
```

Company Trust may aggregate them later, but underlying evidence remains inspectable.

**Network Score must never grant Brain autonomy.**

---

# 18. Development Roadmap

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

Exit criteria:

- CI green for all Body contracts.
- One Chrome records Human events and replays audited page/browser actions.
- Agent events never become Human ground truth.
- Brain lease and debug lock are deterministic.
- Execution truth separates delivered / observed / verified / taskSuccess.

---

## PHASE 2 — LOCAL IDENTITY

**Status: NEXT FOUNDATION.**

Goal: stable identity before multi-browser orchestration expands.

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

Exit criteria:

- Restarting daemon/browser preserves intended logical identity.
- Multiple Browser Instances on one Device remain distinguishable.
- Identity exists on later health/task/capability records.

---

## PHASE 3 — BROWSER MANAGER + TASK WORKSPACE

Goal: daemon-side Browser Manager becomes authoritative for browser/task state.

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

Recommended states:

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
- TaskWorkspace safely owns multiple tabs.
- Extension reconnect does not lose task ownership.
- Task cannot execute on the wrong Browser Instance.

---

## PHASE 4 — ENVIRONMENT GUARDIAN MVP

Goal: decide whether Browser Instance is eligible for autonomous work.

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
- Guardian reports evidence and does not modify environment to evade policy.
- Brain/Manager cannot schedule autonomous work on QUARANTINED browser.

---

## PHASE 5 — SEMANTIC OBSERVATION + RAW EVIDENCE

Goal: create reliable immutable evidence for later analysis.

Deliverables:

```text
Raw Evidence Store
BeforeState
Action
AfterState
ObservedEffect
Outcome
Context
Demonstration timeline
YouTube page-state adapter
provenance IDs
```

Exit criteria:

- Human `youtube.search` demonstration can be reconstructed without raw coordinates alone.
- Facts preserve Human/Agent provenance.
- Sensitive raw data remains local/redacted by policy.

---

## PHASE 6 — DATA FACTORY + OFFLINE ANALYST

Goal: turn raw evidence into Brain-ready semantic data before Director Brain is built.

Deliverables:

```text
Deterministic Normalizer
Action Segmenter
Session Builder
Rules/Statistics Engine
Offline Analyst adapter (~0.6B class)
Semantic Experience Compiler
Knowledge Candidate Store
Habit Candidate Store
Experience Store
Brain-Ready Memory Store
Context/Situation Pack Retriever
```

Hard rules:

```text
Analyst cannot control BODY.
Analyst cannot hold controller lease.
Analyst cannot mutate raw evidence.
Analyst output is inference, not Human fact.
Analyst confidence cannot unlock autonomy.
```

Exit criteria:

- Raw `youtube.search` demonstration compiles into a compact Brain-ready Experience record.
- Brain can retrieve Situation/Capability/Strategy/Experience/Effect/Policy packs without reading raw events.
- Every inference is traceable to source evidence IDs.
- Batch analysis can run while idle/offline without affecting Body responsiveness.

---

## PHASE 7 — NEWBORN DIRECTOR BRAIN

Goal: Brain reasons directly from Brain-ready packs and does not need raw-data understanding logic.

Autonomy:

```text
0 = OBSERVE / REASON / PREDICT ONLY
```

Deliverables:

```text
Goal Pack parser
Situation Pack reader
Knowledge retrieval
Capability Evidence Store
Strategy evaluation
ExpectedEffect reasoning
confidence/evidence API
prediction/evaluation API
```

Exit criteria:

- Brain can explain why it believes `youtube.search` is known or unknown.
- Brain can select a candidate strategy from semantic records without raw logs.
- Brain can identify insufficient evidence instead of inventing certainty.
- Agent execution data alone cannot increase Human preference confidence.

---

## PHASE 8 — IDENTITY / HABIT BRAIN

Goal: learn how Human tends to choose strategies while keeping Knowledge and Motor separate.

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

- Known context returns ranked Human-preferred strategies with evidence.
- Habit model can be reset without deleting Knowledge.
- Motor model can be reset without deleting Personality/Habit.

---

## PHASE 9 — HUMAN OVERRIDE

Goal: Human always wins local control.

### V1 — Page-level

```text
Human page input
-> Brain yields
-> active BODY plan pauses/cancels safely
-> Browser enters HUMAN_CONTROL
```

### V2 — Browser/OS-level

Later add native input observation for Chrome UI actions not visible to content scripts.

Exit criteria:

- Human input reliably interrupts autonomous page execution.
- Body does not race Human.
- Resume requires policy eligibility, not a blind timer.

---

## PHASE 10 — IMITATION + ASSISTED AUTONOMY

Goal: allow only proven capability-specific behavior.

Progression:

```text
Level 0 NEWBORN
  observe only

Level 1 IMITATION
  predict Human strategy
  compare with real Human behavior

Level 2 ASSISTED
  execute explicitly approved capabilities

Level 3 CONTEXT AUTONOMY
  autonomous only inside proven context/policy

Level 4 MATURE CAPABILITY
  Goal -> Plan -> Act -> Observe -> Verify -> Replan
  but only for that proven capability
```

Exit criteria:

- Autonomy is per capability.
- Failed/novel context causes downgrade/wait/replan rather than unrestricted action.
- Human Override remains authoritative.

---

## PHASE 11 — MATURE LOCAL COMPANY

Goal: prove one Company Node can operate locally before depending on Central routing.

Reference path:

```text
Goal
-> Director Brain
-> Situation Pack
-> Identity/Habit strategy
-> Policy check
-> Browser Manager
-> BODY
-> Observation
-> ObservedEffect
-> semantic verification
-> capability evidence update
```

Minimum proof:

- At least one YouTube capability works end-to-end repeatedly.
- Local Company works when Central is offline.
- Environment eligibility is enforced.
- Human Override works.
- Task success is based on semantic effects, not merely input delivery.

**Do not build production Central Task Router before this gate is met.**

---

## PHASE 12 — CENTRAL REGISTRY + PRESENCE + TOPIC DIRECTIVES

Goal: Central can discover healthy network participants and issue high-level goals/topics.

Deliverables:

```text
Company Registry
Device Registry
Browser Registry
Channel Registry
Presence / heartbeat
health summaries
Capability Registry
Topic/Goal Directive schema
policy distribution
```

Exit criteria:

- Central sees Company/Browser capability and health without raw Human data.
- Central can issue a Topic Directive without specifying physical browser actions.
- Local Director may reject a directive that fails capability/environment/policy checks.

---

## PHASE 13 — DISTRIBUTED CAPABILITY WORKERS

Goal: Director can decompose a high-level topic task into bounded subtasks.

Reference flow:

```text
Central Topic Directive
-> Local Director
-> Discovery Worker
-> Relevance Worker
-> Registry Worker
-> Policy Worker
-> Execution Planner
-> Browser Manager/BODY when allowed
-> Result verification
```

Exit criteria:

- Topic candidates can be matched to registered Company/channel metadata.
- Workers have bounded responsibilities and do not bypass Director/Policy/Manager.
- Results remain attributable to Company/Browser/TaskWorkspace.

---

## PHASE 14 — CENTRAL TASK ROUTING + NETWORK SCORES

Goal: route tasks only after local capability evidence exists.

Deliverables:

```text
Online Score
Environment Score
Network Score
Capability Score
Participation Score
Task Router
Task history
Trust/reputation summaries
```

Routing inputs may include:

```text
platform/category match
capability score
environment eligibility
availability
historical task reliability
policy eligibility
```

Hard rule:

```text
Network Score != Brain Autonomy
```

Exit criteria:

- Router assigns goals to eligible Company Nodes without controlling Chrome directly.
- Company may safely reject unsupported tasks.
- Central receives summary evidence/results rather than raw Human telemetry.

---

## PHASE 15 — PLATFORM / NETWORK EXPANSION

Only after YouTube reference architecture is stable:

```text
Facebook
TikTok
other platforms
additional devices/companies
```

New platforms add adapters/capability definitions; they do not create a second BODY architecture.

---

# 19. Architecture Gates — Do Not Skip

## Gate A — BODY before Brain autonomy

No autonomous Brain work until BODY execution/audit contracts are stable.

## Gate B — Identity before large multi-browser operation

Do not scale Browser Instances without stable Company/Device/Browser/Extension identity.

## Gate C — Manager before complex Tasks

Do not use Extension as authoritative Task Manager.

## Gate D — Semantic Evidence before Director Brain

Do not build Director reasoning around raw mouse/keyboard/DOM logs.

## Gate E — Data Factory before mature Brain

A Brain-ready semantic pipeline must exist before attempting sophisticated Director behavior.

## Gate F — Analyst has zero execution authority

Small/offline models analyze data only. They do not control Browser/BODY.

## Gate G — Local maturity before full Central Router

At least one YouTube capability must work repeatedly end-to-end locally before production Central task routing.

## Gate H — Human Override before higher autonomy

Human must be able to reclaim control before Level 3/4 autonomy is enabled.

## Gate I — Policy before distributed interaction

No distributed task may bypass local/network policy checks.

---

# 20. Permanent Guardrails

1. Human is the highest local authority.
2. Central manages the network; it does not directly control Chrome.
3. Brain uses structured contracts, not free-form CMD text as the control plane.
4. `daemon.cmd` is Body Runtime; CMD input is diagnostic/test only.
5. Only one Brain may hold the Body controller lease at a time.
6. Browser Manager is daemon-side authoritative state; Extension is an Adapter.
7. Company and Device are separate identities even if initial deployment is 1:1.
8. Tab is a TaskWorkspace resource, not an Agent.
9. Knowledge, Personality/Habit, Motor and Evidence are separate models.
10. Human data and Agent data stay separate.
11. BODY does not contain Personality.
12. Brain does not contain low-level Motor generation.
13. Raw evidence is not the Director Brain API.
14. Analyst inference does not overwrite Human fact.
15. Offline/small Analyst has no execution authority.
16. Autonomy is per capability, never globally unlocked.
17. Network Score does not unlock autonomy.
18. Analyst/model confidence does not unlock autonomy.
19. Raw Human learning stays local-first by default.
20. Central receives summaries/evidence, not raw sensitive Human streams.
21. Browser quarantine should isolate the bad Browser before the whole Company.
22. No environment/fingerprint/proxy/VPN concealment or detector evasion.
23. YouTube remains the reference platform until end-to-end maturity.
24. Full Central Task Router comes after Mature Local Company proof.
25. New platforms reuse Manager/BODY architecture rather than forking motor systems.
26. Distributed content work must pass policy gates.
27. Coordinated fake engagement, metric manipulation and stealth impersonation are out of scope.

---

# 21. Current Priority

Current project priority is **not** to build the largest possible Brain.

The priority is:

```text
1. stabilize BODY
2. establish Local Identity
3. establish Browser Manager + TaskWorkspace
4. establish Environment Guardian
5. create reliable Raw/Semantic Observation
6. build Data Factory + Offline Analyst
7. produce Brain-Ready Semantic Memory
8. only then build Newborn Director Brain
```

The near-term proof target is:

```text
Human performs a YouTube capability
-> system records immutable evidence
-> deterministic processor compresses raw events
-> Offline Analyst labels semantic candidates
-> Experience Compiler creates Brain-ready record
-> Director Brain retrieves the correct Situation Pack
-> Brain understands the demonstration without reading raw logs
```

That proof is the foundation for later autonomous reasoning, distributed task coordination and Central topic routing.
