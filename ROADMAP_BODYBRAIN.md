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
| B | Chrome BODY Extension release package | Bundled/minified ZIP + signed CRX, no source maps/dev source | DONE |
| C | Desktop Host foundation | Deterministic paths, redacted logs, health, worker supervision, clean shutdown/orphan cleanup | IMPLEMENTED |
| D | Guardian + BODY hosted runtime | EXE starts BODY internally; waits for Extension; Guardian remains fail-closed | IMPLEMENTED |
| E | One-file Windows release | Bundle Node + native input helper; build/smoke actual `BodyBrain.exe`; release hashes | DONE |
| F | Release acceptance | CI build/contracts green + manual real-Chrome first-start/restart/token-reuse + final diff/security review | MANUAL GATE |

## Extension release artifact

Primary signed packaged Extension:

```text
artifacts\BodyChromeAttach-v0.8.0.crx
Extension ID: lgjlhlfiihfbehgjghpbkmngfpdnclhc
SHA-256: 80aad0d0e86f6676481cdf82cf7173e624c74784384d63ae4763178c4bb06fd2
```

`npm run extension:package` builds the release ZIP and materializes the exact signed CRX from the versioned release payload stored in the repository. The private signing key is never stored in the repository.

## Manual real-Chrome acceptance

Real-Chrome release acceptance is intentionally human-operated. CI does not launch or control Chrome. Follow `MANUAL_RELEASE_TEST.md` to verify first-start readiness, Desktop restart reconnect, pairing token reuse, Brain `NOT_CONFIGURED`, and Guardian fail-closed behavior.

## Brain R&D track

Brain development is intentionally not scheduled as a production stage here. It should be researched and validated on a separate branch/roadmap. Only after its architecture is approved should a future integration contract be proposed. That future work must not weaken Guardian authority or BODY ownership of physical execution.

## Release result expected

A user installs the signed Chrome BODY Extension and runs one `BodyBrain.exe`. The executable starts and owns BODY runtime workers, persists BODY data outside the one-file extraction directory, waits for Chrome, reports Guardian/Extension health, shuts down cleanly, and contains no production Brain logic.
