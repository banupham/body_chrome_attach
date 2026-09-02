# BRAIN DATA CONTRACT v1

> Canonical producer/consumer boundary between the local Data Factory / Offline Analyst and the Director Brain.
>
> If code, prompts, storage, model choice, or later architecture conflicts with this contract, update and review this contract first. Do not silently change the meaning of Brain-ready data.

## 1. Purpose

The Director Brain must not learn how to decode raw mouse, keyboard, DOM, or browser timelines. The Data Factory side converts raw evidence into stable semantic records. The Brain side consumes a compact Situation Pack built from those records.

```text
RAW EVIDENCE
    |
    v
Deterministic Processor
    |
    v
Offline Analyst / small model
    |
    v
Semantic Experience Compiler
    |
    v
BrainReadyRecord Store
    |
    v
Context Builder
    |
    v
BrainSituationPack
    |
    v
Director Brain
    |
    v
BrainFeedbackRecord
```

The contract has three machine-readable objects:

```text
BrainReadyRecord     = producer-side immutable semantic evidence/candidate
BrainSituationPack   = consumer-side reasoning input
BrainFeedbackRecord  = structured post-decision/result feedback
```

Schemas live in `contracts/brain-data/v1/`.

---

## 2. Non-negotiable authority boundary

### Data Factory / Offline Analyst

May:

```text
READ raw or normalized evidence
READ deterministic features/statistics
classify semantic context
create candidate intent/capability labels
create candidate strategy labels
interpret observed effects
group demonstrations
create content/topic semantic labels
create knowledge/habit candidates
WRITE BrainReadyRecord
```

Must not:

```text
hold the Brain controller lease
call BODY
send INTENT_EXECUTE
send STRATEGY_EXECUTE
send TAB_SWITCH
send BROWSER_COMMAND
set authoritative autonomy
set authoritative policy eligibility
mutate raw evidence
rewrite Human facts
mark Agent behavior as Human ground truth
```

### Context Builder

May:

```text
READ BrainReadyRecord
READ authoritative Capability Registry
READ Environment Guardian state
READ Policy state
READ current Browser/Task state
rank/retrieve relevant memory
WRITE BrainSituationPack
```

It does not control BODY.

### Director Brain

May:

```text
READ BrainSituationPack
reason about Goal / Situation / Capability / Strategy / Experience / Effect / Policy
select/reject/replan bounded tasks
WRITE BrainFeedbackRecord
use the separate structured Body control API when policy and autonomy permit
```

Must not:

```text
rewrite BrainReadyRecord
rewrite raw Human evidence
reinterpret Agent evidence as Human preference
increase autonomy merely because an Analyst confidence is high
use raw event logs as its normal reasoning API
```

---

## 3. The producer output: BrainReadyRecord

Every semantic unit created by the Data Factory side is one immutable `BrainReadyRecord`.

Canonical record classes:

```text
demonstration
pattern
habit_candidate
capability_candidate
content_semantic
effect_evidence
knowledge_candidate
```

A record separates **facts** from **inferences**.

### Facts

Facts are observations supported directly by evidence, for example:

```text
Human pressed Enter
URL/navigation token changed
search-result state appeared
Human used a keyboard action
video/channel metadata was observed
```

### Inferences

Inferences are model/rule interpretations, for example:

```text
candidate capability = youtube.search
candidate strategy = keyboard_enter
candidate topic = robotics
candidate Human preference = Enter after typing
```

An inference always has:

```text
type
value
confidence 0..1
method
supporting evidence refs
```

Inference never overwrites a fact.

### Required provenance

Every record must preserve:

```text
recordId
schemaVersion
producer identity/version
company/device scope
source provenance
rawEvidenceRefs and/or derivedFrom refs
createdAt
```

If `provenance.source == human`, at least one raw evidence reference is required.

### Human/Agent rule

```text
source = human
  -> may support Human ground truth / preference candidates

source = agent
  -> telemetry, evaluation, verification, failure/success evidence only
```

Agent-derived evidence must never increase Human-preference counts as if a Human demonstrated it.

### Analyst confidence is not authority

`quality.overallConfidence` and inference confidence mean only:

> How strongly the producer believes the semantic interpretation is supported.

They do **not** mean:

```text
permission
policy eligibility
autonomy level
task success
right to execute
```

The producer schema therefore has no authoritative `autonomy` field.

---

## 4. The consumer input: BrainSituationPack

The Director Brain receives one compact, immutable reasoning snapshot per decision cycle.

A Pack contains seven sections:

```text
GOAL
SITUATION
CAPABILITIES
STRATEGIES
EXPERIENCES
EXPECTED EFFECTS
POLICY + ENVIRONMENT
```

The Pack also includes every source record ID used to build it.

### Goal

What the Brain is being asked to accomplish.

Example:

```json
{
  "type": "youtube.search",
  "parameters": {
    "query": "robotics"
  }
}
```

### Situation

Current semantic context, not raw DOM/event logs.

Example:

```json
{
  "platform": "youtube",
  "pageType": "home",
  "humanActive": false,
  "browserState": "ACTIVE"
}
```

### Capabilities

Unlike Analyst output, capability entries in a Situation Pack may contain authoritative autonomy because the Context Builder obtains it from the Capability Registry, not from the Analyst.

```json
{
  "name": "youtube.search",
  "autonomy": 2,
  "confidence": 0.94,
  "evidenceRecordIds": ["BRR-100", "BRR-101"]
}
```

### Strategies

Compact candidate strategies relevant to this situation.

```json
{
  "id": "SEARCH_ENTER",
  "capability": "youtube.search",
  "steps": ["focus_search", "type_query", "press_enter"],
  "humanPreference": 0.91,
  "successRate": 0.97,
  "evidenceRecordIds": ["BRR-100"]
}
```

These are semantic steps. They are not CDP coordinates or native key/mouse instructions.

### Experiences

Only the most relevant records are included, with retrieval relevance and provenance IDs.

### Expected effects

What observable semantic change would support success.

Example:

```json
{
  "capability": "youtube.search",
  "effectType": "page_state",
  "expected": {
    "pageType": "search_results"
  },
  "evidenceRecordIds": ["BRR-100"]
}
```

### Policy and environment

The Pack must include current eligibility before a Brain can choose execution.

Policy classes remain:

```text
SAFE_AUTO
HUMAN_APPROVED
RESTRICTED
```

A high model confidence never overrides a blocked policy or an ineligible environment.

---

## 5. Brain consumption rules

The Director must follow these rules for every Pack:

1. Reject unsupported major `packVersion`.
2. Do not fetch raw Human logs merely to compensate for missing semantic data during normal reasoning.
3. Treat `facts` as evidence and `inferences` as candidates.
4. Treat `confidence` as uncertainty, not permission.
5. Require policy/environment eligibility before execution.
6. Require capability-specific autonomy before autonomous execution.
7. If required data is absent or contradictory, return `WAIT`, `REQUEST_EVIDENCE`, or a bounded replan rather than inventing certainty.
8. Never infer Human preference from Agent-only evidence.
9. Keep the source record IDs used for each decision.
10. Emit structured feedback after execution/evaluation.

---

## 6. Feedback contract

Brain output must not mutate producer records.

Instead:

```text
Director decision/result
        |
        v
BrainFeedbackRecord
        |
        v
Feedback Store
        |
        +--> future Data Factory evaluation
        +--> capability evidence
        +--> failure analysis
```

A feedback record includes:

```text
feedbackId
decisionId
packId
consumedRecordIds
selected capability/strategy
execution delivery result
observed verification result
semantic taskSuccess if known
error/failure category if any
source = agent
```

This provides a closed loop without contaminating Human ground truth.

The Offline Analyst may later read structured Brain feedback as `source=agent`, but must not convert it into Human preference evidence.

---

## 7. Versioning contract

Initial versions:

```text
BrainReadyRecord.schemaVersion   = "1.0"
BrainSituationPack.packVersion   = "1.0"
BrainFeedbackRecord.feedbackVersion = "1.0"
```

Compatibility rule:

```text
same major version
  -> additive optional fields may be accepted

new major version
  -> consumer must explicitly support it
```

Never silently change the meaning, units, provenance semantics, or authority of an existing field.

If a field changes meaning, create a new major version.

---

## 8. Stable identifiers

IDs must be opaque and stable within the local Company data domain.

Recommended prefixes:

```text
BRR-  BrainReadyRecord
BSP-  BrainSituationPack
BFR-  BrainFeedbackRecord
DEC-  Brain decision
TASK- Task
WS-   TaskWorkspace
```

The contract does not require sequential IDs.

---

## 9. Example end-to-end exchange

Human demonstration:

```text
YouTube home
-> focus search
-> type "robotics"
-> Enter
-> search results observed
```

Data Factory creates:

```json
{
  "schemaVersion": "1.0",
  "recordType": "brain_ready_record",
  "recordId": "BRR-100",
  "recordClass": "demonstration",
  "producer": {
    "kind": "semantic_compiler",
    "id": "local-data-factory-v1"
  },
  "scope": {
    "companyId": "COMPANY-A",
    "deviceId": "DEVICE-A",
    "platform": "youtube"
  },
  "provenance": {
    "source": "human",
    "rawEvidenceRefs": ["EV-1", "EV-2", "EV-3"],
    "derivedFrom": [],
    "immutable": true
  },
  "facts": [
    {"type": "submit_key", "value": "Enter", "evidenceRefs": ["EV-2"]},
    {"type": "after_page_type", "value": "search_results", "evidenceRefs": ["EV-3"]}
  ],
  "inferences": [
    {
      "type": "capability_candidate",
      "value": "youtube.search",
      "confidence": 0.97,
      "method": "offline_analyst",
      "evidenceRefs": ["EV-1", "EV-2", "EV-3"]
    }
  ],
  "semantic": {
    "capabilityCandidate": {
      "name": "youtube.search",
      "confidence": 0.97
    },
    "strategyCandidate": {
      "id": "SEARCH_ENTER",
      "steps": ["focus_search", "type_query", "press_enter"],
      "confidence": 0.95
    },
    "effect": {
      "pageType": "search_results"
    }
  },
  "quality": {
    "overallConfidence": 0.96,
    "humanSampleCount": 1,
    "agentSampleCount": 0
  },
  "createdAt": "2026-09-03T03:50:00+07:00"
}
```

Context Builder later creates:

```json
{
  "packVersion": "1.0",
  "packId": "BSP-900",
  "goal": {
    "type": "youtube.search",
    "parameters": {"query": "robotics"}
  },
  "situation": {
    "platform": "youtube",
    "pageType": "home",
    "humanActive": false,
    "browserState": "ACTIVE"
  },
  "capabilities": [
    {
      "name": "youtube.search",
      "autonomy": 2,
      "confidence": 0.94,
      "evidenceRecordIds": ["BRR-100"]
    }
  ],
  "strategies": [
    {
      "id": "SEARCH_ENTER",
      "capability": "youtube.search",
      "steps": ["focus_search", "type_query", "press_enter"],
      "humanPreference": 0.91,
      "successRate": 0.97,
      "evidenceRecordIds": ["BRR-100"]
    }
  ],
  "experiences": [
    {"recordId": "BRR-100", "relevance": 0.99}
  ],
  "expectedEffects": [
    {
      "capability": "youtube.search",
      "effectType": "page_state",
      "expected": {"pageType": "search_results"},
      "evidenceRecordIds": ["BRR-100"]
    }
  ],
  "policy": {
    "class": "SAFE_AUTO",
    "eligible": true,
    "allowedActions": ["search", "open", "review"],
    "blockedActions": []
  },
  "environment": {
    "eligible": true,
    "browserState": "ACTIVE"
  },
  "sourceRecordIds": ["BRR-100"],
  "createdAt": "2026-09-03T03:50:01+07:00"
}
```

Director Brain now reasons from this Pack. It does not need the original mousemove/key timeline.

---

## 10. Acceptance gates before Director implementation

The Producer/Consumer boundary is considered stable only when all are true:

- One `youtube.search` Human demonstration can produce a valid `BrainReadyRecord`.
- Every Human-derived inference traces back to immutable raw evidence IDs.
- Agent-only records cannot become Human preference ground truth.
- Analyst output cannot set autonomy or execution permission.
- Context Builder can create a valid `BrainSituationPack` without raw mouse/keyboard events.
- Director can choose `KNOWN / UNKNOWN / INSUFFICIENT_EVIDENCE` from a Pack alone.
- Director feedback is written as a new `BrainFeedbackRecord`, never by editing the input record.
- Replacing the Offline Analyst model does not change the contract.
- Replacing the Director model does not change the contract.

Until these gates pass, do not couple the Director implementation directly to Data Factory internals.

---

## 11. Final invariant

```text
SMALL MODEL / DATA FACTORY
= PRODUCES EVIDENCE AND CANDIDATES

CONTEXT BUILDER
= PRODUCES THE REASONING PACK

DIRECTOR BRAIN
= CONSUMES THE PACK AND DECIDES

BODY
= EXECUTES ONLY THROUGH ITS SEPARATE CONTROL CONTRACT
```

The producer creates meaning. The consumer uses meaning. Neither side is allowed to silently take over the other's responsibility.
