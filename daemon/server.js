'use strict';

const readline=require('node:readline');
const {WebSocketServer}=require('ws');
const {createDaemonRuntime}=require('./src/daemon_runtime');
const {createCommandRouter}=require('./src/command_router');
const {LocalAuth}=require('./src/local_auth');
const {ControllerLease}=require('./src/controller_lease');

const PORT=8765;
const CONTROL_PROTOCOL_VERSION=6;
const EXTENSION_PROTOCOL_VERSIONS=new Set([5,6]);
let rl=null;

const prompt=()=>runtime.registry.selectedId?`BODY[${runtime.registry.selectedId.slice(0,8)}]> `:'BODY> ';
const printAsync=text=>{if(rl)process.stdout.write(`\n${text}\n${prompt()}`);};
const updatePrompt=()=>rl?.setPrompt(prompt());
const runtime=createDaemonRuntime({baseDir:__dirname,printAsync});
const router=createCommandRouter(runtime,{updatePrompt});
const auth=new LocalAuth(__dirname);
const controller=new ControllerLease();
const debugClients=new Set();

const wss=new WebSocketServer({host:'127.0.0.1',port:PORT,verifyClient:({origin},done)=>!origin||origin.startsWith('chrome-extension://')?done(true):done(false,403,'Forbidden Origin')});
function rejectAuth(ws,error){runtime.send(ws,{type:'AUTH_ERROR',ok:false,error});try{ws.close(1008,'Authentication required');}catch{}}
function brainSend(type,payload={}){if(!controller.brainSocket)return false;return runtime.send(controller.brainSocket,{type,...payload});}
function protocolAllowed(role,version){const v=Number(version);return role==='extension'?EXTENSION_PROTOCOL_VERSIONS.has(v):v===CONTROL_PROTOCOL_VERSION;}

async function handleBrainMessage(ws,msg){
  let result,type;
  if(msg.type==='BODY_STATUS'){
    result={controller:controller.status(),extensions:runtime.registry.list(),recordingEnabled:runtime.recordingEnabled,learningEnabled:runtime.learningEnabled};type='BODY_STATUS_RESULT';
  }else if(msg.type==='EXTENSIONS_LIST'){
    result=runtime.registry.list();type='EXTENSIONS_LIST_RESULT';
  }else if(msg.type==='TABS_LIST'){
    const extId=runtime.selected(msg.extensionId||null);result=await runtime.refreshTabs(extId);type='TABS_LIST_RESULT';
  }else if(msg.type==='INTENT_EXECUTE'){
    result=await runtime.executeIntent(msg.intent,{extensionId:msg.extensionId||null,tabId:msg.tabId||'active'});type='INTENT_RESULT';
  }else if(msg.type==='STRATEGY_EXECUTE'){
    result=await runtime.executeStrategy(msg.task,{extensionId:msg.extensionId||null,tabId:msg.tabId||'active'});type='STRATEGY_RESULT';
  }else if(msg.type==='TAB_SWITCH'){
    result=await runtime.switchTab(msg.extensionId||null,msg.tabId);type='TAB_SWITCH_RESULT';
  }else if(msg.type==='BROWSER_COMMAND'){
    result=await runtime.executeBrowserCommand(msg.action,{extensionId:msg.extensionId||null,tabId:msg.tabId||'active',value:msg.value??null});type='BROWSER_COMMAND_RESULT';
  }else return false;
  runtime.send(ws,{type,requestId:msg.requestId||null,ok:true,result});
  return true;
}

wss.on('connection',(ws,request)=>{
  let role='unknown';
  const origin=String(request?.headers?.origin||'');

  ws.on('message',async raw=>{
    let msg;try{msg=JSON.parse(String(raw));}catch{return;}

    if(msg.type==='HELLO'){
      const requestedRole=String(msg.role||'unknown');
      if(!protocolAllowed(requestedRole,msg.protocolVersion)){rejectAuth(ws,'protocol_version_mismatch');return;}

      if(requestedRole==='extension'){
        const authResult=auth.authenticateExtension({extensionId:msg.extensionId,runtimeExtensionId:msg.runtimeExtensionId,token:msg.token,origin});
        if(!authResult.ok){rejectAuth(ws,authResult.error);return;}
        role='extension';
        if(authResult.paired)runtime.send(ws,{type:'AUTH_PAIRED',role:'extension',protocolVersion:Number(msg.protocolVersion),token:authResult.pairedToken});
        const extId=String(msg.extensionId||'');
        const item=runtime.registry.register(extId,ws,msg);
        for(const t of msg.tabs||[])runtime.tabSites.set(runtime.ctx(extId,t.id),String(t.siteKey||'').toLowerCase());
        printAsync(`[ONLINE] extension=${extId} tabs=${item.tabs.size} auth=${authResult.paired?'paired':'verified'}`);
        runtime.requestExtension(extId,'RECORD_SET',{enabled:runtime.recordingEnabled}).catch(()=>{});
        updatePrompt();
        brainSend('BODY_EVENT',{event:{eventType:'extensionOnline',extensionId:extId,tabCount:item.tabs.size,ts:Date.now()}});
        return;
      }

      if(requestedRole==='brain'){
        if(!auth.authenticateBrain(msg.token)){rejectAuth(ws,'brain_token_invalid');return;}
        try{controller.attachBrain(ws,{controllerId:msg.controllerId||'brain'});}catch(error){rejectAuth(ws,String(error?.message||error));return;}
        role='brain';
        runtime.send(ws,{type:'HELLO_ACK',role:'brain',protocolVersion:CONTROL_PROTOCOL_VERSION,authenticated:true,controller:controller.status()});
        printAsync('[BRAIN] controller attached');
        return;
      }

      if(requestedRole==='debug_client'){
        if(!auth.authenticateDebugClient(msg.token)){rejectAuth(ws,'debug_client_token_invalid');return;}
        role='debug_client';debugClients.add(ws);
        runtime.send(ws,{type:'HELLO_ACK',role:'debug_client',protocolVersion:CONTROL_PROTOCOL_VERSION,authenticated:true,controller:controller.status()});
        return;
      }

      rejectAuth(ws,'unsupported_role');
      return;
    }

    if(role==='unknown')return;

    if(role==='extension'){
      const item=runtime.registry.bySocket(ws);if(!item)return;
      const extId=item.extensionId;runtime.registry.touch(extId);
      if(runtime.resolveResponse(extId,msg))return;
      if(msg.type==='RECORDER_EVENT'){runtime.recorderEvent(extId,msg);return;}
      if(msg.type==='TAB_EVENT'){runtime.tabEvent(extId,msg.event||{});brainSend('BODY_EVENT',{event:{...msg.event,extensionId:extId}});return;}
      if(msg.type==='TAB_CONTEXT'){runtime.tabContext(extId,msg);brainSend('BODY_EVENT',{event:{eventType:'tabContext',extensionId:extId,tabId:msg.tabId,context:msg.context,ts:Date.now()}});return;}
      if(msg.type==='TAB_REMOVED'){runtime.tabRemoved(extId,msg.tabId);brainSend('BODY_EVENT',{event:{eventType:'tabRemoved',extensionId:extId,tabId:msg.tabId,ts:Date.now()}});return;}
      return;
    }

    if(role==='brain'){
      try{await handleBrainMessage(ws,msg);}catch(error){runtime.send(ws,{type:'BRAIN_ERROR',requestId:msg.requestId||null,ok:false,error:String(error?.message||error)});}return;
    }

    if(role==='debug_client'){
      if(msg.type!=='COMMAND')return;
      try{
        const result=await router.runCommand(msg.command,{assertControl:()=>controller.assertDebugControlAllowed()});
        runtime.send(ws,{type:'COMMAND_RESULT',requestId:msg.requestId||null,ok:true,result});
      }catch(error){runtime.send(ws,{type:'CLIENT_ERROR',requestId:msg.requestId||null,ok:false,error:String(error?.message||error)});}
    }
  });

  ws.on('close',()=>{
    const extId=runtime.registry.unregisterSocket(ws);
    if(extId){printAsync(`[OFFLINE] extension=${extId}`);updatePrompt();brainSend('BODY_EVENT',{event:{eventType:'extensionOffline',extensionId:extId,ts:Date.now()}});}
    if(controller.detachSocket(ws))printAsync('[BRAIN] controller detached; Body continues observing/learning.');
    debugClients.delete(ws);
  });
});

function flushStores(){
  try{runtime.learning.flushSync();}catch{}
  try{runtime.tabHabit.flushSync();}catch{}
}
process.once('SIGINT',()=>{flushStores();process.exit(0);});
process.once('SIGTERM',()=>{flushStores();process.exit(0);});
process.once('exit',flushStores);

console.log(`Body runtime transport: ws://127.0.0.1:${PORT}`);
console.log(`Brain auth token: ${auth.status().brainTokenPath}`);
console.log(`Debug client token: ${auth.status().debugClientTokenPath}`);
console.log('daemon.cmd = Body runtime. CMD input is diagnostic/test only. Brain becomes the exclusive controller when attached.');

rl=readline.createInterface({input:process.stdin,output:process.stdout,prompt:prompt()});
rl.prompt();
rl.on('line',async line=>{
  try{
    const out=await router.runCommand(line,{assertControl:()=>controller.assertDebugControlAllowed()});
    if(out!==null)console.log(typeof out==='string'?out:JSON.stringify(out,null,2));
  }catch(error){console.log('[LỖI]',String(error?.message||error));}
  updatePrompt();rl.prompt();
});

module.exports={runtime,router,wss,auth,controller,handleBrainMessage,CONTROL_PROTOCOL_VERSION,EXTENSION_PROTOCOL_VERSIONS,protocolAllowed,flushStores};
