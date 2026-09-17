'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {SurfacePolicyStore,MODE,SURFACE,normalizeMode,normalizeSurface}=require('../research/autonomous_discovery/surface_policy');
const {AutonomousAgentPlanner}=require('../research/autonomous_discovery/agent_planner');

assert.equal(normalizeMode('surface-test'),MODE.SURFACE_TEST);
assert.equal(normalizeMode('DIVERSITY'),MODE.DIVERSITY);
assert.equal(normalizeSurface('home'),SURFACE.HOME);
assert.equal(normalizeSurface('next-video'),SURFACE.RELATED);
assert.equal(normalizeSurface('mix'),SURFACE.MIX);

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'body-surface-policy-'));
try{
  const store=new SurfacePolicyStore(tmp),chosen=[];
  for(let i=0;i<4;i++)chosen.push(store.beginRun({targetVideoId:'target-surface-001',mode:'diversity',requestedSurface:'auto'}).preferredSurface);
  assert.deepEqual(new Set(chosen),new Set([SURFACE.HOME,SURFACE.SEARCH,SURFACE.RELATED,SURFACE.MIX]));
  const testPolicy=store.beginRun({targetVideoId:'target-surface-002',mode:'surface_test',requestedSurface:'related'});
  assert.equal(testPolicy.preferredSurface,SURFACE.RELATED);
  assert.equal(testPolicy.fallbackActive,false);
  store.recordDiscovery(testPolicy,'related');
  const summary=store.summary(testPolicy);assert.equal(summary.surfaces.related.discoveries,1);
}finally{fs.rmSync(tmp,{recursive:true,force:true});}

const memory={ucb(){return 0;},state:{queries:{}}},planner=new AutonomousAgentPlanner({memory,explorationBase:0});
const queryPlan={plan:[{query:'orange county homes',score:10}],signals:[],semanticTopics:[],fingerprint:{primaryTopic:'real_estate'},targetLanguage:'en'};
const target={videoId:'target001',mediaFormat:{kind:'LONG_FORM'}};
const discoveryPolicy={mode:MODE.SURFACE_TEST,preferredSurface:SURFACE.RELATED,requestedSurface:SURFACE.RELATED,fallbackActive:false,fallbackAfterSteps:25};
const task=planner.inferTask(target,queryPlan,null,discoveryPolicy);
const targetSearch={videoId:'target001',surface:'search_results',position:1,targetMatch:true,targetProximity:1,visible:true,actionRect:{x:10,y:100,width:300,height:180,centerX:160,centerY:190},mediaFormat:{kind:'LONG_FORM'},topic:'real_estate'};
const neighbor={videoId:'neighbor001',surface:'search_results',position:2,targetMatch:false,targetProximity:.55,visible:true,actionRect:{x:10,y:320,width:300,height:180,centerX:160,centerY:410},mediaFormat:{kind:'LONG_FORM'},topic:'real_estate'};
const world={currentIsTarget:false,formatMismatch:false,targetVisible:targetSearch,current:{pageType:'search',videoId:null,topic:'unknown',mediaFormat:{kind:'UNKNOWN'}},candidates:[targetSearch,neighbor],history:[],advertising:{playingAd:false},tabs:[{id:1,siteKey:'youtube.com'}],tabId:1,controls:{homeLink:{}},viewport:{width:1000,height:700},body:{pointer:{known:true,x:50,y:50}},environment:{online:true},affordances:[]};
let plan=planner.generate(world,{task,queryPlan,dynamicQueries:[],usedQueries:new Set(),stagnation:0});
assert.equal(plan.subgoal.id,'continue_surface_test_route');
assert.equal(plan.actions.some(a=>a.target?.videoId==='target001'),false);
assert.equal(plan.actions.some(a=>a.target?.videoId==='neighbor001'),true);
task.discoveryPolicy.fallbackActive=true;
plan=planner.generate(world,{task,queryPlan,dynamicQueries:[],usedQueries:new Set(),stagnation:0});
assert.equal(plan.actions.some(a=>a.target?.videoId==='target001'&&a.purpose==='open_target'),true);

console.log('surface_policy_contract: PASS');
