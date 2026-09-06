# Protection Guardian

Protection Guardian extends the read-only Environment Guardian with continuous defensive checks while preserving the authority boundary `Daemon -> BODY -> Extension -> Chrome`.

## Scheduling

- Light controller scan: every 15 seconds by default (`BODY_PROTECTION_LIGHT_INTERVAL_MS`).
- Full Environment/Deep Guardian scan: every 5 minutes by default (`BODY_PROTECTION_FULL_INTERVAL_MS`).
- Initial Environment probe still runs when a Browser comes online.
- Full periodic probes skip Browsers in `BUSY` or `HUMAN_CONTROL` to avoid disturbing active physical work.

## Behavior attribution

BODY-generated recorder events have `source: agent` and are excluded from bot-behavior scoring.

Non-BODY input is observed as human/unattributed input and is evaluated conservatively for:

- untrusted synthetic DOM input (`Event.isTrusted === false`),
- machine-like keyboard cadence,
- repeated exact click cadence,
- repeated exact scroll cadence,
- implausibly high input rate.

A single weak timing signal is review evidence only. Quarantine requires a high-confidence behavior decision or correlation with independent controller evidence.

## External controller probe (Windows, read-only)

The Daemon periodically reads a compact Windows process/network snapshot and looks for evidence such as:

- `chromedriver.exe`, `msedgedriver.exe`, `geckodriver.exe`, `IEDriverServer.exe`,
- Selenium / Playwright / Puppeteer process command-line evidence,
- PyAutoGUI / pynput process evidence,
- AutoHotkey / AutoIt processes,
- Chrome-family `--enable-automation`,
- Chrome-family `--remote-debugging-port` / `--remote-debugging-pipe`,
- UDP endpoints owned by already-suspect automation processes.

Raw process command lines are not exposed or persisted by the Guardian status. Only compact signal IDs, process names/PIDs and sanitized flag names are kept in the in-memory assessment.

Generic UDP traffic alone is never treated as automation. A UDP endpoint only contributes evidence when it belongs to a process already identified as an automation/controller candidate.

## Quarantine policy

Examples of high-confidence controller conflicts:

- WebDriver process + browser automation/remote-debug flag,
- WebDriver process + Selenium/Playwright/Puppeteer process evidence,
- WebDriver or browser automation evidence + Deep Guardian `webdriver_true` / `automation_markers`,
- sufficiently strong independent controller signals.

AutoHotkey, Python, Node, DevTools, a remote-debug flag, or UDP usage by itself does not automatically quarantine the Browser.

When protection blocks a Browser:

- Browser state becomes `QUARANTINED`,
- new Task assignment is rejected by the TaskManager wrapper,
- current BODY attribution remains excluded from behavior scoring,
- protection state is visible inside `body.cmd "status"` under `environment.protection`.

## Transient navigation recovery

A Browser may reconnect while Chrome temporarily exposes `about:` or another non-HTTP surface during reload/navigation. This is not a policy violation.

- `deep_probe_http_tab_required` is treated as a deferred probe instead of `environment_policy_failed`.
- A Browser that has not completed its first HTTP probe stays `ENV_CHECK` / `PENDING`; it is not quarantined solely because the current surface is non-HTTP.
- A previously eligible Browser keeps its last good environment result if a refresh temporarily lands on a non-HTTP surface.
- The light Protection Guardian automatically retries deferred environment checks.
- Concurrent probes for the same Browser share one in-flight request, preventing periodic and manual probes from racing each other.

Actual proxy/VPN, duplicate environment, high-suspicion deep fingerprint, controller-conflict, and high-confidence behavior failures remain fail-closed.

## Environment variables

```text
BODY_PROTECTION_GUARDIAN_ENABLED=true
BODY_PROTECTION_CONTROLLER_BLOCK=true
BODY_PROTECTION_BEHAVIOR_BLOCK=true
BODY_PROTECTION_LIGHT_INTERVAL_MS=15000
BODY_PROTECTION_FULL_INTERVAL_MS=300000
```

Protection Guardian is defensive/read-only. It does not terminate external processes, close sockets, mutate Chrome flags, alter fingerprint values, change proxy/VPN settings, or evade automation detection.
