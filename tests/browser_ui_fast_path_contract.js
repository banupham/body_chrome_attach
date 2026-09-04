'use strict';

const assert=require('node:assert/strict');
const {BrowserUiAdapter,fastBrowserUiRequest}=require('../daemon/src/browser_ui_adapter');
const {DaemonBridge,parseFastBrowserUiAction}=require('../src/daemon_bridge');

(async()=>{
  const request=fastBrowserUiRequest('address','https://www.youtube.com/');
  assert.ok(request.startsWith('__body_fast_browser_ui__:address:'));
  assert.deepEqual(parseFastBrowserUiAction(request),{action:'address',value:'https://www.youtube.com/'});

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

  const state={};
  const tab={id:1,active:true,windowId:1,title:'about:blank',url:'about:blank',status:'complete'};
  const chromeApi={
    runtime:{id:'runtime-id',getManifest(){return {version:'0.7.0'};}},
    storage:{local:{async get(defaults){return {...defaults,...state};},async set(value){Object.assign(state,value);}}},
    tabs:{
      async query(){return [tab];},
      async get(id){assert.equal(Number(id),1);return {...tab};},
      async update(id,patch){assert.equal(Number(id),1);Object.assign(tab,patch);if(patch.url)tab.title=patch.url.includes('youtube.com')?'YouTube':tab.title;return {...tab};},
      async sendMessage(){return {ok:true,result:{available:false}};},
      onActivated:{addListener(){}},onUpdated:{addListener(){}},onRemoved:{addListener(){}}
    },
    windows:{async update(){return {focused:true};},async get(){return {focused:true};}}
  };
  let cdpInputCalls=0;
  const gateway={attachedTabs:new Set(),async sendInput(){cdpInputCalls++;return {ok:true};},async detach(){return {detached:true};}};
  const bridge=new DaemonBridge(chromeApi,{gateway,WebSocketImpl:function(){}});
  const fast=await bridge.handle({type:'FOCUS_WINDOW',tabId:1,commandId:'fast-address-1',browserAction:request});
  assert.equal(fast.fastExecuted,true);
  assert.equal(fast.fastTransport,'chrome.tabs.update');
  assert.equal(fast.browserAction,'address');
  assert.equal(fast.siteKey,'www.youtube.com');
  assert.equal(tab.url,'https://www.youtube.com/');
  assert.equal(cdpInputCalls,0);

  console.log('browser_ui_fast_path_contract: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
