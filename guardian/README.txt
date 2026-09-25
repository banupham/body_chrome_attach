Guardian standalone module — split-test track

Authority order:
HUMAN > GUARDIAN > BRAIN > BODY

Guardian is a separate protection runtime. It does not plan tasks and it does not sit on the Brain -> BODY_STEP execution path.

Guardian owns two protections:

1. Chrome/browser validity
- device/network inspection;
- Chrome/browser environment inspection;
- public IP / proxy / VPN observation;
- deep browser fingerprint/protection signals;
- invalid Chrome/browser instance => Guardian tells BODY to disconnect that Browser Instance.

2. Human-learning provenance
- external Chrome controller / WebDriver / automation process detection;
- raw mouse/keyboard behavior observation, including mousemove/click/wheel/key events;
- if third-party automation or synthetic/machine behavior is detected, Guardian disables HUMAN LEARNING for that Browser Instance;
- BODY may still observe the event and Brain tasks may still execute;
- the blocked event must not be learned as human behavior.

BODY responsibilities:
- observe browser/page/UI facts;
- execute Brain physical commands;
- forward raw facts/events to Guardian;
- enforce Guardian browser-validity disconnect requests;
- enforce Guardian HUMAN-LEARNING allow/block state when ingesting recorder events.

BODY does not evaluate:
- device/IP/proxy/VPN policy;
- controller conflict policy;
- behavior/bot policy;
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
- GUARDIAN_PROTECTION_STATUS
- GUARDIAN_BROWSER_VERDICT
- GUARDIAN_LEARNING_SET

BODY -> Guardian events:
- browserOnline / browserOffline
- tabContext and tab lifecycle facts
- input facts: mousemove, mousedown, mouseup, click, dblclick, wheel, keydown, keyup

Protection behavior:
- browserValid=false => BODY disconnects that Browser Instance;
- learningAllowed=false => BODY keeps observing but does not feed HUMAN recorder events into learning;
- Guardian disconnect => HUMAN learning fails closed until Guardian returns;
- Brain TASK_CREATE / TASK_START / BODY_STEP execution is not gated by Guardian;
- Human local/operator control remains highest authority.

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
