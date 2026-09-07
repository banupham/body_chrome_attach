'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {BodyStepGateway,BODY_CONTRACT_VERSION,judgmentPaths,validateBodyStepCommand}=require('./src/body_step_gateway');

function runtimeStub(){
  const browser={browserInstanceId:'browser-a',extensionInstanceId:'ext-a',online:true,state:'ACTIVE',activeTabId:1,tabs:new Map([[1,{id:1,active:true,windowId:7,title:'Example',siteKey:'example.test',navigationToken:'nav-1',navigationEpoch:1,status:'complete'}],[2,{id:2,active:false,windowId:7,title:'Other',siteKey:'example.test',navigationToken:'nav-2',navigationEpoch:1,status:'complete'}]]),environment:{eligible:true,status:'ELIGIBLE',reasons:[]}};
  const calls={contexts:0,motor:0,browser:0,switch:0};
  const runtime={
    calls,
    identityForExtension:()=>({companyId:'company-a',deviceId:'device-a',browserInstanceId:'browser-a',extensionInstanceId:'ext-a'}),
    identity:{identityChain:()=>({companyId:'company-a',deviceId:'device-a',browserInstanceId:'browser-a',extensionInstanceId:'ext-a'})},
    browsers:{require:id=>{assert.equal(id,'browser-a');return browser;}},
    pointerState:{snapshot:(_identity,tabId)=>({known:true,tabId:Number(tabId),x:50,y:60,source:'human',updatedAt:100})},
    pointerStatus:async(_ext,tabId)=>({known:true,tabId:Number(tabId),x:50,y:60,source:'human',updatedAt:100,resynced:false}),
    tasks:{
      get:id=>({taskId:id,workspace:{browserInstanceId:'browser-a',primaryTabId:1,tabIds:[1,2]}}),
      executionContext:(taskId,tabRef)=>{calls.contexts++;if(taskId==='bad-task')throw new Error('task_not_found:bad-task');const tabId=tabRef==='primary'?1:Number(tabRef);if(![1,2].includes(tabId))throw new Error('tab_not_owned_by_task');return {taskId,browserInstanceId:'browser-a',extensionInstanceId:'ext-a',tabId};}
    },
    executeIntent:async(intent)=>{calls.motor++;if(intent.type==='pressKey'&&intent.key==='FAIL')throw new Error('physical_dispatch_error');return {commandId:'motor-1',behaviorSource:'learned',learnedGroup:'private-motor-detail',execution:{delivered:true,plannedStepCount:3,issuedStepCount:3,completedStepCount:3,observedEffect:{changed:true,navigationChanged:false},verified:true,taskSuccess:true,verification:{reason:'must_not_escape'}}};},
    executeBrowserCommand:async()=>{calls.browser++;return {commandId:'browser-1',delivered:true,verified:true,taskSuccess:false,observedEffect:{changed:true,reason:'tab_count_increased'},executionAudit:{stepCount:1}};},
    switchTab:async(_ext,tabId)=>{calls.switch++;browser.activeTabId=Number(tabId);return {commandId:'switch-1',switched:true,tabId:Number(tabId),verified:true};}
  };
  return runtime;
}

test('BODY Contract v1 validates one atomic motor step',()=>{
  const command=validateBodyStepCommand({contractVersion:'1.0',type:'BODY_STEP',stepId:'STEP-1',taskId:'TASK-1',step:{kind:'motor',intent:{type:'click',x:10,y:20}}});
  assert.equal(command.contractVersion,BODY_CONTRACT_VERSION);
  assert.equal(command.tabId,'primary');
  assert.throws(()=>validateBodyStepCommand({contractVersion:'1.0',type:'BODY_STEP',stepId:'STEP-2',taskId:'TASK-1',step:{kind:'motor',intent:{type:'click',actions:[{type:'pressKey',key:'Enter'}]}}}),/body_motor_composite_forbidden/);
  assert.throws(()=>validateBodyStepCommand({contractVersion:'1.0',type:'BODY_STEP',stepId:'STEP-3',taskId:'TASK-1',step:{kind:'motor',intent:{type:'strategy'}}}),/body_motor_intent_unsupported/);
  assert.throws(()=>validateBodyStepCommand({contractVersion:'1.0',type:'BODY_STEP',stepId:'STEP-4',taskId:'TASK-1',tabId:'',step:{kind:'motor',intent:{type:'pressKey',key:'Enter'}}}),/body_tab_ref_invalid/);
  assert.throws(()=>validateBodyStepCommand({contractVersion:'1.0',type:'BODY_STEP',stepId:'STEP-5',taskId:'TASK-1',step:{kind:'tab_switch',targetTabId:null}}),/body_target_tab_required/);
  assert.throws(()=>validateBodyStepCommand({contractVersion:'1.0',type:'BODY_STEP',stepId:'STEP-6',taskId:'TASK-1',step:{kind:'tab_switch',targetTabId:' '}}),/body_target_tab_required/);
});

test('Eyes observation returns known control/content/environment facts with freshness',async()=>{
  let now=1000;const runtime=runtimeStub(),body=new BodyStepGateway(runtime,{now:()=>now});
  body.observeTabContext('ext-a',{tabId:1,context:{siteKey:'example.test',title:'Example',windowId:7,navigationToken:'nav-1',navigationEpoch:1,status:'complete'}});
  body.observeSemantic('ext-a',{tabId:1,observation:{available:true,observedAt:900,platform:'example',controls:{searchInput:{visible:true,actionRect:{x:10,y:20,width:100,height:30}}}}});
  body.observeRecorder('ext-a',{tabId:1,event:{ts:950,source:'human',target:{tag:'button',role:'button',editable:false,sensitive:false,rect:{x:200,y:100,width:80,height:32}}}});
  now=1100;const observation=await body.observe({browserInstanceId:'browser-a',tabId:1});
  assert.equal(observation.contractVersion,'1.0');
  assert.equal(observation.scope.browserInstanceId,'browser-a');
  assert.equal(observation.control.lastObservedTarget.role,'button');
  assert.equal(observation.control.semanticControls.searchInput.actionRect.x,10);
  assert.equal(observation.environment.eligible,true);
  assert.equal(observation.bodyState.pointer.known,true);
  assert.equal(observation.freshness.semanticAgeMs,200);
  assert.equal(judgmentPaths(observation).length,0);
});

test('Eyes never converts missing optional integers into invented zero values',async()=>{
  const runtime=runtimeStub();
  const browser=runtime.browsers.require('browser-a');
  browser.activeTabId=null;
  browser.tabs.get(1).windowId=null;
  browser.tabs.get(1).navigationEpoch=null;
  const body=new BodyStepGateway(runtime,{now:()=>1000});
  const observation=await body.observe({browserInstanceId:'browser-a',tabId:1});
  assert.equal(observation.scope.windowId,null);
  assert.equal(observation.scope.navigationEpoch,null);
  assert.equal(observation.bodyState.activeTabId,null);
});

test('one BODY_STEP invokes one motor execution and strips all task judgment fields',async()=>{
  const runtime=runtimeStub(),body=new BodyStepGateway(runtime,{now:()=>1200});
  const result=await body.execute({contractVersion:'1.0',type:'BODY_STEP',stepId:'STEP-1',taskId:'TASK-1',step:{kind:'motor',intent:{type:'click',x:10,y:20}}});
  assert.equal(runtime.calls.contexts,1);
  assert.equal(runtime.calls.motor,1);
  assert.equal(result.type,'BODY_STEP_RESULT');
  assert.equal(result.execution.accepted,true);
  assert.equal(result.execution.attempted,true);
  assert.equal(result.execution.attemptedOnce,true);
  assert.equal(result.execution.dispatched,true);
  assert.equal(result.execution.completed,true);
  assert.equal(result.execution.plannedLowLevelSteps,3);
  assert.equal(result.execution.completedLowLevelSteps,3);
  assert.equal(result.observation.changes.changed,true);
  assert.equal(judgmentPaths(result).length,0,JSON.stringify(judgmentPaths(result)));
  assert.equal(JSON.stringify(result).includes('private-motor-detail'),false,'Brain boundary must not expose MotorLearning internals');
});

test('technical execution error returns facts and never retries',async()=>{
  const runtime=runtimeStub(),body=new BodyStepGateway(runtime);
  const result=await body.execute({contractVersion:'1.0',type:'BODY_STEP',stepId:'STEP-FAIL',taskId:'TASK-1',step:{kind:'motor',intent:{type:'pressKey',key:'FAIL'}}});
  assert.equal(runtime.calls.motor,1);
  assert.equal(result.execution.accepted,true);
  assert.equal(result.execution.attempted,true);
  assert.equal(result.execution.completed,false);
  assert.equal(result.execution.error.code,'physical_dispatch_error');
  assert.equal(judgmentPaths(result).length,0);
});

test('invalid/rejected command does not touch physical runtime',async()=>{
  const runtime=runtimeStub(),body=new BodyStepGateway(runtime);
  const result=await body.execute({contractVersion:'1.0',type:'BODY_STEP',stepId:'STEP-X',taskId:'TASK-1',step:{kind:'motor',intent:{type:'strategy'}}});
  assert.equal(result.execution.accepted,false);
  assert.equal(result.execution.attempted,false);
  assert.equal(runtime.calls.contexts,0);
  assert.equal(runtime.calls.motor,0);
});

test('browser UI and tab switch remain one Body step each',async()=>{
  const runtime=runtimeStub(),body=new BodyStepGateway(runtime);
  const browser=await body.execute({contractVersion:'1.0',type:'BODY_STEP',stepId:'STEP-B',taskId:'TASK-1',step:{kind:'browser_ui',action:'back'}});
  assert.equal(runtime.calls.browser,1);assert.equal(browser.execution.completed,true);assert.equal(judgmentPaths(browser).length,0);
  const switched=await body.execute({contractVersion:'1.0',type:'BODY_STEP',stepId:'STEP-T',taskId:'TASK-1',step:{kind:'tab_switch',targetTabId:2}});
  assert.equal(runtime.calls.switch,1);assert.equal(switched.action.name,'switchTab');assert.equal(switched.execution.completed,true);assert.equal(judgmentPaths(switched).length,0);
});
