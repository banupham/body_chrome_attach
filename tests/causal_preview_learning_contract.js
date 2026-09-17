'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {
  AutonomousAgentPlanner,
  actionFamily,
  accountSurfaceBias,
  accountSearchBias,
  accountHomeBias,
  accountPreviewBias,
  accountNeighborClickBias
}=require('../research/autonomous_discovery/agent_planner');
const {recommendationDelta,contextKey}=require('../research/autonomous_discovery/world_model');
const {ExperienceMemory}=require('../research/autonomous_discovery/experience_memory');

const memory={ucb(){return 0;},interactionEffectScore(){return 0;},state:{queries:{}}};
const planner=new AutonomousAgentPlanner({memory,explorationBase:0});
const task=planner.inferTask(
  {videoId:'target001',mediaFormat:{kind:'LONG_FORM'}},
  {plan:[{query:'alpha signal',score:10}],signals:[],semanticTopics:['music'],fingerprint:{primaryTopic:'music'},targetLanguage:'en'},
  {accountState:'ESTABLISHED',plan:{surfaceBias:{home_feed:999,related:999,search_results:999},searchUtility:999,homeUtility:999,previewUtility:999,neighborClickUtility:999}}
);
const rect=(x,y,w=240,h=120)=>({x,y,width:w,height:h,centerX:x+w/2,centerY:y+h/2});
const candidate=(id,surface,topic='music',proximity=.35,pos=1)=>({
  videoId:id,surface,topic,targetMatch:false,targetProximity:proximity,position:pos,
  visible:true,actionRect:rect(80,180+pos*130),mediaFormat:{kind:'LONG_FORM'},isRadio:false
});
const world=(overrides={})=>({
  currentIsTarget:false,formatMismatch:false,targetVisible:null,
  current:{pageType:'home',videoId:null,topic:'unknown',mediaFormat:{kind:'UNKNOWN'}},
  candidates:[],history:[],advertising:{playingAd:false},
  tabs:[{id:1,siteKey:'youtube.com'}],tabId:1,controls:{homeLink:{}},
  viewport:{width:1200,height:800},body:{pointer:{known:true,x:50,y:50}},
  environment:{online:true},affordances:[],...overrides
});

// Account context is evidence only and cannot pre-rank a route.
assert.equal(accountSurfaceBias(task,'search_results'),0);
assert.equal(accountSearchBias(task),0);
assert.equal(accountHomeBias(task),0);
assert.equal(accountPreviewBias(task),0);
assert.equal(accountNeighborClickBias(task),0);

// Preview is an ordinary discoverable interaction on Home, Search and Related.
for(const [pageType,surface] of [['home','home_feed'],['search','search_results'],['watch','related']]){
  const c=candidate(`video-${surface}`,surface,'music',.31,1);
  const w=world({current:{pageType,videoId:pageType==='watch'?'source001':null,topic:'music',mediaFormat:{kind:'LONG_FORM'}},candidates:[c]});
  const plan=planner.generate(w,{task,queryPlan:{plan:[],signals:[],semanticTopics:['music']},dynamicQueries:[],usedQueries:new Set(),stagnation:0});
  const preview=plan.actions.find(a=>a.type==='preview_candidate'&&a.target?.videoId===c.videoId);
  assert.ok(preview,`expected preview action on ${surface}`);
  assert.match(actionFamily(preview,w,task),/^preview_/);
  assert.equal(preview.purpose,'test_preview_exposure_effect');
}

// Recommendation change is measured as environment evidence, not guessed from the route name.
{
  const before=world({candidates:[candidate('a','home_feed','music',.2,1),candidate('b','home_feed','music',.3,2)]});
  const after=world({candidates:[candidate('b','home_feed','music',.3,1),candidate('c','home_feed','gaming',.6,2)]});
  const delta=recommendationDelta(before,after);
  assert.ok(delta.recommendationShift>0);
  assert.ok(delta.candidateTurnover>0);
  assert.ok(delta.topicShift>0);
  assert.ok(delta.proximityGain>0);
}

// A recent preview exposure becomes part of the learned planning context.
{
  const w=world();
  const a=contextKey(w);
  w.recentExposure={videoId:'preview001',topic:'music',surface:'home_feed',playbackDeltaSec:7.5};
  const b=contextKey(w);
  assert.notEqual(a,b);
  assert.match(b,/preview_exposure:music:home_feed/);
}

// Interaction memory learns observed recommendation effects and exposure duration.
{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'causal-preview-'));
  try{
    const mem=new ExperienceMemory(path.join(root,'memory.json'));
    assert.equal(mem.interactionEffectScore('preview_home_feed_same_topic','ctx'),0);
    mem.recordInteractionEffect('preview_home_feed_same_topic',{context:'ctx',success:true,recommendationShift:.7,proximityGain:.2,targetSeen:true,exposureSeconds:8.4});
    const row=mem.interactionEffect('preview_home_feed_same_topic','ctx');
    assert.equal(row.observations,1);
    assert.equal(row.meanExposureSeconds,8.4);
    assert.ok(mem.interactionEffectScore('preview_home_feed_same_topic','ctx')>0);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}

// The execution path must support topic-filter actions created by the planner.
{
  const src=fs.readFileSync(path.join(__dirname,'..','research','autonomous_discovery','brain_v3.js'),'utf8');
  assert.match(src,/action\.type==='topic_filter'/);
  assert.doesNotMatch(src,/targetProgress=.*previewConfirmed===true/);
}

console.log('causal_preview_learning_contract: PASS');
