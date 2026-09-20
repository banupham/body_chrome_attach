'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {GuardianRuntime}=require('./runtime');
const {GuardianBrowserRegistry}=require('./browser_registry');

class FakeClient extends EventEmitter{
  constructor(){super();this.browserVerdicts=[];this.learning=[];this.connected=false;}
  async connect(){this.connected=true;return {role:'guardian'};}
  async bodyStatus(){return {browsers:[{browserInstanceId:'browser-a',extensionInstanceId:'ext-a',runtimeExtensionId:'runtime-a',online:true,activeTabId:1,tabs:[{id:1,active:true,siteKey:'example.test'}]}]};}
  async probeEnvironment(){return {pageEnvironment:{available:true,userAgent:'UA',platform:'Win32',language:'en',languages:['en'],hardwareConcurrency:8,deviceMemory:8,maxTouchPoints:0,webdriver:false,timezone:'UTC',screen:{width:1920,height:1080},devicePixelRatio:1},proxy:{available:true,detected:false,autoDetect:false,mode:'direct'},publicEgress:{available:true,ip:'203.0.113.10',provider:'test'},deepFingerprint:{available:true,score:0,verdict:'PASS',suspected:false,highSuspicion:false,stableHash:'abc',coverage:{percent:100,available:1,total:1},signals:[]}};}
  async setBrowserVerdict(browserInstanceId,verdict){this.browserVerdicts.push({browserInstanceId,...verdict});return this.browserVerdicts.at(-1);}
  async setLearning(browserInstanceId,verdict){this.learning.push({browserInstanceId,...verdict});return this.learning.at(-1);}
  close(){this.connected=false;}
}

class FakeEnvironment{
  constructor(registry,{eligible=true,status=null}={}){this.registry=registry;this.eligible=eligible;this.status=status;}
  async probeBrowser(id){
    const row=this.registry.require(id),resolvedStatus=this.status||(this.eligible?'ELIGIBLE':'BLOCKED');
    row.environment={eligible:this.eligible,status:resolvedStatus,observedAt:new Date(1000).toISOString(),publicIp:'203.0.113.10',environmentSignature:'sig',deepFingerprint:{available:true,signalIds:[]},reasons:resolvedStatus==='PENDING'?['HTTP_TAB_REQUIRED_FOR_ENVIRONMENT_PROBE']:(this.eligible?[]:['INVALID_CHROME']),evidence:[]};
    return row.environment;
  }
  flushSync(){return {ok:true};}
}

test('valid Chrome is admitted and Human learning is allowed when no third-party automation is detected',async()=>{
  const client=new FakeClient(),registry=new GuardianBrowserRegistry(),environment=new FakeEnvironment(registry);
  const runtime=new GuardianRuntime({
    client,registry,environmentGuardian:environment,now:()=>1000,
    controllerProbe:{probe:async()=>({available:true,driverProcesses:[],frameworkProcesses:[],inputAutomationProcesses:[],browserAutomationFlags:[],browserRemoteDebugFlags:[],suspectUdpEndpoints:[]})},
    setIntervalImpl:()=>null,clearIntervalImpl:()=>{}
  });
  await runtime.start();
  const decision=runtime.decisions.get('browser-a');
  assert.equal(decision.browserValid,true);
  assert.equal(decision.learningAllowed,true);
  assert.equal(client.browserVerdicts.at(-1).valid,true);
  assert.equal(client.learning.at(-1).allowed,true);
  await runtime.stop();
});

test('third-party synthetic/automation input blocks only Human learning, not browser validity',async()=>{
  let now=1000;
  const client=new FakeClient(),registry=new GuardianBrowserRegistry(),environment=new FakeEnvironment(registry);
  const runtime=new GuardianRuntime({
    client,registry,environmentGuardian:environment,now:()=>now,
    controllerProbe:{probe:async()=>({available:true,driverProcesses:[],frameworkProcesses:[],inputAutomationProcesses:[],browserAutomationFlags:[],browserRemoteDebugFlags:[],suspectUdpEndpoints:[]})},
    setIntervalImpl:()=>null,clearIntervalImpl:()=>{}
  });
  await runtime.start();
  await runtime.handleEvent({eventType:'input',browserInstanceId:'browser-a',input:{eventType:'mousedown',ts:1100,isTrusted:false,source:'third_party',x:10,y:20}});
  now=1200;
  await runtime.handleEvent({eventType:'input',browserInstanceId:'browser-a',input:{eventType:'mouseup',ts:1200,isTrusted:false,source:'third_party',x:10,y:20}});
  const decision=runtime.decisions.get('browser-a');
  assert.equal(decision.browserValid,true);
  assert.equal(decision.learningAllowed,false);
  assert.ok(decision.learningReasons.includes('BOT_BEHAVIOR_HIGH_CONFIDENCE'));
  assert.equal(client.browserVerdicts.at(-1).valid,true);
  assert.equal(client.learning.at(-1).allowed,false);
  await runtime.stop();
});

test('external controller conflict blocks Human learning but does not block Brain task execution or invalidate Chrome',async()=>{
  const client=new FakeClient(),registry=new GuardianBrowserRegistry(),environment=new FakeEnvironment(registry);
  const runtime=new GuardianRuntime({
    client,registry,environmentGuardian:environment,now:()=>1000,
    controllerProbe:{probe:async()=>({available:true,driverProcesses:[{name:'chromedriver.exe',pid:1}],frameworkProcesses:[{name:'python.exe',pid:2}],inputAutomationProcesses:[],browserAutomationFlags:[{name:'chrome.exe',pid:3}],browserRemoteDebugFlags:[],suspectUdpEndpoints:[]})},
    setIntervalImpl:()=>null,clearIntervalImpl:()=>{}
  });
  await runtime.start();
  const decision=runtime.decisions.get('browser-a');
  assert.equal(decision.browserValid,true);
  assert.equal(decision.learningAllowed,false);
  assert.ok(decision.learningReasons.includes('EXTERNAL_CONTROLLER_CONFLICT'));
  assert.equal(client.browserVerdicts.at(-1).valid,true);
  assert.equal(client.learning.at(-1).allowed,false);
  await runtime.stop();
});

test('invalid Chrome is rejected at browser level',async()=>{
  const client=new FakeClient(),registry=new GuardianBrowserRegistry(),environment=new FakeEnvironment(registry,{eligible:false});
  const runtime=new GuardianRuntime({
    client,registry,environmentGuardian:environment,now:()=>1000,
    controllerProbe:{probe:async()=>({available:true,driverProcesses:[],frameworkProcesses:[],inputAutomationProcesses:[],browserAutomationFlags:[],browserRemoteDebugFlags:[],suspectUdpEndpoints:[]})},
    setIntervalImpl:()=>null,clearIntervalImpl:()=>{}
  });
  await runtime.start();
  const decision=runtime.decisions.get('browser-a');
  assert.equal(decision.browserValid,false);
  assert.equal(decision.learningAllowed,false);
  assert.equal(client.browserVerdicts.at(-1).valid,false);
  assert.ok(decision.browserReasons.includes('INVALID_CHROME'));
  await runtime.stop();
});


test('common auto-click process names disable Human learning without invalidating Chrome',async()=>{
  const client=new FakeClient(),registry=new GuardianBrowserRegistry(),environment=new FakeEnvironment(registry);
  const runtime=new GuardianRuntime({
    client,registry,environmentGuardian:environment,now:()=>1000,
    controllerProbe:{probe:async()=>({available:true,driverProcesses:[],frameworkProcesses:[],inputAutomationProcesses:[{name:'autoclicker.exe',pid:10}],browserAutomationFlags:[],browserRemoteDebugFlags:[],suspectUdpEndpoints:[]})},
    setIntervalImpl:()=>null,clearIntervalImpl:()=>{}
  });
  await runtime.start();
  const decision=runtime.decisions.get('browser-a');
  assert.equal(decision.browserValid,true);
  assert.equal(decision.learningAllowed,false);
  assert.ok(decision.learningReasons.includes('EXTERNAL_CONTROLLER_SUSPECT'));
  assert.equal(client.browserVerdicts.at(-1).valid,true);
  assert.equal(client.learning.at(-1).allowed,false);
  await runtime.stop();
});


test('pending Chrome environment check does not disconnect or mark the browser invalid',async()=>{
  const client=new FakeClient(),registry=new GuardianBrowserRegistry(),environment=new FakeEnvironment(registry,{eligible:false,status:'PENDING'});
  const runtime=new GuardianRuntime({
    client,registry,environmentGuardian:environment,now:()=>1000,
    controllerProbe:{probe:async()=>({available:true,driverProcesses:[],frameworkProcesses:[],inputAutomationProcesses:[],browserAutomationFlags:[],browserRemoteDebugFlags:[],suspectUdpEndpoints:[]})},
    setIntervalImpl:()=>null,clearIntervalImpl:()=>{}
  });
  await runtime.start();
  const decision=runtime.decisions.get('browser-a');
  assert.equal(decision.browserValid,null);
  assert.equal(decision.learningAllowed,false);
  assert.equal(client.browserVerdicts.at(-1).valid,null);
  assert.equal(client.learning.length,0);
  await runtime.stop();
});
