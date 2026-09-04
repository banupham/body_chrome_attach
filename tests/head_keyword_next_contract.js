'use strict';

const assert=require('node:assert/strict');
const {replaceSearchIntents}=require('../research/youtube_search_input');
const {publicFactorComparison,canonicalHomeRows,sameHeadSearch,safeClickGeometry,chooseNaturalNext}=require('../research/head_keyword_next_runner');
const {classifyTopic,classifySurface,transitionEvidence,chooseSourceBridge,topicMatchEvidence,buildAppearanceConclusion}=require('../research/topic_route_runner');
const {pristineSnapshot,pristineDecision}=require('../research/fast_browser_ui_route_runner');
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
  '--target-topic','gaming',
  '--head-queries','nhạc;bds;tin tức;bóng đá',
  '--seed-count','4',
  '--max-hops','2',
  '--branch-modes','natural,metadata_bridge'
]);
assert.equal(config.trackVideoId,'qXy0iyni-xk');
assert.equal(config.targetTopic,'gaming');
assert.deepEqual(config.headQueries,['nhạc','bds','tin tức','bóng đá']);
assert.equal(config.seedCount,4);
assert.equal(config.maxHops,2);
assert.deepEqual(config.branchModes,['natural','source_bridge']);
assert.equal(config.dwellSec,5);
assert.equal(config.dynamicFreshBrowser,true);
assert.equal(config.homeExplore,true);
assert.equal(config.homeSeedCount,3);
assert.equal(config.safeClickTopPx,80);
assert.equal(config.safeClickBottomPx,48);
assert.equal(config.pristineSettleMs,12000);
assert.equal(config.pristinePollMs,400);
assert.equal(config.pristineStableSamples,2);

const strictDefault=parseHeadKeywordNextArgs(['--track-video-id','qXy0iyni-xk','--head-queries','bds']);
assert.deepEqual(strictDefault.branchModes,['source_bridge']);
assert.equal(strictDefault.targetTopic,null);
const tunedPristine=parseHeadKeywordNextArgs(['--track-video-id','qXy0iyni-xk','--head-queries','bds','--pristine-settle-ms','9000','--pristine-poll-ms','250','--pristine-stable-samples','3']);
assert.equal(tunedPristine.pristineSettleMs,9000);
assert.equal(tunedPristine.pristinePollMs,250);
assert.equal(tunedPristine.pristineStableSamples,3);

const staleConfig=parseHeadKeywordNextArgs(['--track-video-id','qXy0iyni-xk&t','--head-queries','bds','--browser','browser-old','--tab','111']);
const binding=bindDynamicFreshBrowser(staleConfig,{browserInstanceId:'browser-fresh',youtubeTabs:[{id:222,active:true,title:'YouTube'}]});
assert.equal(binding.previous.browser,'browser-old');
assert.equal(binding.previous.tab,111);
assert.equal(staleConfig.browser,'browser-fresh');
assert.equal(staleConfig.tab,222);

const pristineTabs=[{id:222,siteKey:'www.youtube.com',active:true}];
const unknownPristine=pristineSnapshot({signedInState:'unknown',route:{pageType:'home'},controls:{searchInput:null},surfaces:[{diagnostics:{rootSelector:null},items:[]}]},pristineTabs);
assert.equal(unknownPristine.shapeOk,true);
assert.equal(pristineDecision(unknownPristine,{stableSignedOutSamples:0,requiredStableSamples:2}).status,'pending','unknown auth must wait, not fail and not pass');
const signedInPristine=pristineSnapshot({signedInState:'signed_in',route:{pageType:'home'},controls:{searchInput:{actionRect:{x:1}}},surfaces:[]},pristineTabs);
assert.equal(pristineDecision(signedInPristine,{stableSignedOutSamples:0,requiredStableSamples:2}).status,'fail');
const signedOutPristine=pristineSnapshot({signedInState:'signed_out',route:{pageType:'home'},controls:{searchInput:{actionRect:{x:1}}},surfaces:[{diagnostics:{rootSelector:'ytd-rich-grid-renderer'},items:[]}]},pristineTabs);
const signedOutFirst=pristineDecision(signedOutPristine,{stableSignedOutSamples:0,requiredStableSamples:2});
assert.equal(signedOutFirst.status,'pending');
assert.equal(signedOutFirst.stableSignedOutSamples,1);
const signedOutSecond=pristineDecision(signedOutPristine,{stableSignedOutSamples:signedOutFirst.stableSignedOutSamples,requiredStableSamples:2});
assert.equal(signedOutSecond.status,'pass');
assert.equal(signedOutSecond.reason,'signed_out_stable');

assert.equal(sameHeadSearch({route:{pageType:'search'}},'bds','bds'),true);
assert.equal(sameHeadSearch({route:{pageType:'watch'}},'bds','bds'),false);
assert.equal(sameHeadSearch({route:{pageType:'search'}},'bóng đá','bds'),false);

const occluded=safeClickGeometry({visible:true,actionRect:{x:683,y:-30,width:208,height:112.5,centerX:787,centerY:26.25}},{viewport:{width:1034,height:613}},{topPx:80,bottomPx:48,sidePx:8});
assert.equal(occluded.safe,false);
assert.equal(occluded.reason,'above_safe_click_band');
assert.ok(occluded.delta<0);
const safe=safeClickGeometry({visible:true,actionRect:{x:672,y:279.4375,width:214.875,height:116.359375,centerX:779.4375,centerY:337.6171875}},{viewport:{width:1034,height:613}},{topPx:80,bottomPx:48,sidePx:8});
assert.equal(safe.safe,true);
assert.equal(safe.reason,null);

const source={videoId:'source00001',title:'Thị trường BĐS và đầu tư nhà đất',path:'/watch?v=source00001',surface:'related',position:1,semanticTitle:true,isRadio:false,youtubeApi:{
  videoId:'source00001',title:'Thị trường BĐS và đầu tư nhà đất',tags:['bđs','bất động sản','đầu tư'],categoryId:'22',defaultAudioLanguage:'vi',topicLabels:['Knowledge'],keywords:[{term:'bất động sản',score:8},{term:'đầu tư',score:6}],statistics:{viewCount:'10000'},publishedAt:'2026-09-04T10:00:00Z',channelId:'c1',channel:{country:'VN',keywords:['bất động sản','đầu tư'],topicLabels:['Knowledge'],statistics:{subscriberCount:'1000',videoCount:'100'}}
}};
const bridgeCandidate={videoId:'bridge00001',title:'Đầu tư tài chính từ dòng tiền BĐS',path:'/watch?v=bridge00001',surface:'related',position:4,semanticTitle:true,isRadio:false,youtubeApi:{
  videoId:'bridge00001',title:'Đầu tư tài chính từ dòng tiền BĐS',tags:['bđs','đầu tư','tài chính'],categoryId:'22',defaultAudioLanguage:'vi',topicLabels:['Knowledge'],keywords:[{term:'tài chính',score:8},{term:'đầu tư',score:6}],statistics:{viewCount:'500'},channelId:'c2',channel:{country:'VN',keywords:['tài chính','đầu tư'],topicLabels:['Knowledge'],statistics:{subscriberCount:'200',videoCount:'20'}}
}};
const targetLikeButUnrelated={videoId:'gaming00001',title:'Game mới hay nhất',path:'/watch?v=gaming00001',surface:'related',position:2,semanticTitle:true,isRadio:false,youtubeApi:{
  videoId:'gaming00001',title:'Game mới hay nhất',tags:['gaming','game'],categoryId:'20',defaultAudioLanguage:'vi',topicLabels:['Gaming'],keywords:[{term:'gaming',score:8}],statistics:{viewCount:'5000'},channelId:'c3',channel:{country:'VN',keywords:['gaming'],topicLabels:['Gaming'],statistics:{subscriberCount:'5000',videoCount:'200'}}
}};
const trackedTarget={videoId:'qXy0iyni-xk',youtubeApi:{
  videoId:'qXy0iyni-xk',title:'Gaming target',tags:['gaming'],categoryId:'20',defaultAudioLanguage:'vi',topicLabels:['Gaming'],keywords:[{term:'gaming',score:8}],statistics:{viewCount:'100'},channelId:'ct',channel:{country:'VN',keywords:['gaming'],topicLabels:['Gaming'],statistics:{subscriberCount:'0',videoCount:'1'}}
}};

const sourceProfile=classifyTopic(source);
assert.ok(sourceProfile.dominantTerms.some(x=>/bất động sản|bđs/i.test(x.term)));
const displayed=classifySurface([bridgeCandidate,targetLikeButUnrelated]);
assert.equal(displayed.sampleSize,2);
assert.ok(displayed.dominantTerms.length>0);

const evidence=transitionEvidence(source,bridgeCandidate);
assert.equal(evidence.targetMetadataUsed,false);
assert.ok(evidence.bridgeKeys.length>0);
assert.ok(evidence.emergingTerms.some(x=>/tài chính/i.test(x)));

const sourceBridge=chooseSourceBridge([targetLikeButUnrelated,bridgeCandidate],source,new Set());
assert.equal(sourceBridge.row.videoId,'bridge00001','source bridge must use current-video metadata, not target affinity');
assert.equal(sourceBridge.evidence.targetMetadataUsed,false);
assert.equal(chooseNaturalNext([targetLikeButUnrelated,bridgeCandidate],new Set()).videoId,'gaming00001');

const targetEval=topicMatchEvidence(targetLikeButUnrelated,'gaming');
assert.ok(targetEval.score>=0.6);
assert.equal(targetEval.evaluationOnly,true);
assert.equal(targetEval.targetUsedForSelection,false);

const factors=publicFactorComparison(source,bridgeCandidate,Date.parse('2026-09-04T16:00:00Z'));
assert.ok(factors.publicAffinityScore>0);
assert.equal(factors.heuristicOnly,true);

const homeObs={surfaces:[{surface:'home_feed',items:[
  {videoId:'home1',title:'Home A',path:'/watch?v=home1',surface:'home_feed',position:2,semanticTitle:true,isRadio:false},
  {videoId:'home2',title:'Home B',path:'/watch?v=home2',surface:'home_feed',position:1,semanticTitle:true,isRadio:false},
  {videoId:'home2',title:'Home B duplicate',path:'/watch?v=home2',surface:'home_feed',position:5,semanticTitle:true,isRadio:false}
]}]};
assert.deepEqual(canonicalHomeRows(homeObs).map(x=>x.videoId),['home2','home1']);

const conclusion=buildAppearanceConclusion({
  trackVideoId:'qXy0iyni-xk',
  trackedVideoApi:trackedTarget.youtubeApi,
  targetTopic:'gaming',
  homeDiscovery:{baseline:{targetExposure:{seen:false}}},
  runs:[{query:'bds',searchSeeds:[],branches:[{seedVideoId:'source00001',branchMode:'source_bridge',topicPath:[{videoId:'source00001',title:'BĐS',topic:sourceProfile,via:'broad_search_seed',bridgeKeys:[]}],hops:[{depth:1,sourceVideoId:'source00001',source:source,targetExposure:{seen:true,surface:'related',rank:7,edgeFactors:factors},targetTopicEvaluation:{score:.2}}]}]}]
});
assert.equal(conclusion.status,'OBSERVED');
assert.equal(conclusion.mechanism,'RELATED_UP_NEXT');
assert.equal(conclusion.firstObserved.rank,7);
assert.equal(conclusion.causalClaim,false);
assert.match(conclusion.conclusionVi,/quan sát trực tiếp/i);

console.log('head_keyword_next_contract: PASS');