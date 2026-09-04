# BODY YouTube freshness observation window

This mode is for controlled recommender research. It does not traverse recommendation candidates after the source seed is opened. It keeps the source video fixed and samples the recommendation surface over time.

## Why

Use it to test whether newly published, cross-topic videos appear in the Related surface because of freshness/popularity/exploration rather than public metadata overlap.

The mode records:

- the selected BODY Browser and Environment Guardian public IP condition;
- a controlled source seed when `--seed-video-id` is supplied;
- Related/Mix candidate rank over time;
- YouTube Data API publication time, category, topics, statistics and target score;
- fresh/cross-topic classification;
- observed view-count delta and views/minute between API refreshes;
- an optional tracked video even when it is absent from a sample.

The YouTube Data API is enrichment only. Recommendation edges still come from the live YouTube DOM observer.

## Command

```cmd
cd /d C:\Users\duong\Downloads\central\body_chrome_attach

npm run research:observe -- --query "nhạc" --target gaming --seed-video-id h2mXEei3NN0 --track-video-id H_6uUEFj7Vc --discovery-window-sec 180 --snapshot-interval-sec 30 --fresh-max-age-hours 6
```

Recommended controls for repeated A/B runs:

- remain signed out;
- use the same `--seed-video-id`;
- keep `--discovery-window-sec`, `--snapshot-interval-sec` and `--fresh-max-age-hours` unchanged;
- change only the intended network/session condition;
- run several replicates per condition rather than drawing conclusions from one run.

## Report fields

`environmentCondition` stores the Environment Guardian condition used by the selected Browser, including `publicIp` when available.

`discoverySnapshots` stores aggregate counts for each time point.

`candidateTimeline` stores compact per-video samples including rank, category/topic shift, age, view count and observed views/minute.

`trackedCandidateTimeline` stores `seen: true/false` for `--track-video-id` at every sample.

`discovery.freshCrossTopicCandidates` is the shortlist of videos that were both newly published within `--fresh-max-age-hours` and observably outside the source topic/category.

## Guardrails

Observation mode still uses BODY physical input to search and open the source seed. After source arrival it performs no candidate traversal, likes, comments, subscriptions, direct target-video navigation, fingerprint spoofing, proxy manipulation or detector evasion.
