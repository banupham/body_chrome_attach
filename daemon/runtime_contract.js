'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {
  ExtensionRegistry,ScopedLearningManager,OnlineBehaviorModel,HumanActionSegmenter,
  HabitModel,TabHabitModel,normalizeSiteKey
}=require('./src/runtime_exports');
const {MotorPlanner,bootstrapMove}=require('./src/motor_planner');

function tmp(name){ return fs.mkdtempSync(path.join(os.tmpdir(),`${name}-`)); }
function clickSample(offset=0){
  return {source:'human',action:'click',tabId:1,context:{target_role:'button',target_rect:{x:100,y:100,width:80,height:32}},pointer_start:{x:0,y:0},points:[{x:0,y:0,t:0},{x:50,y:30+offset,t:60},{x:140,y:116,t:140}],mouse_down_t:145,mouse_up_t:190,hold_ms:45};
}

test('extension registry keeps same tab id isolated by extension',()=>{
  const r=new ExtensionRegistry(); const ws1={},ws2={};
  r.register('ext-a',ws1,{tabs:[{id:1,active:true,siteKey:'a.com'}]});r.register('ext-b',ws2,{tabs:[{id:1,active:true,siteKey:'b.com'}]});
  assert.equal(r.get('ext-a').tabs.get(1).siteKey,'a.com');assert.equal(r.get('ext-b').tabs.get(1).siteKey,'b.com');
});

test('per-site dataset and model fallback stay extension-scoped',()=>{
  const m=new ScopedLearningManager(tmp('scoped'));m.observeHumanSample('ext-a','alpha.test',clickSample(),{learn:true});
  assert.ok(m.stats('ext-a','alpha.test').dataset.humanSamples>=1);
  assert.ok(m.motorFor('ext-a','new.test').sampleMouse({action:'click',role:'button',distance:150,targetWidth:80,targetHeight:32}));
  assert.equal(m.motorFor('ext-b','new.test').sampleMouse({action:'click',role:'button',distance:150,targetWidth:80,targetHeight:32}),null);
});

test('only human events become segmented ground truth',()=>{
  const rows=[];const s=new HumanActionSegmenter(x=>rows.push(x));
  s.handle(1,{source:'agent',eventType:'mousedown',ts:1,x:0,y:0,target:{}});s.handle(1,{source:'agent',eventType:'mouseup',ts:2,x:0,y:0,target:{}});assert.equal(rows.length,0);
  s.handle(1,{source:'human',eventType:'mousemove',ts:10,x:0,y:0,target:{}});s.handle(1,{source:'human',eventType:'mousedown',ts:20,x:20,y:20,target:{role:'button',rect:{x:10,y:10,width:40,height:30}}});s.handle(1,{source:'human',eventType:'mouseup',ts:50,x:20,y:20,target:{role:'button',rect:{x:10,y:10,width:40,height:30}}});assert.equal(rows[0].source,'human');
});

test('trajectory template selection is deterministic cycle',()=>{
  const model=new OnlineBehaviorModel(path.join(tmp('model'),'m.json'));model.observe(clickSample(0));model.observe(clickSample(8));
  const args={action:'click',role:'button',distance:150,targetWidth:80,targetHeight:32};const a=model.sampleMouse(args),b=model.sampleMouse(args),c=model.sampleMouse(args);
  assert.equal(a.selection,'deterministic-cycle');assert.equal(a.index,0);assert.equal(b.index,1);assert.equal(c.index,0);
});

test('bootstrap mouse path is linear, not a synthetic curve',()=>{
  const rows=bootstrapMove({x:0,y:0},{x:140,y:70});for(const row of rows)assert.ok(Math.abs(row.params.y-row.params.x*0.5)<1e-9);
});

test('learned typing timing works with Shift-required printable keys',()=>{
  const model={sampleMouse(){return null;},sampleTyping(){return {groupKey:'typing|typeText',count:1,template:{intervals:[100,120],holds:[40,50]}};},sampleScroll(){return null;}};
  const steps=new MotorPlanner(model).plan({type:'typeText',x:20,y:20,text:'A!'},{pointerStart:{x:0,y:0}}).plan.steps;
  assert.ok(steps.some(s=>s.params?.key==='Shift'&&s.params?.type==='rawKeyDown'));assert.ok(steps.some(s=>s.params?.key==='!'&&s.params?.code==='Digit1'&&s.params?.type==='char'));
});

test('habit model learns keyboard vs mouse choices from human history only',()=>{
  const h=new HabitModel(path.join(tmp('habit'),'habit.json'));h.observe({source:'human',tabId:1,action:'typeText',context:{target_role:'textbox'}});h.observe({source:'human',tabId:1,action:'pressKey',key:'Enter',context:{target_role:'textbox'}});h.observe({source:'agent',tabId:1,action:'click',context:{target_role:'button'}});
  const score=h.scoreAlternatives({habitKey:'after_typing_submit',alternatives:[{id:'keyboard_enter',modality:'keyboard',actions:[{type:'pressKey'}]},{id:'mouse_click',modality:'mouse',actions:[{type:'click'}]}],context:{previousAction:'typeText',previousModality:'keyboard',targetRole:'button'}});assert.equal(score.ranking.length,2);
});

test('tab habit model ignores agent tab switches',()=>{
  const t=new TabHabitModel(path.join(tmp('tabs'),'tabs.json'));t.observe('ext-a',{source:'agent',eventType:'tabActivated',tabId:2,siteKey:'b.test'});const before=t.stats('ext-a');t.observe('ext-a',{source:'human',eventType:'tabActivated',tabId:2,siteKey:'b.test'});const after=t.stats('ext-a');assert.notEqual(JSON.stringify(after),JSON.stringify(before));
});

test('site key is normalized',()=>assert.equal(normalizeSiteKey('EXAMPLE.COM'),'example.com'));
