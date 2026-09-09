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
const {acquireRuntimeLock,releaseRuntimeLock,publishRuntimeEndpoint,clearRuntimeEndpoint}=require('./src/runtime_endpoint');

const LISTEN_HOST='127.0.0.1',CONTROL_PROTOCOL_VERSION=7,EXTENSION_PROTOCOL_VERSIONS=new Set([5,6]);let rl=null,runtimeEndpoint=null;
const runtimeLock=acquireRuntimeLock(__dirname);
const prompt=()=>runtime.registry.selectedId?`BODY[${runtime.registry.selectedId.slice(0,8)}]> `:'BODY> ',printAsync=text=>{if(rl)process.stdout.write(`\n${text}\n${prompt()}`);},updatePrompt=()=>rl?.setPrompt(prompt());
const runtime=createDaemonRuntime({baseDir:__dirname,printAsync}),bodyGateway=new BodyStepGateway(runtime,{baseDir:__dirname}),router=createCommandRouter(runtime,{updatePrompt}),debugAdapter=new DebugCommandAdapter(runtime,router,{updatePrompt}),localAccumulator=createCommandAccumulator(),auth=new LocalAuth(__dirname),controller=new ControllerLease(),debugClients=new Set();
let wss;try{wss=new WebSocketServer({host:LISTEN_HOST,port:0,verifyClient:({origin},done)=>!origin||origin.startsWith('chrome-extension://')?done(true):done(false,403,'Forbidden Origin')});}catch(error){releaseRuntimeLock(__dirname,{pid:process.pid});throw error;}
function rejectAuth(ws,error){runtime.send(ws,{type:'AUTH_ERROR',ok:false,error});try{ws.close(1008,'Authentication required');}catch{}}
function brainSend(type,payload={}){if(!controller.brainSocket)return false;return runtime.send(controller.brainSocket,{type,...payload});}
function protocolAllowed(role,version){const v=Number(version);return role==='extension'?EXTENSION_PROTOCOL_VERSIONS.has(v):v===CONTROL_PROTOCOL_VERSION;}
function browserIdFromHello(msg){const explicit=String(msg.browserInstanceId||'').trim();if(explicit)return explicit;const extensionId=String(msg.extensionId||'').trim();if(Number(msg.protocolVersion)===5&&extensionId)return `browser-${extensionId}`;return '';}
function requireBrowserId(msg){const id=String(msg.browserInstanceId||'').trim();if(!id)throw new Error('browser_instance_id_required');return id;}
function guardianOutcomeLabel(environment){if(environment?.probeDeferred===true||environment?.status==='PENDING')return 'PENDING';return environment?.eligible===true?'ACTIVE':'QUARANTINED';}
function loggableInputEvent(event){return ['mousedown','mouseup','wheel','keydown','keyup'].includes(String(event?.eventType||''));}
function sendReadiness(ws,browserInstanceId){
  let status={state:'CHECKING',reason:'protection_starting',browserState:'ENV_CHECK',environment:'PENDING',botCheck:'PENDING'};
  try{
    if(runtime.protection?.readiness)status=runtime.protection.readiness(browserInstanceId);
    else{const browser=runtime.browsers.require(browserInstanceId);status={state:browser.online?'CHECKING':'BLOCKED',reason:browser.online?'protection_starting':'browser_offline',browserState:browser.state,environment:browser.environment?.status||'PENDING',botCheck:'PENDING'};}
  }catch(error){status={state:'BLOCKED',reason:String(error?.message||error),browserState:'UNKNOWN',environment:'UNKNOWN',botCheck:'UNKNOWN'};}
  runtime.send(ws,{type:'READINESS_STATUS',status,ts:Date.now()});return status;
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
  if(msg.type==='BODY_STATUS'){result={bodyContract:{version:BODY_CONTRACT_VERSION,gateway:bodyGateway.status()},identity:runtime.identity.snapshot(),controller:controller.status(),browsers:runtime.browsers.list(),tasks:runtime.tasks.list(),environment:runtime.guardian.status(),extensions:runtime.registry.list(),recordingEnabled:runtime.recordingEnabled,learningEnabled:runtime.learningEnabled,execution:runtime.execution.status(),evidence:runtime.evidence.status(),evidenceStore:runtime.evidenceStore.stats()};type='BODY_STATUS_RESULT';}
  else if(msg.type==='EXTENSIONS_LIST'){result=runtime.registry.list();type='EXTENSIONS_LIST_RESULT';}
  else if(msg.type==='BROWSERS_LIST'){result=runtime.browsers.list();type='BROWSERS_LIST_RESULT';}
  else if(msg.type==='ENVIRONMENT_STATUS'){result=runtime.guardian.status();type='ENVIRONMENT_STATUS_RESULT';}
  else if(msg.type==='ENVIRONMENT_PROBE'){result=await runtime.probeEnvironment(requireBrowserId(msg));type='ENVIRONMENT_RESULT';}
  else if(msg.type==='ENVIRONMENT_PROBE_ALL'){result=await runtime.probeAllEnvironments();type='ENVIRONMENT_RESULT';}
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
        printAsync(`[ONLINE] browser=${browserInstanceId} state=ENV_CHECK tabs=${item.tabs.size} tasksFailedOnReconcile=${management.reconcile.failedTasks.length}`);runtime.requestExtension(extId,'RECORD_SET',{enabled:runtime.recordingEnabled}).catch(()=>{});updatePrompt();brainSend('BODY_EVENT',{event:{eventType:'browserOnline',identity:runtime.identityForExtension(extId),browser:management.browser,ts:Date.now()}});sendReadiness(ws,browserInstanceId);
        runtime.probeEnvironment(browserInstanceId).then(environment=>{const readiness=sendReadiness(ws,browserInstanceId);printAsync(`[GUARDIAN] browser=${browserInstanceId} env=${guardianOutcomeLabel(environment)} readiness=${readiness.state} reason=${readiness.reason||'none'} reasons=${environment.reasons.join(',')||'none'}`);brainSend('BODY_EVENT',{event:{eventType:'environmentResult',browserInstanceId,environment,ts:Date.now()}});updatePrompt();}).catch(error=>{const readiness=sendReadiness(ws,browserInstanceId);printAsync(`[GUARDIAN] browser=${browserInstanceId} ERROR ${String(error?.message||error)} readiness=${readiness.state} reason=${readiness.reason||'none'}`);brainSend('BODY_EVENT',{event:{eventType:'environmentError',browserInstanceId,error:String(error?.message||error),ts:Date.now()}});});return;
      }
      if(requestedRole==='brain'){if(!auth.authenticateBrain(msg.token)){rejectAuth(ws,'brain_token_invalid');return;}try{controller.attachBrain(ws,{controllerId:msg.controllerId||'brain'});}catch(error){rejectAuth(ws,String(error?.message||error));return;}role='brain';runtime.send(ws,{type:'HELLO_ACK',role:'brain',protocolVersion:CONTROL_PROTOCOL_VERSION,bodyContractVersion:BODY_CONTRACT_VERSION,authenticated:true,identity:runtime.identity.snapshot(),controller:controller.status()});printAsync('[BRAIN] controller attached');return;}
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
      if(msg.type==='RECORDER_EVENT'){bodyGateway.observeRecorder(extId,msg);runtime.recorderEvent(extId,msg);if(loggableInputEvent(msg.event))printAsync(`[INPUT] browser=${item.browserInstanceId} tab=${Number(msg.tabId)} site=${String(msg.siteKey||'__unknown__')} event=${String(msg.event?.eventType||'unknown')}`);sendReadiness(ws,item.browserInstanceId);return;}
      if(msg.type==='SEMANTIC_OBSERVATION'){bodyGateway.observeSemantic(extId,msg);runtime.semanticObservation(extId,msg);return;}
      if(msg.type==='TAB_EVENT'){bodyGateway.observeTabEvent(extId,msg.event||{});runtime.tabEvent(extId,msg.event||{});brainSend('BODY_EVENT',{event:{...msg.event,identity:runtime.identityForExtension(extId),browserInstanceId:item.browserInstanceId}});sendReadiness(ws,item.browserInstanceId);return;}
      if(msg.type==='TAB_CONTEXT'){bodyGateway.observeTabContext(extId,msg);runtime.tabContext(extId,msg);brainSend('BODY_EVENT',{event:{eventType:'tabContext',identity:runtime.identityForExtension(extId),browserInstanceId:item.browserInstanceId,tabId:msg.tabId,context:msg.context,ts:Date.now()}});sendReadiness(ws,item.browserInstanceId);return;}
      if(msg.type==='TAB_REMOVED'){bodyGateway.clearTab(item.browserInstanceId,msg.tabId);runtime.tabRemoved(extId,msg.tabId);brainSend('BODY_EVENT',{event:{eventType:'tabRemoved',identity:runtime.identityForExtension(extId),browserInstanceId:item.browserInstanceId,tabId:msg.tabId,ts:Date.now()}});sendReadiness(ws,item.browserInstanceId);return;}
      return;
    }
    if(role==='brain'){try{const handled=await handleBrainMessage(ws,msg);if(!handled)runtime.send(ws,{type:'BRAIN_ERROR',requestId:msg.requestId||null,ok:false,error:'unsupported_brain_message'});}catch(error){runtime.send(ws,{type:'BRAIN_ERROR',requestId:msg.requestId||null,ok:false,error:String(error?.message||error)});}return;}
    if(role==='debug_client'){if(msg.type!=='COMMAND')return;try{const result=await debugAdapter.run(msg.command,{assertControl:()=>controller.assertDebugControlAllowed()});runtime.send(ws,{type:'COMMAND_RESULT',requestId:msg.requestId||null,ok:true,result});}catch(error){runtime.send(ws,{type:'CLIENT_ERROR',requestId:msg.requestId||null,ok:false,error:String(error?.message||error)});}}
  });
  ws.on('close',()=>{const extId=runtime.registry.unregisterSocket(ws);if(extId){const identity=runtime.identityForExtension(extId);bodyGateway.clearBrowser(identity.browserInstanceId);const cleanup=runtime.extensionOffline(extId);printAsync(`[OFFLINE] browser=${identity.browserInstanceId||'unknown'} extension=${extId} rejectedPending=${cleanup.rejectedPending}`);updatePrompt();brainSend('BODY_EVENT',{event:{eventType:'browserOffline',identity,browserInstanceId:identity.browserInstanceId,ts:Date.now()}});}if(controller.detachSocket(ws))printAsync('[BRAIN] controller detached; Body continues observing/learning.');debugClients.delete(ws);});
});

function disconnectExtensionForRevocation(extensionId){const item=runtime.registry.get(extensionId);if(!item?.online||!item.ws)return false;try{if(typeof item.ws.terminate==='function')item.ws.terminate();else item.ws.close(1008,'Pairing revoked');return true;}catch{return false;}}
function flushStores(){try{return {runtime:runtime.flushSync(),body:bodyGateway.flushSync()};}catch{return null;}}
function clearEndpoint(){let endpoint=false,lock=false;try{endpoint=clearRuntimeEndpoint(__dirname,{pid:process.pid});}catch{}try{lock=releaseRuntimeLock(__dirname,{pid:process.pid});}catch{}return {endpoint,lock};}
function shutdown(){flushStores();clearEndpoint();process.exit(0);}
process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);process.once('exit',()=>{flushStores();clearEndpoint();});
const localIdentity=runtime.identity.snapshot();console.log(`Company runtime identity: company=${localIdentity.companyId} device=${localIdentity.deviceId}`);console.log('Body runtime transport: requesting an available localhost port from Windows...');console.log(`BODY Contract: v${BODY_CONTRACT_VERSION} — Brain physical boundary is BODY_STEP only.`);console.log(`Environment policy: ${JSON.stringify(runtime.guardian.status().policy)}`);console.log(`Brain auth token: ${auth.status().brainTokenPath}`);console.log(`Debug client token: ${auth.status().debugClientTokenPath}`);console.log('Extension authentication is automatic and bound to Extension/Browser/Runtime/Origin. Local console: pair status | pair list | pair forget <extensionId>');console.log('Company Runtime validates Browser eligibility before Task assignment. Guardian is read-only: observe/report/quarantine only.');
rl=readline.createInterface({input:process.stdin,output:process.stdout,prompt:prompt()});rl.prompt();rl.on('line',async line=>{try{if(!localAccumulator.waiting){const pairing=pairingConsoleCommand(auth,line,{disconnectExtension:disconnectExtensionForRevocation});if(pairing.handled){if(pairing.result!==null)console.log(typeof pairing.result==='string'?pairing.result:JSON.stringify(pairing.result,null,2));updatePrompt();rl.prompt();return;}}const accumulated=localAccumulator.feed(line);if(!accumulated.ready){rl.setPrompt('... ');rl.prompt();return;}const out=await debugAdapter.run(accumulated.command,{assertControl:()=>controller.assertDebugControlAllowed()});if(out!==null)console.log(typeof out==='string'?out:JSON.stringify(out,null,2));}catch(error){localAccumulator.reset();console.log('[LỖI]',String(error?.message||error));}updatePrompt();rl.prompt();});
module.exports={runtime,bodyGateway,router,debugAdapter,wss,auth,controller,runtimeLock,handleBrainMessage,CONTROL_PROTOCOL_VERSION,BODY_CONTRACT_VERSION,EXTENSION_PROTOCOL_VERSIONS,protocolAllowed,browserIdFromHello,requireBrowserId,guardianOutcomeLabel,loggableInputEvent,sendReadiness,disconnectExtensionForRevocation,flushStores,clearEndpoint};
