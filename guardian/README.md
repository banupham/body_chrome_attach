# Guardian module — split-test track

This package is the Guardian side of the temporary BODY / Guardian / Brain split.

Responsibilities kept here:
- EnvironmentGuardian
- ProtectionSupervisor
- device/network probing
- external-controller probing
- behavior protection
- Guardian composition through `daemon/src/guardian_module.js`

The BODY-only artifact intentionally does not package these implementation files.
Its small `guardian_module.js` boundary remains only to expose a DETACHED fail-closed contract.

This is a test branch boundary. It does not merge or replace the production BodyBrain release.
