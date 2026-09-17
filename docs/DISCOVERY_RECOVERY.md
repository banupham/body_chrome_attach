# Account-aware discovery recovery

The discovery entrypoint runs Brain V4 with account profiles, cold-start preview
verification, and persistent Home/Search/Related/Mix policies. V4 now inherits
the recovery layer previously maintained on the recovery backup branch.

```powershell
npm install
npm run research:autodiscover -- --target VIDEO_ID --account-id LOCAL_ACCOUNT_ID --discovery-mode auto
```

Use the same local account label for the same attached Chrome profile. The label
does not log into Google or verify Google identity. Existing account-scoped
profile, activity and experience files remain in use; anonymous runs remain
supported. The target ID/title restriction on direct search and preview seeds
is unchanged.

## Behavior

- Action learning reads and writes the same capability/purpose/context key.
  Existing records with that key are reusable without resetting learned data.
- Specific target concepts and language influence relevance. Merely sharing a
  broad category is weak evidence. Recovery exploration considers action
  families, avoiding a pool consisting entirely of near-identical clicks.
- A query used in the last six completed actions is temporarily excluded from
  search choices. Old query reward is capped so it cannot dominate indefinitely.
- Failed navigation receives negative reward. New videos and page movement
  alone do not reset target-progress stagnation. Confirmed cold-start previews
  remain useful progress.
- Candidate clicks bind to a fresh observation and clip the rectangle to the
  content viewport. Each action permits at most two repositioning scrolls and
  one click. A cooperative 20-second deadline stops further requests, including
  during tab reconciliation; the current BODY request is awaited and remains
  subject to the client's request timeout. It is not a hard 20-second wall-clock
  cancellation of an already dispatched input.
- Hidden ad modules and sponsored companion/feed elements do not imply a
  playing video ad. Player ad state or visible in-player ad indicators do.

## Reports (schema 9)

The JSONL ledger uses `type: "agent_outcome"` for completed decisions and
`actionType` for `search`, `click_candidate`, etc. Historical schema-5 ledgers
overwrote `type`; readers of old sessions should identify outcomes by `step`.

`latest.json` is updated after every completed action, including steps between
batch exports. It has `reportScope: "checkpoint"` and a bounded recent action
history, with `historyFirstStep`/`historyLastStep` identifying its coverage.
Numbered JSON/Markdown batch files contain only that batch's path/snapshots.
`batch.firstStep`/`lastStep` describe the batch window; `summaryScope` explicitly
identifies cumulative run totals. Do not add batch summaries together.

Each report links to its session ledger and records source revision, commit,
dirty state and build time where available. Packaged executables embed metadata
stamped from a clean checkout by `npm run research:stamp-build` before packaging.
Unknown source metadata stays null instead of being inferred from report dates.

## Validation

`npm run verify` includes the recovered planner contracts and the V4 integration
regressions in `tests/account_recovery_v4_contract.js`. They cover learning
feedback, account isolation/reload, query cooldown, failure rewards, target
progress, bounded recovery/stop, target attribution, ad visibility and report
checkpoints. The Windows CI job also builds and smoke-tests the separate
YouTubeExplorerBrain executable; the production BODY host remains separate.

These contracts use controlled observations. A live run against the attached
Chrome profile is still needed to measure discovery quality and timing.
