'use strict';

const assert=require('node:assert/strict');
const {replaceSearchIntents}=require('../research/youtube_search_input');
const {publicFactorComparison,canonicalHomeRows,sameHeadSearch,safeClickGeometry,chooseNaturalNext,chooseMetadataBridge}=require('../research/head_keyword_next_runner');
const {parseHeadKeywordNextArgs,bindDynamicFreshBrowser}=require('../research/head_keyword_next_entry');

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
assert.equal(config.dynamicFreshBrowser,true);
assert.equal(config.homeExplore,true);
assert.equal(config.homeSeedCount,3);
assert.equal(config.safeClickTopPx,80);
assert.equal(config.safeClickBottomPx,48);

const staleConfig=parseHeadKeywordNextArgs(['--track-video-id','qXy0iyni-xk&t','--head-queries','bds','--browser','browser-old','--tab','111']);
const binding=bindDynamicFreshBrowser(staleConfig,{browserInstanceId:'browser-fresh',youtubeTabs:[{id:222,active:true,title:'YouTube'}]});
assert.equal(binding.previous.browser,'browser-old');
assert.equal(binding.previous.tab,111);
assert.equal(staleConfig.browser,'browser-fresh');
assert.equal(staleConfig.tab,222);

assert.equal(sameHeadSearch({route:{pageType:'search'}},'bds','bds'),true);
assert.equal(sameHeadSearch({route:{pageType:'watch'}},'bds','bds'),false);
assert.equal(sameHeadSearch({route:{pageType:'search'}},'bóng đá','bds'),false);

const occluded=safeClickGeometry({visible:true,actionRect:{x:683,y:-30,width:208,height:112.5,centerX:787,centerY:26.25}},{viewport:{width:1034,height:613}},{topPx:80,bottomPx:48,sidePx:8});
assert.equal(occluded.safe,false);
assert.equal(occluded.reason,'above_safe_click_band');
assert.ok(occluded.delta<0,'candidate under the fixed header should be physically scrolled down before clicking');
const safe=safeClickGeometry({visible:true,actionRect:{x:672,y:279.4375,width:214.875,height:116.359375,centerX:779.4375,centerY:337.6171875}},{viewport:{width:1034,height:613}},{topPx:80,bottomPx:48,sidePx:8});
assert.equal(safe.safe,true);
assert.equal(safe.reason,null);

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

const homeObs={surfaces:[{surface:'home_feed',items:[
  {videoId:'home1',title:'Home A',path:'/watch?v=home1',surface:'home_feed',position:2,semanticTitle:true,isRadio:false},
  {videoId:'home2',title:'Home B',path:'/watch?v=home2',surface:'home_feed',position:1,semanticTitle:true,isRadio:false},
  {videoId:'home2',title:'Home B duplicate',path:'/watch?v=home2',surface:'home_feed',position:5,semanticTitle:true,isRadio:false}
]}]};
assert.deepEqual(canonicalHomeRows(homeObs).map(x=>x.videoId),['home2','home1']);

console.log('head_keyword_next_contract: PASS');
