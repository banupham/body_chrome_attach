'use strict';

const readline=require('node:readline');
const {WebSocketServer}=require('ws');
const {createDaemonRuntime}=require('./src/daemon_runtime');
const {createCommandRouter}=require('./src/command_router');
const {LocalAuth}=require('./src/local_auth');
const {ControllerLease}=require('./src/controller_lease');

const PORT=8765;
const CONTROL_PROTOCOL_VERSION=7;
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
function browserIdFromHello(msg){const explicit=String(msg.browserInstanceId||'').trim();if(explicit)return explicit;const extensionId=String(msg.extensionId||'').trim();if(Number(msg.protocolVersion)===5&&extensionId)return `browser-${extensionId}`;return '';}
function requireTaskId(msg){const id=String(msg.taskId||'').trim();if(!id)throw new Error('brain_task_id_required');return id;}

async function handleBrainMessage(ws,msg){
  let result,type;
  if(msg.type==='BODY_STATUS'){result={identity:runtime.identity.snapshot(),controller:controller.status(),browsers:runtime.browsers.list(),tasks:runtime.tasks.list(),extensions:runtime.registry.list(),recordingEnabled:runtime.recordingEnabled,learningEnabled:runtime.learningEnabled,execution:runtime.execution.status()};type='BODY_STATUS_RESULT';}
  else if(msg.type==='EXTENSIONS_LIST'){result=runtime.registry.list();type='EXTENSIONS_LIST_RESULT';}
  else if(msg.type==='BROWSERS_LIST'){result=runtime.browsers.list();type='BROWSERS_LIST_RESULT';}
  else if(msg.type==='TASKS_LIST'){result=runtime.tasks.list();type='TASKS_LIST_RESULT';}
  else if(msg.type==='TASK_GET'){result=runtime.tasks.public(runtime.tasks.get(msg.taskId));type='TASK_RESULT';}
  else if(msg.type==='TABS_LIST'){const extId=runtime.selected(msg.extensionId||null);result=await runtime.refreshTabs(extId);type='TABS_LIST_RESULT';}
  else if(msg.type==='TASK_CREATE'){result=runtime.tasks.create(msg.task||{});type='TASK_RESULT';}
  else if(msg.type==='TASK_APPROVE'){result=runtime.tasks.approve(msg.taskId);type='TASK_RESULT';}
  else if(msg.type==='TASK_START'){result=runtime.tasks.start(msg.taskId);type='TASK_RESULT';}
  else if(msg.type==='TASK_COMPLETE'){result=runtime.tasks.finish(msg.taskId,'COMPLETED',msg.result??null);type='TASK_RESULT';}
  else if(msg.type==='TASK_FAIL'){result=runtime.tasks.finish(msg.taskId,'FAILED',msg.error??'task_failed');type='TASK_RESULT';}
  else if(msg.type==='TASK_CANCEL'){result=runtime.tasks.finish(msg.taskId,'CANCELLED',msg.reason??'cancelled');type='TASK_RESULT';}
  else if(msg.type==='INTENT_EXECUTE'){result=await runtime.executeTaskIntent(requireTaskId(msg),msg.intent,{tabId:msg.tabId??'primary'});type='INTENT_RESULT';}
  else if(msg.type==='STRATEGY_EXECUTE'){result=await runtime.executeTaskStrategy(requireTaskId(msg),msg.strategy||msg.taskStrategy||msg.task,{tabId:msg.tabId??'primary'});type='STRATEGY_RESULT';}
  else if(msg.type==='TAB_SWITCH'){result=await runtime.executeTaskTabSwitch(requireTaskId(msg),msg.tabId);type='TAB_SWITCH_RESULT';}
  else if(msg.type==='BROWSER_COMMAND'){result=await runtime.executeTaskBrowserCommand(requireTaskId(msg),msg.action,{tabId:msg.tabId??'primary',value:msg.value??null});type='BROWSER_COMMAND_RESULT';}
  else return false;
  runtime.send(ws,{type,requestId:msg.requestId||null,ok:true,result});return true;
}

wss.on('connection',(ws,request)=>{
  let role='unknown';const origin=String(request?.headers?.origin||'');
  ws.on('message',async raw=>{
    let msg;try{msg=JSON.parse(String(raw));}catch{return;}
    if(msg.type==='HELLO'){
      const requestedRole=String(msg.role||'unknown');if(!protocolAllowed(requestedRole,msg.protocolVersion)){rejectAuth(ws,'protocol_version_mismatch');return;}
      if(requestedRole==='extension'){
        const extId=String(msg.extensionId||'').trim(),browserInstanceId=browserIdFromHello(msg);if(!browserInstanceId){rejectAuth(ws,'browser_instance_id_required');return;}
        const authResult=auth.authenticateExtension({extensionId:extId,browserInstanceId,runtimeExtensionId:msg.runtimeExtensionId,token:msg.token,origin});if(!authResult.ok){rejectAuth(ws,authResult.error);return;}
        let identity;try{identity=runtime.registerExtensionIdentity({browserInstanceId,extensionInstanceId:extId,runtimeExtensionId:msg.runtimeExtensionId});}catch(error){if(authResult.paired)auth.forgetExtension(extId);rejectAuth(ws,String(error?.message||error));return;}
        role='extension';const item=runtime.registry.register(extId,ws,{...msg,...identity,browserInstanceId});let management;
        try{management=runtime.extensionOnline(item);}catch(error){runtime.registry.unregisterSocket(ws);if(authResult.paired)auth.forgetExtension(extId);rejectAuth(ws,String(error?.message||error));return;}
        if(authResult.paired)runtime.send(ws,{type:'AUTH_PAIRED',role:'extension',protocolVersion:Number(msg.protocolVersion),token:authResult.pairedToken,identity});
        for(const t of msg.tabs||[])runtime.tabSites.set(runtime.ctx(extId,t.id),String(t.siteKey||'').toLowerCase());
        printAsync(`[ONLINE] browser=${browserInstanceId} extension=${extId} tabs=${item.tabs.size} tasksFailedOnReconcile=${management.reconcile.failedTasks.length}`);runtime.requestExtension(extId,'RECORD_SET',{enabled:runtime.recordingEnabled}).catch(()=>{});updatePrompt();brainSend('BODY_EVENT',{event:{eventType:'browserOnline',identity:runtime.identityForExtension(extId),browser:management.browser,ts:Date.now()}});return;
      }
      if(requestedRole==='brain'){
        if(!auth.authenticateBrain(msg.token)){rejectAuth(ws,'brain_token_invalid');return;}try{controller.attachBrain(ws,{controllerId:msg.controllerId||'brain'});}catch(error){rejectAuth(ws,String(error?.message||error));return;}role='brain';runtime.send(ws,{type:'HELLO_ACK',role:'brain',protocolVersion:CONTROL_PROTOCOL_VERSION,authenticated:true,identity:runtime.identity.snapshot(),controller:controller.status()});printAsync('[BRAIN] controller attached');return;
      }
      if(requestedRole==='debug_client'){
        if(!auth.authenticateDebugClient(msg.token)){rejectAuth(ws,'debug_client_token_invalid');return;}role='debug_client';debugClients.add(ws);runtime.send(ws,{type:'HELLO_ACK',role:'debug_client',protocolVersion:CONTROL_PROTOCOL_VERSION,authenticated:true,identity:runtime.identity.snapshot(),controller:controller.status()});return;
      }
      rejectAuth(ws,'unsupported_role');return;
    }
    if(role==='unknown')return;
    if(role==='extension'){
      const item=runtime.registry.bySocket(ws);if(!item)return;const extId=item.extensionId;if(msg.browserInstanceId&&String(msg.browserInstanceId)!==String(item.browserInstanceId)){rejectAuth(ws,'browser_instance_scope_mismatch');return;}runtime.registry.touch(extId);
      if(runtime.resolveResponse(extId,msg))return;if(msg.type==='RECORDER_EVENT'){runtime.recorderEvent(extId,msg);return;}if(msg.type==='TAB_EVENT'){runtime.tabEvent(extId,msg.event||{});brainSend('BODY_EVENT',{event:{...msg.event,identity:runtime.identityForExtension(extId),browserInstanceId:item.browserInstanceId}});return;}if(msg.type==='TAB_CONTEXT'){runtime.tabContext(extId,msg);brainSend('BODY_EVENT',{event:{eventType:'tabContext',identity:runtime.identityForExtension(extId),browserInstanceId:item.browserInstanceId,tabId:msg.tabId,context:msg.context,ts:Date.now()}});return;}if(msg.type==='TAB_REMOVED'){runtime.tabRemoved(extId,msg.tabId);brainSend('BODY_EVENT',{event:{eventType:'tabRemoved',identity:runtime.identityForExtension(extId),browserInstanceId:item.browserInstanceId,tabId:msg.tabId,ts:Date.now()}});return;}return;
    }
    if(role==='brain'){try{await handleBrainMessage(ws,msg);}catch(error){runtime.send(ws,{type:'BRAIN_ERROR',requestId:msg.requestId||null,ok:false,error:String(error?.message||error)});}return;}
    if(role==='debug_client'){if(msg.type!=='COMMAND')return;try{const result=await router.runCommand(msg.command,{assertControl:()=>controller.assertDebugControlAllowed()});runtime.send(ws,{type:'COMMAND_RESULT',requestId:msg.requestId||null,ok:true,result});}catch(error){runtime.send(ws,{type:'CLIENT_ERROR',requestId:msg.requestId||null,ok:false,error:String(error?.message||error)});}}
  });
  ws.on('close',()=>{
    const extId=runtime.registry.unregisterSocket(ws);if(extId){const identity=runtime.identityForExtension(extId),cleanup=runtime.extensionOffline(extId);printAsync(`[OFFLINE] browser=${identity.browserInstanceId||'unknown'} extension=${extId} rejectedPending=${cleanup.rejectedPending}`);updatePrompt();brainSend('BODY_EVENT',{event:{eventType:'browserOffline',identity,browserInstanceId:identity.browserInstanceId,ts:Date.now()}});}
    if(controller.detachSocket(ws))printAsync('[BRAIN] controller detached; Body continues observing/learning.');debugClients.delete(ws);
  });
});

function flushStores(){try{return runtime.flushSync();}catch{return null;}}
process.once('SIGINT',()=>{flushStores();process.exit(0);});process.once('SIGTERM',()=>{flushStores();process.exit(0);});process.once('exit',flushStores);
const localIdentity=runtime.identity.snapshot();console.log(`Company runtime identity: company=${localIdentity.companyId} device=${localIdentity.deviceId}`);console.log(`Body runtime transport: ws://127.0.0.1:${PORT}`);console.log(`Brain auth token: ${auth.status().brainTokenPath}`);console.log(`Debug client token: ${auth.status().debugClientTokenPath}`);console.log('Company Runtime owns Browser/Task state. Brain protocol v7 requires taskId for physical execution; daemon CMD remains diagnostic/test only.');
rl=readline.createInterface({input:process.stdin,output:process.stdout,prompt:prompt()});rl.prompt();rl.on('line',async line=>{try{const out=await router.runCommand(line,{assertControl:()=>controller.assertDebugControlAllowed()});if(out!==null)console.log(typeof out==='string'?out:JSON.stringify(out,null,2));}catch(error){console.log('[LỖI]',String(error?.message||error));}updatePrompt();rl.prompt();});

module.exports={runtime,router,wss,auth,controller,handleBrainMessage,CONTROL_PROTOCOL_VERSION,EXTENSION_PROTOCOL_VERSIONS,protocolAllowed,browserIdFromHello,requireTaskId,flushStores};
