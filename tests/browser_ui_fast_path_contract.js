'use strict';

const assert=require('node:assert/strict');
const {BrowserUiAdapter,fastBrowserUiRequest}=require('../daemon/src/browser_ui_adapter');
const {DaemonBridge,parseFastBrowserUiAction,ALLOWED_METHODS}=require('../src/daemon_bridge');

(async()=>{
  const request=fastBrowserUiRequest('address','https://www.youtube.com/');
  assert.ok(request.startsWith('__body_fast_browser_ui__:address:'));
  assert.deepEqual(parseFastBrowserUiAction(request),{action:'address',value:'https://www.youtube.com/'});
  assert.deepEqual(parseFastBrowserUiAction(fastBrowserUiRequest('back')),{action:'back',value:''});
  assert.equal(fastBrowserUiRequest('address','youtube systemverilog'),null);

  let snapshotIndex=0,focusAction=null;
  const native=[];
  const states=[
    {tabs:[{id:10,active:true,windowId:1,navigationToken:'blank'}],active:{id:10,active:true,windowId:1,navigationToken:'blank'}},
    {tabs:[{id:10,active:true,windowId:1,navigationToken:'youtube'}],active:{id:10,active:true,windowId:1,navigationToken:'youtube'}}
  ];
  const adapter=new BrowserUiAdapter({
    resolveTarget:async()=>({extensionId:'ext-fast',tab:{id:10,windowId:1}}),
    focusTarget:async({action})=>{focusAction=action;return {verified:true,fastExecuted:true,fastTransport:'chrome.tabs.update'};},
    finishTarget:async()=>({cleared:true}),
    snapshot:async()=>states[Math.min(snapshotIndex++,states.length-1)],
    runNativeInput:async(mode,value)=>{native.push({mode,value});return {ok:true};},
    sleepImpl:async()=>{},verifyTimeoutMs:100,verifyIntervalMs:20
  });
  const result=await adapter.execute('address',{value:'https://www.youtube.com/'});
  assert.equal(result.delivered,true);
  assert.equal(result.verified,true);
  assert.equal(result.executionAudit.browserApiFastPath,true);
  assert.equal(result.executionAudit.nativeInputUsed,false);
  assert.deepEqual(result.native,[]);
  assert.deepEqual(native,[]);
  assert.equal(focusAction,request);

  let fallbackSnapshot=0;
  const fallbackFocus=[],fallbackNative=[];
  const fallbackStates=[
    {tabs:[{id:10,active:true,windowId:1,navigationToken:'one'}],active:{id:10,active:true,windowId:1,navigationToken:'one'}},
    {tabs:[{id:10,active:true,windowId:1,navigationToken:'one'}],active:{id:10,active:true,windowId:1,navigationToken:'one'}},
    {tabs:[{id:10,active:true,windowId:1,navigationToken:'two'}],active:{id:10,active:true,windowId:1,navigationToken:'two'}}
  ];
  const fallbackAdapter=new BrowserUiAdapter({
    resolveTarget:async()=>({extensionId:'ext-fallback',tab:{id:10,windowId:1}}),
    focusTarget:async({action})=>{fallbackFocus.push(action);if(String(action).startsWith('__body_fast_browser_ui__:'))throw new Error('browser_ui_fast_back_unavailable');return {verified:true,fastExecuted:false};},
    finishTarget:async()=>({cleared:true}),
    snapshot:async()=>fallbackStates[Math.min(fallbackSnapshot++,fallbackStates.length-1)],
    runNativeInput:async(mode,value)=>{fallbackNative.push({mode,value});return {ok:true};},
    sleepImpl:async()=>{},verifyTimeoutMs:100,verifyIntervalMs:20
  });
  const fallback=await fallbackAdapter.execute('back');
  assert.equal(fallback.executionAudit.browserApiFastPath,false);
  assert.equal(fallback.executionAudit.fastAttempted,true);
  assert.match(fallback.executionAudit.fastError,/fast_back_unavailable/);
  assert.equal(fallback.executionAudit.nativeInputUsed,true);
  assert.equal(fallback.verified,true);
  assert.ok(String(fallbackFocus[0]).startsWith('__body_fast_browser_ui__:back:'));
  assert.equal(fallbackFocus[1],'back');
  assert.deepEqual(fallbackNative,[{mode:'combo',value:'Alt+ArrowLeft'}]);

  const state={};
  const tab={id:1,active:true,windowId:1,title:'about:blank',url:'about:blank',status:'complete'};
  const transports=[];
  const chromeApi={
    runtime:{id:'runtime-id',getManifest(){return {version:'0.7.0'};}},
    storage:{local:{async get(defaults){return {...defaults,...state};},async set(value){Object.assign(state,value);}}},
    tabs:{
      async query(){return [{...tab}];},
      async get(id){assert.equal(Number(id),1);return {...tab};},
      async update(id,patch){assert.equal(Number(id),1);Object.assign(tab,patch);transports.push('update');return {...tab};},
      async goBack(id){assert.equal(Number(id),1);tab.url='https://example.test/back';transports.push('back');},
      async goForward(id){assert.equal(Number(id),1);tab.url='https://example.test/forward';transports.push('forward');},
      async reload(id,options){assert.equal(Number(id),1);transports.push(options?.bypassCache?'hardreload':'reload');},
      async sendMessage(){return {ok:true,result:{available:false}};},
      onActivated:{addListener(){}},onUpdated:{addListener(){}},onRemoved:{addListener(){}}
    },
    windows:{async update(){return {focused:true};},async get(){return {focused:true};}}
  };
  let cdpInputCalls=0;
  const gateway={attachedTabs:new Set(),async sendInput(){cdpInputCalls++;return {ok:true};},async detach(){return {detached:true};}};
  const bridge=new DaemonBridge(chromeApi,{gateway,WebSocketImpl:function(){}});

  for(const [action,value,transport] of [
    ['address','https://www.youtube.com/','chrome.tabs.update'],
    ['back',null,'chrome.tabs.goBack'],
    ['forward',null,'chrome.tabs.goForward'],
    ['reload',null,'chrome.tabs.reload'],
    ['hardreload',null,'chrome.tabs.reload']
  ]){
    const fastRequest=fastBrowserUiRequest(action,value);
    const fast=await bridge.handle({type:'FOCUS_WINDOW',tabId:1,commandId:`fast-${action}`,browserAction:fastRequest});
    assert.equal(fast.fastExecuted,true,action);
    assert.equal(fast.fastTransport,transport,action);
    assert.equal(fast.browserAction,action);
  }

  assert.equal(cdpInputCalls,0);
  assert.deepEqual([...ALLOWED_METHODS].sort(),['Input.dispatchKeyEvent','Input.dispatchMouseEvent'].sort());
  assert.ok(transports.includes('update'));
  assert.ok(transports.includes('back'));
  assert.ok(transports.includes('forward'));
  assert.ok(transports.includes('reload'));
  assert.ok(transports.includes('hardreload'));

  console.log('browser_ui_fast_path_contract: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
