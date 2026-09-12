'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {HumanActionSegmenter}=require('../daemon/src/segmenter');
const {OnlineBehaviorModel}=require('../daemon/src/online_model');
const {MotorPlanner}=require('../src/page_motor_core');

function keyEvent(eventType,ts,{key=null,keyClass='special',repeat=false}={}){
  return {source:'human',eventType,ts,key,keyClass,repeat,target:{role:'textbox',tag:'input',editable:true,sensitive:false,rect:{x:10,y:10,width:200,height:30}}};
}

const samples=[];
const segmenter=new HumanActionSegmenter(sample=>samples.push(sample));

segmenter.handle(1,keyEvent('keydown',100,{key:'Enter',keyClass:'Enter'}));
segmenter.handle(1,keyEvent('keyup',170,{key:'Enter',keyClass:'Enter'}));
const press=samples.find(sample=>sample.action==='pressKey');
assert.ok(press,'completed special key must emit pressKey');
assert.equal(press.key,'Enter');
assert.equal(press.hold_ms,70);

segmenter.handle(1,keyEvent('keydown',200,{key:'Control',keyClass:'modifier'}));
segmenter.handle(1,keyEvent('keydown',230,{key:null,keyClass:'alpha'}));
segmenter.handle(1,keyEvent('keyup',280,{key:null,keyClass:'alpha'}));
segmenter.handle(1,keyEvent('keyup',310,{key:'Control',keyClass:'modifier'}));
const combo=samples.find(sample=>sample.action==='keyCombo');
assert.ok(combo,'modifier + primary key must emit keyCombo');
assert.deepEqual(combo.modifiers,['Control']);
assert.equal(combo.key_class,'alpha');
assert.equal(combo.key,null,'printable combo key identity must remain redacted');
assert.equal(combo.hold_ms,50);
assert.equal(samples.filter(sample=>sample.action==='typeText').length,0,'keyCombo must not contaminate typeText');

segmenter.handle(1,keyEvent('keydown',400,{key:null,keyClass:'alpha'}));
segmenter.handle(1,keyEvent('keyup',440,{key:null,keyClass:'alpha'}));
segmenter.handle(1,keyEvent('keydown',500,{key:null,keyClass:'alpha'}));
segmenter.handle(1,keyEvent('keyup',545,{key:null,keyClass:'alpha'}));
segmenter.flush(1);
const typing=samples.find(sample=>sample.action==='typeText');
assert.ok(typing,'ordinary printable keys must still emit typeText');
assert.equal(typing.key_events.filter(event=>event.type==='keydown').length,2);

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'body-keyboard-learning-'));
try{
  const model=new OnlineBehaviorModel(path.join(tmp,'behavior_model.json'),{random:()=>0});
  assert.equal(model.observe({...press,source:'human'}),true);
  assert.equal(model.observe({...combo,source:'human'}),true);
  assert.equal(model.observe({...typing,source:'human'}),true);
  assert.equal(model.observe({...press,source:'agent'}),false,'agent keyboard samples must never be learned');

  const stats=model.stats();
  assert.equal(stats.groups['keyboard|pressKey|Enter'],1);
  assert.equal(stats.groups['keyboard|keyCombo|Control|alpha'],1);
  assert.equal(stats.groups['typing|typeText'],1);

  const learnedPress=model.samplePressKey('Enter');
  assert.ok(learnedPress);
  assert.equal(learnedPress.template.holdMs,70);

  const learnedCombo=model.sampleKeyCombo({modifiers:['Control'],keyClass:'alpha'});
  assert.ok(learnedCombo);
  assert.equal(learnedCombo.template.keyDownDelayMs,30);
  assert.equal(learnedCombo.template.keyHoldMs,50);
  assert.deepEqual(learnedCombo.template.modifierReleaseGaps,[30]);

  const planner=new MotorPlanner(model);
  const pressPlan=planner.plan({type:'pressKey',key:'Enter'});
  assert.equal(pressPlan.source,'learned');
  assert.equal(pressPlan.learnedGroup,'keyboard|pressKey|Enter');
  assert.equal(pressPlan.plan.steps.length,2);
  assert.equal(pressPlan.plan.steps[1].delayMs,70);

  const comboPlan=planner.plan({type:'keyCombo',key:'Control+c'});
  assert.equal(comboPlan.source,'learned');
  assert.equal(comboPlan.learnedGroup,'keyboard|keyCombo|Control|alpha');
  assert.equal(comboPlan.plan.steps.length,4);
  assert.equal(comboPlan.plan.steps[0].params.key,'Control');
  assert.equal(comboPlan.plan.steps[1].params.key,'c');
  assert.equal(comboPlan.plan.steps[1].delayMs,30);
  assert.equal(comboPlan.plan.steps[2].delayMs,50);
  assert.equal(comboPlan.plan.steps[3].delayMs,30);

  const empty=new OnlineBehaviorModel(path.join(tmp,'empty.json'),{random:()=>0});
  const cascaded=new MotorPlanner({primary:empty,fallback:model});
  assert.equal(cascaded.plan({type:'pressKey',key:'Enter'}).source,'learned','keyboard recall must fall back to browser-global model');
  assert.equal(cascaded.plan({type:'keyCombo',key:'Control+c'}).source,'learned','combo recall must fall back to browser-global model');

  const rebuilt=new OnlineBehaviorModel(path.join(tmp,'rebuilt.json'),{random:()=>0});
  rebuilt.rebuild([
    {source:'human',action:'pressKey',key:'Tab',tabId:1,context:{}},
    {...combo,source:'human'}
  ]);
  assert.ok(rebuilt.samplePressKey('Tab'),'legacy pressKey samples without hold_ms must rebuild with fallback timing');
  assert.equal(rebuilt.samplePressKey('Tab').template.holdMs,45);
  assert.ok(rebuilt.sampleKeyCombo({modifiers:['Control'],keyClass:'alpha'}));
} finally {
  fs.rmSync(tmp,{recursive:true,force:true});
}

console.log('keyboard_learning_contract: PASS');
