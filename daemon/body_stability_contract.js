'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {ExecutionLane}=require('./src/execution_lane');
const {HumanActionSegmenter}=require('./src/segmenter');
const {BrowserUiAdapter}=require('./src/browser_ui_adapter');
const {createDaemonRuntime}=require('./src/daemon_runtime');

function tmp(name){return fs.mkdtempSync(path.join(os.tmpdir(),`${name}-`));}
function tick(){return new Promise(resolve=>setImmediate(resolve));}

test('execution lane serializes physical work per extension',async()=>{
  const lane=new ExecutionLane(),order=[];
  let releaseFirst;
  const first=lane.run('ext-a',{action:'first'},async()=>{
    order.push('first:start');
    await new Promise(resolve=>{releaseFirst=resolve;});
    order.push('first:end');
    return 1;
  });
  const second=lane.run('ext-a',{action:'second'},async()=>{order.push('second:start');return 2;});
  await tick();
  assert.deepEqual(order,['first:start']);
  const state=lane.status('ext-a');
  assert.equal(state.active,true);
  assert.equal(state.queued,1);
  releaseFirst();
  assert.deepEqual(await Promise.all([first,second]),[1,2]);
  assert.deepEqual(order,['first:start','first:end','second:start']);
  assert.equal(lane.status('ext-a').completed,2);
});

test('execution lanes for different extensions do not block each other',async()=>{
  const lane=new ExecutionLane(),order=[];
  let releaseA;
  const a=lane.run('ext-a',{},async()=>{order.push('a');await new Promise(resolve=>{releaseA=resolve;});});
  const b=lane.run('ext-b',{},async()=>{order.push('b');});
  await tick();
  assert.deepEqual(order.sort(),['a','b']);
  releaseA();
  await Promise.all([a,b]);
});

test('segmenter flushes pending typing and scroll before disposal',()=>{
  const rows=[];
  const s=new HumanActionSegmenter(row=>rows.push(row));
  const target={role:'textbox',tag:'input',editable:true};
  s.handle(7,{source:'human',eventType:'keydown',ts:100,keyClass:'alpha',target});
  s.handle(7,{source:'human',eventType:'keyup',ts:130,keyClass:'alpha',target});
  s.handle(7,{source:'human',eventType:'keydown',ts:180,keyClass:'alpha',target});
  s.handle(7,{source:'human',eventType:'keyup',ts:215,keyClass:'alpha',target});
  s.handle(7,{source:'human',eventType:'wheel',ts:240,deltaX:0,deltaY:120,x:400,y:300,target:{}});
  const result=s.dispose(7,{flush:true});
  assert.equal(result.emitted,2);
  assert.deepEqual(rows.map(x=>x.action).sort(),['scrollVertical','typeText']);
  assert.equal(s.tabs.has(7),false);
});

test('extension disconnect rejects pending requests immediately',()=>{
  const runtime=createDaemonRuntime({baseDir:tmp('body-disconnect')});
  let rejected=null;
  const timer=setTimeout(()=>{},30000);
  runtime.pending.set('request-1',{extensionId:'ext-a',type:'BODY_EXECUTE',timer,reject:error=>{rejected=error;}});
  const count=runtime.rejectPendingForExtension('ext-a');
  assert.equal(count,1);
  assert.equal(runtime.pending.size,0);
  assert.match(String(rejected?.message||rejected),/extension_disconnected:ext-a:BODY_EXECUTE/);
  runtime.flushSync();
});

test('Browser UI exposes the same delivery observation verification task-success truth layers',async()=>{
  let snapshotIndex=0;
  const before={tabs:[{id:10,windowId:1}],active:{id:10,windowId:1}};
  const after={tabs:[{id:10,windowId:1},{id:11,windowId:1}],active:{id:11,windowId:1}};
  const adapter=new BrowserUiAdapter({
    resolveTarget:async()=>({extensionId:'ext-a',tab:{id:10,windowId:1}}),
    focusTarget:async()=>({verified:true,focused:true}),
    finishTarget:async()=>({cleared:true}),
    snapshot:async()=>snapshotIndex++===0?before:after,
    runNativeInput:async()=>({ok:true}),
    sleepImpl:async()=>{},
    verifyTimeoutMs:100,
    verifyIntervalMs:20
  });
  const result=await adapter.execute('newtab');
  assert.equal(result.delivered,true);
  assert.equal(result.observed,true);
  assert.equal(result.verified,true);
  assert.equal(result.taskSuccess,null);
  assert.equal(result.observedEffect.kind,'new-tab');
  assert.equal(result.observedEffect.observable,true);
  assert.equal(result.executionAudit.nativeInputOnly,true);
});
