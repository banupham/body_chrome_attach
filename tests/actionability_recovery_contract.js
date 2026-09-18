'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {nodeView,actionabilityEvidence,actionabilityQuality}=require('../src/dom_perception');
const {extractSurface}=require('../src/youtube_semantic_observer');
const {buildWorld,actionabilityDelta}=require('../research/autonomous_discovery/world_model');
const {AutonomousAgentPlanner}=require('../research/autonomous_discovery/agent_planner');
const {AutonomousYouTubeBrainV3}=require('../research/autonomous_discovery/brain_v3');

const normalStyle={display:'block',visibility:'visible',opacity:'1',overflow:'visible',overflowX:'visible',overflowY:'visible'};
const rect={x:100,y:120,width:320,height:180};

// Perception must preserve why a target is blocked instead of collapsing every case to "not visible".
{
  const hidden={hidden:true,inert:false,parentElement:null,getAttribute(){return null;},contains(){return false;}};
  const hiddenView=nodeView(hidden,rect,{windowRef:{innerWidth:1000,innerHeight:700,getComputedStyle(){return normalStyle;}},documentRef:{elementFromPoint(){return hidden;}}});
  assert.equal(hiddenView.reason,'hidden');
  assert.equal(hiddenView.evidence.explicitHidden,true);
  assert.equal(hiddenView.evidence.geometryKnown,true);
  assert.equal(hiddenView.evidence.rectIntersectsViewport,true);

  const blocker={tagName:'DIV',className:'overlay',getAttribute(){return 'dialog';}};
  const node={hidden:false,inert:false,parentElement:null,getAttribute(){return null;},contains(){return false;}};
  const occluded=nodeView(node,rect,{windowRef:{innerWidth:1000,innerHeight:700,getComputedStyle(){return normalStyle;}},documentRef:{elementFromPoint(){return blocker;}}});
  assert.equal(occluded.reason,'occluded');
  assert.equal(occluded.hitTested,true);
  assert.equal(occluded.evidence.hitOwned,false);
  assert.equal(occluded.evidence.blocker.tag,'div');
  assert.equal(occluded.evidence.blocker.role,'dialog');
  assert.ok(actionabilityQuality(occluded)>0);
}

// If YouTube exposes the same video through multiple DOM anchors, keep the representation with better observed actionability.
{
  const card={querySelectorAll(){return [];},getBoundingClientRect(){return rect;}};
  const makeAnchor=(x,hidden)=>({hidden,inert:false,parentElement:null,href:'https://www.youtube.com/watch?v=sameVideo01',getAttribute(name){if(name==='href')return '/watch?v=sameVideo01';if(name==='title')return 'same video';return null;},closest(selector){return ['ytd-rich-item-renderer','ytd-video-renderer','ytd-grid-video-renderer','ytd-compact-video-renderer','ytd-playlist-panel-video-renderer','yt-lockup-view-model','ytm-shorts-lockup-view-model','ytd-radio-renderer','ytd-playlist-renderer'].includes(selector)?card:null;},contains(hit){return hit===this;},getBoundingClientRect(){return {x,y:160,width:220,height:120};}});
  const a1=makeAnchor(80,true),a2=makeAnchor(360,false),root={querySelectorAll(){return [a1,a2];},getBoundingClientRect(){return {x:0,y:80,width:900,height:500};}};
  const documentRef={querySelector(selector){return selector==='ytd-search #contents'?root:null;},elementFromPoint(x){return x>=360?a2:null;}};
  const windowRef={innerWidth:1000,innerHeight:700,getComputedStyle(){return normalStyle;}};
  const surface=extractSurface(documentRef,'search_results',{windowRef,maxItems:10});
  assert.equal(surface.items.length,1);
  assert.equal(surface.items[0].videoId,'sameVideo01');
  assert.equal(surface.items[0].representationCount,2);
  assert.equal(surface.items[0].actionable,true);
  assert.ok(surface.items[0].actionPoint);
  assert.equal(surface.items[0].representations.length,2);
}

// Actionability progress is separate from generic world changes such as scrollY.
function candidate({actionable=false,reason='occluded',scoreStage='blocked'}={}){
  const ready=actionable;
  return {videoId:'target001',surface:'search_results',position:1,targetMatch:true,targetProximity:1,visible:ready,actionable:ready,reason,hitTested:true,actionPoint:ready?{x:240,y:220}:null,visibleRect:{x:100,y:120,width:320,height:180},actionRect:{x:100,y:120,width:320,height:180},evidence:{geometryKnown:true,rectIntersectsViewport:true,rectFullyInViewport:true,hitOwned:ready,hitPointsTried:ready?1:5,blocker:ready?null:{tag:'div',role:'dialog'},reason},mediaFormat:{kind:'LONG_FORM'},topic:'music',isRadio:false};
}
function worldWith(c,scrollY=0){
  return buildWorld({observation:{environment:{online:true,eligible:true},bodyState:{activeTabId:1,pointer:{known:true,x:30,y:30}}},semantic:{route:{pageType:'search'},viewport:{width:1000,height:700,scrollY},controls:{},advertising:{playingAd:false},affordances:[]},snapshot:{pageType:'search',currentTopic:'unknown',candidates:[c]},browser:{tabs:[{id:1,active:true,siteKey:'youtube.com'}]},tabId:1,target:{videoId:'target001',mediaFormat:{kind:'LONG_FORM'}},history:[]});
}
{
  const before=worldWith(candidate({actionable:false}),0),scrolled=worldWith(candidate({actionable:false}),600),ready=worldWith(candidate({actionable:true,reason:'hit_test'}),600);
  const noProgress=actionabilityDelta(before,scrolled,'target001');
  assert.equal(noProgress.improved,false);
  assert.equal(noProgress.scoreDelta,0);
  const progress=actionabilityDelta(scrolled,ready,'target001');
  assert.equal(progress.improved,true);
  assert.equal(progress.becameActionable,true);
  assert.ok(progress.scoreDelta>0);
}

// Planner must not attempt a blocked target directly or hide a scroll inside click execution.
{
  const memory={ucb(){return 0;},interactionEffectScore(){return 0;},state:{queries:{}}},planner=new AutonomousAgentPlanner({memory,explorationBase:0});
  const task=planner.inferTask({videoId:'target001',mediaFormat:{kind:'LONG_FORM'}},{plan:[{query:'nearby music',score:10}],signals:[],semanticTopics:['music'],fingerprint:{primaryTopic:'music'}});
  const blocked=worldWith(candidate({actionable:false}));
  const plan=planner.generate(blocked,{task,queryPlan:{plan:[{query:'nearby music',score:10}],signals:[],semanticTopics:['music']},dynamicQueries:[],usedQueries:new Set(),stagnation:0});
  assert.equal(plan.subgoal.id,'restore_target_actionability');
  assert.equal(plan.actions.some(a=>a.purpose==='open_target'),false);
  const reobserve=plan.actions.find(a=>a.type==='reobserve'),down=plan.actions.find(a=>a.type==='scroll'&&a.direction==='down'),up=plan.actions.find(a=>a.type==='scroll'&&a.direction==='up');
  assert.ok(reobserve);assert.ok(down);assert.ok(up);
  assert.equal(reobserve.recoveryTargetVideoId,'target001');
  assert.equal(down.recoveryTargetVideoId,'target001');
  assert.equal(up.recoveryTargetVideoId,'target001');
  assert.equal(down.baseUtility,up.baseUtility);

  const ready=worldWith(candidate({actionable:true,reason:'hit_test'}));
  const readyPlan=planner.generate(ready,{task,queryPlan:{plan:[],signals:[],semanticTopics:['music']},dynamicQueries:[],usedQueries:new Set(),stagnation:0});
  assert.equal(readyPlan.subgoal.id,'open_observed_target');
  assert.ok(readyPlan.actions.some(a=>a.purpose==='open_target'));
}

// Recovery reward must depend on actionability improvement, not on the fact that the page scrolled.
{
  const brain=Object.create(AutonomousYouTubeBrainV3.prototype);
  const unchanged=brain.rewardAgent({action:{},outcome:{success:true,error:null},delta:{changed:true,reasons:['scroll','signature']},afterInfo:{},recovery:{improved:false,regressed:false,scoreDelta:0,becameActionable:false}});
  const improved=brain.rewardAgent({action:{},outcome:{success:true,error:null},delta:{changed:true,reasons:['scroll','actionability']},afterInfo:{},recovery:{improved:true,regressed:false,scoreDelta:8,becameActionable:false}});
  assert.ok(unchanged<0);
  assert.ok(improved>0);
}

// Architecture guard: candidate click may not call an implicit scroll-recovery loop.
{
  const source=fs.readFileSync(path.join(__dirname,'..','research','autonomous_discovery','brain_v2.js'),'utf8');
  const start=source.indexOf('async clickCandidate(candidate)');
  const end=source.indexOf('async verifiedBack()',start);
  const clickSource=source.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.doesNotMatch(clickSource,/scrollToCandidate|scrollVertical|for\s*\(let\s+attempt/);
  assert.match(clickSource,/candidate_not_safely_actionable/);
  const plannerSource=fs.readFileSync(path.join(__dirname,'..','research','autonomous_discovery','agent_planner.js'),'utf8');
  assert.doesNotMatch(plannerSource,/reason\s*===\s*['"](?:hidden|occluded|outside_view)['"][^\n]*scroll/i);
}

console.log('actionability_recovery_contract: PASS');
