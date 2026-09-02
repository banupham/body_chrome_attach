'use strict';

const readline=require('node:readline');
const {WebSocketServer}=require('ws');
const {createDaemonRuntime}=require('./src/daemon_runtime');
const {createCommandRouter}=require('./src/command_router');

const PORT=8765;
let rl=null;
const prompt=()=>runtime.registry.selectedId?`BODY[${runtime.registry.selectedId.slice(0,8)}]> `:'BODY> ';
const printAsync=text=>{if(rl)process.stdout.write(`\n${text}\n${prompt()}`);};
const updatePrompt=()=>rl?.setPrompt(prompt());
const runtime=createDaemonRuntime({baseDir:__dirname,printAsync});
const router=createCommandRouter(runtime,{updatePrompt});
const clients=new Set();

const wss=new WebSocketServer({
  host:'127.0.0.1',port:PORT,
  verifyClient:({origin},done)=>!origin||origin.startsWith('chrome-extension://')?done(true):done(false,403,'Forbidden Origin')
});

wss.on('connection',ws=>{
  let role='unknown';
  ws.on('message',async raw=>{
    let msg;try{msg=JSON.parse(String(raw));}catch{return;}
    if(msg.type==='HELLO'){
      role=msg.role||'unknown';
      if(role==='extension'){
        const extId=String(msg.extensionId||'');
        const item=runtime.registry.register(extId,ws,msg);
        for(const t of msg.tabs||[])runtime.tabSites.set(runtime.ctx(extId,t.id),String(t.siteKey||'').toLowerCase());
        printAsync(`[ONLINE] extension=${extId} tabs=${item.tabs.size}`);
        runtime.requestExtension(extId,'RECORD_SET',{enabled:runtime.recordingEnabled}).catch(()=>{});updatePrompt();return;
      }
      if(role==='client'){
        clients.add(ws);runtime.send(ws,{type:'HELLO_ACK',role:'client',protocolVersion:4});return;
      }
    }
    if(role==='extension'){
      const item=runtime.registry.bySocket(ws);if(!item)return;const extId=item.extensionId;runtime.registry.touch(extId);
      if(runtime.resolveResponse(extId,msg))return;
      if(msg.type==='RECORDER_EVENT'){runtime.recorderEvent(extId,msg);return;}
      if(msg.type==='TAB_EVENT'){runtime.tabEvent(extId,msg.event||{});return;}
      if(msg.type==='TAB_CONTEXT'){runtime.tabContext(extId,msg);return;}
      if(msg.type==='TAB_REMOVED'){runtime.tabRemoved(extId,msg.tabId);return;}
      return;
    }
    if(role==='client'){
      try{
        let result,type;
        if(msg.type==='COMMAND'){result=await router.runCommand(msg.command);type='COMMAND_RESULT';}
        else if(msg.type==='INTENT_EXECUTE'){result=await runtime.executeIntent(msg.intent,{extensionId:msg.extensionId||null,tabId:msg.tabId||'active'});type='INTENT_RESULT';}
        else if(msg.type==='STRATEGY_EXECUTE'){result=await runtime.executeStrategy(msg.task,{extensionId:msg.extensionId||null,tabId:msg.tabId||'active'});type='STRATEGY_RESULT';}
        else if(msg.type==='TAB_SWITCH'){result=await runtime.switchTab(msg.extensionId||null,msg.tabId);type='TAB_SWITCH_RESULT';}
        else if(msg.type==='BROWSER_COMMAND'){result=await runtime.executeBrowserCommand(msg.action,{extensionId:msg.extensionId||null,tabId:msg.tabId||'active',value:msg.value??null});type='BROWSER_COMMAND_RESULT';}
        else return;
        runtime.send(ws,{type,requestId:msg.requestId||null,ok:true,result});
      }catch(error){runtime.send(ws,{type:'CLIENT_ERROR',requestId:msg.requestId||null,ok:false,error:String(error?.message||error)});}
    }
  });
  ws.on('close',()=>{
    const extId=runtime.registry.unregisterSocket(ws);if(extId){printAsync(`[OFFLINE] extension=${extId}`);updatePrompt();}
    clients.delete(ws);
  });
});

console.log(`Learned Body daemon: ws://127.0.0.1:${PORT}`);
console.log('Multi-extension + multi-tab + per-site learning + verified semantic Browser UI. Gõ help để xem lệnh.');
rl=readline.createInterface({input:process.stdin,output:process.stdout,prompt:prompt()});rl.prompt();
rl.on('line',async line=>{try{const out=await router.runCommand(line);if(out!==null)console.log(typeof out==='string'?out:JSON.stringify(out,null,2));}catch(error){console.log('[LỖI]',String(error?.message||error));}updatePrompt();rl.prompt();});

module.exports={runtime,router,wss};
