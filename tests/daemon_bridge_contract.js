'use strict';

const assert=require('node:assert/strict');
const {DaemonBridge,siteKeyFromUrl}=require('../src/daemon_bridge');

function chromeStub(){
  const state={};
  const tabListeners={onActivated:[],onUpdated:[],onRemoved:[]};
  return {
    state,
    runtime:{id:'runtime-id',getManifest(){return {version:'0.2.0'};}},
    storage:{local:{async get(defaults){return {...defaults,...state};},async set(v){Object.assign(state,v);}}},
    tabs:{
      async query(){return [{id:1,active:true,windowId:1,title:'Example',url:'https://example.com/path'}];},
      async get(){return {id:1,active:true,windowId:1,title:'Example',url:'https://example.com/path'};},
      async update(){return {};},async sendMessage(){return {ok:true};},
      onActivated:{addListener(fn){tabListeners.onActivated.push(fn);}},onUpdated:{addListener(fn){tabListeners.onUpdated.push(fn);}},onRemoved:{addListener(fn){tabListeners.onRemoved.push(fn);}}
    },
    windows:{async update(){return {};}}
  };
}

(async()=>{
  const sent=[];const chromeApi=chromeStub();
  const gateway={attachedTabs:new Set(),async sendInput(tabId,method,params){sent.push({tabId,method,params});return {ok:true};},async detach(){return {detached:true};}};
  const bridge=new DaemonBridge(chromeApi,{gateway,WebSocketImpl:function(){}});bridge.extensionInstanceId='ext-test';bridge.socket={readyState:1,send(raw){sent.push(JSON.parse(raw));}};

  assert.equal(siteKeyFromUrl('https://Sub.Example.com/a'),'sub.example.com');
  await bridge.forwardUserMotor(1,{source:'USER',kind:'pointer',url:'https://example.com/a',event:{type:'mouseMoved',x:10,y:20,at:100},context:{tag:'button',role:'button'}});
  assert.equal(sent[0].type,'RECORDER_EVENT');assert.equal(sent[0].event.source,'human');
  sent.length=0;
  await bridge.forwardUserMotor(1,{source:'USER',kind:'keyboard',url:'https://example.com/a',event:{type:'keydown',key:'a',code:'KeyA',at:120},context:{tag:'input',role:'textbox'}});
  assert.equal(sent[0].event.key,null);assert.equal(sent[0].event.keyClass,'alpha');

  const result=await bridge.executePlan({commandId:'c1',tabId:1,plan:{executionCapability:'HUMAN_MOTOR',steps:[{method:'Input.dispatchMouseEvent',delayMs:0,params:{type:'mouseMoved',x:30,y:40,button:'none'}}]}});
  assert.equal(result.completedStepCount,1);assert.equal(sent.some(x=>x.method==='Input.dispatchMouseEvent'),true);assert.equal(sent.some(x=>x.type==='RECORDER_EVENT'&&x.event?.source==='agent'),true);
  await assert.rejects(()=>bridge.executePlan({tabId:1,plan:{executionCapability:'HUMAN_MOTOR',steps:[{method:'Runtime.evaluate',params:{}}]}}),/forbidden_method/);
  console.log('daemon_bridge_contract: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
