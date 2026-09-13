# BODY Autonomous YouTube Discovery Brain

This is a separate research Brain. It controls the current BODY runtime through BODY Contract v1; it is not embedded into `BodyBrain.exe` and it does not alter BODY motor-learning data.

## Goal

Input one YouTube video ID and let the Brain explore YouTube until the target appears naturally in an observed YouTube surface and BODY can physically open it.

The target ID is allowed only for:

- YouTube Data API target profiling;
- matching an observed candidate ID;
- verifying successful arrival.

The Brain must not search:

- the target video ID;
- the target watch URL;
- the exact target title;
- a near-exact target-title fragment.

Every query is checked by `query_firewall.js` and written to the report audit.

## What it observes

The BODY extension exposes a read-only semantic snapshot for:

- Home feed;
- Search results;
- Related / Next videos;
- Mix queue.

Candidate evidence includes visible `videoId`, semantic title, channel, surface, rank, radio/list state and physical action rectangle. The Brain optionally enriches observed candidates with YouTube Data API public metadata and classifies them into broad topics.

## Trial-and-error loop

The Brain repeatedly performs:

```text
observe
  -> enrich + classify
  -> record every recommendation exposure
  -> choose an exploration strategy with persistent UCB experience
  -> BODY move/scroll/click/search/back
  -> dwell for a variable quick/medium/long interval
  -> observe the changed environment
  -> reward or penalize the strategy
  -> persist experience
  -> rotate a batch report
```

Strategies currently include:

- `search_result`
- `home_novelty`
- `related_top`
- `related_long_tail`
- `semantic_bridge`
- `mix_queue`
- `new_query`
- `backtrack`

The Brain learns strategy reward by page/topic context across runs. Semantic discovery memory is stored separately from BODY human motor learning.

## API setup

Keep the key local. Never commit it.

Windows CMD:

```cmd
set "YOUTUBE_DATA_API_KEY=YOUR_LOCAL_KEY"
```

The key is not written to report JSON/Markdown.

## Run

BODY/Chrome must already be online and Guardian-eligible.

Bounded practical run:

```cmd
npm run research:autodiscover -- --target qXy0iyni-xk --max-minutes 30 --max-steps 120 --max-dwell-sec 90 --report-every-steps 10 --report-every-minutes 10
```

Unlimited exploration until manually stopped:

```cmd
npm run research:autodiscover -- --target qXy0iyni-xk --unlimited true --continue-after-found true --max-dwell-sec 180 --report-every-steps 10 --report-every-minutes 10
```

Stop with `Ctrl+C`. Reports already rotated before that point remain on disk.

To stop when the target is physically opened, leave `--continue-after-found` false (default).

## Storage

Default:

```text
%LOCALAPPDATA%\BodyBrain\brain\youtube-discovery\
  memory.json
  sessions\<run-id>.jsonl
  reports\<run-id>-batch-0001.json
  reports\<run-id>-batch-0001.md
  reports\<run-id>-latest.json
```

`memory.json` is persistent experience across runs. The JSONL session ledger is append-only evidence of decisions/actions. Batch reports answer:

- which path was taken;
- which query/strategy was tried;
- which source video/topic led to the next step;
- whether the target appeared in Search, Home, Related/Next, or Mix;
- rank/surface of the target when first observed;
- what YouTube recommended at each checkpoint;
- topic mix at each checkpoint;
- how long BODY dwelled on selected videos;
- reward and accumulated strategy experience;
- strongest observed topic transitions.

## Boundaries

The Brain does not like, dislike, comment, subscribe, share, spoof fingerprints, manipulate proxies/VPNs, evade detection, or navigate directly to the target watch URL.

YouTube recommendation edges are treated as observations. Public API metadata can describe correlations and content similarity but cannot prove YouTube's hidden causal ranking logic.
