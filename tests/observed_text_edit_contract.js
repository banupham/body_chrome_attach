'use strict';

const assert=require('node:assert/strict');
const {AutonomousYouTubeBrainV2,fingerprintText}=require('../research/autonomous_discovery/brain_v2');
const {MotorPlanner}=require('../src/page_motor_core');
const {buildWorld,worldDelta}=require('../research/autonomous_discovery/world_model');

function control(value,{active=true,start=0,end=0,full=false}={}){
  const fp=fingerprintText(value),valueLength=String(value).trim().replace(/\s+/g,' ').length;
  return {available:true,visible:true,active,actionRect:{x:100,y:80,width:400,height:40,centerX:300,centerY:100},valueFingerprint:fp,selection:{available:true,active,collapsed:start===end,fullSelection:full,start,end,direction:'forward',valueLength,selectedLength:Math.max(0,end-start)}};
}
function makeBrain(initialValue,selection){
  const brain=Object.create(AutonomousYouTubeBrainV2.prototype),actions=[],logs=[];let current=control(initialValue,selection);
  brain.tabId=1;brain.verifyTimeoutMs=5500;brain.actionRetries=3;brain.targetApi={videoId:'target001',title:'Target Song'};brain.queryAudit=[];brain.queryAttempts=0;
  const state=()=>({semantic:{available:true,platform:'youtube',controls:{searchInput:current},route:{pageType:'home'},surfaces:[],viewport:{width:1200,height:800}}});
  brain.ensureYouTube=async()=>state();brain.handleAds=async()=>({});brain.browserTabs=async()=>[];brain.reconcileTabEffects=async()=>{};brain.ledger=(type,data)=>logs.push({type,data});brain.observe=async()=>state();
  brain.waitForSemantic=async predicate=>predicate(state().semantic)?state():null;
  brain.motor=async intent=>{actions.push(intent);if(intent.type==='keyCombo'&&intent.key==='Control+a'){const len=Number(current.valueFingerprint.length||0);current={...current,selection:{...current.selection,available:true,collapsed:false,fullSelection:len>0,start:0,end:len,valueLength:len,selectedLength:len}};}else if(intent.type==='typeText'){current=control(intent.text,{active:true,start:String(intent.text).length,end:String(intent.text).length,full:false});}return {execution:{completed:true}};};
  return {brain,actions,logs,getCurrent:()=>current};
}

(async()=>{
  // Empty search field: type directly. No Ctrl+A, no Backspace.
  {
    const {brain,actions}=makeBrain('',{active:true,start:0,end:0,full:false});
    const out=await brain.verifiedSearchField('rick astley animated');
    assert.ok(out);
    assert.equal(actions.some(a=>a.type==='keyCombo'&&a.key==='Control+a'),false);
    assert.equal(actions.some(a=>a.type==='pressKey'&&a.key==='Backspace'),false);
    const typed=actions.find(a=>a.type==='typeText');assert.ok(typed);assert.equal(typed.preserveFocus,true);
  }

  // Existing text already fully selected: preserve the selection and type over it.
  {
    const value='old query',len=value.length,{brain,actions}=makeBrain(value,{active:true,start:0,end:len,full:true});
    const out=await brain.verifiedSearchField('new query');
    assert.ok(out);
    assert.equal(actions.some(a=>a.type==='keyCombo'),false);
    assert.equal(actions.find(a=>a.type==='typeText')?.preserveFocus,true);
  }

  // Existing text not selected: select only because observed state requires replacement.
  {
    const value='old query',len=value.length,{brain,actions}=makeBrain(value,{active:true,start:len,end:len,full:false});
    const out=await brain.verifiedSearchField('new query');
    assert.ok(out);
    assert.equal(actions[0].type,'keyCombo');
    assert.equal(actions[0].key,'Control+a');
    assert.equal(actions[1].type,'typeText');
    assert.equal(actions[1].preserveFocus,true);
  }

  // A failed field verification ends the planner step; search no longer nests blind retry loops.
  {
    const brain=Object.create(AutonomousYouTubeBrainV2.prototype);let calls=0;brain.targetApi={videoId:'target001',title:'Target Song'};brain.queryAudit=[];brain.verifiedSearchField=async()=>{calls++;return null;};
    await assert.rejects(()=>brain.search({query:'music discovery',kind:'test',source:'test'}),/search_field_not_verified_after_observed_edit/);
    assert.equal(calls,1);
  }

  // preserveFocus typing must not inject a pointer click that would collapse a confirmed selection.
  {
    const model={sampleTyping(){return null;}},planner=new MotorPlanner(model),plan=planner.plan({type:'typeText',text:'abc',x:100,y:100,width:200,height:30,role:'textbox',preserveFocus:true},{pointerStart:{x:5,y:5}});
    assert.equal(plan.plan.steps.some(step=>step.method==='Input.dispatchMouseEvent'),false);
    assert.ok(plan.plan.steps.some(step=>step.method==='Input.dispatchKeyEvent'));
  }

  // Selection/highlight is part of the Brain world and produces an explicit delta reason.
  {
    const base={observation:{environment:{online:true},bodyState:{activeTabId:1,pointer:{known:true,x:1,y:1}}},snapshot:{pageType:'home',candidates:[]},browser:{tabs:[{id:1,active:true,siteKey:'youtube.com'}]},tabId:1,target:{videoId:'target001'},history:[]};
    const semanticA={route:{pageType:'home'},controls:{searchInput:control('abc',{active:true,start:3,end:3,full:false})},selection:{available:true,collapsed:true,selectedLength:0},affordances:[],advertising:{},viewport:{width:1000,height:700}};
    const semanticB={...semanticA,controls:{searchInput:control('abc',{active:true,start:0,end:3,full:true})},selection:{available:true,collapsed:false,selectedLength:3,textFingerprint:fingerprintText('abc')}};
    const a=buildWorld({...base,semantic:semanticA}),b=buildWorld({...base,semantic:semanticB}),delta=worldDelta(a,b);
    assert.equal(b.selection.searchInput.fullSelection,true);
    assert.ok(delta.reasons.includes('selection'));
  }

  console.log('observed_text_edit_contract: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
