# BODY CONTRACT v1

> Canonical and stable boundary between Director Brain and BODY.
>
> BODY is a learnable body, not a second brain. Future implementations may change inside BODY, but this contract must not silently change meaning.

## 1. Definition

BODY observes the browser/environment, maintains physical state, executes exactly one requested Body step per command, learns HOW to perform motor actions from Human data, and returns observed facts.

BODY does not decide task success/failure, correctness, goal completion, retry, replan, or the next semantic action.

```text
BRAIN decides WHAT / WHY / WHAT NEXT.
BODY learns HOW and reports WHAT HAPPENED.
```

## 2. Stable Brain boundary

Brain may use two BODY operations:

```text
BODY_OBSERVE  -> BODY_OBSERVE_RESULT
BODY_STEP     -> BODY_STEP_RESULT
```

`BODY_STEP` is the only production physical-action command exposed to Brain.

Legacy production Brain commands such as `INTENT_EXECUTE`, `STRATEGY_EXECUTE`, `TAB_SWITCH`, and `BROWSER_COMMAND` are not part of BODY Contract v1. Internal debug tooling may still exercise lower layers, but it is not a Brain API.

## 3. One command / one step / one result

For every valid `BODY_STEP`:

```text
one BODY_STEP command
    -> at most one requested Body step is physically attempted
    -> no Body-level retry/replan loop
    -> one BODY_STEP_RESULT is returned
```

A Body step may contain many low-level input events needed to physically perform that one step (for example, a learned mouse trajectory contains many `mouseMoved` events). Those low-level events are implementation details, not additional Brain steps.

### Durable step identity

`taskId + stepId` is the durable idempotency identity of one Body step.

Before physical execution, BODY durably reserves that identity. Therefore:

```text
same taskId + stepId + same command
  -> never performs the physical step a second time
  -> completed result is replayed when available

same taskId + stepId + different command
  -> body_step_id_conflict
  -> no physical execution

step was RESERVED but final outcome is unavailable after restart/crash
  -> body_step_outcome_unknown
  -> BODY does not execute it again
```

Transport `requestId` is not part of step identity. A network retry may use a new requestId and still refer to the same Body step.

This contract guarantees **at-most-once physical execution**, including duplicate delivery and daemon restart. When outcome is unknown, Brain must observe/reason and create a new stepId if it decides another action is required.

## 4. BODY modules

```text
BodyGateway
  - stable Brain/BODY contract
  - durable Body-step identity / replay

Eyes / Observation
  - browser/tab context
  - known controls and their geometry
  - semantic page/content observations
  - environment eligibility/state
  - observation freshness

Proprioception
  - pointer position
  - active tab/window state
  - focus/scroll state when observed

Motor
  - page mouse/keyboard actions
  - browser UI actions
  - tab switching

StepExecutor
  - executes one Body step at most once
  - never chooses the next semantic step

Recorder
  - immutable/raw Human and Agent evidence with provenance

MotorLearning
  - learns Human-derived trajectory/timing/motor habits
  - improves HOW an already-requested action is physically performed
```

## 5. Learning boundary

Human and Agent provenance remain separate.

```text
Human evidence -> may update Human MotorLearning
Agent evidence -> telemetry/evaluation evidence only
```

Agent behavior must never become Human ground truth merely because BODY executed it.

MotorLearning may choose physical implementation details such as learned trajectory, timing, hold duration, scroll burst shape, or other motor parameters. It must not choose a different task goal or invent the next semantic action.

## 6. Facts BODY may return

BODY may return factual execution/observation data such as:

```text
command accepted/rejected
physical attempt count (0 or 1)
whether this result was replayed
physical dispatch true / false / unknown
physical step completed or interrupted
technical error code/message
pointer before/after
current tab/browser identity
known control geometry
semantic/content observation
navigation/focus/scroll changes observed
environment/browser state
observation freshness
```

If a lower layer fails after an attempt begins and BODY cannot prove whether any physical input was already dispatched, `dispatched` is `null`. BODY must not turn unknown into false.

Technical completion is not semantic task success.

## 7. Judgment fields forbidden at Brain boundary

A `BODY_STEP_RESULT` must never contain fields whose meaning claims task judgment, including:

```text
success
taskSuccess
verified
verification
goalAchieved
correct
wrong
shouldRetry
nextAction
recommendedAction
```

Internal adapters may use physical state-change checks to gather observations, but those checks cannot cross the BodyGateway as task judgment.

## 8. Error rule

BODY may know a physical/technical error, for example:

```text
pointer_state_required
tab_not_found
browser_offline
forbidden_method
execution_deadline_exceeded
body_step_id_conflict
body_step_outcome_unknown
```

BODY reports the technical fact and stops. Brain decides whether that means WAIT, RETRY with a new step, REPLAN, REQUEST_EVIDENCE, FAIL, or anything else.

BODY never automatically retries the physical step.

## 9. Observation truth rule

BODY never invents state. Unknown/stale observation is returned as unknown/stale.

`BODY_OBSERVE` and the before/after observation around a Body step request a live `BODY_OBSERVE_SNAPSHOT` from the Extension when available. The live Eyes snapshot includes current tab metadata, page focus/active target, scroll/viewport state, semantic controls/content supported by the observer, and pointer state.

If live refresh is unavailable, BODY may return cached facts only with explicit freshness metadata.

Examples:

```text
pointer unknown -> do not invent 400,300
missing window/navigation state -> null, not 0
semantic observation unavailable -> available=false
cached semantic/control observation -> include age/freshness
live snapshot failure -> liveRefreshSucceeded=false
```

## 10. Task/Company Runtime boundary

Company Runtime may keep TaskManager, policy, environment, authentication, controller lease, and workspace ownership as execution authorization infrastructure.

BODY itself does not decide the task lifecycle. Director Brain owns semantic task reasoning and may separately tell Company Runtime to start/complete/fail/cancel a task.

A `BODY_STEP` never implicitly starts a Task. Brain must explicitly send `TASK_START` first, and the Task must already be `RUNNING` before BODY is authorized to perform a physical step.

`BODY_STEP` also requires a valid TaskWorkspace scope so physical execution cannot escape the assigned Browser/Tab.

## 11. Versioning

```text
BODY Contract version = 1.0
```

Compatible additive fields may be introduced within major version 1 if they do not change existing semantics.

Any change to the six invariants below requires a new major contract version.

## 12. Six immutable invariants

1. One BODY_STEP identity requests one Body step and permits at most one physical attempt.
2. BODY returns facts, not task judgment.
3. Brain alone decides semantic success/failure and the next step.
4. BODY learning changes HOW, never WHAT goal to pursue.
5. Human and Agent provenance remain strictly separate.
6. Brain does not access CDP, native-input, MotorLearning templates, or other BODY internals directly.

## 13. Relation to Brain Data Contract

`BRAIN_DATA_CONTRACT.md` governs the semantic Data Factory / Context Builder / Director boundary.

This file governs the separate physical body boundary.

```text
BrainSituationPack -> Director Brain -> TASK_START
                                      -> BODY_OBSERVE
                                      -> BODY_STEP
                                      -> BODY_STEP_RESULT
                                      -> Director evaluation / BrainFeedbackRecord
```

BODY does not consume BrainSituationPack and does not emit BrainFeedbackRecord. It only executes and observes.
