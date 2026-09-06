'use strict';

const assert=require('node:assert/strict');
const {DaemonBridge,ALLOWED_METHODS}=require('../src/daemon_bridge');

(async()=>{
  const sent=[];const listeners={};
  const before={available:true,platform:'youtube',observerVersion:1,observedAt:100,privacy:{searchQueryCaptured:false,accountIdentityCaptured:false,textContentCaptured:false},route:{supported:true,pageType:'home',path:'/',searchQueryPresent:false},controls:{searchInput:{available:true,visible:true,active:true,tag:'input',actionRect:{x:1,y:1,width:100,height:20}},searchButton:{available:true,visible:true,active:false,tag:'button',actionRect:{x:105,y:1,width:30,height:20}}},surfaces:[],viewport:{width:1200,height:700}};
  const after={...before,observedAt:200,route:{supported:true,pageType:'search',path:'/results',searchQueryPresent:true},controls:{...before.controls,searchInput:{...before.controls.searchInput,active:false}},surfaces:[{surface:'search_results',itemCount:3}]};
  let semantic=before;
  const chromeApi={
    runtime:{id:'runtime-a',getManifest(){return {version:'0.7.0'};}},
    storage:{local:{async get(defaults){return defaults;},async set(){}}},
    tabs:{
      async query(){return [{id:1,active:true,windowId:1,url:'https://www.youtube.com/',title:'YouTube'}];},
      async get(){return {id:1,active:true,windowId:1,url:'https://www.youtube.com/',title:'YouTube'};},
      async sendMessage(_id,message){
        if(message.action==='body.targetContextAt')return {ok:true,result:{tag:'input',role:'searchbox',inputType:'text',editable:true,sensitive:false,rect:{x:1,y:1,width:100,height:20}}};
        if(message.action==='body.semanticObservation')return {ok:true,result:semantic};
        if(message.action==='body.pageObservation')return {ok:true,result:{available:false}};
        return {ok:false};
      },
      onActivated:{addListener(fn){listeners.activated=fn;}},
      onUpdated:{addListener(fn){listeners.updated=fn;}},
      onRemoved:{addListener(fn){listeners.removed=fn;}}
    }
  };
  const gateway={attachedTabs:new Set(),async sendInput(){throw new Error('CDP input must not be used by semantic observation');},async detach(){}};
  const bridge=new DaemonBridge(chromeApi,{gateway,WebSocketImpl:function(){}});
  bridge.browserInstanceId='browser-a';bridge.extensionInstanceId='ext-a';
  bridge.socket={readyState:1,send(raw){sent.push(JSON.parse(String(raw)));}};

  const delivered=await bridge.forwardUserMotor(1,{source:'USER',kind:'keyboard',event:{type:'keydown',key:'Enter',code:'Enter',at:101},context:{tag:'input',role:'searchbox'},url:'https://www.youtube.com/'});
  assert.equal(delivered,true);
  const recorder=sent.find(row=>row.type==='RECORDER_EVENT');
  assert.ok(recorder);
  assert.equal(recorder.event.source,'human');
  assert.equal(recorder.event.isTrusted,true);
  assert.equal(recorder.event.semanticBefore.platform,'youtube');
  assert.equal(recorder.event.semanticBefore.controls.searchInput.active,true);

  bridge.installTabListeners();semantic=after;
  listeners.updated(1,{status:'complete'},{id:1,url:'https://www.youtube.com/results?search_query=private',title:'Results',windowId:1,status:'complete'});
  await new Promise(resolve=>setImmediate(resolve));
  const observation=sent.find(row=>row.type==='SEMANTIC_OBSERVATION');
  assert.ok(observation);
  assert.equal(observation.observation.route.pageType,'search');
  assert.equal(JSON.stringify(observation.observation).includes('private'),false);
  assert.deepEqual([...ALLOWED_METHODS].sort(),['Input.dispatchKeyEvent','Input.dispatchMouseEvent'].sort());

  console.log('semantic_evidence_bridge_contract: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
