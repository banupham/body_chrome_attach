# Deep Environment Guardian review checklist

- [x] Built on top of `feat/main-foundation-hardening`.
- [x] Daemon remains authoritative for Browser state and Task eligibility.
- [x] Deep scanner is read-only and is not a second daemon/runtime.
- [x] BODY/CDP allowlist is unchanged.
- [x] No proxy/privacy/fingerprint mutation APIs in the deep-probe module.
- [x] No raw fingerprint sample persistence in daemon state.
- [x] Deep probe failure does not independently replace the basic environment result.
- [x] Suspicion scoring is coverage-gated before optional quarantine.
- [x] Lower-severity findings remain evidence-only.
- [x] New permissions are limited to `scripting`, `privacy`, `system.cpu`, `system.memory`, `system.display`.
- [x] Regression contracts cover scoring, injected-function closure safety, read-only boundaries, compact persistence and Guardian state changes.

Known limitations:

- Fingerprint signals are heuristic. Legitimate VM/RDP/GPU/privacy configurations may produce warnings.
- `chrome.scripting.executeScript` does not run on restricted/internal Chrome pages; the deep probe reports unavailable there.
- A timeout resolves the deep probe as unavailable; already-started browser-side script work cannot be force-cancelled by the current API.
- The current integration intentionally ports a bounded subset of Fingerprint Guard Deep rather than every diagnostic from the uploaded extension.
