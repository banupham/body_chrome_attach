'use strict';

const assert=require('node:assert/strict');
const {replaceSearchIntents}=require('../research/youtube_search_input');
const {publicFactorComparison,chooseNaturalNext,chooseMetadataBridge}=require('../research/head_keyword_next_runner');
const {parseHeadKeywordNextArgs}=require('../research/head_keyword_next_entry');

const control={actionRect:{centerX:500,centerY:40,width:420,height:34}};
const intents=replaceSearchIntents(control,'bóng đá');
assert.deepEqual(intents.map(x=>[x.type,x.key||null,x.text||null]),[
  ['click',null,null],
  ['keyCombo','Control+a',null],
  ['pressKey','Backspace',null],
  ['typeText',null,'bóng đá'],
  ['pressKey','Enter',null]
]);

const config=parseHeadKeywordNextArgs([
  '--track-video-id','qXy0iyni-xk&t',
  '--head-queries','nhạc;bds;tin tức;bóng đá',
  '--seed-count','4',
  '--max-hops','2',
  '--branch-modes','natural,metadata_bridge'
]);
assert.equal(config.trackVideoId,'qXy0iyni-xk');
assert.deepEqual(config.headQueries,['nhạc','bds','tin tức','bóng đá']);
assert.equal(config.seedCount,4);
assert.equal(config.maxHops,2);
assert.deepEqual(config.branchModes,['natural','metadata_bridge']);
assert.equal(config.dwellSec,5);

const source={videoId:'source00001',title:'Tin bóng đá Việt Nam hôm nay',path:'/watch?v=source00001',surface:'related',position:1,semanticTitle:true,isRadio:false,youtubeApi:{
  videoId:'source00001',title:'Tin bóng đá Việt Nam hôm nay',tags:['bóng đá','việt nam'],categoryId:'17',defaultAudioLanguage:'vi',topicLabels:['Association football'],statistics:{viewCount:'10000'},publishedAt:'2026-09-04T10:00:00Z',channelId:'c1',channel:{country:'VN',keywords:['bóng đá','tin thể thao'],topicLabels:['Sports'],statistics:{subscriberCount:'1000',videoCount:'100'}}
}};
const target={videoId:'qXy0iyni-xk',youtubeApi:{
  videoId:'qXy0iyni-xk',title:'Bóng đá Việt Nam mới nhất',tags:['bóng đá','việt nam'],categoryId:'17',defaultAudioLanguage:'vi',topicLabels:['Association football'],statistics:{viewCount:'100'},publishedAt:'2026-09-04T15:00:00Z',channelId:'c2',channel:{country:'VN',keywords:['bóng đá'],topicLabels:['Sports'],statistics:{subscriberCount:'0',videoCount:'1'}}
}};
const factors=publicFactorComparison(source,target,Date.parse('2026-09-04T16:00:00Z'));
assert.ok(factors.sharedTags.includes('bong da'));
assert.ok(factors.sharedTopics.includes('association football'));
assert.equal(factors.sameCategory,true);
assert.equal(factors.sameLanguage,true);
assert.equal(factors.sameCountry,true);
assert.ok(factors.publicAffinityScore>0);
assert.equal(factors.heuristicOnly,true);

const rows=[
  {...source,videoId:'a1234567890',position:1},
  {videoId:'b1234567890',title:'Khác chủ đề',path:'/watch?v=b1234567890',surface:'related',position:2,semanticTitle:true,isRadio:false,youtubeApi:{videoId:'b1234567890',title:'Khác chủ đề',tags:[],categoryId:'22',statistics:{viewCount:'1'},channel:{keywords:[],topicLabels:[]}}}
];
assert.equal(chooseNaturalNext(rows,new Set()).videoId,'a1234567890');
const bridge=chooseMetadataBridge(rows,target.youtubeApi,new Set());
assert.equal(bridge.row.videoId,'a1234567890');

console.log('head_keyword_next_contract: PASS');
