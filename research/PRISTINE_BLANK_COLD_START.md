# BODY pristine blank cold-start research

This mode starts the experiment from a newly-created Chrome user-data-dir at `about:blank`, before any HTTPS page has been opened in that Browser session.

## Why bootstrap happens before the research Task

`about:blank` / `chrome://newtab` cannot host the BODY web content script, so Environment Guardian cannot yet obtain the browser-environment signature. BODY must not weaken the eligibility gate just to start research.

The cold-start sequence is therefore:

1. Launch a fresh signed-out Chrome at `about:blank` with only the BODY unpacked extension.
2. BODY debug Browser UI selects that newly-connected blank Browser.
3. BODY Browser UI performs address-bar navigation to `https://www.youtube.com/`.
4. Wait for the YouTube content script and request Environment Guardian re-probes until the Browser is eligible.
5. Close the debug bootstrap client.
6. Attach the research Brain, dynamically bind the same newly-discovered Browser for this run, create the research Task, and begin target-blind topic-route discovery.

No CDP gateway method is added or changed by this cold-start mode. Page motor remains BODY HUMAN_MOTOR; browser chrome navigation remains BODY Browser UI.

## One-command run

From the repository root, after `daemon.cmd` is running and every other BODY-managed Chrome is closed:

```cmd
research\run_pristine_blank_search.cmd --track-video-id "qXy0iyni-xk&t" --head-queries "bds" --target-topic "gaming" --seed-count 4 --max-hops 4 --branch-modes "source_bridge" --max-related-rank 40 --dwell-sec 5
```

The wrapper resets only `research\profiles\pristine-blank-search`, launches `about:blank`, waits for BODY to connect, bootstraps YouTube through BODY Browser UI, then starts `research:search:cold`.

## Manual two-stage run

```cmd
research\launch_pristine_blank_chrome.cmd
npm run research:blank-bootstrap
```

After bootstrap succeeds, a normal `npm run research:search -- ...` can be used. For report provenance, prefer `research:search:cold`, which records `coldStartMode=about_blank_body_browser_ui` in the research config.

## Interpretation

This mode controls the start-navigation state of the dedicated experiment profile. It does not claim to remove network-level YouTube context, global platform state, or every source of recommendation variation. The report should compare cold-start runs against the existing pristine-YouTube launcher rather than treat one run as causal proof.
