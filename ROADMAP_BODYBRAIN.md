# BodyBrain Product Roadmap

## Product architecture (locked direction)

The product ships as two user-facing components:

1. **BodyBrain desktop application** — one Windows background application containing three logical domains:
   - **GUARDIAN**: decides whether a browser/environment is allowed to operate.
   - **BRAIN**: decides WHAT / WHY / NEXT and evaluates semantic outcome.
   - **BODY Core**: executes exactly one authorized Body step, observes facts, manages motor state/learning and durable at-most-once execution.
2. **Chrome BODY Extension** — the Chrome-resident part of BODY: Eyes/sensors, Human recorder, environment evidence and Chrome/CDP actuator bridge.

```text
WINDOWS
  |
  v
BodyBrain desktop app
  |
  +-- GUARDIAN
  |     +-- EnvironmentGuardian
  |     +-- ProtectionSupervisor
  |     +-- ExternalControllerProbe
  |     +-- Human-control / readiness gate
  |
  +-- BRAIN
  |     +-- Goal / task reasoning
  |     +-- Data Factory
  |     +-- Context Builder
  |     +-- Director
  |     +-- Memory / Feedback
  |
  +-- BODY Core
        +-- BodyGateway
        +-- Proprioception / pointer state
        +-- StepLedger
        +-- Motor / MotorLearning
        +-- Human evidence pipeline
        |
        +-- BODY Contract v1
                 |
                 v
          Chrome BODY Extension
                 |
                 +-- Observe / semantic sensors
                 +-- Environment evidence
                 +-- Human input recorder
                 +-- CDP / browser actuator
                 |
                 v
               Chrome
```

## Immutable authority boundaries

- **GUARDIAN** may block or allow execution; Brain cannot override a Guardian block.
- **BRAIN** owns semantic task reasoning, success/failure judgment and next-step selection.
- **BODY** owns physical implementation and motor learning only; it changes HOW, never WHAT.
- **Chrome Extension** is part of BODY, not a fourth reasoning system.
- Production Brain physical execution goes through `BODY_STEP` only.
- One durable `BODY_STEP` identity permits at most one physical attempt.
- BODY returns factual observations/results and never task judgment or retry advice.
- Human and Agent provenance remain strictly separate.

## Delivery roadmap

| Phase | Scope | Acceptance gate | Status |
|---|---|---|---|
| 0 | BODY Contract v1 | PR #7 CI green; final review; explicit merge approval | REVIEW_READY / not merged |
| 1 | Production Chrome Extension package | Release build is bundled + minified, has no sourcemaps/local remembered runtime port, and produces one deterministic ZIP artifact | IN PROGRESS |
| 2 | Desktop Host foundation | One desktop entrypoint starts/stops internal runtime workers, owns paths/config/logging and exposes health | PLANNED |
| 3 | Guardian startup/readiness integration | Desktop will not start production Brain work until Chrome environment + protection/controller checks reach READY | PLANNED |
| 4 | BODY Core integration | Desktop automatically hosts existing BODY runtime; user no longer runs `npm run daemon`/CMD | PLANNED |
| 5 | Python Brain skeleton + BodyClient | Python Brain can only call status/observe/step/task APIs through the BODY boundary; no CDP/native/motor internals | PLANNED |
| 6 | Data Factory v1 | Raw evidence -> deterministic processing -> durable normalized records with provenance | PLANNED |
| 7 | Context Builder v1 | Build bounded `BrainSituationPack` from current task, BODY facts, environment and selected history | PLANNED |
| 8 | Director Brain v1 | Observe -> reason -> choose exactly one semantic step -> BODY_STEP -> evaluate -> repeat | PLANNED |
| 9 | Brain Feedback / Memory | Store semantic outcomes and feedback separately from BODY Human motor-learning data | PLANNED |
| 10 | Desktop packaging | Produce one `BodyBrain.exe` product entrypoint; internal workers are not user-managed | PLANNED |
| 11 | Integrity/signing/installer | Signed desktop artifact + versioned Extension package + release manifest + installer/autostart policy | PLANNED |
| 12 | Full E2E release gate | Real Chrome: Guardian READY -> Brain task -> BODY one-step execution -> factual result -> Brain evaluation; restart/duplicate/quarantine tests pass | PLANNED |

## Phase 1 — Extension release package

Release rules:

- Source modules under `src/` are development inputs only and are **not shipped**.
- Each required Manifest V3 execution context is bundled by esbuild into its own single runtime bundle (`service_worker.js`, `virtual_cursor_content.js`, `pairing_popup.js`). Chrome requires separate entry files for these separate execution contexts, so they cannot safely become one JavaScript file.
- Release JavaScript is minified.
- Release builds contain no `.map` files and no `sourceMappingURL` references.
- `runtime-endpoint.json` in a release is neutral/inactive and must never embed a remembered port from the developer/build machine.
- The deliverable is one deterministic `body-chrome-attach-v<version>.zip` artifact containing only runtime files required by the Extension.
- Private signing keys (`*.pem`) are never committed or placed inside the release ZIP.
- A future signed CRX / Chrome Web Store deployment may consume this ZIP, but key management/signing remains a separate release-security step.

Expected package contents:

```text
body-chrome-attach-v0.8.0.zip
  manifest.json
  pairing.html
  runtime-endpoint.json
  service_worker.js
  virtual_cursor_content.js
  pairing_popup.js
```

## Desktop startup target

```text
BodyBrain starts
  -> verify product/runtime integrity
  -> start internal BODY runtime
  -> wait for Chrome BODY Extension
  -> identify BrowserInstance
  -> EnvironmentGuardian probe
  -> external-controller/protection scan
  -> readiness = READY
  -> start/enable Brain production work
```

If readiness becomes BLOCKED later, the Browser is quarantined and no new physical step may be authorized until the protection state is cleared.

## Release principle

**One product, three logical authorities, one Chrome BODY extension.**

Development source remains modular and testable; production ships built artifacts rather than the source tree. Packaging/obfuscation must never be used to weaken contract tests, provenance separation, Guardian hard gates or at-most-once execution.
