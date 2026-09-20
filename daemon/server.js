'use strict';

const readline=require('node:readline');
const {WebSocketServer}=require('ws');
const {createDaemonRuntime}=require('./src/daemon_runtime');
const {createCommandRouter}=require('./src/command_router');
const {DebugCommandAdapter,createCommandAccumulator}=require('./src/debug_command_adapter');
const {LocalAuth}=require('./src/local_auth');
const {pairingConsoleCommand}=require('./src/local_pairing_console');
const {ControllerLease}=require('./src/controller_lease');
const {BodyStepGateway,BODY_CONTRACT_VERSION}=require('./src/body_step_gateway');
const {GuardianAuthorityGate}=require('./src/guardian_authority_gate');
const {acquireRuntimeLock,releaseRuntimeLock,publishRuntimeEndpoint,clearRuntimeEndpoint}=require('./src/runtime_endpoint');

const LISTEN_HOST='127.0.0.1',CONTROL_PROTOCOL_VERSION=7,EXTENSION_PROTOCOL_VERSIONS=new Set([5,6]);let rl=null,runtimeEndpoint=null;
const runtimeLock=acquireRuntimeLock(__dirname);
const prompt=()=>runtime.registry.selectedId?`BODY[${runtime.registry.selectedId.slice(0,8)}]> `:'BODY> ',printAsync=text=>{if(rl)process.stdout.write(`\n${text}\n${prompt()}`);},updatePrompt=()=>rl?.setPrompt(prompt());
const runtime=createDaemonRuntime({baseDir:__dirname,printAsync}),guardianGate=new GuardianAuthorityGate(),bodyGateway=new BodyStepGateway(runtime,{baseDir:__dirname,guardianGate}),router=createCommandRouter(runtime,{updatePrompt}),debugAdapter=new DebugCommandAdapter(runtime,router,{updatePrompt}),localAccumulator=createCommandAccumulator(),auth=new LocalAuth(__dirname),controller=new ControllerLease(),debugClients=new Set();
let wss;try{wss=new WebSocketServer({host:LISTEN_HOST,port:0,verifyClient:({origin},done)=>!origin||origin.startsWith('chrome-extension://')?done(true):done(false,403,'Forbidden Origin')});}catch(error){releaseRuntimeLock(__dirname,{pid:process.pid});throw error;}
function rejectAuth(ws,error){runtime.send(ws,{type:'AUTH_ERROR',ok:false,error});try{ws.close(1008,'Authentication required');}catch{}}
function routingIdentity(extensionId){const value=runtime.identityForExtension(extensionId)||{};return {browserInstanceId:value.browserInstanceId||null,extensionInstanceId:value.extensionInstanceId||null,runtimeExtensionId:value.runtimeExtensionId||null};}
function brainSend(type,payload={}){if(!controller.brainSocket)return false;return runtime.send(controller.brainSocket,{type,...payload});}
function guardianSend(type,payload={}){if(!guardianGate.socket)return false;return runtime.send(guardianGate.socket,{type,...payload});}
function protocolAllowed(role,version){const v=Number(version);return role==='extension'?EXTENSION_PROTOCOL_VERSIONS.has(v):v===CONTROL_PROTOCOL_VERSION;}
function browserIdFromHello(msg){const explicit=String(msg.browserInstanceId||'').trim();if(explicit)return explicit;const extensionId=String(msg.extensionId||'').trim();if(Number(msg.protocolVersion)===5&&extensionId)return `browser-${extensionId}`;return '';}
function requireBrowserId(msg){const id=String(msg.browserInstanceId||'').trim();if(!id)throw new Error('browser_instance_id_required');return id;}
function loggableInputEvent(event){return ['mousedown','mouseup','wheel','keydown','keyup'].includes(String(event?.eventType||''));}
function sendReadiness(ws,browserInstanceId){
  let status={state:'CHECKING',reason:'guardian_authority_not_attached',browserState:'UNKNOWN',guardian:'EXTERNAL'};
  try{
    const browser=runtime.browsers.require(browserInstanceId),authorization=guardianGate.authorization(browserInstanceId);
    if(!browser.online)status={state:'BLOCKED',reason:'browser_offline',browserState:browser.state,guardian:'EXTERNAL'};
    else if(authorization.allowed===true)status={state:'READY',reason:'guardian_cdp_allowed',browserState:browser.state,guardian:'EXTERNAL',leaseId:authorization.leaseId||null,expiresAt:authorization.expiresAt||null};
    else status={state:authorization.code==='guardian_cdp_blocked'?'BLOCKED':'CHECKING',reason:authorization.code,browserState:browser.state,guardian:'EXTERNAL'};
  }catch(error){status={state:'BLOCKED',reason:String(error?.message||error),browserState:'UNKNOWN',guardian:'EXTERNAL'};}
  runtime.send(ws,{type:'READINESS_STATUS',status,ts:Date.now()});return status;
}
function bodyStatusResult(){
  return {
    bodyContract:{version:BODY_CONTRACT_VERSION,gateway:bodyGateway.status()},
    controller:controller.status(),
    browsers:runtime.browsers.list(),
    tasks:runtime.tasks.list(),
    extensions:runtime.registry.list(),
    recordingEnabled:runtime.recordingEnabled,
    learningEnabled:runtime.learningEnabled,
    execution:runtime.execution.status(),
    evidence:runtime.evidence.status(),
    evidenceStore:runtime.evidenceStore.stats()
  };
}

wss.once('listening',()=>{
  try{
    const address=wss.address(),port=Number(address&&typeof address==='object'?address.port:0);
    runtimeEndpoint=publishRuntimeEndpoint(__dirname,port);
    console.log(`Body runtime transport: ${runtimeEndpoint.wsUrl} (auto-assigned)`);
  }catch(error){
    console.error('[FATAL]',String(error?.message||error));
    try{wss.close();}catch{}
    clearEndpoint();
    process.exitCode=1;
    setImmediate(()=>process.exit(1));
  }
});

async function handleBrainMessage(ws,msg){
  if(msg.type==='BODY_STEP'){
    const result=await bodyGateway.execute(msg);
    runtime.send(ws,{...result,requestId:msg.requestId||null});
    return true;
  }
  if(msg.type==='BODY_OBSERVE'){
    const observation=await bodyGateway.observe({taskId:msg.taskId??null,browserInstanceId:msg.browserInstanceId??null,tabId:msg.tabId??null});
    runtime.send(ws,{type:'BODY_OBSERVE_RESULT',contractVersion:BODY_CONTRACT_VERSION,requestId:msg.requestId||null,observation});
    return true;
  }
  let result,type;
  if(msg.type==='BODY_STATUS'){result=bodyStatusResult();type='BODY_STATUS_RESULT';}
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
  else return false;
  runtime.send(ws,{type,requestId:msg.requestId||null,ok:true,result});return true;
}
async function handleGuardianMessage(ws,msg){
  let result,type;
  if(msg.type==='GUARDIAN_GATE_SET'){result=guardianGate.setGrant(msg);type='GUARDIAN_GATE_RESULT';}
  else if(msg.type==='GUARDIAN_GATE_REVOKE'){result={revoked:guardianGate.revoke(requireBrowserId(msg)),browserInstanceId:requireBrowserId(msg)};type='GUARDIAN_GATE_RESULT';}
  else if(msg.type==='GUARDIAN_GATE_STATUS'){result=guardianGate.status();type='GUARDIAN_GATE_STATUS_RESULT';}
  else if(msg.type==='GUARDIAN_BODY_STATUS'){result=bodyStatusResult();type='GUARDIAN_BODY_STATUS_RESULT';}
  else if(msg.type==='GUARDIAN_BODY_OBSERVE'){result=await bodyGateway.observe({browserInstanceId:msg.browserInstanceId??null,tabId:msg.tabId??null});type='GUARDIAN_BODY_OBSERVE_RESULT';}
  else if(msg.type==='GUARDIAN_EXTENSION_ENVIRONMENT_PROBE'){
    const browser=runtime.browsers.require(requireBrowserId(msg));
    if(!browser.online||!browser.extensionInstanceId)throw new Error('guardian_probe_browser_offline');
    const tabId=Number.isInteger(Number(msg.tabId))?Number(msg.tabId):Number(browser.activeTabId);
    result=await runtime.requestExtension(browser.extensionInstanceId,'ENVIRONMENT_PROBE',{tabId,publicIpEndpoint:msg.publicIpEndpoint??null,timeoutMs:msg.timeoutMs??null},Math.max(1000,Number(msg.timeoutMs)||6000)+4000);
    type='GUARDIAN_EXTENSION_ENVIRONMENT_RESULT';
  }else return false;
  runtime.send(ws,{type,requestId:msg.requestId||null,ok:true,result});
  if(msg.type==='GUARDIAN_GATE_SET'||msg.type==='GUARDIAN_GATE_REVOKE'){
    for(const row of runtime.registry.list().filter(x=>x.online)){
      const ext=runtime.registry.get(row.extensionId);if(ext?.ws)sendReadiness(ext.ws,row.browserInstanceId);
    }
  }
  return true;
}
function handleStatusClientMessage(ws,msg){
  if(msg.type!=='BODY_STATUS'){
    runtime.send(ws,{type:'STATUS_ERROR',requestId:msg.requestId||null,ok:false,error:'status_client_read_only'});
    return true;
  }
  runtime.send(ws,{type:'BODY_STATUS_RESULT',requestId:msg.requestId||null,ok:true,result:bodyStatusResult()});
  return true;
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
        role='extension';const item=runtime.registry.register(extId,ws,{...msg,...identity,browserInstanceId});let management;try{management=runtime.extensionOnline(item);}catch(error){runtime.registry.unregisterSocket(ws);if(authResult.paired)auth.forgetExtension(extId);rejectAuth(ws,String(error?.message||error));return;}
        if(authResult.paired)runtime.send(ws,{type:'AUTH_PAIRED',role:'extension',protocolVersion:Number(msg.protocolVersion),token:authResult.pairedToken,identity,rotated:authResult.rotated===true});for(const t of msg.tabs||[])runtime.tabSites.set(runtime.ctx(extId,t.id),String(t.siteKey||'').toLowerCase());
        printAsync(`[ONLINE] browser=${browserInstanceId} state=ONLINE tabs=${item.tabs.size} tasksFailedOnReconcile=${management.reconcile.failedTasks.length}`);runtime.requestExtension(extId,'RECORD_SET',{enabled:runtime.recordingEnabled}).catch(()=>{});updatePrompt();const browserEvent={eventType:'browserOnline',identity:routingIdentity(extId),browser:management.browser,ts:Date.now()};brainSend('BODY_EVENT',{event:browserEvent});guardianSend('GUARDIAN_EVENT',{event:browserEvent});sendReadiness(ws,browserInstanceId);return;
      }
      if(requestedRole==='brain'){if(!auth.authenticateBrain(msg.token)){rejectAuth(ws,'brain_token_invalid');return;}try{controller.attachBrain(ws,{controllerId:msg.controllerId||'brain'});}catch(error){rejectAuth(ws,String(error?.message||error));return;}role='brain';runtime.send(ws,{type:'HELLO_ACK',role:'brain',protocolVersion:CONTROL_PROTOCOL_VERSION,bodyContractVersion:BODY_CONTRACT_VERSION,authenticated:true,component:'BODY',controller:controller.status()});printAsync('[BRAIN] controller attached');return;}
      if(requestedRole==='guardian'){if(!auth.authenticateGuardian(msg.token)){rejectAuth(ws,'guardian_token_invalid');return;}try{guardianGate.attach(ws,{guardianId:msg.guardianId||'guardian'});}catch(error){rejectAuth(ws,String(error?.message||error));return;}role='guardian';runtime.send(ws,{type:'HELLO_ACK',role:'guardian',protocolVersion:CONTROL_PROTOCOL_VERSION,guardianContractVersion:1,authenticated:true,bodyRuntimeIdentity:runtime.identity.snapshot(),authority:guardianGate.status()});printAsync('[GUARDIAN] authority attached');for(const row of runtime.registry.list().filter(x=>x.online)){const ext=runtime.registry.get(row.extensionId);if(ext?.ws)sendReadiness(ext.ws,row.browserInstanceId);}return;}
      if(requestedRole==='status_client'){if(!auth.authenticateBrain(msg.token)){rejectAuth(ws,'status_client_token_invalid');return;}role='status_client';runtime.send(ws,{type:'HELLO_ACK',role:'status_client',protocolVersion:CONTROL_PROTOCOL_VERSION,bodyContractVersion:BODY_CONTRACT_VERSION,authenticated:true,component:'BODY',controller:controller.status()});return;}
      if(requestedRole==='debug_client'){if(!auth.authenticateDebugClient(msg.token)){rejectAuth(ws,'debug_client_token_invalid');return;}role='debug_client';debugClients.add(ws);runtime.send(ws,{type:'HELLO_ACK',role:'debug_client',protocolVersion:CONTROL_PROTOCOL_VERSION,bodyContractVersion:BODY_CONTRACT_VERSION,authenticated:true,identity:runtime.identity.snapshot(),controller:controller.status()});return;}
      rejectAuth(ws,'unsupported_role');return;
    }
    if(role==='unknown')return;
    if(role==='extension'){
      const item=runtime.registry.bySocket(ws);if(!item)return;const extId=item.extensionId;
      if(msg.browserInstanceId&&String(msg.browserInstanceId)!==String(item.browserInstanceId)){rejectAuth(ws,'browser_instance_scope_mismatch');return;}
      runtime.registry.touch(extId);
      if(runtime.resolveResponse(extId,msg))return;
      if(msg.type==='READINESS_POLL'||msg.type==='KEEPALIVE'){sendReadiness(ws,item.browserInstanceId);return;}
      if(msg.type==='RECORDER_EVENT'){bodyGateway.observeRecorder(extId,msg);runtime.recorderEvent(extId,msg);if(loggableInputEvent(msg.event)){printAsync(`[INPUT] browser=${item.browserInstanceId} tab=${Number(msg.tabId)} site=${String(msg.siteKey||'__unknown__')} event=${String(msg.event?.eventType||'unknown')}`);const event=msg.event||{};guardianSend('GUARDIAN_EVENT',{event:{eventType:'input',browserInstanceId:item.browserInstanceId,tabId:Number(msg.tabId),siteKey:String(msg.siteKey||'__unknown__'),input:{eventType:event.eventType||null,ts:event.ts||Date.now(),source:event.source||null,isTrusted:event.isTrusted===true,x:event.x??null,y:event.y??null,button:event.button??null,buttons:event.buttons??null,deltaX:event.deltaX??null,deltaY:event.deltaY??null,key:event.key??null,code:event.code??null,modifiers:event.modifiers??null}}});}sendReadiness(ws,item.browserInstanceId);return;}
      if(msg.type==='SEMANTIC_OBSERVATION'){bodyGateway.observeSemantic(extId,msg);runtime.semanticObservation(extId,msg);return;}
      if(msg.type==='TAB_EVENT'){bodyGateway.observeTabEvent(extId,msg.event||{});runtime.tabEvent(extId,msg.event||{});const event={...msg.event,identity:routingIdentity(extId),browserInstanceId:item.browserInstanceId};brainSend('BODY_EVENT',{event});guardianSend('GUARDIAN_EVENT',{event});sendReadiness(ws,item.browserInstanceId);return;}
      if(msg.type==='TAB_CONTEXT'){bodyGateway.observeTabContext(extId,msg);runtime.tabContext(extId,msg);const event={eventType:'tabContext',identity:routingIdentity(extId),browserInstanceId:item.browserInstanceId,tabId:msg.tabId,context:msg.context,ts:Date.now()};brainSend('BODY_EVENT',{event});guardianSend('GUARDIAN_EVENT',{event});sendReadiness(ws,item.browserInstanceId);return;}
      if(msg.type==='TAB_REMOVED'){bodyGateway.clearTab(item.browserInstanceId,msg.tabId);runtime.tabRemoved(extId,msg.tabId);const event={eventType:'tabRemoved',identity:routingIdentity(extId),browserInstanceId:item.browserInstanceId,tabId:msg.tabId,ts:Date.now()};brainSend('BODY_EVENT',{event});guardianSend('GUARDIAN_EVENT',{event});sendReadiness(ws,item.browserInstanceId);return;}
      return;
    }
    if(role==='brain'){try{const handled=await handleBrainMessage(ws,msg);if(!handled)runtime.send(ws,{type:'BRAIN_ERROR',requestId:msg.requestId||null,ok:false,error:'unsupported_brain_message'});}catch(error){runtime.send(ws,{type:'BRAIN_ERROR',requestId:msg.requestId||null,ok:false,error:String(error?.message||error)});}return;}
    if(role==='guardian'){try{const handled=await handleGuardianMessage(ws,msg);if(!handled)runtime.send(ws,{type:'GUARDIAN_ERROR',requestId:msg.requestId||null,ok:false,error:'unsupported_guardian_message'});}catch(error){runtime.send(ws,{type:'GUARDIAN_ERROR',requestId:msg.requestId||null,ok:false,error:String(error?.message||error)});}return;}
    if(role==='status_client'){try{handleStatusClientMessage(ws,msg);}catch(error){runtime.send(ws,{type:'STATUS_ERROR',requestId:msg.requestId||null,ok:false,error:String(error?.message||error)});}return;}
    if(role==='debug_client'){if(msg.type!=='COMMAND')return;try{const result=await debugAdapter.run(msg.command,{assertControl:()=>controller.assertDebugControlAllowed()});runtime.send(ws,{type:'COMMAND_RESULT',requestId:msg.requestId||null,ok:true,result});}catch(error){runtime.send(ws,{type:'CLIENT_ERROR',requestId:msg.requestId||null,ok:false,error:String(error?.message||error)});}}
  });
  ws.on('close',()=>{const extId=runtime.registry.unregisterSocket(ws);if(extId){const identity=routingIdentity(extId);bodyGateway.clearBrowser(identity.browserInstanceId);const cleanup=runtime.extensionOffline(extId);printAsync(`[OFFLINE] browser=${identity.browserInstanceId||'unknown'} extension=${extId} rejectedPending=${cleanup.rejectedPending}`);updatePrompt();const event={eventType:'browserOffline',identity,browserInstanceId:identity.browserInstanceId,ts:Date.now()};brainSend('BODY_EVENT',{event});guardianSend('GUARDIAN_EVENT',{event});}if(controller.detachSocket(ws))printAsync('[BRAIN] controller detached; Body continues observing.');if(guardianGate.detach(ws)){printAsync('[GUARDIAN] authority detached; Brain CDP is fail-closed.');for(const row of runtime.registry.list().filter(x=>x.online)){const ext=runtime.registry.get(row.extensionId);if(ext?.ws)sendReadiness(ext.ws,row.browserInstanceId);}}debugClients.delete(ws);});
});

function disconnectExtensionForRevocation(extensionId){const item=runtime.registry.get(extensionId);if(!item?.online||!item.ws)return false;try{if(typeof item.ws.terminate==='function')item.ws.terminate();else item.ws.close(1008,'Pairing revoked');return true;}catch{return false;}}
function flushStores(){try{return {runtime:runtime.flushSync(),body:bodyGateway.flushSync()};}catch{return null;}}
function clearEndpoint(){let endpoint=false,lock=false;try{endpoint=clearRuntimeEndpoint(__dirname,{pid:process.pid});}catch{}try{lock=releaseRuntimeLock(__dirname,{pid:process.pid});}catch{}return {endpoint,lock};}
function shutdown(){flushStores();clearEndpoint();process.exit(0);}
process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);process.once('exit',()=>{flushStores();clearEndpoint();});
const localIdentity=runtime.identity.snapshot();console.log(`Company runtime identity: company=${localIdentity.companyId} device=${localIdentity.deviceId}`);console.log('Body runtime transport: requesting an available localhost port from Windows...');console.log(`BODY Contract: v${BODY_CONTRACT_VERSION} — Brain physical boundary is BODY_STEP only.`);console.log(`Brain auth token: ${auth.status().brainTokenPath}`);console.log(`Guardian auth token: ${auth.status().guardianTokenPath}`);console.log(`Debug client token: ${auth.status().debugClientTokenPath}`);console.log('Extension authentication is automatic and bound to Extension/Browser/Runtime/Origin. Local console: pair status | pair list | pair forget <extensionId>');console.log('Guardian is external authority. Brain CDP is fail-closed without an active Guardian grant. Human local control remains higher authority.');
rl=readline.createInterface({input:process.stdin,output:process.stdout,prompt:prompt()});rl.prompt();rl.on('line',async line=>{try{if(!localAccumulator.waiting){const pairing=pairingConsoleCommand(auth,line,{disconnectExtension:disconnectExtensionForRevocation});if(pairing.handled){if(pairing.result!==null)console.log(typeof pairing.result==='string'?pairing.result:JSON.stringify(pairing.result,null,2));updatePrompt();rl.prompt();return;}}const accumulated=localAccumulator.feed(line);if(!accumulated.ready){rl.setPrompt('... ');rl.prompt();return;}const out=await debugAdapter.run(accumulated.command,{assertControl:()=>controller.assertDebugControlAllowed()});if(out!==null)console.log(typeof out==='string'?out:JSON.stringify(out,null,2));}catch(error){localAccumulator.reset();console.log('[LỖI]',String(error?.message||error));}updatePrompt();rl.prompt();});
module.exports={runtime,bodyGateway,guardianGate,router,debugAdapter,wss,auth,controller,runtimeLock,handleBrainMessage,handleGuardianMessage,handleStatusClientMessage,bodyStatusResult,CONTROL_PROTOCOL_VERSION,BODY_CONTRACT_VERSION,EXTENSION_PROTOCOL_VERSIONS,protocolAllowed,browserIdFromHello,requireBrowserId,loggableInputEvent,sendReadiness,disconnectExtensionForRevocation,flushStores,clearEndpoint};
