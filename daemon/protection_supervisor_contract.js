'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {BehaviorGuardian}=require('./src/behavior_guardian');
const {ExternalControllerProbe,compactProcessSnapshot,assessControllerConflict}=require('./src/external_controller_probe');
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

test('Windows controller probe is asynchronous and preserves failure reason',async()=>{
  let calls=0;const execFile=(file,args,options,callback)=>{calls++;assert.equal(file,'powershell.exe');assert.ok(args.includes('-NonInteractive'));setImmediate(()=>callback(null,JSON.stringify({processes:[{Name:'chromedriver.exe',ProcessId:10,ParentProcessId:1,CommandLine:'chromedriver.exe'}],udp:[]}),'') );};
  const probe=new ExternalControllerProbe({platform:'win32',execFile,timeoutMs:7000});const pending=probe.probe();assert.equal(typeof pending.then,'function');const result=await pending;assert.equal(calls,1);assert.equal(result.available,true);assert.equal(result.driverProcesses[0].name,'chromedriver.exe');
  const failed=new ExternalControllerProbe({platform:'win32',execFile:(file,args,options,callback)=>setImmediate(()=>callback(Object.assign(new Error('timed out'),{code:'ETIMEDOUT'}),'','')),timeoutMs:7000});const unavailable=await failed.probe();assert.equal(unavailable.available,false);assert.match(unavailable.reason,/ETIMEDOUT/);assert.match(assessControllerConflict(unavailable,[]).reason,/ETIMEDOUT/);
});

test('behavior guardian ignores BODY agent events, blocks synthetic input, then decays stale evidence',()=>{
  let now=1000;const behavior=new BehaviorGuardian({now:()=>now});
  for(let i=0;i<30;i++){behavior.observe('b1',{eventType:'mousedown',source:'agent',ts:now,x:10,y:10});now+=20;}
  assert.equal(behavior.status('b1').score,0);
  behavior.observe('b1',{eventType:'synthetic_input',source:'human',isTrusted:false,ts:now});now+=5;
  behavior.observe('b1',{eventType:'synthetic_input',source:'human',isTrusted:false,ts:now});
  let status=behavior.status('b1');
  assert.equal(status.blocked,true);
  assert.ok(status.signalIds.includes('synthetic_untrusted_input'));
  now+=16000;status=behavior.status('b1');
  assert.equal(status.blocked,false);
  assert.equal(status.score,0);
});

function fakeRuntime(){
  const row={browserInstanceId:'b1',extensionInstanceId:'e1',online:true,state:'ACTIVE',stateReason:'environment_eligible',environment:{eligible:true,reasons:[],evidence:[{type:'deep_fingerprint',signalIds:['webdriver_true']}]}};
  const browsers={
    list:()=>[{...row,environment:{...row.environment,reasons:[...(row.environment.reasons||[])],evidence:(row.environment.evidence||[]).map(x=>({...x}))}}],
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

test('light supervisor accepts an asynchronous controller sensor without blocking startup',async()=>{
  const runtime=fakeRuntime();const probe={probe:()=>new Promise(resolve=>setImmediate(()=>resolve(compactProcessSnapshot({processes:[],udp:[]}))))};const supervisor=new ProtectionSupervisor(runtime,{controllerProbe:probe,setIntervalImpl:()=>({unref(){}}),clearIntervalImpl:()=>{}}).start();
  assert.equal(supervisor.status().lightRunning,true);assert.equal(supervisor.status().browsers.b1.controller.reason,'controller_scan_pending');await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));const status=supervisor.status();assert.equal(status.lightRunning,false);assert.equal(status.browsers.b1.controller.available,true);assert.equal(status.browsers.b1.controller.blocked,false);supervisor.stop();
});

test('light supervisor automatically retries a deferred environment check and clears ENV_CHECK',async()=>{
  const runtime=fakeRuntime(),row=runtime.browsers.require('b1');row.state='ENV_CHECK';row.stateReason='environment_waiting_for_http_tab';row.environment={eligible:false,status:'PENDING',reasons:['ENVIRONMENT_SIGNATURE_UNAVAILABLE'],evidence:[]};let probes=0;
  runtime.probeEnvironment=async()=>{probes++;row.environment={eligible:true,status:'ELIGIBLE',reasons:[],evidence:[]};row.state='ACTIVE';row.stateReason='environment_eligible';return {browserInstanceId:'b1',eligible:true,status:'ELIGIBLE',reasons:[]};};
  const probe={probe:()=>compactProcessSnapshot({processes:[],udp:[]})};const supervisor=new ProtectionSupervisor(runtime,{controllerProbe:probe,setIntervalImpl:()=>({unref(){}}),clearIntervalImpl:()=>{}}).start();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(probes,1);assert.equal(row.state,'ACTIVE');assert.equal(supervisor.status().transientProbeInFlight.length,0);supervisor.stop();
});
