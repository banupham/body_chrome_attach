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
    -> at most one requested Body step is attempted
    -> no Body-level retry/replan loop
    -> one BODY_STEP_RESULT is returned
```

A Body step may contain many low-level input events needed to physically perform that one step (for example, a learned mouse trajectory contains many `mouseMoved` events). Those low-level events are implementation details, not additional Brain steps.

## 4. BODY modules

```text
BodyGateway
  - stable Brain/BODY contract

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
  - executes one Body step once
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
physical dispatch attempted or not
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
```

BODY reports the technical fact and stops. Brain decides whether that means WAIT, RETRY, REPLAN, REQUEST_EVIDENCE, FAIL, or anything else.

## 9. Observation truth rule

BODY never invents state. Unknown/stale observation is returned as unknown/stale.

Examples:

```text
pointer unknown -> do not invent 400,300
semantic observation unavailable -> available=false
cached semantic/control observation -> include age/freshness
```

## 10. Task/Company Runtime boundary

Company Runtime may keep TaskManager, policy, environment, authentication, controller lease, and workspace ownership as execution authorization infrastructure.

BODY itself does not decide the task lifecycle. Director Brain owns semantic task reasoning and may separately tell Company Runtime to complete/fail/cancel a task.

`BODY_STEP` requires a valid Task scope so physical execution cannot escape the TaskWorkspace.

## 11. Versioning

```text
BODY Contract version = 1.0
```

Compatible additive fields may be introduced within major version 1 if they do not change existing semantics.

Any change to the six invariants below requires a new major contract version.

## 12. Six immutable invariants

1. One BODY_STEP command requests one Body step and produces one result.
2. BODY returns facts, not task judgment.
3. Brain alone decides semantic success/failure and the next step.
4. BODY learning changes HOW, never WHAT goal to pursue.
5. Human and Agent provenance remain strictly separate.
6. Brain does not access CDP, native-input, MotorLearning templates, or other BODY internals directly.

## 13. Relation to Brain Data Contract

`BRAIN_DATA_CONTRACT.md` governs the semantic Data Factory / Context Builder / Director boundary.

This file governs the separate physical body boundary.

```text
BrainSituationPack -> Director Brain -> BODY_STEP
                                      -> BODY_STEP_RESULT
                                      -> Director evaluation / BrainFeedbackRecord
```

BODY does not consume BrainSituationPack and does not emit BrainFeedbackRecord. It only executes and observes.
