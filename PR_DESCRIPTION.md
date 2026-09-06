# PR summary

Implements hardening plan item 1 only: Browser BUSY/ACTIVE lifecycle is now driven by the execution queue lifecycle instead of each Task wrapper toggling the Browser independently.

Validation scope:
- queued execution remains BUSY across task boundaries;
- failure path does not create false ACTIVE state;
- Guardian refuses probes while BUSY;
- strong Browser states are preserved;
- environment ineligibility after execution drains to QUARANTINED rather than ACTIVE.
