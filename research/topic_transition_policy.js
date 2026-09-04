'use strict';

const TOPICS = Object.freeze({
  gaming: {
    direct: [
      'gameplay','gaming','gamer','esports','e-sports','minecraft','roblox','valorant','pubg','free fire',
      'liên quân','lien quan','mobile legends','genshin','fortnite','call of duty','warzone','cs2','counter strike',
      'league of legends','liên minh huyền thoại','lien minh huyen thoai','dota','gta','game review','walkthrough','speedrun'
    ],
    bridge: [
      'gaming music','game music','game ost','game soundtrack','soundtrack game','nhạc game','ost game',
      'gaming montage','game montage','esports highlight','gaming highlight','streamer','game stream','livestream game'
    ]
  },
  technology: {
    direct:['công nghệ','technology','tech review','smartphone','laptop','pc build','computer','ai','artificial intelligence','programming','coding'],
    bridge:['gaming pc','pc gaming','graphics card','gpu','cpu','benchmark','setup tour']
  },
  sports: {
    direct:['bóng đá','football','soccer','nba','basketball','tennis','sports','thể thao','premier league','champions league'],
    bridge:['football edit','sports highlight','match highlight','stadium','fan reaction']
  }
});

const SOURCE_MUSIC_TERMS = [
  'nhạc','music','remix','ballad','chill','lofi','playlist','bolero','edm','dj','ca nhạc','karaoke','cover','lyrics','audio','mashup','megamix'
];

function normalize(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function textOf(candidate) {
  return normalize([
    candidate?.title,
    candidate?.channel,
    ...(Array.isArray(candidate?.metadata) ? candidate.metadata : [])
  ].filter(Boolean).join(' | '));
}

function tokenSet(value) {
  const stop = new Set(['the','and','for','with','hay','nhat','nhất','top','2026','official','video','mix','playlist']);
  return new Set(normalize(value).split(/[^a-z0-9À-ỹ]+/iu).filter(x => x.length >= 3 && !stop.has(x)));
}

function jaccardDistance(a, b) {
  const aa = a instanceof Set ? a : tokenSet(a), bb = b instanceof Set ? b : tokenSet(b);
  if (!aa.size && !bb.size) return 0;
  let intersection = 0;
  for (const x of aa) if (bb.has(x)) intersection++;
  const union = aa.size + bb.size - intersection;
  return union ? 1 - intersection / union : 0;
}

function pathNovelty(candidate, recentTitles = []) {
  const current = tokenSet(textOf(candidate));
  if (!current.size) return 0;
  const recent = (recentTitles || []).map(tokenSet).filter(x => x.size);
  if (!recent.length) return 0.5;
  return Math.min(1, Math.max(0, Math.min(...recent.map(x => jaccardDistance(current, x)))));
}

function matchTerms(text, terms) {
  const matched = [];
  for (const term of terms || []) {
    const key = normalize(term);
    if (key && text.includes(key)) matched.push(key);
  }
  return [...new Set(matched)];
}

function boundedScore(count, base, increment, max = 1) {
  if (count <= 0) return 0;
  return Math.min(max, base + Math.max(0, count - 1) * increment);
}

function scoreTopic(candidate, targetTopic = 'gaming') {
  const topic = TOPICS[targetTopic] || TOPICS.gaming;
  const text = textOf(candidate);
  const matched = matchTerms(text, topic.direct);
  const bridgeMatched = matchTerms(text, topic.bridge);
  const sourceMusicMatched = matchTerms(text, SOURCE_MUSIC_TERMS);
  const targetScore = boundedScore(matched.length, 0.72, 0.11);
  const bridgeScore = Math.max(
    boundedScore(bridgeMatched.length, 0.48, 0.12, 0.92),
    matched.length ? 0.35 : 0
  );
  const sourceTopicScore = boundedScore(sourceMusicMatched.length, 0.48, 0.09, 0.96);
  const semantic = Boolean(text && candidate?.semanticTitle !== false && candidate?.title);
  return {
    targetTopic,
    targetScore,
    bridgeScore,
    sourceTopicScore,
    noveltyScore: semantic ? Math.max(0, 1 - sourceTopicScore) : 0,
    matched,
    bridgeMatched,
    sourceMusicMatched,
    semantic
  };
}

function isRadioCandidate(candidate) {
  if (candidate?.isRadio === true) return true;
  const listId = String(candidate?.listId || '');
  const path = String(candidate?.path || '');
  return /^RD/i.test(listId) || /(?:[?&])start_radio=1(?:&|$)/.test(path);
}

function dedupeCandidates(candidates, visited = new Set()) {
  const best = new Map();
  for (const candidate of candidates || []) {
    const videoId = String(candidate?.videoId || '').trim();
    if (!videoId || visited.has(videoId)) continue;
    const current = best.get(videoId);
    const semantic = Boolean(candidate?.title && candidate?.semanticTitle !== false);
    if (!current || (semantic && !current.title) || Number(candidate?.position || 999) < Number(current.position || 999)) best.set(videoId, candidate);
  }
  return [...best.values()];
}

function surfaceWeight(surface) {
  return { home_feed:0.28, related:0.18, search_results:0.12, mix_queue:0.02 }[surface] ?? 0;
}

function annotateCandidate(candidate, context = {}) {
  const topic = scoreTopic(candidate, context.targetTopic || 'gaming');
  const rank = Math.max(1, Number(candidate?.position || 999));
  const radio = isRadioCandidate(candidate);
  const rankScore = 1 / Math.sqrt(rank);
  const semanticBonus = topic.semantic ? 0.18 : -0.7;
  const trajectoryNovelty = pathNovelty(candidate, context.recentTitles || []);
  return {
    ...candidate,
    topic,
    radio,
    trajectoryNovelty,
    objective:
      topic.targetScore * 6.0 +
      topic.bridgeScore * 3.0 +
      topic.noveltyScore * 1.25 +
      trajectoryNovelty * 0.85 +
      surfaceWeight(candidate?.surface) +
      rankScore * 0.15 +
      semanticBonus -
      (radio ? Number(context.radioPenalty ?? 0.75) : 0)
  };
}

function byRank(a,b) {
  const order = { related:0, home_feed:1, mix_queue:2, search_results:3 };
  return (order[a.surface] ?? 9) - (order[b.surface] ?? 9) || Number(a.position || 999) - Number(b.position || 999);
}

function chooseNaturalTop1(rows) {
  return [...rows].sort(byRank)[0] || null;
}

function chooseMixNext(rows) {
  return rows.filter(x => x.surface === 'mix_queue').sort((a,b)=>Number(a.position||999)-Number(b.position||999))[0] || null;
}

function chooseLongTail(rows) {
  const related = rows.filter(x => x.surface === 'related' && Number(x.position) >= 5 && Number(x.position) <= 30);
  return related.sort((a,b)=>b.objective-a.objective || Number(b.position)-Number(a.position))[0] || null;
}

function chooseCandidate(candidates, context = {}) {
  const visited = context.visited instanceof Set ? context.visited : new Set(context.visited || []);
  const raw = dedupeCandidates(candidates, visited);
  const rows = raw.map(c => annotateCandidate(c, context));
  if (!rows.length) return { candidate:null, reason:'no_unvisited_candidates', rows:[] };
  const policy = String(context.policy || 'portfolio');

  if (policy === 'natural_top1') return { candidate:chooseNaturalTop1(rows), reason:'natural_top1', rows };
  if (policy === 'mix_next') return { candidate:chooseMixNext(rows) || chooseNaturalTop1(rows), reason:'mix_next', rows };
  if (policy === 'long_tail_related') return { candidate:chooseLongTail(rows) || chooseNaturalTop1(rows), reason:'long_tail_related', rows };

  const targetThreshold = Number(context.targetThreshold ?? 0.6);
  const target = rows.filter(x => x.topic.targetScore >= targetThreshold).sort((a,b)=>b.topic.targetScore-a.topic.targetScore || b.objective-a.objective)[0];
  if (target) return { candidate:target, reason:'target_candidate', rows };

  const bridge = rows.filter(x => x.topic.bridgeScore > 0).sort((a,b)=>b.topic.bridgeScore-a.topic.bridgeScore || b.objective-a.objective)[0];
  if (bridge) return { candidate:bridge, reason:'bridge_candidate', rows };

  if (policy === 'radio_avoidance') {
    const nonRadio = rows.filter(x => !x.radio && x.topic.semantic).sort((a,b)=>b.objective-a.objective)[0];
    return { candidate:nonRadio || [...rows].sort((a,b)=>b.objective-a.objective)[0], reason:nonRadio?'radio_avoidance':'radio_avoidance_fallback', rows };
  }

  if (policy === 'semantic_escape' || policy === 'directed_bridge' || policy === 'portfolio') {
    const semantic = rows.filter(x => x.topic.semantic).sort((a,b)=>b.objective-a.objective)[0];
    return { candidate:semantic || chooseNaturalTop1(rows), reason:semantic?'semantic_escape':'semantic_unavailable_fallback', rows };
  }

  return { candidate:chooseNaturalTop1(rows), reason:'fallback_top1', rows };
}

function bestScores(rows) {
  const all=rows || [], semantic=all.filter(x => x.topic?.semantic);
  const crossTopic=semantic.filter(x => Number(x.topic?.sourceTopicScore || 0) < 0.25 || Number(x.topic?.targetScore || 0) > 0 || Number(x.topic?.bridgeScore || 0) > 0);
  return {
    bestTargetScore:Math.max(0, ...all.map(x => Number(x.topic?.targetScore || 0))),
    bestBridgeScore:Math.max(0, ...all.map(x => Number(x.topic?.bridgeScore || 0))),
    bestNoveltyScore:Math.max(0, ...all.map(x => Number(x.topic?.noveltyScore || 0))),
    bestTrajectoryNovelty:Math.max(0, ...all.map(x => Number(x.trajectoryNovelty || 0))),
    semanticCandidateCount:semantic.length,
    radioCandidateCount:all.filter(x => x.radio).length,
    radioShare:all.length ? all.filter(x => x.radio).length / all.length : 0,
    crossTopicCandidateCount:crossTopic.length,
    crossTopicExposureRate:semantic.length ? crossTopic.length / semantic.length : 0
  };
}

function shouldEscapeHome(state = {}) {
  const stagnation = Number(state.stagnationCount || 0);
  const sinceHome = Number(state.stepsSinceHome ?? 999);
  return stagnation >= Number(state.homeEscapeAfter ?? 2) && sinceHome >= Number(state.homeCooldownSteps ?? 2);
}

function choosePortfolioAction({ rows = [], state = {}, selection = null } = {}) {
  const scores = bestScores(rows);
  if (selection?.topic?.targetScore >= Number(state.targetThreshold ?? 0.6)) return { type:'click', reason:'target_candidate', selection, scores };
  if (selection?.topic?.bridgeScore > 0) return { type:'click', reason:'bridge_candidate', selection, scores };
  if (shouldEscapeHome(state) && state.pageType !== 'home') return { type:'go_home', reason:'topic_stagnation_home_escape', scores };
  if (Number(state.stagnationCount || 0) >= Number(state.longTailAfter ?? 4)) return { type:'long_tail', reason:'topic_stagnation_long_tail', scores };
  return selection ? { type:'click', reason:'semantic_escape', selection, scores } : { type:'backtrack', reason:'no_candidate_backtrack', scores };
}

module.exports = {
  TOPICS,
  SOURCE_MUSIC_TERMS,
  normalize,
  textOf,
  tokenSet,
  jaccardDistance,
  pathNovelty,
  scoreTopic,
  isRadioCandidate,
  annotateCandidate,
  chooseCandidate,
  bestScores,
  shouldEscapeHome,
  choosePortfolioAction
};
