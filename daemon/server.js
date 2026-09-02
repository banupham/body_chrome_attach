'use strict';

const readline=require('node:readline');
const {WebSocketServer}=require('ws');
const {createDaemonRuntime}=require('./src/daemon_runtime');
const {createCommandRouter}=require('./src/command_router');
const {LocalAuth}=require('./src/local_auth');

const PORT=8765;
const PROTOCOL_VERSION=5;
let rl=null;
const prompt=()=>runtime.registry.selectedId?`BODY[${runtime.registry.selectedId.slice(0,8)}]> `:'BODY> ';
const printAsync=text=>{if(rl)process.stdout.write(`\n${text}\n${prompt()}`);};
const updatePrompt=()=>rl?.setPrompt(prompt());
const runtime=createDaemonRuntime({baseDir:__dirname,printAsync});
const router=createCommandRouter(runtime,{updatePrompt});
const auth=new LocalAuth(__dirname);
const clients=new Set();

const wss=new WebSocketServer({host:'127.0.0.1',port:PORT,verifyClient:({origin},done)=>!origin||origin.startsWith('chrome-extension://')?done(true):done(false,403,'Forbidden Origin')});
function rejectAuth(ws,error){runtime.send(ws,{type:'AUTH_ERROR',ok:false,error});try{ws.close(1008,'Authentication required');}catch{}}

wss.on('connection',(ws,request)=>{
  let role='unknown';const origin=String(request?.headers?.origin||'');
  ws.on('message',async raw=>{
    let msg;try{msg=JSON.parse(String(raw));}catch{return;}
    if(msg.type==='HELLO'){
      if(Number(msg.protocolVersion)!==PROTOCOL_VERSION){rejectAuth(ws,'protocol_version_mismatch');return;}
      const requestedRole=String(msg.role||'unknown');
      if(requestedRole==='extension'){
        const authResult=auth.authenticateExtension({extensionId:msg.extensionId,runtimeExtensionId:msg.runtimeExtensionId,token:msg.token,origin});
        if(!authResult.ok){rejectAuth(ws,authResult.error);return;}role='extension';
        if(authResult.paired)runtime.send(ws,{type:'AUTH_PAIRED',role:'extension',protocolVersion:PROTOCOL_VERSION,token:authResult.pairedToken});
        const extId=String(msg.extensionId||''),item=runtime.registry.register(extId,ws,msg);for(const t of msg.tabs||[])runtime.tabSites.set(runtime.ctx(extId,t.id),String(t.siteKey||'').toLowerCase());
        printAsync(`[ONLINE] extension=${extId} tabs=${item.tabs.size} auth=${authResult.paired?'paired':'verified'}`);runtime.requestExtension(extId,'RECORD_SET',{enabled:runtime.recordingEnabled}).catch(()=>{});updatePrompt();return;
      }
      if(requestedRole==='client'){
        if(!auth.authenticateClient(msg.token)){rejectAuth(ws,'client_token_invalid');return;}role='client';clients.add(ws);runtime.send(ws,{type:'HELLO_ACK',role:'client',protocolVersion:PROTOCOL_VERSION,authenticated:true});return;
      }
      rejectAuth(ws,'unsupported_role');return;
    }
    if(role==='unknown')return;
    if(role==='extension'){
      const item=runtime.registry.bySocket(ws);if(!item)return;const extId=item.extensionId;runtime.registry.touch(extId);if(runtime.resolveResponse(extId,msg))return;
      if(msg.type==='RECORDER_EVENT'){runtime.recorderEvent(extId,msg);return;}if(msg.type==='TAB_EVENT'){runtime.tabEvent(extId,msg.event||{});return;}if(msg.type==='TAB_CONTEXT'){runtime.tabContext(extId,msg);return;}if(msg.type==='TAB_REMOVED'){runtime.tabRemoved(extId,msg.tabId);return;}return;
    }
    if(role==='client'){
      try{
        let result,type;if(msg.type==='COMMAND'){result=await router.runCommand(msg.command);type='COMMAND_RESULT';}
        else if(msg.type==='INTENT_EXECUTE'){result=await runtime.executeIntent(msg.intent,{extensionId:msg.extensionId||null,tabId:msg.tabId||'active'});type='INTENT_RESULT';}
        else if(msg.type==='STRATEGY_EXECUTE'){result=await runtime.executeStrategy(msg.task,{extensionId:msg.extensionId||null,tabId:msg.tabId||'active'});type='STRATEGY_RESULT';}
        else if(msg.type==='TAB_SWITCH'){result=await runtime.switchTab(msg.extensionId||null,msg.tabId);type='TAB_SWITCH_RESULT';}
        else if(msg.type==='BROWSER_COMMAND'){result=await runtime.executeBrowserCommand(msg.action,{extensionId:msg.extensionId||null,tabId:msg.tabId||'active',value:msg.value??null});type='BROWSER_COMMAND_RESULT';}
        else return;runtime.send(ws,{type,requestId:msg.requestId||null,ok:true,result});
      }catch(error){runtime.send(ws,{type:'CLIENT_ERROR',requestId:msg.requestId||null,ok:false,error:String(error?.message||error)});}
    }
  });
  ws.on('close',()=>{const extId=runtime.registry.unregisterSocket(ws);if(extId){printAsync(`[OFFLINE] extension=${extId}`);updatePrompt();}clients.delete(ws);});
});
function flushStores(){for(const scope of runtime.learning.cache.values()){try{scope.store.flushSync();}catch{}}}
process.once('SIGINT',()=>{flushStores();process.exit(0);});process.once('SIGTERM',()=>{flushStores();process.exit(0);});process.once('exit',flushStores);
console.log(`Learned Body daemon: ws://127.0.0.1:${PORT}`);console.log(`Local client auth: ${auth.status().clientTokenPath}`);console.log('Canonical page motor + buffered learning + persistent Browser UI worker. Gõ help để xem lệnh.');
rl=readline.createInterface({input:process.stdin,output:process.stdout,prompt:prompt()});rl.prompt();
rl.on('line',async line=>{try{const out=await router.runCommand(line);if(out!==null)console.log(typeof out==='string'?out:JSON.stringify(out,null,2));}catch(error){console.log('[LỖI]',String(error?.message||error));}updatePrompt();rl.prompt();});
module.exports={runtime,router,wss,auth};
