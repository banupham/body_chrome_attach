'use strict';

const assert=require('node:assert/strict');
const {
  AutonomousAgentPlanner,
  actionFamily,
  routeFrontierAdjustment,
  topicFilterAffordances,
  topicFilterActions,
  targetCandidateScore
}=require('../research/autonomous_discovery/agent_planner');

const memory={ucb(){return 0;},state:{queries:{}}};
const planner=new AutonomousAgentPlanner({memory,explorationBase:0});
const task=planner.inferTask(
  {videoId:'target001',mediaFormat:{kind:'LONG_FORM'}},
  {plan:[{query:'alpha signal',score:18},{query:'beta signal',score:16}],signals:[],semanticTopics:['music'],fingerprint:{primaryTopic:'music'},targetLanguage:'en'}
);
const rect=(x,y,w=180,h=100)=>({x,y,width:w,height:h,centerX:x+w/2,centerY:y+h/2});
const candidate=(videoId,surface,topic,proximity=.45,pos=1)=>({
  videoId,surface,topic,targetMatch:false,targetProximity:proximity,position:pos,
  visible:true,actionRect:rect(40,180+pos*115),mediaFormat:{kind:'LONG_FORM'},isRadio:false
});
const baseWorld=(overrides={})=>({
  currentIsTarget:false,formatMismatch:false,targetVisible:null,
  current:{pageType:'search',videoId:null,topic:'music',mediaFormat:{kind:'UNKNOWN'}},
  candidates:[],history:[],advertising:{playingAd:false},
  tabs:[{id:1,siteKey:'youtube.com'}],tabId:1,controls:{homeLink:{}},
  viewport:{width:1200,height:800},body:{pointer:{known:true,x:50,y:50}},
  environment:{online:true},affordances:[],...overrides
});

// Default scoring must not contain a static Search-vs-Related preference.
{
  const world=baseWorld();
  const a=candidate('a','search_results','music',.4,1);
  const b={...a,videoId:'b',surface:'related'};
  assert.equal(targetCandidateScore(a,world,'LONG_FORM'),targetCandidateScore(b,world,'LONG_FORM'));
}

// An unseen route gets the same frontier opportunity regardless of route name.
{
  const world=baseWorld();
  const search={type:'search',capability:'motor+search_control',purpose:'acquire_target_anchored_evidence'};
  const home={type:'home',capability:'motor.click|browser_ui.address',purpose:'sample_home_environment'};
  search.routeFamily=actionFamily(search,world,task);
  home.routeFamily=actionFamily(home,world,task);
  const families=[search.routeFamily,home.routeFamily];
  assert.equal(routeFrontierAdjustment(search,[],families,world,task),routeFrontierAdjustment(home,[],families,world,task));
}

// Repeating Search without target progress must lower that family enough to expose another frontier.
{
  const neighbor=candidate('neighbor001','search_results','music',.52,1);
  const history=Array.from({length:5},(_,i)=>({
    step:i+1,type:'search',capability:'motor+search_control',purpose:'acquire_target_anchored_evidence',
    routeFamily:'search_query',targetProgress:false,success:true,changed:true,reward:8,query:`query-${i}`
  }));
  const world=baseWorld({candidates:[neighbor],history});
  const plan=planner.generate(world,{task,queryPlan:{plan:[{query:'new evidence',score:25}],signals:[],semanticTopics:['music']},dynamicQueries:[],usedQueries:new Set(),stagnation:5});
  const bestSearch=plan.actions.find(a=>a.routeFamily==='search_query');
  const bestAlternative=plan.actions.find(a=>a.routeFamily==='search_neighbor_same_topic')||plan.actions.find(a=>a.routeFamily==='home_nav');
  assert.ok(bestSearch);
  assert.ok(bestAlternative);
  assert.ok(bestAlternative.utility>bestSearch.utility,`expected frontier alternative > saturated search, got ${bestAlternative.utility} <= ${bestSearch.utility}`);
}

// Same-topic and cross-topic recommendation paths are independent frontiers.
{
  const same=candidate('same001','related','music',.38,1);
  const cross=candidate('cross001','related','entertainment',.38,2);
  const history=Array.from({length:4},(_,i)=>({
    step:i+1,type:'click_candidate',routeFamily:'related_same_topic',videoId:`seen-${i}`,
    targetProgress:false,success:true,changed:true,reward:3
  }));
  const world=baseWorld({current:{pageType:'watch',videoId:'source',topic:'music',mediaFormat:{kind:'LONG_FORM'}},candidates:[same,cross],history});
  const plan=planner.generate(world,{task,queryPlan:{plan:[],signals:[],semanticTopics:['music']},dynamicQueries:[],usedQueries:new Set(),stagnation:4});
  const sameAction=plan.actions.find(a=>a.target?.videoId==='same001');
  const crossAction=plan.actions.find(a=>a.target?.videoId==='cross001');
  assert.equal(sameAction.routeFamily,'related_same_topic');
  assert.equal(crossAction.routeFamily,'related_cross_topic');
  assert.ok(crossAction.utility>sameAction.utility,`expected unexplored cross-topic route > saturated same-topic route`);
}

// Topic chips are discovered from geometry/roles, not a hardcoded vocabulary.
{
  const labels=['Alpha','Beta','Gamma','Delta','Epsilon'];
  const affordances=labels.map((label,i)=>({
    index:i+1,label,role:'button',tag:'button',editable:false,disabled:false,active:false,link:null,
    actionRect:{x:100+i*150,y:125,width:120,height:38,centerX:160+i*150,centerY:144}
  }));
  const world=baseWorld({current:{pageType:'home',videoId:null,topic:'unknown',mediaFormat:{kind:'UNKNOWN'}},affordances});
  const chips=topicFilterAffordances(world),actions=topicFilterActions(world);
  assert.equal(chips.length,labels.length);
  assert.equal(actions.length,labels.length);
  assert.deepEqual(actions.map(a=>a.affordance.label),labels);
  for(const action of actions)assert.equal(actionFamily(action,world,task),'topic_filter');
}

// Opening an observed target is never suppressed by frontier saturation.
{
  const targetCandidate={...candidate('target001','related','music',1,1),targetMatch:true};
  const history=Array.from({length:8},(_,i)=>({step:i+1,type:'click_candidate',routeFamily:'related_same_topic',targetProgress:false,success:true,changed:true,reward:0}));
  const world=baseWorld({current:{pageType:'watch',videoId:'source',topic:'music',mediaFormat:{kind:'LONG_FORM'}},targetVisible:targetCandidate,candidates:[targetCandidate],history});
  const plan=planner.generate(world,{task,queryPlan:{plan:[],signals:[],semanticTopics:['music']},dynamicQueries:[],usedQueries:new Set(),stagnation:8});
  assert.equal(plan.actions[0].purpose,'open_target');
  assert.equal(plan.actions[0].routeFamily,'target_open');
}

console.log('adaptive_route_frontier_contract: PASS');
