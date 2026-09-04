# YouTube Data API enrichment for Topic Transition Lab

This layer enriches recommendation nodes observed by BODY. It does not replace the read-only YouTube DOM observer and it does not claim to expose YouTube's recommendation algorithm.

## Why hybrid observation is required

BODY records the recommendation edge that the website actually shows: source video -> candidate, surface, rank, action rectangle, and transition outcome.

YouTube Data API v3 enriches each observed video with public metadata:

- `snippet.tags`
- `snippet.categoryId`
- title and a bounded description excerpt
- channel id/title
- `contentDetails.duration`
- `topicDetails.topicIds`, `relevantTopicIds`, and `topicCategories`
- public statistics
- channel branding keywords and channel topics
- locally derived keywords with source/weight evidence

The Data API does not expose the feature weights or causal reason that caused a recommendation to be ranked. The former `search.list.relatedToVideoId` mechanism is no longer supported, so recommendation edges must come from the website observation itself.

## Setup

Create a YouTube Data API v3 key in your Google Cloud project and expose it only to the local Node research process. Do not put the key in extension source, reports, git, or screenshots.

Windows CMD for the current terminal session:

```cmd
set "YOUTUBE_DATA_API_KEY=YOUR_LOCAL_KEY"
set "BODY_YOUTUBE_API_ENRICH=1"
```

Optional strict mode:

```cmd
set "BODY_YOUTUBE_API_REQUIRED=1"
```

Without a key, the research runner remains compatible with the original DOM-only behavior and reports `youtubeDataApi.enabled=false`.

## Run

```cmd
npm run research:topic -- --query "nhạc" --target gaming --policy portfolio --dwell-sec 30 --max-steps 18
```

## Report additions

Each selected path node may include:

- `youtubeApi.tags`
- `youtubeApi.categoryId`
- `youtubeApi.topicLabels`
- `youtubeApi.keywords[]` with score and source labels
- compact channel keywords/topics
- `bridgeAnalysis`

The report root contains:

- `youtubeDataApi`: API/cache/error accounting without the API key
- `bridgeEdges[]`: source -> candidate edge explanations

## Bridge interpretation

`bridgeAnalysis` separates evidence from inference.

Observable evidence can include:

- the candidate was physically present in `related`, `home_feed`, or `mix_queue`
- recommendation rank
- non-Radio escape
- source/target category shift
- shared video tags
- shared derived keywords
- shared video or channel topics
- direct target-topic terms such as `roblox`, `minecraft`, `gameplay`, etc.

If a Music source and a Gaming candidate have a real observed recommendation edge but little or no overlap in public metadata, the report sets `opaqueRecommendationSignalLikely=true`. This means the public metadata is insufficient to explain the edge. Co-watch behavior, session context, personalization, popularity/freshness, or other non-public recommendation signals are plausible classes of explanation, but BODY must not label any one of them as the causal reason without additional evidence.
