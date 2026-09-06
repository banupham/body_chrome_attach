# BUSY lifecycle regression scope

This temporary contract note documents the first hardening item.

The regression suite must prove:

- Queueing the first execution marks the lane busy immediately.
- A second queued execution keeps the lane busy after the first finishes.
- Failure of one queued execution does not create an idle gap before the next execution starts.
- Browser state follows lane busy/idle without overwriting `HUMAN_CONTROL`, `QUARANTINED`, `ERROR` or `OFFLINE`.
- Guardian refuses environment probes while the Browser is `BUSY`.
