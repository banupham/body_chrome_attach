'use strict';

const assert=require('node:assert/strict');
const {queryEvidence,canonicalSearchRows,ageHours}=require('../research/search_exposure_runner');
const {splitQueries,parseSearchExposureArgs}=require('../research/search_exposure_entry');
const {compactChannel}=require('../research/youtube_data_enricher');

assert.deepEqual(splitQueries('bds tphcm;bds|tin tức'),['bds tphcm','bds','tin tức']);
const config=parseSearchExposureArgs(['--query','bds','--track-video-id','abc123','--queries','bds quận 7;bds tphcm','--head-query','bds','--max-search-rank','60']);
assert.equal(config.trackVideoId,'abc123');
assert.equal(config.headQuery,'bds');
assert.deepEqual(config.queries,['bds quận 7','bds tphcm','bds'],'head query must be included exactly once');
assert.equal(config.maxSearchRank,60);
assert.equal(config.stopOnTarget,false);

const api={title:'BĐS TP.HCM: căn hộ Quận 7 giá mới',descriptionExcerpt:'Phân tích bất động sản khu nam TP.HCM',tags:['bds','bất động sản','căn hộ quận 7'],topicLabels:['Real estate'],channel:{keywords:['bds tphcm','căn hộ']}};
const evidence=queryEvidence(api,'bds tphcm');
assert.equal(evidence.titleTerms.includes('bds'),true);
assert.equal(evidence.tagTerms.includes('bds'),true);
assert.equal(evidence.channelKeywordTerms.includes('tphcm'),true);
assert.equal(evidence.heuristicOnly,true);
assert.ok(evidence.heuristicScore>0);

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