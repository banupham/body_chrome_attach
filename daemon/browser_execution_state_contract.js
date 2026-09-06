'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {LocalIdentityStore}=require('./src/local_identity');
const {BrowserManager}=require('./src/browser_manager');
const {ExecutionLane}=require('./src/execution_lane');
const {syncBrowserExecutionState}=require('./src/daemon_runtime');

function tmp(name){return fs.mkdtempSync(path.join(os.tmpdir(),`${name}-`));}
function deferred(){let resolve,reject;const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});return {promise,resolve,reject};}
function tick(){return new Promise(resolve=>setImmediate(resolve));}
function setup(){
  const base=tmp('browser-execution-state');
  const identity=new LocalIdentityStore(base,{env:{BODY_COMPANY_ID:'company-test',BODY_DEVICE_ID:'device-test'}});
  identity.registerBrowser({browserInstanceId:'browser-a',extensionInstanceId:'ext-a',runtimeExtensionId:'runtime-a'});
  const browsers=new BrowserManager(identity);
  browsers.registerExtension({
    companyId:'company-test',deviceId:'device-test',browserInstanceId:'browser-a',
    extensionInstanceId:'ext-a',extensionId:'ext-a',runtimeExtensionId:'runtime-a',
    connectedAt:1,lastSeenAt:1,activeTabId:1,tabs:new Map([[1,{id:1,active:true,siteKey:'youtube.com'}]])
  });
  browsers.setEnvironment('browser-a',{eligible:true,status:'ELIGIBLE',publicIp:'1.1.1.1',environmentSignature:'sig-a',reasons:[],evidence:[]},'test_environment_eligible');
  return browsers;
}

test('execution lane busy state owns ACTIVE -> BUSY -> ACTIVE lifecycle',()=>{
  const browsers=setup();
  syncBrowserExecutionState(browsers,'ext-a',{busy:true,active:false,queued:2,current:null});
  assert.equal(browsers.require('browser-a').state,'BUSY');
  syncBrowserExecutionState(browsers,'ext-a',{busy:true,active:true,queued:1,current:{operation:'intent'}});
  assert.equal(browsers.require('browser-a').state,'BUSY');
  syncBrowserExecutionState(browsers,'ext-a',{busy:true,active:true,queued:0,current:{operation:'intent'}});
  assert.equal(browsers.require('browser-a').state,'BUSY');
  syncBrowserExecutionState(browsers,'ext-a',{busy:false,active:false,queued:0,current:null});
  assert.equal(browsers.require('browser-a').state,'ACTIVE');
});

test('two queued physical works on one Browser never create a false ACTIVE gap',async()=>{
  const browsers=setup();
  const lane=new ExecutionLane({onStateChange:(extensionId,state)=>syncBrowserExecutionState(browsers,extensionId,state)});
  const firstGate=deferred();
  const secondGate=deferred();
  const first=lane.run('ext-a',{operation:'intent',taskId:'task-a'},async()=>{await firstGate.promise;return 'first';});
  const second=lane.run('ext-a',{operation:'intent',taskId:'task-b'},async()=>{await secondGate.promise;return 'second';});

  await tick();
  assert.equal(browsers.require('browser-a').state,'BUSY');
  assert.equal(lane.status('ext-a').queued,1);

  firstGate.resolve();
  assert.equal(await first,'first');
  await tick();
  assert.equal(browsers.require('browser-a').state,'BUSY');
  assert.equal(lane.status('ext-a').active,true);
  assert.equal(lane.status('ext-a').queued,0);

  secondGate.resolve();
  assert.equal(await second,'second');
  await tick();
  assert.equal(lane.status('ext-a').busy,false);
  assert.equal(browsers.require('browser-a').state,'ACTIVE');
});

test('idle notification never overwrites HUMAN_CONTROL, QUARANTINED, ERROR or OFFLINE',()=>{
  for(const terminalState of ['HUMAN_CONTROL','QUARANTINED','ERROR']){
    const browsers=setup();
    browsers.setState('browser-a',terminalState,'test_override');
    syncBrowserExecutionState(browsers,'ext-a',{busy:false,active:false,queued:0,current:null});
    assert.equal(browsers.require('browser-a').state,terminalState);
  }
  const browsers=setup();
  browsers.extensionOffline('ext-a');
  syncBrowserExecutionState(browsers,'ext-a',{busy:false,active:false,queued:0,current:null});
  assert.equal(browsers.require('browser-a').state,'OFFLINE');
});

test('lane drain does not reactivate a browser whose environment became ineligible',()=>{
  const browsers=setup();
  syncBrowserExecutionState(browsers,'ext-a',{busy:true,active:true,queued:0,current:{operation:'intent'}});
  assert.equal(browsers.require('browser-a').state,'BUSY');
  browsers.require('browser-a').environment.eligible=false;
  syncBrowserExecutionState(browsers,'ext-a',{busy:false,active:false,queued:0,current:null});
  assert.equal(browsers.require('browser-a').state,'QUARANTINED');
});
