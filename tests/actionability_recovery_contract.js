'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {nodeView}=require('../src/dom_perception');
const {extractSurface}=require('../src/youtube_semantic_observer');
const {buildWorld,candidateInteractionState,candidatePositionState,candidatePositionContext,actionabilityDelta}=require('../research/autonomous_discovery/world_model');
const {AutonomousAgentPlanner}=require('../research/autonomous_discovery/agent_planner');
const {ExperienceMemory}=require('../research/autonomous_discovery/experience_memory');
const {AutonomousYouTubeBrainV3}=require('../research/autonomous_discovery/brain_v3');

const normalStyle={display:'block',visibility:'visible',opacity:'1',overflow:'visible',overflowX:'visible',overflowY:'visible'};
const rect={x:100,y:120,width:320,height:180};

// BODY is eyes only: geometry/style/hit samples are observations, not action decisions.
{
  const node={hidden:false,inert:false,parentElement:null,getAttribute(){return null;},contains(hit){return hit===this;}};
  const view=nodeView(node,rect,{windowRef:{innerWidth:1000,innerHeight:700,getComputedStyle(){return normalStyle;}},documentRef:{elementFromPoint(){return node;}}});
  assert.equal(view.visible,true);
  assert.equal(view.hitTested,true);
  assert.equal(view.hitSamples.length,5);
  assert.equal(view.hitSamples.some(row=>row.owned),true);
  assert.equal(Object.hasOwn(view,'actionable'),false);
  assert.equal(Object.hasOwn(view,'actionPoint'),false);
  assert.equal(Object.hasOwn(view,'reason'),false);
}

// aria-hidden and ancestor clipping remain evidence only. They must not prevent
// BODY from collecting physical hit-test facts for an in-viewport rectangle.
{
  const clipParent={hidden:false,inert:false,parentElement:null,getAttribute(name){return name==='aria-hidden'?'true':null;},getBoundingClientRect(){return {x:0,y:0,width:50,height:50};}};
  const node={hidden:false,inert:false,parentElement:clipParent,getAttribute(){return null;},contains(hit){return hit===this;}};
  const windowRef={innerWidth:1000,innerHeight:700,getComputedStyle(n){return n===clipParent?{...normalStyle,overflow:'hidden',overflowX:'hidden',overflowY:'hidden'}:normalStyle;}};
  const view=nodeView(node,rect,{windowRef,documentRef:{elementFromPoint(){return node;}}});
  assert.equal(view.evidence.rectIntersectsViewport,true);
  assert.equal(view.evidence.rectFullyInViewport,true);
  assert.equal(view.evidence.ariaHidden,true);
  assert.equal(view.evidence.clippedByContainer,true);
  assert.equal(view.evidence.clippedRect,null);
  assert.equal(view.hitTested,true);
  assert.equal(view.hitSamples.some(row=>row.owned),true);
}

// Same video can have multiple DOM representations. BODY preserves all raw
// representations; Brain, not BODY, chooses the representation and click point.
{
  const card={querySelectorAll(){return [];},getBoundingClientRect(){return rect;}};
  const makeAnchor=(x,hitOwned)=>({hidden:false,inert:false,parentElement:null,href:'https://www.youtube.com/watch?v=sameVideo01',getAttribute(name){if(name==='href')return '/watch?v=sameVideo01';if(name==='title')return 'same video';return null;},closest(selector){return ['ytd-rich-item-renderer','ytd-video-renderer','ytd-grid-video-renderer','ytd-compact-video-renderer','ytd-playlist-panel-video-renderer','yt-lockup-view-model','ytm-shorts-lockup-view-model','ytd-radio-renderer','ytd-playlist-renderer'].includes(selector)?card:null;},contains(hit){return hit===this;},getBoundingClientRect(){return {x,y:160,width:220,height:120};},hitOwned});
  const a1=makeAnchor(80,false),a2=makeAnchor(360,true),root={querySelectorAll(){return [a1,a2];},getBoundingClientRect(){return {x:0,y:80,width:900,height:500};}};
  const blocker={tagName:'DIV',className:'overlay',getAttribute(){return 'dialog';}};
  const documentRef={querySelector(selector){return selector==='ytd-search #contents'?root:null;},elementFromPoint(x){return x>=360?a2:blocker;}};
  const windowRef={innerWidth:1000,innerHeight:700,getComputedStyle(){return normalStyle;}};
  const surface=extractSurface(documentRef,'search_results',{windowRef,maxItems:10}),raw=surface.items[0];
  assert.equal(surface.items.length,1);
  assert.equal(raw.videoId,'sameVideo01');
  assert.equal(raw.representationCount,2);
  assert.equal(raw.representations.length,2);
  assert.equal(Object.hasOwn(raw,'actionable'),false);
  assert.equal(Object.hasOwn(raw,'actionPoint'),false);
  const decision=candidateInteractionState(raw);
  assert.equal(decision.actionable,true);
  assert.equal(decision.index,1);
  assert.ok(decision.actionPoint);
  assert.equal(decision.reason,'owned_hit_sample');
}

function rawCandidate({owned=false,offscreen=false}={}){
  const actionRect=offscreen?{x:100,y:900,width:320,height:180}:{x:100,y:120,width:320,height:180};
  return {videoId:'target001',surface:'search_results',position:1,targetMatch:true,targetProximity:1,mediaFormat:{kind:'LONG_FORM'},topic:'music',isRadio:false,representationCount:1,representations:[{visible:!offscreen,visibleRect:offscreen?null:{x:100,y:120,width:320,height:180,centerX:260,centerY:210},hitTested:!offscreen,hitSamples:offscreen?[]:[{x:260,y:210,owned,blocker:owned?null:{tag:'div',role:'dialog'}}],actionRect,evidence:{geometryKnown:true,rectIntersectsViewport:!offscreen,rectFullyInViewport:!offscreen,explicitHidden:false,inert:false,ariaHidden:false,displayNone:false,visibilityHidden:false,opacityZero:false,clippedByContainer:false}}]};
}
function worldWith(c,scrollY=0){
  return buildWorld({observation:{environment:{online:true,eligible:true},bodyState:{activeTabId:1,pointer:{known:true,x:30,y:30}}},semantic:{route:{pageType:'search'},viewport:{width:1000,height:700,scrollY},controls:{},advertising:{playingAd:false},affordances:[]},snapshot:{pageType:'search',currentTopic:'unknown',candidates:[c]},browser:{tabs:[{id:1,active:true,siteKey:'youtube.com'}]},tabId:1,target:{videoId:'target001',mediaFormat:{kind:'LONG_FORM'}},history:[]});
}
function rawCandidateAt(y,{owned=false,targetMatch=true}={}){
  const actionRect={x:100,y,width:320,height:180};
  const inView=y<700&&y+180>0;
  return {videoId:'target001',surface:'search_results',position:1,targetMatch,targetProximity:1,mediaFormat:{kind:'LONG_FORM'},topic:'music',isRadio:false,representationCount:1,representations:[{visible:inView,visibleRect:inView?{...actionRect,centerX:260,centerY:y+90}:null,hitTested:inView,hitSamples:inView?[{x:260,y:y+90,owned,blocker:owned?null:{tag:'div',role:'overlay'}}]:[],actionRect,evidence:{geometryKnown:true,rectIntersectsViewport:inView,rectFullyInViewport:inView&&y>=0&&y+180<=700,explicitHidden:false,inert:false,ariaHidden:false,displayNone:false,visibilityHidden:false,opacityZero:false,clippedByContainer:false}}]};
}

// Brain alone decides readiness and measures recovery progress from raw evidence.
{
  const before=worldWith(rawCandidate({owned:false}),0),scrolled=worldWith(rawCandidate({owned:false}),600),ready=worldWith(rawCandidate({owned:true}),600);
  assert.equal(before.targetVisible.actionable,false);
  assert.equal(ready.targetVisible.actionable,true);
  assert.ok(ready.targetVisible.actionPoint);
  const noProgress=actionabilityDelta(before,scrolled,'target001');
  assert.equal(noProgress.improved,false);
  const progress=actionabilityDelta(scrolled,ready,'target001');
  assert.equal(progress.improved,true);
  assert.equal(progress.becameActionable,true);
  assert.ok(progress.scoreDelta>0);
}

// Position progress is learned before the candidate becomes clickable: moving an
// off-screen representation closer is a positive observed effect even when the
// actionability score itself has not changed yet.
{
  const far=worldWith(rawCandidateAt(1600),0),near=worldWith(rawCandidateAt(950),650);
  const farState=candidatePositionState(far.targetVisible,far),nearState=candidatePositionState(near.targetVisible,near),delta=actionabilityDelta(far,near,'target001');
  assert.equal(farState.verticalRelation,'below');
  assert.equal(nearState.verticalRelation,'below');
  assert.ok(nearState.distancePx<farState.distancePx);
  assert.equal(delta.scoreDelta,0);
  assert.equal(delta.positionImproved,true);
  assert.equal(delta.improved,true);
  assert.ok(delta.effectDelta>0);
  assert.match(candidatePositionContext(far,far.targetVisible),/^effect_model_v2\|/);
}

// Planner consumes Brain-derived readiness, never BODY-provided actionable flags.
{
  const memory={ucb(){return 0;},interactionEffectScore(){return 0;},actionEffectScore(){return 0;},state:{queries:{}}},planner=new AutonomousAgentPlanner({memory,explorationBase:0});
  const task=planner.inferTask({videoId:'target001',mediaFormat:{kind:'LONG_FORM'}},{plan:[{query:'nearby music',score:10}],signals:[],semanticTopics:['music'],fingerprint:{primaryTopic:'music'}});
  const blocked=worldWith(rawCandidateAt(1150));
  const plan=planner.generate(blocked,{task,queryPlan:{plan:[{query:'nearby music',score:10}],signals:[],semanticTopics:['music']},dynamicQueries:[],usedQueries:new Set(),stagnation:0});
  assert.equal(plan.subgoal.id,'restore_target_actionability');
  assert.equal(plan.actions.some(a=>a.purpose==='open_target'),false);
  assert.ok(plan.actions.some(a=>a.type==='position_candidate'&&a.recoveryTargetVideoId==='target001'));
  assert.equal(plan.actions[0].type,'position_candidate');
  const ready=worldWith(rawCandidate({owned:true}));
  const readyPlan=planner.generate(ready,{task,queryPlan:{plan:[],signals:[],semanticTopics:['music']},dynamicQueries:[],usedQueries:new Set(),stagnation:0});
  assert.equal(readyPlan.subgoal.id,'open_observed_target');
  assert.ok(readyPlan.actions.some(a=>a.purpose==='open_target'));
}

// Wrong positioning hypotheses lose utility and successful ones gain utility in
// the same evidence context. This learning store is isolated from legacy reward
// memory by the effect_model_v2 namespace.
{
  const dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'brain-position-learning-')),file=path.join(dir,'memory.json'),memory=new ExperienceMemory(file),planner=new AutonomousAgentPlanner({memory,explorationBase:0});
  const task=planner.inferTask({videoId:'target001',mediaFormat:{kind:'LONG_FORM'}},{plan:[],signals:[],semanticTopics:['music'],fingerprint:{primaryTopic:'music'}});
  const blocked=worldWith(rawCandidateAt(1300));
  const first=planner.generate(blocked,{task,queryPlan:{plan:[],signals:[],semanticTopics:['music']},dynamicQueries:[],usedQueries:new Set(),stagnation:0});
  const p55=first.actions.find(a=>a.type==='position_candidate'&&a.positionVariant==='geometry_55'),p85=first.actions.find(a=>a.type==='position_candidate'&&a.positionVariant==='geometry_85');
  assert.ok(p55&&p85);
  memory.recordActionEffect(p55.memoryId,{context:p55.effectContext,executionSuccess:true,environmentChanged:true,expectedEffectObserved:false,targetProgress:false,goalSuccess:false,regressed:true,effectDelta:-1});
  memory.recordActionEffect(p85.memoryId,{context:p85.effectContext,executionSuccess:true,environmentChanged:true,expectedEffectObserved:true,targetProgress:true,goalSuccess:false,regressed:false,effectDelta:1});
  const learned=planner.generate(blocked,{task,queryPlan:{plan:[],signals:[],semanticTopics:['music']},dynamicQueries:[],usedQueries:new Set(),stagnation:0}),l55=learned.actions.find(a=>a.type==='position_candidate'&&a.positionVariant==='geometry_55'),l85=learned.actions.find(a=>a.type==='position_candidate'&&a.positionVariant==='geometry_85');
  assert.ok(l55.learnedEffectBonus<0);
  assert.ok(l85.learnedEffectBonus>0);
  assert.ok(l85.utility>l55.utility);
  assert.equal(memory.state.actionEffectSchema,'effect_model_v2');
  fs.rmSync(dir,{recursive:true,force:true});
}

// Recovery reward remains a Brain concern.
{
  const brain=Object.create(AutonomousYouTubeBrainV3.prototype);
  const unchanged=brain.rewardAgent({action:{},outcome:{success:true,error:null},delta:{changed:true,reasons:['scroll','signature']},afterInfo:{},recovery:{improved:false,regressed:false,scoreDelta:0,becameActionable:false}});
  const improved=brain.rewardAgent({action:{},outcome:{success:true,error:null},delta:{changed:true,reasons:['scroll','actionability']},afterInfo:{},recovery:{improved:true,regressed:false,scoreDelta:8,becameActionable:false}});
  assert.ok(unchanged<0);
  assert.ok(improved>0);
}

// Architecture guard: BODY may observe, never judge or choose an action target.
{
  const bodySource=fs.readFileSync(path.join(__dirname,'..','src','dom_perception.js'),'utf8');
  const semanticSource=fs.readFileSync(path.join(__dirname,'..','src','youtube_semantic_observer.js'),'utf8');
  assert.doesNotMatch(bodySource,/actionabilityQuality|actionPoint\s*:|actionable\s*:/);
  assert.doesNotMatch(semanticSource,/actionabilityQuality|useNew=.*actionability|actionPoint\s*:|actionable\s*:/);
  assert.match(bodySource,/hitSamples/);
  assert.match(semanticSource,/representations/);

  const brainSource=fs.readFileSync(path.join(__dirname,'..','research','autonomous_discovery','brain_v2.js'),'utf8'),clickStart=brainSource.indexOf('async clickCandidate(candidate)'),clickEnd=brainSource.indexOf('async verifiedBack()',clickStart),clickSource=brainSource.slice(clickStart,clickEnd);
  const worldSource=fs.readFileSync(path.join(__dirname,'..','research','autonomous_discovery','world_model.js'),'utf8');
  assert.ok(clickStart>=0&&clickEnd>clickStart);
  assert.match(clickSource,/candidateInteractionState/);
  assert.match(worldSource,/candidateInteractionState/);
  assert.match(worldSource,/owned_hit_sample/);
  assert.doesNotMatch(clickSource,/scrollToCandidate|for\s*\(let\s+attempt/);
}

console.log('actionability_recovery_contract: PASS');
