'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {AutonomousYouTubeBrainV4}=require('../research/autonomous_discovery/brain_v4');
const {AutonomousAgentPlanner,actionMemoryId}=require('../research/autonomous_discovery/agent_planner');
const {buildWorld,contextKey}=require('../research/autonomous_discovery/world_model');
const {buildAccountProfile,contextForTarget}=require('../research/autonomous_discovery/account_profile');
const {advertisingObservation}=require('../src/youtube_semantic_observer');
const {parseArgs}=require('../research/autonomous_discovery/entry');

const root=fs.mkdtempSync(path.join(os.tmpdir(),'body-account-recovery-'));
const originalRandom=Math.random;
const api={stats:()=>({enabled:false}),enrichVideoIds:async()=>new Map()};
const config={root,target:'target00001',accountId:'account-a',reportEverySteps:10,reportEveryMinutes:10,discoveryMode:'auto',discoverySurface:'auto'};
const target={videoId:config.target,title:'Target example',categoryId:'22',mediaFormat:{kind:'LONG_FORM'},tags:['Japan culture']};
const candidate={videoId:'candidate01',surface:'related',position:1,visible:true,actionRect:{x:700,y:200,width:200,height:100},classification:{primary:'food'},targetProximity:0.6,youtubeApi:{mediaFormat:{kind:'LONG_FORM'}}};
const world=buildWorld({tabId:1,target,semantic:{route:{pageType:'watch',videoId:'current0001'},viewport:{width:1000,height:700}},snapshot:{pageType:'watch',currentVideoId:'current0001',currentTopic:'food',currentMediaFormat:{kind:'LONG_FORM'},candidates:[candidate]}});
function brain(accountId='account-a'){
  const b=new AutonomousYouTubeBrainV4({...config,accountId},{body:{},api});b.targetApi=target;
  b.accountContext=contextForTarget(buildAccountProfile({accountId,signedInState:'signed_in',historyVideos:[],homeSampleCount:0}),target);
  b.taskModel=b.agentPlanner.inferTask(target,{fingerprint:{primaryTopic:'food'},targetLanguage:'en'},b.accountContext);
  return b;
}
function rectNode(rect,extra={}){return {getBoundingClientRect:()=>rect,...extra};}
function advertising({marker=null,module=null,adClass=false,style={display:'block',visibility:'visible',opacity:'1'},companion=null}={}){
  const player=rectNode({x:0,y:100,width:640,height:360},{classList:{contains:name=>adClass&&name==='ad-showing'},querySelectorAll:selector=>selector==='.ytp-ad-text'&&marker?[marker]:[]});
  const document={querySelector:selector=>selector==='#movie_player'?player:selector==='.ytp-ad-module'?module:selector==='ytd-action-companion-ad-renderer'?companion:null,querySelectorAll:()=>[]};
  return advertisingObservation(document,{innerWidth:1000,innerHeight:700,getComputedStyle:()=>style});
}

async function main(){
  Math.random=()=>0.5;
  assert.equal(parseArgs(['--target',config.target,'--account-id','account-a']).accountId,'account-a');
  const b=brain(),task={targetFormat:'LONG_FORM'},planner=new AutonomousAgentPlanner({memory:b.memory,explorationBase:0});
  const select=()=>planner.generate(world,{task,queryPlan:{plan:[]}}).actions.find(a=>a.type==='click_candidate');
  const before=select(),id=actionMemoryId(before),context=contextKey(world);
  b.memory.recordStrategy(id,{context,reward:-100,success:false});
  const after=select();assert.ok(after.utility<before.utility,'a recorded failure must reduce the next utility');
  assert.equal(b.memory.strategy(after.memoryId,context).attempts,1);
  b.memory.save();const isolated=brain('account-b'),reloaded=brain();
  assert.notEqual(b.memory.file,isolated.memory.file);
  assert.equal(isolated.memory.strategy(id,context).attempts,0);
  assert.equal(reloaded.memory.strategy(id,context).attempts,1,'existing scoped learning must survive restart');

  // High legacy query rewards cannot override the recent-query cooldown.
  b.memory.state.queries['european food']={meanReward:1000};
  const repeatedWorld={...world,history:[{type:'search',query:'European food',success:true,changed:true}]};
  const queries=planner.generate(repeatedWorld,{task,queryPlan:{plan:[{query:'european food',score:20},{query:'regional cuisine',score:12}]},usedQueries:new Set(['european food'])});
  assert.ok(!queries.actions.some(a=>a.type==='search'&&a.query==='european food'));
  assert.ok(queries.actions.some(a=>a.type==='search'&&a.query==='regional cuisine'));

  const changed={changed:true,reasons:['signature','scroll']},novel={newVideos:100,newTopics:4,newTransitions:4,proximityGain:0,targetCandidate:null,snapshot:{candidates:[]}};
  const args={action:{type:'click_candidate',selection:'exploration_family_diverse'},outcome:{success:false,error:null},delta:changed,afterInfo:novel};
  assert.ok(b.rewardAgent(args)<0,'failed navigation cannot earn positive novelty reward');
  assert.ok(b.rewardAgent({...args,outcome:{success:true}})<=1,'novelty alone cannot count as target progress');
  assert.ok(b.rewardAgent({...args,action:{type:'preview_candidate'},outcome:{success:true,previewConfirmed:true}})>1,'confirmed cold-start preview remains useful');

  // Exercise the actual outcome/memory/checkpoint path, not just reward helpers.
  b.stepNo=1;b.worldFrom=async()=>world;
  b.agentPlanner.generate=()=>({context,subgoal:{id:'test'},actions:[]});
  b.agentPlanner.choose=()=>({...before,selection:'utility_max'});
  b.executeAgentAction=async()=>({success:false,error:'candidate_not_safely_actionable',selected:candidate,durationMs:100});
  b.observe=async()=>({semantic:{}});b.enrichedSnapshot=async()=>novel;
  const outcome=await b.actAgent({semantic:{}},{snapshot:{candidates:[candidate]},targetCandidate:null});
  assert.ok(outcome.reward<0);assert.equal(b.stagnation,1);
  assert.equal(b.agentHistory[0].targetProgress,false);
  const events=fs.readFileSync(b.ledgerFile,'utf8').trim().split('\n').map(JSON.parse);
  const event=events.find(row=>row.type==='agent_outcome');assert.ok(event);assert.equal(event.actionType,'click_candidate');
  assert.equal(event.memoryId,id);

  // Keep bounded action recovery on the account-aware V4 execution path.
  const stuck=brain('account-stuck'),commands=[];
  stuck.handleAds=async()=>({handled:false});
  stuck.observe=async()=>({semantic:{viewport:{width:1000,height:700},surfaces:[{surface:'related',items:[{...candidate,visible:false,actionRect:{x:700,y:4000,width:200,height:100,centerY:4050}}]}]}});
  stuck.motor=async intent=>{commands.push(intent.type);return {execution:{completed:true}};};
  const failed=await stuck.clickCandidateSafe(candidate);
  assert.equal(failed.ok,false);assert.equal(commands.filter(x=>x==='scrollVertical').length,2);assert.ok(!commands.includes('click'));assert.equal(stuck.candidateDeadline,null);
  stuck.candidateDeadline=Date.now()-1;commands.length=0;
  await assert.rejects(()=>stuck.prepareCandidateForSafeClick(candidate),/budget_exhausted/);assert.equal(commands.length,0);
  stuck.candidateDeadline=Date.now()+10000;stuck.stopRequested=true;
  await assert.rejects(()=>stuck.prepareCandidateForSafeClick(candidate),/action_stopped/);stuck.candidateDeadline=null;

  const arrived=brain('account-arrival'),targetCandidate={...candidate,videoId:target.videoId};
  arrived.clickCandidateSafe=async()=>({ok:true,result:{execution:{completed:true}}});
  const opened=await arrived.executeAgentAction({type:'click_candidate',target:targetCandidate},{snapshot:{candidates:[targetCandidate]}},world);
  assert.equal(opened.success,true);assert.equal(arrived.targetDiscovery.opened,true);
  assert.equal(arrived.targetDiscovery.surface,'related');assert.equal(arrived.surfaceDiscoveryRecorded,true);
  assert.ok(arrived.accountProfileStore.brainGeneratedVideoIds().has(target.videoId));

  const hidden=rectNode({x:0,y:0,width:0,height:0});
  assert.equal(advertising({module:hidden}).playingAd,false);
  assert.equal(advertising({companion:rectNode({x:700,y:100,width:200,height:100})}).playingAd,false);
  assert.equal(advertising({marker:hidden}).playingAd,false);
  const marker=rectNode({x:20,y:200,width:100,height:20});
  assert.equal(advertising({marker,style:{visibility:'hidden',display:'block',opacity:'1'}}).playingAd,false);
  assert.equal(advertising({marker}).playingAd,true);
  assert.equal(advertising({adClass:true}).playingAd,true);

  // Rotated batches and live latest have explicit, different coverage.
  const reporting=brain('account-report');
  for(let step=1;step<=10;step++)reporting.agentHistory.push({step,type:'search',success:true});
  reporting.stepNo=10;reporting.batchPath=[...reporting.agentHistory];
  const paths=reporting.writeBatch('RUNNING');
  const batch=JSON.parse(fs.readFileSync(paths.json));assert.equal(batch.reportScope,'batch');assert.equal(batch.batch.lastStep,10);
  reporting.stepNo=11;const row={step:11,type:'click_candidate',success:true};reporting.agentHistory.push(row);reporting.batchPath.push(row);reporting.writeBatch('RUNNING');
  const latest=JSON.parse(fs.readFileSync(paths.latest));
  assert.equal(latest.schemaVersion,9);assert.equal(latest.summary.steps,11);assert.equal(latest.historyLastStep,11);assert.equal(latest.path.length,11);
  assert.equal(latest.batch.firstStep,11);assert.equal(latest.reportScope,'checkpoint');assert.equal(latest.source.revision,'observation-feedback-recovery-v2');
  assert.equal(latest.account.accountKey,reporting.accountContext.accountKey);
  reporting.writeBatch('USER_STOP',true);assert.equal(JSON.parse(fs.readFileSync(paths.latest)).status,'USER_STOP');
  console.log('account_recovery_v4_contract: PASS');
}

main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{Math.random=originalRandom;fs.rmSync(root,{recursive:true,force:true});});
