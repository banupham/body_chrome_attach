# New-channel YouTube Search Exposure Lab

## Research question

Measure when and under what observable conditions a public video from a newly created channel begins appearing in YouTube Search for a competitive head query such as `nhạc`, `bds`, `tin tức`, or `bóng đá`.

This is a Search experiment, not a recommendation-graph experiment. DOM search results are the ranking ground truth; YouTube Data API v3 is only used to enrich the tracked video and visible competitors with metadata such as publish time, channel creation time, category, topics, tags, and public statistics.

## Important interpretation boundary

YouTube does not expose its Search feature weights. The lab can observe correlation between rank and public signals, but must not claim a causal ranking formula. It does not create synthetic views, clicks, watch time, likes, comments, subscribers, or traffic.

Official YouTube documentation describes Search around relevance, engagement, and quality. Music/entertainment may use extra freshness/popularity signals, while news and other credibility-sensitive topics place more emphasis on authoritative sources. Tags are secondary compared with title, description, video content, and viewer response.

## Recommended query ladder

For a new channel, test the same video on a ladder from specific to broad. Example for real estate:

- long-tail: `căn hộ quận 7 giá 5 tỷ`
- mid-tail: `bds tphcm`
- head: `bds`

For music:

- long-tail: `nhạc remix việt 2026`
- mid-tail: `nhạc remix`
- head: `nhạc`

For football:

- long-tail: a specific match/team/event query
- mid-tail: a league/team query
- head: `bóng đá`

For news, use event-specific and topic-specific queries as controls before the head query `tin tức`; broad news Search is credibility-sensitive and a brand-new channel should not be expected to rank simply because metadata matches.

## Run

Set the YouTube Data API key in the same CMD process:

```cmd
set "YOUTUBE_DATA_API_KEY=YOUR_KEY"
set "BODY_YOUTUBE_API_ENRICH=1"
```

Track one new public video against one head query:

```cmd
npm run research:search -- --query "bds" --track-video-id VIDEO_ID --max-search-rank 80
```

Run a query ladder in one session:

```cmd
npm run research:search -- --query "bds" --head-query "bds" --queries "căn hộ quận 7 giá 5 tỷ;bds tphcm;bds" --track-video-id VIDEO_ID --max-search-rank 80
```

Repeat snapshots in the same Browser session:

```cmd
npm run research:search -- --query "bds" --head-query "bds" --queries "bds tphcm;bds" --track-video-id VIDEO_ID --samples 3 --sample-interval-sec 300 --max-search-rank 80
```

For clean A/B comparisons across IP/browser/session conditions, prefer one query per fresh run instead of many queries in one session.

## Report fields

The report records:

- `environmentCondition.publicIp`
- tracked video age and public statistics
- tracked channel creation time, age, subscriber/video counts when public
- exact Search rank if observed
- maximum Search rank actually scanned
- query/title/tag/description/topic/channel-keyword overlap diagnostics
- top visible competitors with age, views, category, and query evidence
- first observed rank on the head query

`queryEvidence.heuristicScore` is a lab diagnostic only. It is not a YouTube ranking score.

## What a useful longitudinal result looks like

A strong new-channel dataset may show a progression such as:

```text
T+0h   exact/long-tail: rank 14   mid-tail: absent   head: absent
T+6h   exact/long-tail: rank 4    mid-tail: rank 42  head: absent
T+24h  exact/long-tail: rank 2    mid-tail: rank 18  head: rank 67
T+48h  exact/long-tail: rank 2    mid-tail: rank 9   head: rank 31
```

That supports analysis of how exposure broadens from a highly relevant query toward a competitive head term without inventing a hidden YouTube formula.
