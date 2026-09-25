'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {nodeView}=require('../src/dom_perception');
const {extractSurface}=require('../src/youtube_semantic_observer');
const {buildWorld,candidateInteractionState,candidateViewportState,candidateEffectDelta,actionabilityDelta}=require('../research/autonomous_discovery/world_model');
const {AutonomousAgentPlanner,candidatePositionActions,affordanceActions}=require('../research/autonomous_discovery/agent_planner');
const {AutonomousYouTubeBrainV3,progressSignals,candidateEffectValue,findSemanticAffordance,semanticTextVerification,rawBodySemanticEffect}=require('../research/autonomous_discovery/brain_v3');
const {ExperienceMemory}=require('../research/autonomous_discovery/experience_memory');
const {FORMAT}=require('../research/autonomous_discovery/media_format');
const os=require('node:os');

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

// Brain models candidate position separately from BODY actionability and learns
// whether a positioning attempt moved the candidate toward a usable viewport.
{
  const below=worldWith(rawCandidate({offscreen:true}),0),state=candidateViewportState(below.targetVisible,below.viewport);
  assert.equal(state.zone,'below');
  assert.ok(state.distanceToViewport>0);
  const generated=candidatePositionActions(below.targetVisible,below,{priority:100});
  assert.ok(generated.length>=2);
  assert.ok(generated.every(row=>row.type==='position_candidate'&&row.recoveryTargetVideoId==='target001'));
  assert.ok(generated.some(row=>Number(row.delta)>0));

  const nearerRaw=rawCandidate({offscreen:true});nearerRaw.representations[0].actionRect={x:100,y:760,width:320,height:180};
  const fartherRaw=rawCandidate({offscreen:true});fartherRaw.representations[0].actionRect={x:100,y:1250,width:320,height:180};
  const nearer=worldWith(nearerRaw,300),farther=worldWith(fartherRaw,0);
  const improved=candidateEffectDelta(below,nearer,'target001'),wrongWay=candidateEffectDelta(below,farther,'target001');
  assert.equal(improved.improved,true);
  assert.ok(improved.distanceImprovement>0);
  assert.equal(wrongWay.regressed,true);
  assert.ok(wrongWay.distanceImprovement<0);
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

// Planner consumes Brain-derived readiness, never BODY-provided actionable flags.
{
  const memory={ucb(){return 0;},interactionEffectScore(){return 0;},actionEffectScore(){return 0;},state:{queries:{}}},planner=new AutonomousAgentPlanner({memory,explorationBase:0});
  const task=planner.inferTask({videoId:'target001',mediaFormat:{kind:'LONG_FORM'}},{plan:[{query:'nearby music',score:10}],signals:[],semanticTopics:['music'],fingerprint:{primaryTopic:'music'}});
  const blocked=worldWith(rawCandidate({owned:false}));
  const plan=planner.generate(blocked,{task,queryPlan:{plan:[{query:'nearby music',score:10}],signals:[],semanticTopics:['music']},dynamicQueries:[],usedQueries:new Set(),stagnation:0});
  assert.equal(plan.subgoal.id,'restore_target_actionability');
  assert.equal(plan.actions.some(a=>a.purpose==='open_target'),false);
  assert.ok(plan.actions.some(a=>a.type==='position_candidate'&&a.recoveryTargetVideoId==='target001'));
  const ready=worldWith(rawCandidate({owned:true}));
  const readyPlan=planner.generate(ready,{task,queryPlan:{plan:[],signals:[],semanticTopics:['music']},dynamicQueries:[],usedQueries:new Set(),stagnation:0});
  assert.equal(readyPlan.subgoal.id,'open_observed_target');
  assert.ok(readyPlan.actions.some(a=>a.purpose==='open_target'));
}

// Effect memory learns from observed outcome, not merely successful dispatch.
{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'brain-effect-v2-')),file=path.join(dir,'memory.json'),memory=new ExperienceMemory(file),context='effect_v2|watch|food|test';
  memory.recordActionEffect('motor.scrollVertical:position_candidate:forward_medium',{context,executionSuccess:true,expectedEffectObserved:false,regressed:true,effectValue:-18});
  memory.recordActionEffect('motor.scrollVertical:position_candidate:forward_medium',{context,executionSuccess:true,expectedEffectObserved:false,regressed:true,effectValue:-12});
  memory.recordActionEffect('motor.scrollVertical:position_candidate:forward_large',{context,executionSuccess:true,expectedEffectObserved:true,regressed:false,targetProgress:true,effectValue:22});
  assert.ok(memory.actionEffectScore('motor.scrollVertical:position_candidate:forward_large',context)>memory.actionEffectScore('motor.scrollVertical:position_candidate:forward_medium',context));
  assert.equal(memory.state.effectSchema,'candidate_effect_v2');
  fs.rmSync(dir,{recursive:true,force:true});
}

// Candidate actionability progress is local recovery evidence, not target progress.
{
  const unrelated=progressSignals({goalSuccess:false,success:true,proximityGain:0,targetCandidateBefore:false,targetCandidateAfter:false,recovery:{improved:true},recoveryTargetVideoId:'neighbor001',targetVideoId:'target001'});
  assert.equal(unrelated.candidateActionabilityProgress,true);
  assert.equal(unrelated.recoveryIsTarget,false);
  assert.equal(unrelated.targetRecoveryProgress,false);
  assert.equal(unrelated.targetProgress,false);

  const targetRecovery=progressSignals({goalSuccess:false,success:true,proximityGain:0,targetCandidateBefore:true,targetCandidateAfter:true,recovery:{improved:true},recoveryTargetVideoId:'target001',targetVideoId:'target001'});
  assert.equal(targetRecovery.candidateActionabilityProgress,true);
  assert.equal(targetRecovery.recoveryIsTarget,true);
  assert.equal(targetRecovery.targetRecoveryProgress,true);
  assert.equal(targetRecovery.targetProgress,true);

  const evidenceGain=progressSignals({goalSuccess:false,success:true,proximityGain:0.2,targetCandidateBefore:false,targetCandidateAfter:false,recovery:null,recoveryTargetVideoId:null,targetVideoId:'target001'});
  assert.equal(evidenceGain.targetProximityImproved,true);
  assert.equal(evidenceGain.targetProgress,true);
}

// Recovery reward keeps local candidate improvement modest; target recovery may
// receive target-directed reward. Candidate effect value remains available for
// learning geometry/actionability independently of task progress.
{
  const brain=Object.create(AutonomousYouTubeBrainV3.prototype);brain.targetOpened=false;
  const recovery={improved:true,regressed:false,scoreDelta:110,distanceImprovement:154,becameInViewport:true,becameActionable:true};
  const afterInfo={newVideos:0,newTopics:0,newTransitions:0,proximityGain:0,targetCandidate:null};
  const unrelatedReward=brain.rewardAgent({action:{},outcome:{success:true,error:null},delta:{changed:true,reasons:['scroll','actionability']},afterInfo,recovery,recoveryIsTarget:false,targetProgress:false});
  const targetReward=brain.rewardAgent({action:{},outcome:{success:true,error:null},delta:{changed:true,reasons:['scroll','actionability']},afterInfo,recovery,recoveryIsTarget:true,targetProgress:true});
  assert.equal(unrelatedReward,2);
  assert.ok(targetReward>unrelatedReward);
  assert.ok(candidateEffectValue(recovery)>unrelatedReward);
}


// Native-occluded affordances are evidence, not safe targets. Brain must not
// generate pointer/text actions from a covered coordinate.
{
  const world={affordances:[{index:3,tag:'input',role:'textbox',type:'text',editable:true,disabled:false,label:'Search',actionRect:{x:100,y:500,width:300,height:40},interactionPoint:null,interaction:{actionable:false,reason:'native_top_level_occlusion'}}],viewport:{width:1000,height:700}};
  const actions=affordanceActions(world,{textProbe:'europeans food',targetVocabulary:['food'],targetFormat:FORMAT.LONG_FORM});
  assert.equal(actions.length,0);
}

// Generic text actions are successful only when the same observed editable is
// still focused and contains the exact expected text.
{
  const descriptor={index:3,label:'Search',role:'textbox',tag:'input'};
  const expected={length:14,fnv1a32:'placeholder'};
  const rows={affordances:[{index:3,label:'Search',role:'textbox',tag:'input',editable:true,active:true,state:{valueFingerprint:expected}}]};
  const row=findSemanticAffordance(rows,descriptor);assert.ok(row);
  const actual=semanticTextVerification(row,'europeans food');
  assert.equal(actual.ok,false);
  assert.equal(rawBodySemanticEffect({capability:'motor.typeText',verification:{textVerified:false}},{changed:true,reasons:['signature','browser_ui']}),false);
  assert.equal(rawBodySemanticEffect({capability:'motor.typeText',verification:{textVerified:true}},{changed:true,reasons:['selection']}),true);
  assert.equal(rawBodySemanticEffect({capability:'motor.click'},{changed:true,reasons:['browser_ui']}),false);
  assert.equal(rawBodySemanticEffect({capability:'motor.click'},{changed:true,reasons:['page_type']}),true);
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
