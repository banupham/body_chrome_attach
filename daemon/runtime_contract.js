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
  return {
    source:'human',action:'click',tabId:1,
    context:{target_role:'button',target_rect:{x:100,y:100,width:80,height:32}},
    pointer_start:{x:0,y:0},
    points:[{x:0,y:0,t:0},{x:50,y:30+offset,t:60},{x:140,y:116,t:140}],
    mouse_down_t:145,mouse_up_t:190,hold_ms:45
  };
}

test('extension registry keeps same tab id isolated by extension',()=>{
  const r=new ExtensionRegistry();
  const ws1={},ws2={};
  r.register('ext-a',ws1,{tabs:[{id:1,active:true,siteKey:'a.com'}]});
  r.register('ext-b',ws2,{tabs:[{id:1,active:true,siteKey:'b.com'}]});
  assert.equal(r.get('ext-a').tabs.get(1).siteKey,'a.com');
  assert.equal(r.get('ext-b').tabs.get(1).siteKey,'b.com');
});

test('per-site dataset and model fallback stay extension-scoped',()=>{
  const m=new ScopedLearningManager(tmp('scoped'));
  m.observeHumanSample('ext-a','alpha.test',clickSample(),{learn:true});
  assert.ok(m.stats('ext-a','alpha.test').dataset.humanSamples>=1);
  assert.ok(m.motorFor('ext-a','new.test').sampleMouse({action:'click',role:'button',distance:150,targetWidth:80,targetHeight:32}));
  assert.equal(m.motorFor('ext-b','new.test').sampleMouse({action:'click',role:'button',distance:150,targetWidth:80,targetHeight:32}),null);
});

test('only human events become segmented ground truth',()=>{
  const rows=[];
  const s=new HumanActionSegmenter(x=>rows.push(x));
  s.handle(1,{source:'agent',eventType:'mousedown',ts:1,x:0,y:0,target:{}});
  s.handle(1,{source:'agent',eventType:'mouseup',ts:2,x:0,y:0,target:{}});
  assert.equal(rows.length,0);
  s.handle(1,{source:'human',eventType:'mousemove',ts:10,x:0,y:0,target:{}});
  s.handle(1,{source:'human',eventType:'mousedown',ts:20,x:20,y:20,target:{role:'button',rect:{x:10,y:10,width:40,height:30}}});
  s.handle(1,{source:'human',eventType:'mouseup',ts:50,x:20,y:20,target:{role:'button',rect:{x:10,y:10,width:40,height:30}}});
  assert.equal(rows[0].source,'human');
});

test('trajectory template selection is deterministic cycle',()=>{
  const model=new OnlineBehaviorModel(path.join(tmp('model'),'m.json'));
  model.observe(clickSample(0));
  model.observe(clickSample(8));
  const args={action:'click',role:'button',distance:150,targetWidth:80,targetHeight:32};
  const a=model.sampleMouse(args),b=model.sampleMouse(args),c=model.sampleMouse(args);
  assert.equal(a.selection,'deterministic-cycle');
  assert.equal(a.index,0); assert.equal(b.index,1); assert.equal(c.index,0);
});

test('bootstrap mouse path is linear, not a synthetic curve',()=>{
  const rows=bootstrapMove({x:0,y:0},{x:140,y:70});
  for(const row of rows) assert.ok(Math.abs(row.params.y-row.params.x*0.5)<1e-9);
});

test('learned typing timing works with Shift-required printable keys',()=>{
  const model={sampleMouse(){return null;},sampleTyping(){return {groupKey:'typing|typeText',count:1,template:{intervals:[100,120],holds:[40,50]}};},sampleScroll(){return null;}};
  const steps=new MotorPlanner(model).plan({type:'typeText',x:20,y:20,text:'A!'},{pointerStart:{x:0,y:0}}).plan.steps;
  assert.ok(steps.some(s=>s.params?.key==='Shift'&&s.params?.type==='rawKeyDown'));
  assert.ok(steps.some(s=>s.params?.key==='!'&&s.params?.code==='Digit1'&&s.params?.type==='char'));
});

test('habit model learns keyboard vs mouse choices from human history only',()=>{
  const h=new HabitModel(path.join(tmp('habit'),'habit.json'));
  h.observe({source:'human',tabId:1,action:'typeText',context:{target_role:'textbox'}});
  h.observe({source:'human',tabId:1,action:'pressKey',key:'Enter',context:{target_role:'textbox'}});
  h.observe({source:'agent',tabId:1,action:'click',context:{target_role:'button'}});
  const score=h.scoreAlternatives({habitKey:'after_typing_submit',alternatives:[{id:'keyboard_enter',modality:'keyboard',actions:[{type:'pressKey'}]},{id:'mouse_click',modality:'mouse',actions:[{type:'click'}]}],context:{previousAction:'typeText',previousModality:'keyboard',targetRole:'button'}});
  assert.ok(score.ranking.length===2);
});

test('tab habit model ignores agent tab switches',()=>{
  const t=new TabHabitModel(path.join(tmp('tabs'),'tabs.json'));
  t.observe('ext-a',{source:'agent',eventType:'tabActivated',tabId:2,siteKey:'b.test'});
  const before=t.stats('ext-a');
  t.observe('ext-a',{source:'human',eventType:'tabActivated',tabId:2,siteKey:'b.test'});
  const after=t.stats('ext-a');
  assert.ok(JSON.stringify(after)!==JSON.stringify(before));
});

test('site key is normalized',()=>assert.equal(normalizeSiteKey('EXAMPLE.COM'),'example.com'));

const {BrowserUiAdapter,BROWSER_COMMANDS}=require('./src/browser_ui_adapter');
const {createWindowsInputRunner}=require('./src/windows_native_input');
const {PROTOCOL_VERSION,navigationToken,DaemonBridge}=require('../src/daemon_bridge');

function browserAdapter(states,{focusVerified=true}={}){
  let index=0;const native=[];const finished=[];
  const adapter=new BrowserUiAdapter({
    resolveTarget:async()=>({extensionId:'ext-a',tab:{id:10,windowId:1}}),
    focusTarget:async({action,commandId})=>({verified:focusVerified,focused:focusVerified,action,commandId}),
    finishTarget:async info=>{finished.push(info);return {cleared:true};},
    snapshot:async()=>states[Math.min(index++,states.length-1)],
    runNativeInput:async(mode,value)=>{native.push({mode,value});return {ok:true};},
    sleepImpl:async()=>{},verifyTimeoutMs:100,verifyIntervalMs:20
  });
  return {adapter,native,finished};
}

test('semantic browser commands are mapped by Body, not caller shortcuts',()=>{
  for(const name of ['back','forward','reload','hardreload','newtab','closetab','reopentab','nexttab','prevtab','addressbar','find','downloads','history','devtools','fullscreen','bookmark','zoomin','zoomout','zoomreset']) assert.ok(BROWSER_COMMANDS[name]);
});

test('browser newtab verifies observed state and clears agent provenance marker',async()=>{
  const before={tabs:[{id:10,windowId:1}],active:{id:10,windowId:1}};
  const after={tabs:[{id:10,windowId:1},{id:11,windowId:1}],active:{id:11,windowId:1}};
  const {adapter,native,finished}=browserAdapter([before,after]);
  const result=await adapter.execute('newtab');
  assert.equal(result.delivered,true);assert.equal(result.verified,true);assert.deepEqual(native,[{mode:'combo',value:'Control+t'}]);assert.equal(finished.length,1);
});

test('browser address hides typed value from result while verifying navigation token',async()=>{
  const before={tabs:[{id:10,windowId:1}],active:{id:10,windowId:1,navigationToken:'a'}};
  const after={tabs:[{id:10,windowId:1}],active:{id:10,windowId:1,navigationToken:'b'}};
  const {adapter,native}=browserAdapter([before,after]);
  const secret='https://example.test/private?q=123';const result=await adapter.execute('address',{value:secret});
  assert.equal(result.verified,true);assert.equal(native[1].value,secret);assert.equal(JSON.stringify(result).includes(secret),false);
});

test('unobservable browser chrome state remains delivered but unverified',async()=>{
  const state={tabs:[{id:10,windowId:1}],active:{id:10,windowId:1}};const {adapter}=browserAdapter([state,state]);
  const result=await adapter.execute('addressbar');assert.equal(result.delivered,true);assert.equal(result.verified,false);
});

test('browser native input fails closed off Windows',async()=>{
  const run=createWindowsInputRunner({platform:'linux'});await assert.rejects(()=>run('combo','Control+t'),/browser_ui_input_windows_only/);
});

test('browser UI protocol uses v4 navigation tokens without raw URLs',()=>{
  assert.equal(PROTOCOL_VERSION,4);const a=navigationToken('https://example.test/a?secret=1'),b=navigationToken('https://example.test/b?secret=2');assert.notEqual(a,b);assert.equal(a.includes('secret'),false);
});

test('FOCUS_WINDOW marks tab activation as agent browser UI provenance',async()=>{
  let activatedListener=null;const sent=[];const tab={id:10,active:true,windowId:1,title:'T',url:'https://example.test/a'};
  const chrome={storage:{local:{get:async()=>({bodyDaemonExtensionInstanceId:'ext-a'}),set:async()=>{}}},runtime:{getManifest:()=>({version:'x'})},tabs:{query:async()=>[tab],get:async()=>tab,update:async()=>tab,sendMessage:async()=>({}),onActivated:{addListener:fn=>{activatedListener=fn;}},onUpdated:{addListener:()=>{}},onRemoved:{addListener:()=>{}}},windows:{update:async()=>({focused:true}),get:async()=>({focused:true})}};
  const gateway={attachedTabs:new Set(),detach:async()=>{},sendInput:async()=>{}};const bridge=new DaemonBridge(chrome,{gateway,WebSocketImpl:function(){}});bridge.extensionInstanceId='ext-a';bridge.socket={readyState:1,send:s=>sent.push(JSON.parse(s))};bridge.installTabListeners();
  const focus=await bridge.handle({type:'FOCUS_WINDOW',tabId:10,browserAction:'newtab',commandId:'browser-1'});assert.equal(focus.verified,true);await activatedListener({tabId:10});
  const row=sent.find(x=>x.type==='TAB_EVENT');assert.equal(row.event.source,'agent');assert.equal(row.event.agentCommandId,'browser-1');await bridge.handle({type:'BROWSER_UI_END',commandId:'browser-1'});assert.equal(bridge.expectedBrowserUi,null);
});
