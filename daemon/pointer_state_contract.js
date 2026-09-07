'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PointerStateManager}=require('./src/pointer_state_manager');
const {MotorPlanner}=require('./src/motor_planner');

function modelNull(){return {sampleMouse(){return null;},sampleTyping(){return null;},sampleScroll(){return null;}};}

test('pointer state is isolated by stable browser identity and tab',()=>{
  let now=1000;const state=new PointerStateManager({now:()=>++now});
  const first=state.update('browser-a',10,{x:111,y:222},{source:'human'});
  state.update('browser-a',11,{x:333,y:444},{source:'agent'});
  state.update('browser-b',10,{x:555,y:666},{source:'human'});
  assert.equal(first.updatedAt,1001);
  assert.deepEqual({x:state.require('browser-a',10).x,y:state.require('browser-a',10).y,source:state.require('browser-a',10).source},{x:111,y:222,source:'human'});
  assert.deepEqual({x:state.require('browser-a',11).x,y:state.require('browser-a',11).y},{x:333,y:444});
  assert.deepEqual({x:state.require('browser-b',10).x,y:state.require('browser-b',10).y},{x:555,y:666});
  assert.equal(state.snapshot('browser-a',99).known,false);
  assert.throws(()=>state.require('browser-a',99),/pointer_state_required/);
  assert.throws(()=>state.update('browser-a',null,{x:1,y:2}),/pointer_tab_id_required/);
  assert.throws(()=>state.update('browser-a',1,{x:null,y:2}),/pointer_coordinates_required/);
  assert.throws(()=>state.update('browser-a',1,{x:'',y:2}),/pointer_coordinates_required/);
});

test('recorder updates pointer provenance without treating keyboard or null coordinates as pointer state',()=>{
  const state=new PointerStateManager({now:()=>5000});
  assert.equal(state.observeRecorder({browserInstanceId:'browser-a'},7,{source:'human',eventType:'keydown',x:1,y:2,ts:10}),null);
  assert.equal(state.observeRecorder({browserInstanceId:'browser-a'},7,{source:'human',eventType:'mousemove',x:null,y:null,ts:10}),null);
  const human=state.observeRecorder({browserInstanceId:'browser-a'},7,{source:'human',eventType:'mousemove',x:120,y:240,ts:11});
  assert.equal(human.source,'human');assert.equal(human.eventType,'mousemove');
  const agent=state.observeRecorder({browserInstanceId:'browser-a'},7,{source:'agent',eventType:'mouseup',x:130,y:250,ts:12});
  assert.equal(agent.source,'agent');assert.deepEqual([agent.x,agent.y],[130,250]);
});

test('scroll is anchored to current pointer and completed agent plan advances pointer state',()=>{
  const model=modelNull(),planner=new MotorPlanner(model),anchor={x:731,y:487};
  const scroll=planner.plan({type:'scrollVertical',delta:500},{pointerStart:anchor});
  assert.ok(scroll.plan.steps.length>0);
  for(const step of scroll.plan.steps){assert.equal(step.params.x,anchor.x);assert.equal(step.params.y,anchor.y);assert.equal(step.params.type,'mouseWheel');}
  const state=new PointerStateManager({now:()=>9000});state.update('browser-a',3,anchor,{source:'human'});
  const afterScroll=state.applyPlan('browser-a',3,scroll.plan,{source:'agent'});
  assert.deepEqual([afterScroll.x,afterScroll.y],[anchor.x,anchor.y]);
  const click=planner.plan({type:'click',x:900,y:600,width:40,height:30,role:'button'},{pointerStart:anchor});
  const afterClick=state.applyPlan('browser-a',3,click.plan,{source:'agent'});
  const last=click.plan.steps.filter(step=>step.method==='Input.dispatchMouseEvent').at(-1).params;
  assert.deepEqual([afterClick.x,afterClick.y],[last.x,last.y]);
  assert.equal(afterClick.source,'agent');
});

test('pointer-dependent motor actions fail closed instead of inventing coordinates',()=>{
  const planner=new MotorPlanner(modelNull());
  assert.throws(()=>planner.plan({type:'click',x:100,y:100}),/pointer_state_required/);
  assert.throws(()=>planner.plan({type:'moveTo',x:100,y:100}),/pointer_state_required/);
  assert.throws(()=>planner.plan({type:'scrollVertical',delta:100}),/pointer_state_required/);
  assert.throws(()=>planner.plan({type:'drag',x1:10,y1:10,x2:50,y2:50}),/pointer_state_required/);
  assert.throws(()=>planner.plan({type:'click',x:100,y:100},{pointerStart:{x:null,y:null}}),/pointer_state_required/);
  assert.throws(()=>planner.plan({type:'scrollVertical',delta:100},{pointerStart:{x:'',y:200}}),/pointer_state_required/);
  assert.doesNotThrow(()=>planner.plan({type:'pressKey',key:'Enter'}));
  const root=path.join(__dirname,'..');
  const runtime=fs.readFileSync(path.join(__dirname,'src','daemon_runtime.js'),'utf8');
  const motor=fs.readFileSync(path.join(root,'src','page_motor_core.js'),'utf8');
  for(const source of [runtime,motor]){
    assert.equal(/\{\s*x\s*:\s*400\s*,\s*y\s*:\s*300\s*\}/.test(source),false,'400,300 pointer fallback must not exist');
    assert.equal(/\{\s*x\s*:\s*500\s*,\s*y\s*:\s*400\s*\}/.test(source),false,'500,400 scroll fallback must not exist');
  }
  assert.ok(runtime.includes("'POINTER_STATUS'"),'daemon must resync pointer state from extension instead of fabricating coordinates');
});
