# New-channel YouTube Search Exposure Lab

## Research question

Measure how a public video from a newly created channel becomes discoverable in YouTube Search, starting from exact/indexing queries and progressively testing long-tail, freshness, competitor-neighborhood, spelling and competitive head queries such as `nhạc`, `bds`, `tin tức`, or `bóng đá`.

This is a Search experiment, not a recommendation-graph experiment. DOM search results are the ranking ground truth. YouTube Data API v3 only enriches the tracked video and visible competitors with public metadata.

## Clean-browser condition

For a clean baseline, close every other BODY-managed Chrome first, keep the daemon running, then launch the dedicated disposable profile:

```cmd
research\launch_pristine_search_chrome.cmd
```

The launcher deletes only `research\profiles\pristine-search`, creates a brand-new `--user-data-dir`, loads only the local BODY unpacked extension from `dist`, disables Chrome sync, and opens YouTube signed out.

The runner also performs a fail-closed `pristine_browser_check`. By default it requires:

- YouTube `signed_out`
- one YouTube tab
- no more than two tabs in the selected Browser

This is observable evidence, not proof that arbitrary Chrome internals are empty. The dedicated launcher is what supplies the fresh user-data-dir.

## Video ID normalization

The CLI accepts a raw ID or a normal YouTube URL. Extra URL parameters are stripped. For example:

```text
qXy0iyni-xk&t
```

is normalized to:

```text
qXy0iyni-xk
```

## Automatic discovery scenarios

With `--auto-explore true` (default), BODY first fetches public metadata for the tracked video, then builds a query plan. It never searches the target video ID itself as a ranking shortcut and never clicks the tracked video.

The plan can include:

1. `indexing_exact_title` — full title baseline.
2. `indexing_title_phrase` — compact title phrase.
3. `semantic_keywords` — strongest public metadata terms.
4. `tag_probe` — primary uploader tag when available.
5. `channel_topic_probe` — channel name plus strong topic term.
6. `head_plus_metadata` — head query plus terms derived from this exact video.
7. `head_freshness` — `hôm nay`, `mới nhất`, current year variants.
8. `head_spelling_variant` — diacritic-folded variant such as `bong da` for `bóng đá`.
9. `head_exact` — the competitive broad query itself.
10. `competitor_neighborhood` — after observing a head query, derive a small number of recurring terms from the actual top-result titles and test `head + recurring term`.

`queryEvidence.heuristicScore` is only a BODY diagnostic for metadata overlap. It is not a YouTube ranking score.

## Recommended run for qXy0iyni-xk

Update and build first:

```cmd
npm install
npm run verify
```

Set API enrichment in the same CMD process:

```cmd
set "YOUTUBE_DATA_API_KEY=YOUR_KEY"
set "BODY_YOUTUBE_API_ENRICH=1"
```

Launch a clean Browser:

```cmd
research\launch_pristine_search_chrome.cmd
```

Wait until `body.cmd "browsers"` shows the new Browser as `ACTIVE` and environment-eligible.

### Scenario A — broad discovery across several large keywords

```cmd
npm run research:search -- --track-video-id "qXy0iyni-xk&t" --head-queries "nhạc;bds;tin tức;bóng đá" --max-search-rank 80 --max-auto-queries 32 --competitor-expansion true
```

This is deliberately exploratory. It is useful for discovering which large keyword family, if any, already has a natural relation to the video.

### Scenario B — one chosen keyword family, deeper scan

If the video belongs to one topic, prefer one primary head query and let metadata create narrower probes. Example:

```cmd
npm run research:search -- --track-video-id "qXy0iyni-xk&t" --head-query "bóng đá" --max-search-rank 120 --max-search-scrolls 18 --competitor-expansion true
```

### Scenario C — add manually chosen control queries

```cmd
npm run research:search -- --track-video-id "qXy0iyni-xk&t" --head-query "bóng đá" --queries "bóng đá hôm nay;tin bóng đá mới nhất;nhận định bóng đá" --max-search-rank 100
```

Manual queries are kept in addition to the automatic exploration plan.

### Scenario D — temporal movement in the same clean session

```cmd
npm run research:search -- --track-video-id "qXy0iyni-xk&t" --head-query "bóng đá" --samples 3 --sample-interval-sec 300 --max-search-rank 80
```

This lets the report distinguish `not seen <= rank 80`, first appearance, and rank movement over time.

## Report fields

The report now records:

- `environmentCondition.publicIp`
- `pristineEvidence`
- normalized tracked video ID
- tracked video title, tags, topics, publish age and public statistics
- channel creation time, channel age, subscriber count and video count when public
- `scenarioPlan[]` with kind/source/query
- `searchScans[]` with observed rank and maximum rank actually scanned
- top visible competitors for each query
- `competitor_neighborhood` scenarios derived from actual Search results
- `searchExposure.indexingBaseline`
- `searchExposure.headKeywords`
- per-query and per-scenario timelines

## Interpretation boundary

The lab observes public Search behavior. It does not create views, clicks, likes, comments, subscriptions, watch time or other synthetic engagement. A rank change can be correlated with observed public metadata and time, but the report must not claim a hidden YouTube ranking formula or a causal feature weight that YouTube does not expose.
