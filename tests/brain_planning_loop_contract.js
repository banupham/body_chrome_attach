'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const {buildWorld,contextKey}=require('../research/autonomous_discovery/world_model');
const {AutonomousAgentPlanner,actionMemoryId}=require('../research/autonomous_discovery/agent_planner');
const {ExperienceMemory}=require('../research/autonomous_discovery/experience_memory');

const originalRandom=Math.random;
Math.random=()=>0.5;

function rawCandidate({
  videoId='target001',
  targetMatch=true,
  proximity=1,
  surface='search_results',
  y=900,
  owned=false,
  topic='music'
}={}){
  const actionRect={x:100,y,width:320,height:180};
  const inViewport=y<700&&y+180>0;
  return {
    videoId,
    surface,
    position:1,
    targetMatch,
    targetProximity:proximity,
    mediaFormat:{kind:'LONG_FORM'},
    topic,
    isRadio:false,
    representationCount:1,
    representations:[{
      visible:inViewport,
      visibleRect:inViewport?{...actionRect,centerX:260,centerY:y+90}:null,
      hitTested:inViewport,
      hitSamples:inViewport?[{x:260,y:y+90,owned,blocker:owned?null:{tag:'div',role:'dialog'}}]:[],
      actionRect,
      evidence:{
        geometryKnown:true,
        rectIntersectsViewport:inViewport,
        rectFullyInViewport:inViewport,
        explicitHidden:false,
        inert:false,
        ariaHidden:false,
        displayNone:false,
        visibilityHidden:false,
        opacityZero:false,
        clippedByContainer:false
      }
    }]
  };
}

function makeWorld({candidates=[],history=[],pageType='search',scrollY=0,currentVideoId=null,currentTopic='music',tabs=null,affordances=[]}={}){
  return buildWorld({
    observation:{
      bodyState:{online:true,activeTabId:1,pointer:{known:true,x:40,y:40}},
      scope:{tabId:1,status:'complete'}
    },
    semantic:{
      route:{pageType,videoId:currentVideoId},
      viewport:{width:1000,height:700,scrollY},
      controls:{homeLink:{}},
      advertising:{playingAd:false},
      affordances
    },
    snapshot:{
      pageType,
      currentVideoId,
      currentTopic,
      candidates
    },
    browser:{tabs:tabs||[{id:1,active:true,siteKey:'youtube.com'}]},
    tabId:1,
    target:{videoId:'target001',mediaFormat:{kind:'LONG_FORM'}},
    history
  });
}

function queryPlan(){
  return {
    plan:[
      {query:'music signal alpha',score:20},
      {query:'music signal beta',score:16}
    ],
    signals:[{term:'music'}],
    semanticTopics:['music'],
    targetLanguage:'en',
    fingerprint:{primaryTopic:'music'}
  };
}

function memoryStub(){
  return {
    state:{queries:{}},
    ucb(){return 0;},
    interactionEffectScore(){return 0;},
    actionEffectScore(){return 0;}
  };
}

try{
  // 1. Closed loop: target is observed but cannot be clicked.
  // Brain must first restore actionability instead of trying to open it.
  {
    const planner=new AutonomousAgentPlanner({memory:memoryStub(),explorationBase:0});
    const task=planner.inferTask({videoId:'target001',mediaFormat:{kind:'LONG_FORM'}},queryPlan());
    const blocked=makeWorld({candidates:[rawCandidate({y:930,owned:false})]});
    const plan1=planner.generate(blocked,{task,queryPlan:queryPlan(),stagnation:0});
    const action1=planner.choose(plan1,{stagnation:0});

    assert.equal(plan1.subgoal.id,'restore_target_actionability');
    assert.equal(action1.type,'position_candidate');
    assert.equal(action1.recoveryTargetVideoId,'target001');
    assert.equal(action1.capability,'motor.scrollVertical');

    // Environment changes after the positioning action: same target is now
    // visible and physically hit-testable. Brain must form a new subgoal.
    const ready=makeWorld({candidates:[rawCandidate({y:220,owned:true})],scrollY:620});
    const plan2=planner.generate(ready,{task,queryPlan:queryPlan(),stagnation:0});
    const action2=planner.choose(plan2,{stagnation:0});

    assert.equal(plan2.subgoal.id,'open_observed_target');
    assert.equal(action2.type,'click_candidate');
    assert.equal(action2.purpose,'open_target');
    assert.equal(action2.target.videoId,'target001');
  }

  // 2. Learned effect changes the next plan.
  // Two physical variants are available for the same blocked target.
  // The variant observed to regress must lose to the variant that produced progress.
  {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'brain-planning-loop-'));
    try{
      const memory=new ExperienceMemory(path.join(root,'memory.json'));
      const planner=new AutonomousAgentPlanner({memory,explorationBase:0});
      const task=planner.inferTask({videoId:'target001',mediaFormat:{kind:'LONG_FORM'}},queryPlan());
      const world=makeWorld({candidates:[rawCandidate({y:930,owned:false})]});
      const context=contextKey(world);

      memory.recordActionEffect(
        'motor.scrollVertical:position_candidate:forward_medium',
        {context,executionSuccess:true,expectedEffectObserved:false,regressed:true,effectValue:-30}
      );
      memory.recordActionEffect(
        'motor.scrollVertical:position_candidate:forward_large',
        {context,executionSuccess:true,expectedEffectObserved:true,targetProgress:true,effectValue:35}
      );

      const plan=planner.generate(world,{task,queryPlan:queryPlan(),stagnation:1});
      const medium=plan.actions.find(a=>a.type==='position_candidate'&&a.positionVariant==='forward_medium');
      const large=plan.actions.find(a=>a.type==='position_candidate'&&a.positionVariant==='forward_large');

      assert.ok(medium,'forward_medium positioning variant missing');
      assert.ok(large,'forward_large positioning variant missing');
      assert.ok(large.effectLearningBonus>medium.effectLearningBonus);
      assert.ok(large.utility>medium.utility);
      assert.notEqual(planner.choose(plan,{stagnation:1}).memoryId,medium.memoryId);
    }finally{
      fs.rmSync(root,{recursive:true,force:true});
    }
  }

  // 3. Repeated no-op outcomes must change the subgoal to recovery,
  // not blindly repeat the same action family.
  {
    const planner=new AutonomousAgentPlanner({memory:memoryStub(),explorationBase:0});
    const task=planner.inferTask({videoId:'target001',mediaFormat:{kind:'LONG_FORM'}},queryPlan());
    const history=[
      {step:1,type:'search',capability:'motor+search_control',purpose:'acquire_target_anchored_evidence',actionKey:'search|motor+search_control||q1|',success:false,changed:false,targetProgress:false,reward:-10},
      {step:2,type:'search',capability:'motor+search_control',purpose:'acquire_target_anchored_evidence',actionKey:'search|motor+search_control||q2|',success:false,changed:false,targetProgress:false,reward:-10},
      {step:3,type:'scroll',capability:'motor.scrollVertical',purpose:'expand_visible_environment',actionKey:'scroll|motor.scrollVertical|||',success:false,changed:false,targetProgress:false,reward:-10}
    ];
    const world=makeWorld({history,candidates:[]});
    const plan=planner.generate(world,{task,queryPlan:queryPlan(),stagnation:3});
    const selected=planner.choose(plan,{stagnation:3});

    assert.equal(plan.subgoal.id,'recover_from_noop_blocker');
    assert.ok(['dismiss_transient_overlay_or_menu','recover_from_noop_blocker','escape_active_control'].includes(selected.purpose)||selected.capability==='motor.pressKey');
    assert.notEqual(selected.routeFamily,'search_query');
  }

  // 4. A saturated route with repeated activity but no target progress must
  // expose another frontier instead of treating Search as permanently preferred.
  {
    const planner=new AutonomousAgentPlanner({memory:memoryStub(),explorationBase:0});
    const task=planner.inferTask({videoId:'target001',mediaFormat:{kind:'LONG_FORM'}},queryPlan());
    const neighbor=rawCandidate({videoId:'neighbor001',targetMatch:false,proximity:.58,surface:'search_results',y:210,owned:true});
    const history=Array.from({length:5},(_,i)=>({
      step:i+1,
      type:'search',
      capability:'motor+search_control',
      purpose:'acquire_target_anchored_evidence',
      routeFamily:'search_query',
      query:'old-query-'+i,
      success:true,
      changed:true,
      targetProgress:false,
      reward:5
    }));
    const world=makeWorld({history,candidates:[neighbor]});
    const plan=planner.generate(world,{task,queryPlan:queryPlan(),stagnation:5});
    const search=plan.actions.find(a=>a.routeFamily==='search_query');
    const neighborAction=plan.actions.find(a=>a.type==='click_candidate'&&a.target?.videoId==='neighbor001');

    assert.ok(search);
    assert.ok(neighborAction);
    assert.ok(neighborAction.utility>search.utility);
    assert.notEqual(planner.choose(plan,{stagnation:5}).routeFamily,'search_query');
  }

  // 5. Low-evidence environment must produce several competing hypotheses.
  // This proves planning is not a single hardcoded Search->Click sequence.
  {
    const planner=new AutonomousAgentPlanner({memory:memoryStub(),explorationBase:0});
    const task=planner.inferTask({videoId:'target001',mediaFormat:{kind:'LONG_FORM'}},queryPlan());
    const affordances=[
      {index:1,label:'Alpha',role:'button',tag:'button',editable:false,disabled:false,active:false,link:null,actionRect:{x:80,y:130,width:120,height:36,centerX:140,centerY:148}},
      {index:2,label:'Beta',role:'button',tag:'button',editable:false,disabled:false,active:false,link:null,actionRect:{x:260,y:130,width:120,height:36,centerX:320,centerY:148}},
      {index:3,label:'Gamma',role:'button',tag:'button',editable:false,disabled:false,active:false,link:null,actionRect:{x:440,y:130,width:120,height:36,centerX:500,centerY:148}},
      {index:4,label:'Delta',role:'button',tag:'button',editable:false,disabled:false,active:false,link:null,actionRect:{x:620,y:130,width:120,height:36,centerX:680,centerY:148}}
    ];
    const world=makeWorld({pageType:'home',candidates:[],affordances});
    const plan=planner.generate(world,{task,queryPlan:queryPlan(),stagnation:0});
    const families=new Set(plan.actions.map(a=>a.routeFamily));

    assert.equal(plan.subgoal.id,'acquire_more_target_evidence');
    assert.ok(plan.actions.length>=8);
    assert.ok(families.has('search_query'));
    assert.ok(families.has('topic_filter'));
    assert.ok([...families].some(x=>String(x).startsWith('body:')));
    assert.ok([...families].some(x=>String(x).startsWith('scroll:')));
  }

  console.log('brain_planning_loop_contract: PASS');
}finally{
  Math.random=originalRandom;
}
