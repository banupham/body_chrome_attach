# BODY pristine blank cold-start research

This mode is **attach-first**. BODY does not need to know where `chrome.exe` is installed and does not require the repository launcher. You may start any Chrome/Chromium build yourself from any path, as long as the BODY extension is loaded and the newest BODY-managed Browser is still on `about:blank` or a blank/new-tab page.

## Why bootstrap happens before the research Task

`about:blank` / `chrome://newtab` cannot host the BODY web content script, so Environment Guardian cannot yet obtain the browser-environment signature. BODY must not weaken the eligibility gate just to start research.

The cold-start sequence is therefore:

1. The operator launches the Chrome/Chromium executable that should be tested, from any filesystem path, with BODY loaded. The research code does not inspect or assume the executable path.
2. Leave the newest BODY-managed Browser on `about:blank`, `chrome://newtab`, or another blank/new-tab state, with no YouTube tab already open.
3. `research:search:cold` discovers the newest online blank Browser from BODY Browser Manager identity/tabs, not from the executable path.
4. BODY debug Browser UI selects that Browser and performs address-bar navigation to `https://www.youtube.com/`.
5. Wait for the YouTube content script and request Environment Guardian re-probes until the Browser is eligible.
6. Close the debug bootstrap client.
7. Attach the research Brain, bind the same Browser for this run, create the research Task, and begin target-blind topic-route discovery.

No CDP gateway method is added or changed by this cold-start mode. Page motor remains BODY HUMAN_MOTOR; browser chrome navigation remains BODY Browser UI.

## Recommended attach-first run

Start `daemon.cmd`, close unrelated BODY-managed Browsers, then launch the Chrome/Chromium build you want to test yourself. Its executable may be anywhere, for example a portable build on `D:` or `E:`. Leave it on a blank/new-tab page and run:

```cmd
research\run_pristine_blank_search.cmd --track-video-id "qXy0iyni-xk&t" --head-queries "bds" --target-topic "gaming" --seed-count 4 --max-hops 4 --branch-modes "source_bridge" --max-related-rank 40 --dwell-sec 5
```

The wrapper no longer launches Chrome. It only starts `research:search:cold`, which discovers the newest blank BODY Browser dynamically.

You can also call npm directly:

```cmd
npm run research:search:cold -- --track-video-id "qXy0iyni-xk&t" --head-queries "bds" --target-topic "gaming" --seed-count 4 --max-hops 4 --branch-modes "source_bridge" --max-related-rank 40 --dwell-sec 5
```

## Optional repository launcher

`research\launch_pristine_blank_chrome.cmd` remains only as a convenience for standard local Chrome installs. It is not part of the research requirement and is not needed when Chrome executables live in different locations.

## Selection rule

The bootstrap selects the newest online Browser whose tabs are all blank/new-tab and that has no YouTube tab. If several BODY Browsers are open, close the unrelated ones or make sure the intended blank Browser is the newest one before starting the command.

## Interpretation

This mode controls the start-navigation state of the selected experiment Browser. It does not claim to remove network-level YouTube context, global platform state, or every source of recommendation variation. The report should compare cold-start runs against other controlled runs rather than treat one run as causal proof.
