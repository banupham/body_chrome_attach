'use strict';

const assert=require('node:assert/strict');
const {safeContentRect,specificPlanningProximity}=require('../research/autonomous_discovery/brain_v3_recovery');
const {AutonomousAgentPlanner,actionMemoryId,noOpStreak,explorationPool}=require('../research/autonomous_discovery/agent_planner');
const {adaptiveQueryPlan}=require('../research/autonomous_discovery/adaptive_query_planner');
const {FORMAT}=require('../research/autonomous_discovery/media_format');

assert.equal(safeContentRect({x:683,y:-12.5,width:208,height:112.5},{width:1000,height:700}),null);
const safe=safeContentRect({x:683,y:349,width:208,height:112.5},{width:1000,height:700});assert.ok(safe);assert.ok(safe.centerY>105);assert.ok(safe.visibleRatio>0.9);

const fingerprint={primaryTopic:'real_estate',country:'VN',language:'vi',signals:[
  {term:'cầu tràm',sources:['title_concept'],searchable:true},
  {term:'5x28m shr',sources:['title_concept'],searchable:true},
  {term:'nhà bình chánh',sources:['channel_keyword'],searchable:true}
]};
const base={classification:{primary:'real_estate'},legacyTargetProximity:0.67,targetProximity:0.67};
const unrelated={...base,title:'Biệt thự Fountain Valley California',youtubeApi:{title:'Luxury home Fountain Valley',defaultLanguage:'vi',channel:{country:'US',keywords:['real estate','california']},tags:['bất động sản mỹ'],keywords:[{term:'nhà đẹp mỹ'}]}};
const local={...base,title:'Cầu Tràm 5x28m SHR Bình Chánh',youtubeApi:{title:'Cầu Tràm 5x28m SHR Bình Chánh',defaultLanguage:'vi',channel:{country:'VN',keywords:['nhà bình chánh']},tags:['cầu tràm','5x28m','shr'],keywords:[{term:'cầu tràm'}]}};
assert.ok(specificPlanningProximity(unrelated,fingerprint)<0.35);
assert.ok(specificPlanningProximity(local,fingerprint)>specificPlanningProximity(unrelated,fingerprint)+0.25);
assert.ok(specificPlanningProximity(local,fingerprint)>0.42);

const seenMemoryIds=[];const memory={ucb(id){seenMemoryIds.push(id);return 0;},state:{queries:{}}},planner=new AutonomousAgentPlanner({memory,explorationBase:0});
const failureRows=[1,2,3].map(step=>({step,actionKey:`click_candidate|motor.click|candidate-${step}||`,type:'click_candidate',capability:'motor.click',purpose:'follow_same_format_environment_edge',videoId:`candidate-${step}`,success:false,changed:false}));
assert.equal(noOpStreak(failureRows),3);
const world={
  currentIsTarget:false,formatMismatch:false,targetVisible:null,current:{pageType:'watch',topic:'real_estate',videoId:'source',mediaFormat:FORMAT.LONG_FORM},
  viewport:{width:1000,height:700},advertising:{playingAd:false},environment:{online:true},controls:{homeLink:{available:true},activeTarget:null},body:{pointer:{known:true,x:400,y:300}},
  tabs:[{id:1,siteKey:'youtube.com'}],tabId:1,affordances:[],history:failureRows,
  candidates:[{videoId:'candidate-new',surface:'related',position:1,visible:true,actionRect:{x:700,y:200,width:200,height:100},topic:'real_estate',targetProximity:0.46,targetMatch:false,mediaFormat:FORMAT.LONG_FORM}]
};
const task={targetFormat:FORMAT.LONG_FORM},queryPlan={plan:[{query:'cầu tràm nhà đất',score:18}],signals:[{term:'cầu tràm',sources:['title_concept'],searchable:true}],semanticTopics:[]};
const plan=planner.generate(world,{task,queryPlan,dynamicQueries:[],usedQueries:new Set(),stagnation:3});
assert.equal(plan.subgoal.id,'recover_from_noop_blocker');
assert.ok(plan.actions.some(a=>a.purpose==='dismiss_transient_overlay_or_menu'));
const search=plan.actions.find(a=>a.type==='search'),candidate=plan.actions.find(a=>a.type==='click_candidate'),escape=plan.actions.find(a=>a.purpose==='dismiss_transient_overlay_or_menu');assert.ok(search);assert.ok(candidate);assert.ok(escape);assert.ok(escape.utility>search.utility);assert.ok(escape.utility>candidate.utility);
assert.ok(seenMemoryIds.includes(actionMemoryId(candidate)));
const pool=explorationPool(plan.actions);assert.ok(pool.some(a=>a.type==='search'));assert.ok(pool.some(a=>a.purpose==='dismiss_transient_overlay_or_menu'));

const target={videoId:'qXy0iyni-xk',title:'Khu dân cư mới Cầu Tràm 5x28m SHR đường rộng ô tô tránh nhau hướng ĐNT 2tỷ750-3tỷ150',defaultLanguage:'vi',tags:[],topicLabels:['Hobby'],channel:{country:'VN',keywords:['NHÀ BÌNH CHÁNH GIÁ RẺ SỔ HỒNG RÊNG','NHÀ BÌNH CHÁNH 500TR','NHÀ BÌNH CHÁNH 2022'],topicLabels:['Knowledge']},keywords:[{term:'cầu tràm',sources:['title']},{term:'5x28m',sources:['title']},{term:'shr',sources:['title']},{term:'NHÀ BÌNH CHÁNH 500TR',sources:['channel_keyword']}]};
const queries=adaptiveQueryPlan(target,{maxQueries:20});assert.ok(queries.plan.length);assert.ok(queries.plan.slice(0,8).some(row=>/(cầu\s+tràm|5x28m|\bshr\b)/iu.test(row.query)));assert.equal(queries.plan.slice(0,5).some(row=>/500tr/i.test(row.query)),false);

console.log('planner_recovery_contract: PASS');
