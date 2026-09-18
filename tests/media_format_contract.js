'use strict';

const assert=require('node:assert/strict');
const {FORMAT,parseIsoDurationSeconds,classifyMediaFormat}=require('../research/autonomous_discovery/media_format');
const {YouTubeApi}=require('../research/autonomous_discovery/youtube_api');
const {buildWorld}=require('../research/autonomous_discovery/world_model');
const {AutonomousAgentPlanner}=require('../research/autonomous_discovery/agent_planner');

assert.equal(parseIsoDurationSeconds('PT2M31S'),151);
assert.equal(parseIsoDurationSeconds('PT1H2M3S'),3723);
const short2026=classifyMediaFormat({duration:'PT2M30S',publishedAt:'2026-01-01T00:00:00Z',player:{embedWidth:720,embedHeight:1280}});
assert.equal(short2026.kind,FORMAT.SHORT);
const landscapeShortDuration=classifyMediaFormat({duration:'PT45S',publishedAt:'2026-01-01T00:00:00Z',player:{embedWidth:1920,embedHeight:1080}});
assert.equal(landscapeShortDuration.kind,FORMAT.LONG_FORM);
const legacyVertical90=classifyMediaFormat({duration:'PT1M30S',publishedAt:'2023-01-01T00:00:00Z',player:{embedWidth:720,embedHeight:1280}});
assert.equal(legacyVertical90.kind,FORMAT.LONG_FORM);
const longByDuration=classifyMediaFormat({duration:'PT8M12S',publishedAt:'2026-01-01T00:00:00Z'});
assert.equal(longByDuration.kind,FORMAT.LONG_FORM);
const unknownShortDuration=classifyMediaFormat({duration:'PT45S',publishedAt:'2026-01-01T00:00:00Z'});
assert.equal(unknownShortDuration.kind,FORMAT.UNKNOWN);

async function main(){
  let videoRequest=null;
  const api=new YouTubeApi({apiKey:'test-key',maxRetries:0,fetchImpl:async url=>{
    videoRequest=new URL(String(url));
    return {ok:true,json:async()=>({items:[{id:'target-long',snippet:{title:'Bán nhà Bình Chánh',publishedAt:'2026-01-02T00:00:00Z',categoryId:'22'},contentDetails:{duration:'PT8M12S'},player:{embedWidth:1920,embedHeight:1080},topicDetails:{},statistics:{}}]})};
  }});
  const target=await api.profileTarget('target-long');
  assert.equal(target.mediaFormat.kind,FORMAT.LONG_FORM);
  assert.ok(target.mediaFormat.confidence>=0.98);
  assert.ok(String(videoRequest.searchParams.get('part')).includes('player'));
  assert.equal(videoRequest.searchParams.get('maxWidth'),'8192');
  assert.equal(videoRequest.searchParams.get('maxHeight'),'8192');

  const shortFormat=classifyMediaFormat({duration:'PT40S',publishedAt:'2026-01-01T00:00:00Z',player:{embedWidth:720,embedHeight:1280}});
  const longFormat=target.mediaFormat;
  const semantic={route:{pageType:'shorts',path:'/shorts/current-short',videoId:'current-short'},viewport:{width:1000,height:700,scrollY:0},controls:{},advertising:{playingAd:false},affordances:[{index:1,tag:'a',role:'link',label:'Shorts',link:{youtube:true,path:'/shorts/another-short'},actionRect:{x:10,y:10,width:100,height:40}}]};
  const snapshot={pageType:'shorts',currentVideoId:'current-short',currentTopic:'real_estate',currentMediaFormat:shortFormat,candidates:[
    {videoId:'short-candidate',path:'/shorts/short-candidate',surface:'related',position:1,visible:true,actionRect:{x:10,y:80,width:200,height:80},classification:{primary:'real_estate',confidence:0.8},targetMatch:false,targetProximity:0.7,youtubeApi:{title:'Short candidate',mediaFormat:shortFormat}},
    {videoId:'long-candidate',path:'/watch?v=long-candidate',surface:'related',position:2,visible:true,actionable:true,hitTested:true,actionPoint:{x:110,y:220},visibleRect:{x:10,y:180,width:200,height:80,centerX:110,centerY:220},actionRect:{x:10,y:180,width:200,height:80},evidence:{geometryKnown:true,rectIntersectsViewport:true,hitOwned:true},classification:{primary:'real_estate',confidence:0.8},targetMatch:false,targetProximity:0.5,youtubeApi:{title:'Long candidate',mediaFormat:longFormat}}
  ]};
  const world=buildWorld({observation:{environment:{online:true,eligible:true},bodyState:{activeTabId:1,pointer:{known:true,x:50,y:50}}},semantic,snapshot,browser:{tabs:[{id:1,active:true,siteKey:'youtube.com'}]},tabId:1,target:{videoId:target.videoId,mediaFormat:target.mediaFormat},history:[]});
  assert.equal(world.targetFormat,FORMAT.LONG_FORM);
  assert.equal(world.current.mediaFormat,FORMAT.SHORT);
  assert.equal(world.formatMismatch,true);

  const memory={ucb(){return 0;},state:{queries:{}}},planner=new AutonomousAgentPlanner({memory,explorationBase:0}),queryPlan={fingerprint:{primaryTopic:'real_estate'},targetLanguage:'vi',plan:[{query:'nhà đất bình chánh',score:5}],signals:[],semanticTopics:[]},task=planner.inferTask(target,queryPlan),plan=planner.generate(world,{task,queryPlan,dynamicQueries:[],usedQueries:new Set(),stagnation:0});
  assert.equal(task.targetFormat,FORMAT.LONG_FORM);
  assert.equal(task.formatPolicy,'exclude_known_shorts_from_long_form_exploration');
  assert.equal(plan.subgoal.id,'exit_target_format_mismatch');
  assert.equal(plan.actions.some(a=>a.type==='click_candidate'&&a.target?.videoId==='short-candidate'),false);
  assert.equal(plan.actions.some(a=>a.type==='click_candidate'&&a.target?.videoId==='long-candidate'),true);
  assert.equal(plan.actions.some(a=>a.type==='dwell'),false);
  assert.equal(plan.actions.some(a=>a.affordance?.label==='Shorts'),false);
  assert.equal(plan.actions.some(a=>a.capability==='browser_ui.back'&&a.purpose==='exit_target_format_mismatch'),true);

  const shortTarget={...target,videoId:'target-short',mediaFormat:shortFormat};
  const shortTask=planner.inferTask(shortTarget,queryPlan),shortWorld=buildWorld({observation:{environment:{online:true,eligible:true},bodyState:{activeTabId:1,pointer:{known:true,x:50,y:50}}},semantic:{...semantic,route:{pageType:'watch',path:'/watch?v=current-long',videoId:'current-long'},affordances:[]},snapshot:{...snapshot,pageType:'watch',currentVideoId:'current-long',currentMediaFormat:longFormat},browser:{tabs:[{id:1,active:true,siteKey:'youtube.com'}]},tabId:1,target:{videoId:shortTarget.videoId,mediaFormat:shortTarget.mediaFormat},history:[]}),shortPlan=planner.generate(shortWorld,{task:shortTask,queryPlan,dynamicQueries:[],usedQueries:new Set(),stagnation:0});
  assert.equal(shortTask.targetFormat,FORMAT.SHORT);
  assert.equal(shortPlan.actions.some(a=>a.type==='click_candidate'&&a.target?.videoId==='long-candidate'),false);
  assert.equal(shortPlan.actions.some(a=>a.type==='click_candidate'&&a.target?.videoId==='short-candidate'),true);

  console.log('media_format_contract: PASS');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
