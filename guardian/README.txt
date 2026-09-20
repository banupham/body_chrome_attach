Guardian standalone module — split-test track

Authority order:
HUMAN > GUARDIAN > BRAIN > BODY

Guardian is a separate runtime, not a BODY mode and not a BODY policy class.

Responsibilities owned by Guardian:
- device/network inspection;
- Chrome/browser environment inspection;
- public IP / proxy / VPN observation;
- deep browser fingerprint/protection signals;
- external Chrome controller / WebDriver / automation process detection;
- raw mouse/keyboard behavior observation, including mousemove/click/wheel/key events;
- allow/revoke decisions for Brain physical execution.

BODY responsibilities:
- observe browser/page/UI facts;
- execute physical commands;
- forward raw facts/events;
- enforce only the opaque Guardian grant immediately before Brain physical execution.

BODY does not evaluate:
- device/IP/proxy/VPN policy;
- controller conflict policy;
- behavior/bot policy;
- READY/BLOCKED/QUARANTINED semantics;
- target quality, retry, next action or goal success.

Guardian transport:
- role: guardian
- protocolVersion: 7
- credential: BODY data root / profiles / .auth / guardian.token
- endpoint: BODY data root / state / runtime-endpoint.json

Guardian commands:
- GUARDIAN_BODY_STATUS
- GUARDIAN_BODY_OBSERVE
- GUARDIAN_EXTENSION_ENVIRONMENT_PROBE
- GUARDIAN_GATE_STATUS
- GUARDIAN_GATE_SET
- GUARDIAN_GATE_REVOKE

BODY -> Guardian events:
- browserOnline / browserOffline
- tabContext and tab lifecycle facts
- input facts: mousemove, mousedown, mouseup, click, dblclick, wheel, keydown, keyup

Gate behavior:
- grants are short-lived per Browser Instance;
- Guardian refreshes grants while checks remain valid;
- explicit deny blocks Brain physical execution;
- Guardian disconnect clears all grants;
- no Guardian/grant => Brain physical execution fails closed;
- Human local/operator control remains higher authority.

Standalone entry:
  node guardian/main.js

Guardian state defaults to:
- Windows: %LOCALAPPDATA%\BodyBrain\guardian
- other platforms: ~/.bodybrain/guardian
Override with GUARDIAN_DATA_DIR.

BODY data location is discovered independently:
- BODY_RUNTIME_DATA_DIR when explicitly supplied;
- otherwise BODYBRAIN_HOME/body;
- otherwise the normal BodyBrain body data directory.

The stable CDP/motor files are not part of Guardian and are not modified by this split.
