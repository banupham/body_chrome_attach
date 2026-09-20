'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {GuardianRuntime}=require('./runtime');
const {GuardianBrowserRegistry}=require('./browser_registry');

class FakeClient extends EventEmitter{
  constructor(){super();this.gates=[];this.revoked=[];this.connected=false;}
  async connect(){this.connected=true;return {role:'guardian'};}
  async bodyStatus(){return {browsers:[{browserInstanceId:'browser-a',extensionInstanceId:'ext-a',runtimeExtensionId:'runtime-a',online:true,activeTabId:1,tabs:[{id:1,active:true,siteKey:'example.test'}]}]};}
  async probeEnvironment(){return {pageEnvironment:{available:true,userAgent:'UA',platform:'Win32',language:'en',languages:['en'],hardwareConcurrency:8,deviceMemory:8,maxTouchPoints:0,webdriver:false,timezone:'UTC',screen:{width:1920,height:1080},devicePixelRatio:1},proxy:{available:true,detected:false,autoDetect:false,mode:'direct'},publicEgress:{available:true,ip:'203.0.113.10',provider:'test'},deepFingerprint:{available:true,score:0,verdict:'PASS',suspected:false,highSuspicion:false,stableHash:'abc',coverage:{percent:100,available:1,total:1},signals:[]}};}
  async setGate(browserInstanceId,grant){this.gates.push({browserInstanceId,...grant});return this.gates.at(-1);}
  async revokeGate(browserInstanceId){this.revoked.push(browserInstanceId);return {revoked:true};}
  close(){this.connected=false;}
}

class FakeEnvironment{
  constructor(registry){this.registry=registry;}
  async probeBrowser(id){
    const row=this.registry.require(id);
    row.environment={eligible:true,status:'ELIGIBLE',observedAt:new Date(1000).toISOString(),publicIp:'203.0.113.10',environmentSignature:'sig',deepFingerprint:{available:true,signalIds:[]},reasons:[],evidence:[]};
    return row.environment;
  }
  flushSync(){return {ok:true};}
}

test('Guardian alone decides allow/block while BODY receives only an opaque gate',async()=>{
  let now=1000;
  const client=new FakeClient(),registry=new GuardianBrowserRegistry(),environment=new FakeEnvironment(registry);
  const runtime=new GuardianRuntime({
    client,registry,environmentGuardian:environment,now:()=>now,
    controllerProbe:{probe:async()=>({available:true,driverProcesses:[],frameworkProcesses:[],inputAutomationProcesses:[],browserAutomationFlags:[],browserRemoteDebugFlags:[],suspectUdpEndpoints:[]})},
    setIntervalImpl:()=>null,clearIntervalImpl:()=>{}
  });
  await runtime.start();
  assert.equal(client.gates.length>0,true);
  assert.equal(client.gates.at(-1).allowed,true);
  assert.equal(runtime.status().authorityOrder,'HUMAN > GUARDIAN > BRAIN > BODY');

  await runtime.handleEvent({eventType:'input',browserInstanceId:'browser-a',input:{eventType:'mousedown',ts:1100,isTrusted:false,source:'third_party',x:10,y:20}});
  now=1200;
  await runtime.handleEvent({eventType:'input',browserInstanceId:'browser-a',input:{eventType:'mouseup',ts:1200,isTrusted:false,source:'third_party',x:10,y:20}});
  assert.equal(client.gates.at(-1).allowed,false);
  assert.ok(runtime.decisions.get('browser-a').reasons.includes('BOT_BEHAVIOR_HIGH_CONFIDENCE'));

  await runtime.stop();
  assert.deepEqual(client.revoked,['browser-a']);
});

test('external controller conflict independently blocks Brain CDP',async()=>{
  const client=new FakeClient(),registry=new GuardianBrowserRegistry(),environment=new FakeEnvironment(registry);
  const runtime=new GuardianRuntime({
    client,registry,environmentGuardian:environment,now:()=>1000,
    controllerProbe:{probe:async()=>({available:true,driverProcesses:[{name:'chromedriver.exe',pid:1}],frameworkProcesses:[{name:'python.exe',pid:2}],inputAutomationProcesses:[],browserAutomationFlags:[{name:'chrome.exe',pid:3}],browserRemoteDebugFlags:[],suspectUdpEndpoints:[]})},
    setIntervalImpl:()=>null,clearIntervalImpl:()=>{}
  });
  await runtime.start();
  const decision=runtime.decisions.get('browser-a');
  assert.equal(decision.allowed,false);
  assert.ok(decision.reasons.includes('EXTERNAL_CONTROLLER_CONFLICT'));
  assert.equal(client.gates.at(-1).allowed,false);
  await runtime.stop();
});
