# Topic Transition Lab — BODY + YouTube Semantic Observation

This research harness studies how a signed-out/low-history YouTube session can move from one content cluster to another without repeatedly typing target video titles.

The reference experiment is:

```text
initial search: nhạc
source cluster: music
target cluster: gaming
```

After the initial query, the runner only consumes candidates that are visible in YouTube surfaces observed by the local browser. It never constructs a target video URL.

## Architecture boundary

```text
YouTube DOM
  -> read-only youtube_semantic_observer
  -> existing LIST_TABS snapshot
  -> research policy/controller
  -> protocol v7 Task API
  -> Task Manager + Environment Guardian
  -> BODY HUMAN_MOTOR
  -> Input.dispatchMouseEvent / Input.dispatchKeyEvent
```

The content script only observes and returns semantic rectangles. It does not click, type, scroll, or mutate page action state.

Physical work remains BODY-only.

The research runner connects as `role=brain`, creates a `SAFE_AUTO` `youtube.content_discovery` Task and uses task-scoped `INTENT_EXECUTE`, `TAB_SWITCH`, and `BROWSER_COMMAND` calls.

## Why this is different from the old DOM runner

The previous recommendation runner could degrade into:

```text
Related #1 -> Related #1 -> Related #1
```

and could stay inside YouTube Radio/Mix for the whole run.

The new harness separates:

- semantic observation,
- policy selection,
- physical execution,
- evidence/reporting.

It also rejects duration-only strings such as `1:31:49` as semantic titles.

## Policies

### `natural_top1`

Baseline. Select the highest-priority top recommendation. This reproduces the accidental v0.8 behavior and measures natural topic inertia.

### `mix_next`

Stay in Mix/Radio and choose the next unvisited queue item. Useful as a topic-preservation control.

### `directed_bridge`

Score all observed candidates for the target topic and known bridge concepts. Direct target candidates win, then bridge candidates, then semantic escape.

Example Gaming bridges include:

```text
gaming music
game OST
game soundtrack
gaming montage
esports highlight
streamer / game stream
```

### `radio_avoidance`

Penalize candidates whose `list` begins with `RD` or whose URL carries `start_radio=1`. This tests the hypothesis that Radio/Mix acts as a topic-local trap.

### `semantic_escape`

When no explicit Gaming/bridge candidate exists, prefer semantically valid candidates that are least Music-like. This is the main method for discovering an unknown bridge instead of assuming its name in advance.

### `long_tail_related`

Prefer Related ranks 5–30 rather than rank #1. BODY scrolls to the candidate and re-observes before clicking. This tests whether cross-topic candidates are disproportionately exposed deeper in the list.

### `portfolio`

Adaptive policy:

```text
TARGET candidate
  -> click
else BRIDGE candidate
  -> click
else semantic escape
  -> click
if scores stagnate
  -> leave Watch/Radio and re-enter Home
if stagnation continues
  -> inspect long-tail Related
if no usable candidate
  -> bounded browser Back and try another branch
```

This policy is designed to find a path. It should not be treated as a causal A/B experiment because backtracking and prior visits change the same YouTube session.

## Read-only semantic evidence

For each surface candidate the observer records only browser-visible information needed for research:

```text
surface
rank / position
videoId
sanitized path
listId / radio flag
semantic title + title source
channel / limited metadata
duration
visible/offscreen
action rectangle
```

Surfaces:

```text
home_feed
search_results
related
mix_queue
```

Diagnostics include:

```text
candidateAnchors
extractedItems
semanticTitleItems
semanticCoverage
cardModels
rootSelector
```

## Research output

Each run writes a local JSON report under `research/results/` unless `--output` is supplied.

The report contains:

- experiment/task identity,
- config,
- selected path,
- semantic checkpoints,
- best target/bridge scores,
- semantic coverage,
- Home re-entry count,
- backtrack count,
- BODY command IDs,
- timestamps for offline merge with the Fingerprint Auditor report.

`research/results/` is ignored by Git.

## Running

First build and load the BODY extension:

```bat
npm install
npm run verify
```

Load `dist/` in Chrome and start the runtime:

```bat
daemon.cmd
```

Use a YouTube tab on an Environment-eligible Browser. Then run:

```bat
npm run research:topic -- --query "nhạc" --target gaming --policy portfolio --dwell-sec 30 --max-steps 18
```

Controls can be varied:

```bat
npm run research:topic -- --query "nhạc" --target gaming --policy natural_top1 --dwell-sec 30 --max-steps 12
npm run research:topic -- --query "nhạc" --target gaming --policy radio_avoidance --dwell-sec 30 --max-steps 18
npm run research:topic -- --query "nhạc" --target gaming --policy semantic_escape --dwell-sec 30 --max-steps 18
npm run research:topic -- --query "nhạc" --target gaming --policy long_tail_related --dwell-sec 30 --max-steps 18
npm run research:topic -- --query "nhạc" --target gaming --policy portfolio --dwell-sec 5 --max-steps 18
npm run research:topic -- --query "nhạc" --target gaming --policy portfolio --dwell-sec 120 --max-steps 18
```

## Experimental interpretation

Use separate fresh Browser Instances/profiles for causal comparisons between policies or dwell times. Several branches explored in one Browser share the same YouTube session and are useful for path discovery, not independent causal samples.

Useful metrics:

```text
steps/time to target
bestTargetScore by step
bestBridgeScore by step
semanticCoverage
radio share
surface used
selected rank bucket
Home re-entry count
backtrack count
cross-topic exposure before target
```

## Guardrails

This harness does not:

```text
like / dislike
comment
subscribe
post
send unsolicited interactions
spoof fingerprint
change proxy/VPN/IP
hide automation
simulate random human behavior
bypass anti-bot or detection systems
navigate directly to a target Gaming video
```

The initial search is allowed once. Subsequent target discovery comes only from observed YouTube recommendations and bounded navigation.
