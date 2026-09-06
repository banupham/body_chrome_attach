'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {BehaviorGuardian}=require('./src/behavior_guardian');
const {compactProcessSnapshot,assessControllerConflict}=require('./src/external_controller_probe');
const {ProtectionSupervisor}=require('./src/protection_supervisor');

test('external controller assessment blocks correlated webdriver automation but not a lone input utility',()=>{
  const snapshot=compactProcessSnapshot({processes:[
    {Name:'chromedriver.exe',ProcessId:10,CommandLine:'chromedriver.exe --port=9515'},
    {Name:'chrome.exe',ProcessId:11,CommandLine:'chrome.exe --enable-automation --remote-debugging-port=0'},
    {Name:'python.exe',ProcessId:12,CommandLine:'python run_selenium.py selenium'}
  ],udp:[{OwningProcess:12,LocalPort:50000}]});
  const verdict=assessControllerConflict(snapshot,['webdriver_true']);
  assert.equal(verdict.blocked,true);
  assert.ok(verdict.signalIds.includes('external_webdriver_process'));
  assert.ok(verdict.signalIds.includes('browser_enable_automation_flag'));
  assert.ok(verdict.signalIds.includes('deep_browser_automation_signal'));
  assert.ok(verdict.signalIds.includes('automation_process_udp_endpoint'));

  const lone=compactProcessSnapshot({processes:[{Name:'AutoHotkey.exe',ProcessId:44,CommandLine:'AutoHotkey.exe script.ahk'}],udp:[]});
  const loneVerdict=assessControllerConflict(lone,[]);
  assert.equal(loneVerdict.blocked,false);
  assert.equal(loneVerdict.review,true);
});

test('behavior guardian ignores BODY agent events and blocks repeated untrusted synthetic input',()=>{
  let now=1000;const behavior=new BehaviorGuardian({now:()=>now});
  for(let i=0;i<30;i++){behavior.observe('b1',{eventType:'mousedown',source:'agent',ts:now,x:10,y:10});now+=20;}
  assert.equal(behavior.status('b1').score,0);
  behavior.observe('b1',{eventType:'synthetic_input',source:'human',isTrusted:false,ts:now});now+=5;
  behavior.observe('b1',{eventType:'synthetic_input',source:'human',isTrusted:false,ts:now});
  const status=behavior.status('b1');
  assert.equal(status.blocked,true);
  assert.ok(status.signalIds.includes('synthetic_untrusted_input'));
});

function fakeRuntime(){
  const row={browserInstanceId:'b1',extensionInstanceId:'e1',online:true,state:'ACTIVE',stateReason:'environment_eligible',environment:{eligible:true,evidence:[{type:'deep_fingerprint',signalIds:['webdriver_true']}]}};
  const browsers={
    list:()=>[{...row,environment:{...row.environment,evidence:row.environment.evidence.map(x=>({...x}))}}],
    require:id=>{if(id!=='b1')throw new Error('not_found');return row;},
    browserForExtension:id=>id==='e1'?row:null,
    setState:(id,state,reason)=>{assert.equal(id,'b1');row.state=state;row.stateReason=reason;return {...row};},
    public:r=>({...r})
  };
  return {
    browsers,
    recorderEvent:()=>true,
    tasks:{create:spec=>({ok:true,...spec})},
    guardian:{status:()=>({policy:{}})},
    probeEnvironment:async()=>({browserInstanceId:'b1',eligible:true,status:'ELIGIBLE',reasons:[]}),
    probeAllEnvironments:async()=>[{browserInstanceId:'b1',eligible:true,status:'ELIGIBLE',reasons:[]}]
  };
}

test('protection supervisor quarantines controller conflict and blocks new task assignment',()=>{
  const runtime=fakeRuntime();
  const probe={probe:()=>compactProcessSnapshot({processes:[
    {Name:'chromedriver.exe',ProcessId:10,CommandLine:'chromedriver.exe'},
    {Name:'chrome.exe',ProcessId:11,CommandLine:'chrome.exe --enable-automation'}
  ],udp:[]})};
  const timers=[];const supervisor=new ProtectionSupervisor(runtime,{controllerProbe:probe,setIntervalImpl:(fn,ms)=>{timers.push(ms);return {unref(){}};},clearIntervalImpl:()=>{}}).start();
  assert.equal(runtime.browsers.require('b1').state,'QUARANTINED');
  assert.throws(()=>runtime.tasks.create({browserInstanceId:'b1'}),/browser_protection_blocked/);
  assert.deepEqual(timers,[15000,300000]);
  const status=runtime.guardian.status();
  assert.equal(status.protection.browsers.b1.blocked,true);
  supervisor.stop();
});
