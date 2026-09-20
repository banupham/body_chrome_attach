# Guardian module — split-test track

Authority order:
HUMAN > GUARDIAN > BRAIN > BODY

Guardian is a separate authority, not a BODY mode.

Guardian owns:
- device/network inspection;
- Chrome/browser environment inspection;
- public IP / proxy / VPN observation;
- deep browser fingerprint/protection signals;
- third-party Chrome automation/controller detection;
- mouse/keyboard behavior conflict observation;
- allow/revoke decisions for Brain CDP execution.

BODY owns no Guardian policy. BODY only exposes a narrow external authority gate:
- Guardian connects with its own guardian.token;
- Guardian issues GUARDIAN_GATE_SET / GUARDIAN_GATE_REVOKE;
- BODY checks that opaque grant immediately before Brain physical execution;
- without a current grant, Brain CDP is fail-closed;
- Human local control remains higher authority and bypasses the Brain gate.

Guardian may request raw BODY observations and the extension environment probe through the Guardian-only protocol. BODY forwards facts; Guardian evaluates them.

Guardian implementation payload:
- EnvironmentGuardian
- ProtectionSupervisor
- BehaviorGuardian
- DeviceNetworkProbe
- ExternalControllerProbe
- authority_contract.js

The BODY-only artifact intentionally excludes Guardian implementation files. It contains only guardian_authority_gate.js, which performs no policy evaluation.

This branch is for independent component testing and is not merged into main.
