'use strict';

const assert=require('node:assert/strict');
const {queryEvidence,canonicalSearchRows,ageHours,normalizeVideoId,buildScenarioPlan,deriveCompetitorScenarios}=require('../research/search_exposure_runner');
const {splitQueries,parseSearchExposureArgs}=require('../research/search_exposure_entry');
const {compactChannel}=require('../research/youtube_data_enricher');

assert.deepEqual(splitQueries('bds tphcm;bds|tin tức'),['bds tphcm','bds','tin tức']);
assert.equal(normalizeVideoId('qXy0iyni-xk&t'),'qXy0iyni-xk');
assert.equal(normalizeVideoId('https://www.youtube.com/watch?v=qXy0iyni-xk&t=120'),'qXy0iyni-xk');
assert.equal(normalizeVideoId('https://youtu.be/qXy0iyni-xk?t=5'),'qXy0iyni-xk');

const config=parseSearchExposureArgs([
  '--query','bds',
  '--track-video-id','qXy0iyni-xk&t',
  '--head-queries','nhạc;bds;tin tức;bóng đá',
  '--queries','căn hộ quận 7;bds tphcm',
  '--max-search-rank','60'
]);
assert.equal(config.trackVideoId,'qXy0iyni-xk');
assert.deepEqual(config.headQueries,['nhạc','bds','tin tức','bóng đá']);
assert.deepEqual(config.queries,['căn hộ quận 7','bds tphcm']);
assert.equal(config.autoExplore,true);
assert.equal(config.requirePristine,true);
assert.equal(config.competitorExpansion,true);
assert.equal(config.maxSearchRank,60);
assert.equal(config.stopOnTarget,false);

const api={
  videoId:'qXy0iyni-xk',
  title:'BĐS TP.HCM: căn hộ Quận 7 giá mới',
  descriptionExcerpt:'Phân tích bất động sản khu nam TP.HCM',
  tags:['bds','bất động sản','căn hộ quận 7'],
  topicLabels:['Real estate'],
  channelTitle:'Kênh BĐS Mới',
  keywords:[
    {term:'bds',score:12,sources:['tag','title']},
    {term:'căn hộ quận 7',score:9,sources:['tag']},
    {term:'tphcm',score:7,sources:['title']}
  ],
  channel:{keywords:['bds tphcm','căn hộ']}
};
const evidence=queryEvidence(api,'bds tphcm');
assert.equal(evidence.titleTerms.includes('bds'),true);
assert.equal(evidence.tagTerms.includes('bds'),true);
assert.equal(evidence.channelKeywordTerms.includes('tphcm'),true);
assert.equal(evidence.heuristicOnly,true);
assert.ok(evidence.heuristicScore>0);

const plan=buildScenarioPlan(api,{queries:[],autoExplore:true,headQueries:['bds','bóng đá'],maxAutoQueries:30});
assert.ok(plan.some(x=>x.kind==='indexing_exact_title'&&x.query===api.title));
assert.ok(plan.some(x=>x.kind==='head_exact'&&x.query==='bds'));
assert.ok(plan.some(x=>x.kind==='head_exact'&&x.query==='bóng đá'));
assert.ok(plan.some(x=>x.kind==='head_spelling_variant'&&x.query==='bong da'));
assert.ok(plan.some(x=>x.kind==='head_freshness'));
assert.ok(plan.some(x=>x.kind==='head_plus_metadata'));

const competitorScenarios=deriveCompetitorScenarios({
  kind:'head_exact',isHeadQuery:true,headQuery:'bds',competitors:[
    {title:'BĐS căn hộ Hà Nội mới nhất'},
    {title:'BĐS căn hộ TP HCM giá tốt'},
    {title:'BĐS đất nền Hà Nội'}
  ]
},{limit:3,existingQueries:['bds']});
assert.ok(competitorScenarios.length>=1);
assert.ok(competitorScenarios.some(x=>/bds/i.test(x.query)));
assert.ok(competitorScenarios.some(x=>/căn|ha|hà/i.test(x.query)));

const obs={surfaces:[{surface:'search_results',items:[
  {videoId:'v2',surface:'search_results',position:2,semanticTitle:true},
  {videoId:'v1',surface:'search_results',position:1,semanticTitle:true},
  {videoId:'v2',surface:'search_results',position:5,semanticTitle:true},
  {videoId:'cta',surface:'search_results',position:3,semanticTitle:false}
]}]};
assert.deepEqual(canonicalSearchRows(obs).map(x=>x.videoId),['v1','v2']);

const channel=compactChannel({id:'ch1',snippet:{title:'New Channel',publishedAt:'2026-09-04T00:00:00Z',country:'VN'},statistics:{subscriberCount:'3',videoCount:'1',viewCount:'120'},brandingSettings:{channel:{keywords:'bds tphcm'}},topicDetails:{topicCategories:[]}});
assert.equal(channel.publishedAt,'2026-09-04T00:00:00Z');
assert.equal(channel.statistics.subscriberCount,'3');
assert.equal(channel.statistics.videoCount,'1');
assert.ok(ageHours('2026-09-04T00:00:00Z',Date.parse('2026-09-04T12:00:00Z'))===12);

console.log('search_exposure_contract: PASS');
