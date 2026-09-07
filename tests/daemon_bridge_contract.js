'use strict';

const assert=require('node:assert/strict');
const {DaemonBridge,siteKeyFromUrl,observedEffect,PROTOCOL_VERSION}=require('../src/daemon_bridge');
function chromeStub(){
  const state={},sessionState={},tabListeners={onActivated:[],onUpdated:[],onRemoved:[]};let contextQueries=0;
  const tab={id:1,active:true,windowId:1,title:'Example',url:'https://example.com/path',status:'complete'};
  return {
    state,sessionState,tabListeners,get contextQueries(){return contextQueries;},
    runtime:{id:'runtime-id',getManifest(){return {version:'0.5.0'};}},
    storage:{
      local:{async get(defaults){return {...defaults,...state};},async set(v){Object.assign(state,v);}},
      session:{async get(defaults){return {...defaults,...sessionState};},async set(v){Object.assign(sessionState,v);},async remove(key){delete sessionState[key];}}
    },
    tabs:{async query(){return [tab];},async get(){return tab;},async update(){return tab;},async sendMessage(_id,message){if(message.action==='body.targetContextAt'){contextQueries++;return {ok:true,result:{tag:'input',role:'textbox',inputType:'text',editable:true,sensitive:false,rect:{x:0,y:0,width:100,height:20}}};}if(message.action==='body.pageObservation')return {ok:true,result:{available:true,hasFocus:true,visibilityState:'visible',activeTarget:{tag:'input',role:'textbox',editable:true,sensitive:false,rect:{x:0,y:0,width:100,height:20}},scrollX:0,scrollY:0,viewport:{width:800,height:600}}};return {ok:true};},onActivated:{addListener(fn){tabListeners.onActivated.push(fn);}},onUpdated:{addListener(fn){tabListeners.onUpdated.push(fn);}},onRemoved:{addListener(fn){tabListeners.onRemoved.push(fn);}}},
    windows:{async update(){return {focused:true};},async get(){return {focused:true};}}
  };
}
(async()=>{
  assert.equal(PROTOCOL_VERSION,5);const sent=[];const chromeApi=chromeStub();const gateway={attachedTabs:new Set(),async sendInput(tabId,method,params){sent.push({tabId,method,params});return {ok:true};},async detach(){return {detached:true};}};const bridge=new DaemonBridge(chromeApi,{gateway,WebSocketImpl:function(){}});
  const firstIdentity=await bridge.identity();assert.ok(firstIdentity.browserInstanceId.startsWith('browser-'));assert.ok(firstIdentity.extensionInstanceId);assert.notEqual(firstIdentity.browserInstanceId,firstIdentity.extensionInstanceId);
  const bridgeReloaded=new DaemonBridge(chromeApi,{gateway,WebSocketImpl:function(){}});const secondIdentity=await bridgeReloaded.identity();assert.equal(secondIdentity.browserInstanceId,firstIdentity.browserInstanceId);assert.equal(secondIdentity.extensionInstanceId,firstIdentity.extensionInstanceId);
  bridge.socket={readyState:1,send(raw){sent.push(JSON.parse(raw));}};
  assert.equal(siteKeyFromUrl('https://Sub.Example.com/a'),'sub.example.com');
  bridge.installTabListeners();
  sent.length=0;chromeApi.tabListeners.onUpdated[0](1,{status:'complete'},{id:1,active:true,windowId:1,title:'about:blank',url:'about:blank',status:'complete'});assert.equal(sent.some(x=>x.type==='TAB_CONTEXT'),false,'masked about: metadata must not overwrite observed web context');
  chromeApi.tabListeners.onUpdated[0](1,{url:'https://example.com/next'},{id:1,active:true,windowId:1,title:'Next',url:'https://example.com/next',status:'complete'});const webContext=sent.find(x=>x.type==='TAB_CONTEXT');assert.ok(webContext);assert.equal(webContext.context.siteKey,'example.com');assert.equal(webContext.context.contextSource,'chrome_tabs');assert.equal(webContext.context.urlScheme,'https:');
  sent.length=0;
  await bridge.forwardUserMotor(1,{source:'USER',kind:'pointer',url:'https://example.com/a',event:{type:'mouseMoved',x:10,y:20,at:100},context:{}});assert.equal(chromeApi.contextQueries,0);
  const humanPointer=await bridge.handle({type:'POINTER_STATUS',tabId:1});assert.equal(humanPointer.known,true);assert.deepEqual([humanPointer.x,humanPointer.y],[10,20]);assert.equal(humanPointer.source,'human');
  const pointerReloaded=new DaemonBridge(chromeApi,{gateway,WebSocketImpl:function(){}});const cachedPointer=await pointerReloaded.handle({type:'POINTER_STATUS',tabId:1});assert.equal(cachedPointer.known,true);assert.deepEqual([cachedPointer.x,cachedPointer.y],[10,20]);assert.equal(cachedPointer.source,'human');
  await bridge.forwardUserMotor(1,{source:'USER',kind:'pointer',url:'https://example.com/a',event:{type:'mousePressed',x:10,y:20,at:110},context:{}});assert.equal(chromeApi.contextQueries,1);
  await bridge.forwardUserMotor(1,{source:'USER',kind:'keyboard',url:'https://example.com/a',event:{type:'keydown',key:'a',code:'KeyA',at:120},context:{}});assert.equal(chromeApi.contextQueries,2);const keyboard=sent.find(x=>x.type==='RECORDER_EVENT'&&x.event?.keyClass==='alpha');assert.equal(keyboard.event.key,null);assert.equal(keyboard.browserInstanceId,firstIdentity.browserInstanceId);
  sent.length=0;const result=await bridge.executePlan({commandId:'c1',tabId:1,plan:{executionCapability:'HUMAN_MOTOR',steps:[{method:'Input.dispatchMouseEvent',delayMs:0,params:{type:'mouseMoved',x:30,y:40,button:'none'}}]}});assert.equal(result.delivered,true);assert.equal(result.observed,true);assert.equal(result.taskSuccess,null);assert.ok(result.observedEffect);assert.equal(sent.some(x=>x.method==='Input.dispatchMouseEvent'),true);
  const agentPointer=await bridge.handle({type:'POINTER_STATUS',tabId:1});assert.equal(agentPointer.known,true);assert.deepEqual([agentPointer.x,agentPointer.y],[30,40]);assert.equal(agentPointer.source,'agent');
  const agentReloaded=new DaemonBridge(chromeApi,{gateway,WebSocketImpl:function(){}});const cachedAgentPointer=await agentReloaded.handle({type:'POINTER_STATUS',tabId:1});assert.deepEqual([cachedAgentPointer.x,cachedAgentPointer.y],[30,40]);assert.equal(cachedAgentPointer.source,'agent');
  await assert.rejects(()=>bridge.executePlan({tabId:1,plan:{executionCapability:'HUMAN_MOTOR',steps:[{method:'Runtime.evaluate',params:{}}]}}),/forbidden_method/);
  await bridge.handle({type:'READINESS_STATUS',status:{state:'READY',reason:null}});assert.equal(bridge.readinessStatus.state,'READY');assert.equal(bridge.status().readinessStatus.state,'READY');
  const ping=await bridge.handle({type:'PING'});assert.equal(ping.browserInstanceId,firstIdentity.browserInstanceId);assert.equal(ping.extensionInstanceId,firstIdentity.extensionInstanceId);
  const effect=observedEffect({navigationToken:'a',navigationEpoch:1,page:{available:true,activeTarget:{tag:'body'},scrollX:0,scrollY:0,hasFocus:true,visibilityState:'visible'}},{navigationToken:'b',navigationEpoch:2,page:{available:true,activeTarget:{tag:'input'},scrollX:0,scrollY:10,hasFocus:true,visibilityState:'visible'}});assert.equal(effect.navigationChanged,true);assert.equal(effect.activeTargetChanged,true);assert.equal(effect.scrollChanged,true);assert.equal(effect.changed,true);
  const legacyChrome=chromeStub();legacyChrome.state.bodyDaemonExtensionInstanceId='legacy-extension';const legacyBridge=new DaemonBridge(legacyChrome,{gateway,WebSocketImpl:function(){}});const legacyIdentity=await legacyBridge.identity();assert.equal(legacyIdentity.browserInstanceId,'browser-legacy-extension');
  console.log('daemon_bridge_contract: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
