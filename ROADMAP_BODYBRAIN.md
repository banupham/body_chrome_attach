# BODY Product Roadmap

## Production target

The current production target is **BODY**, delivered as two user-facing components:

1. **`BodyBrain.exe`** — Windows host containing Desktop Host + Guardian + BODY Core.
2. **Chrome BODY Extension** — Chrome-resident sensors, Human recorder, environment evidence and actuator bridge.

**Brain is not part of the current production release.** Brain remains a separate R&D track until its reasoning, planning, context and memory architecture is approved.

```text
Windows
  |
  v
BodyBrain.exe
  +-- Desktop Host
  +-- Guardian
  +-- BODY Core
  |
  +---- authenticated local status/readiness channel
             |
             v
      Chrome BODY Extension
             |
             v
           Chrome

Brain
  -> separate R&D track
  -> NOT_CONFIGURED in production health
```

## Locked production boundaries

- Guardian owns ALLOW / BLOCK and remains fail-closed.
- BODY owns physical implementation, observation, provenance, StepLedger and motor learning.
- Chrome Extension is part of BODY.
- Desktop production code does not reason about WHAT / WHY / NEXT.
- Desktop production status client is read-only and does not expose physical action commands.
- Human and Agent provenance remain separate.
- One-file extraction never owns persistent identity/auth/task/evidence/learning/ledger state; persistent BODY state lives under `%LOCALAPPDATA%\BodyBrain\body`.
- Brain is reported as `NOT_CONFIGURED`; production packaging does not import or bundle Brain modules.

## Production delivery plan

| Stage | Scope | Acceptance gate | Status |
|---|---|---|---|
| A | BODY Contract + provenance + at-most-once execution | Contract/regression tests green | DONE |
| B | Chrome BODY Extension release package | Bundled/minified ZIP, no source maps/dev source, deterministic package | DONE |
| C | Desktop Host foundation | Deterministic paths, redacted logs, health, worker supervision, clean shutdown/orphan cleanup | IMPLEMENTED |
| D | Guardian + BODY hosted runtime | EXE starts BODY internally; waits for Extension; Guardian remains fail-closed | IMPLEMENTED |
| E | One-file Windows release | Bundle Node + native input helper; build/smoke actual `BodyBrain.exe`; release hashes | CI GATE |
| F | Release acceptance | CI green, final diff/security review, artifacts published | PENDING |

## Brain R&D track

Brain development is intentionally not scheduled as a production stage here. It should be researched and validated on a separate branch/roadmap. Only after its architecture is approved should a future integration contract be proposed. That future work must not weaken Guardian authority or BODY ownership of physical execution.

## Release result expected

A user installs the Chrome BODY Extension and runs one `BodyBrain.exe`. The executable starts and owns BODY runtime workers, persists BODY data outside the one-file extraction directory, waits for Chrome, reports Guardian/Extension health, shuts down cleanly, and contains no production Brain logic.
