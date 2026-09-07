'use strict';

const {BodyStepLedger}=require('./body_step_ledger');
const {BROWSER_COMMANDS,COMPOUND_COMMANDS}=require('./browser_ui_adapter');

const BODY_CONTRACT_VERSION='1.0';
const MOTOR_TYPES=new Set(['click','doubleClick','moveTo','hover','drag','scrollVertical','scrollHorizontal','typeText','pressKey','keyCombo']);
const BROWSER_UI_ACTIONS=new Set([...Object.keys(BROWSER_COMMANDS),...Object.keys(COMPOUND_COMMANDS)]);
const STEP_KINDS=new Set(['motor','browser_ui','tab_switch']);
const FORBIDDEN_JUDGMENT_KEYS=new Set(['success','tasksuccess','verified','verification','goalachieved','correct','wrong','shouldretry','nextaction','recommendedaction']);

function clone(value){return value===undefined?undefined:JSON.parse(JSON.stringify(value));}
function nonEmpty(value){return typeof value==='string'&&value.trim().length>0;}
function finiteNumber(value){return value!==null&&value!==undefined&&!(typeof value==='string'&&value.trim()==='')&&Number.isFinite(Number(value));}
function finiteInteger(value){return finiteNumber(value)&&Number.isInteger(Number(value))&&Number(value)>=0;}
function optionalInteger(value){return finiteInteger(value)?Number(value):null;}
function errorWithCode(code,message=code){const error=new Error(message);error.code=code;return error;}
function keyName(value){return String(value||'').replace(/[_-]/g,'').toLowerCase();}
function stripJudgment(value){if(Array.isArray(value))return value.map(stripJudgment);if(!value||typeof value!=='object')return value;const out={};for(const [key,row] of Object.entries(value)){if(FORBIDDEN_JUDGMENT_KEYS.has(keyName(key)))continue;out[key]=stripJudgment(row);}return out;}
function judgmentPaths(value,prefix=''){const found=[];if(Array.isArray(value)){value.forEach((row,index)=>found.push(...judgmentPaths(row,`${prefix}[${index}]`)));return found;}if(!value||typeof value!=='object')return found;for(const [key,row] of Object.entries(value)){const path=prefix?`${prefix}.${key}`:key;if(FORBIDDEN_JUDGMENT_KEYS.has(keyName(key)))found.push(path);found.push(...judgmentPaths(row,path));}return found;}
function ageMs(now,row){if(!row||!finiteNumber(row.observedAt))return null;return Math.max(0,Math.trunc(now-Number(row.observedAt)));}
function technicalError(error){const message=String(error?.message||error||'body_step_error');const code=String(error?.code||message.split(':')[0]||'body_step_error');return {code,message};}
function actionName(step){if(step?.kind==='motor')return String(step.intent?.type||'unknown');if(step?.kind==='browser_ui')return String(step.action||'unknown');if(step?.kind==='tab_switch')return 'switchTab';return null;}
function replayResult(result,replayed=true){const out=clone(result);if(out?.execution)out.execution.replayed=replayed===true;return out;}

function validateBodyStepCommand(message){
  if(!message||typeof message!=='object'||Array.isArray(message))throw errorWithCode('body_step_command_required');
  if(String(message.contractVersion||'')!==BODY_CONTRACT_VERSION)throw errorWithCode('body_contract_version_mismatch');
  if(message.type!=='BODY_STEP')throw errorWithCode('body_step_type_required');
  if(!nonEmpty(message.stepId))throw errorWithCode('body_step_id_required');
  if(!nonEmpty(message.taskId))throw errorWithCode('body_task_id_required');
  const step=clone(message.step);
  if(!step||typeof step!=='object'||Array.isArray(step)||!STEP_KINDS.has(step.kind))throw errorWithCode('body_step_kind_invalid');
  if(step.kind==='motor'){
    if(!step.intent||typeof step.intent!=='object'||Array.isArray(step.intent))throw errorWithCode('body_motor_intent_required');
    if(!MOTOR_TYPES.has(String(step.intent.type||'')))throw errorWithCode('body_motor_intent_unsupported');
    for(const forbidden of ['actions','strategies','habitKey','task','nextAction','shouldRetry'])if(Object.prototype.hasOwnProperty.call(step.intent,forbidden))throw errorWithCode('body_motor_composite_forbidden');
  }
  if(step.kind==='browser_ui'){
    const action=String(step.action||'').trim().toLowerCase();
    if(!BROWSER_UI_ACTIONS.has(action))throw errorWithCode('body_browser_action_unsupported');
    step.action=action;
  }
  if(step.kind==='tab_switch'&&!finiteInteger(step.targetTabId))throw errorWithCode('body_target_tab_required');
  const tabId=message.tabId===undefined||message.tabId===null?'primary':message.tabId;
  if(tabId!=='primary'&&!finiteInteger(tabId))throw errorWithCode('body_tab_ref_invalid');
  return {contractVersion:BODY_CONTRACT_VERSION,type:'BODY_STEP',requestId:message.requestId??null,stepId:String(message.stepId),taskId:String(message.taskId),tabId:tabId==='primary'?'primary':Number(tabId),step};
}

class BodyStepGateway{
  constructor(runtime,{now=()=>Date.now(),baseDir=null,ledger=null}={}){
    if(!runtime)throw new Error('body_step_gateway_runtime_required');
    if(!ledger&&!baseDir)throw new Error('body_step_gateway_ledger_required');
    this.runtime=runtime;this.now=now;this.ledger=ledger||new BodyStepLedger(baseDir,{now});this.inflight=new Map();this.lastLedgerError=null;
    this.semantic=new Map();this.page=new Map();this.tabContext=new Map();this.controls=new Map();
  }
  key(browserInstanceId,tabId){return `${String(browserInstanceId||'')}/${Number(tabId)}`;}
  identityForExtension(extensionId){return this.runtime.identityForExtension(extensionId);}
  _put(map,browserInstanceId,tabId,value,observedAt=null){if(!browserInstanceId||!finiteInteger(tabId)||value===undefined)return null;const row={value:clone(value),observedAt:finiteNumber(observedAt)?Number(observedAt):this.now()};map.set(this.key(browserInstanceId,tabId),row);return row;}
  observeSemantic(extensionId,msg={}){const identity=this.identityForExtension(extensionId),tabId=Number(msg.tabId);if(!identity?.browserInstanceId||!Number.isInteger(tabId)||!msg.observation)return null;return this._put(this.semantic,identity.browserInstanceId,tabId,msg.observation,msg.observation?.observedAt);}
  observeTabContext(extensionId,msg={}){const identity=this.identityForExtension(extensionId),tabId=Number(msg.tabId);if(!identity?.browserInstanceId||!Number.isInteger(tabId)||!msg.context)return null;return this._put(this.tabContext,identity.browserInstanceId,tabId,msg.context,this.now());}
  observeTabEvent(extensionId,event={}){const identity=this.identityForExtension(extensionId),tabId=Number(event.tabId);if(!identity?.browserInstanceId||!Number.isInteger(tabId))return null;const current=this.tabContext.get(this.key(identity.browserInstanceId,tabId))?.value||{};return this._put(this.tabContext,identity.browserInstanceId,tabId,{...current,siteKey:event.siteKey??current.siteKey,title:event.title??current.title,windowId:event.windowId??current.windowId,active:event.eventType==='tabActivated'?true:current.active},event.ts);}
  observeRecorder(extensionId,msg={}){const identity=this.identityForExtension(extensionId),tabId=Number(msg.tabId),target=msg.event?.target;if(!identity?.browserInstanceId||!Number.isInteger(tabId)||!target)return null;const control={tag:target.tag??null,role:target.role??null,inputType:target.inputType??null,editable:target.editable===true,sensitive:target.sensitive===true,rect:target.rect?clone(target.rect):null,source:String(msg.event?.source||'unknown')};return this._put(this.controls,identity.browserInstanceId,tabId,control,msg.event?.ts);}
  ingestLiveSnapshot(extensionId,tabId,snapshot={}){const identity=this.identityForExtension(extensionId),browserInstanceId=identity?.browserInstanceId;if(!browserInstanceId||!finiteInteger(tabId)||!snapshot||typeof snapshot!=='object')return null;const at=finiteNumber(snapshot.observedAt)?Number(snapshot.observedAt):this.now();if(snapshot.tab)this._put(this.tabContext,browserInstanceId,tabId,{...snapshot.tab,contextSource:'live_eyes_snapshot'},at);if(snapshot.page)this._put(this.page,browserInstanceId,tabId,snapshot.page,at);if(snapshot.semantic)this._put(this.semantic,browserInstanceId,tabId,snapshot.semantic,finiteNumber(snapshot.semantic?.observedAt)?snapshot.semantic.observedAt:at);return {browserInstanceId,tabId:Number(tabId),pointer:snapshot.pointer?clone(snapshot.pointer):null,observedAt:at};}
  async refreshEyes(browserInstanceId,extensionInstanceId,tabId){if(!extensionInstanceId||typeof this.runtime.requestExtension!=='function')return {attempted:false,succeeded:false,pointer:null};try{const snapshot=await this.runtime.requestExtension(extensionInstanceId,'BODY_OBSERVE_SNAPSHOT',{tabId:Number(tabId)},5000),ingested=this.ingestLiveSnapshot(extensionInstanceId,tabId,snapshot);if(!ingested||ingested.browserInstanceId!==browserInstanceId)throw errorWithCode('body_eyes_scope_mismatch');return {attempted:true,succeeded:true,pointer:ingested.pointer};}catch(error){return {attempted:true,succeeded:false,pointer:null,error:technicalError(error)};}}
  clearTab(browserInstanceId,tabId){const key=this.key(browserInstanceId,tabId);return {semantic:this.semantic.delete(key),page:this.page.delete(key),tabContext:this.tabContext.delete(key),control:this.controls.delete(key)};}
  clearBrowser(browserInstanceId){const prefix=`${String(browserInstanceId||'')}/`;let cleared=0;for(const map of [this.semantic,this.page,this.tabContext,this.controls])for(const key of [...map.keys()])if(key.startsWith(prefix)){map.delete(key);cleared++;}return cleared;}
  status(){return {contractVersion:BODY_CONTRACT_VERSION,cachedSemantic:this.semantic.size,cachedPage:this.page.size,cachedTabContext:this.tabContext.size,cachedControls:this.controls.size,inflightSteps:this.inflight.size,ledger:this.ledger.stats(),lastLedgerError:this.lastLedgerError};}
  flushSync(){return this.ledger.flushSync();}

  scopeForObservation(request={}){
    if(nonEmpty(request.taskId)){const task=this.runtime.tasks.get(request.taskId),workspace=task.workspace||{},browserInstanceId=String(workspace.browserInstanceId||''),primary=request.tabId===undefined||request.tabId===null||request.tabId==='primary';if(!primary&&!finiteInteger(request.tabId))throw errorWithCode('body_observe_tab_not_in_task');const tabId=primary?Number(workspace.primaryTabId):Number(request.tabId);if(!Number.isInteger(tabId)||!Array.isArray(workspace.tabIds)||!workspace.tabIds.map(Number).includes(tabId))throw errorWithCode('body_observe_tab_not_in_task');return {browserInstanceId,tabId};}
    const browserInstanceId=String(request.browserInstanceId||'').trim();if(!browserInstanceId)throw errorWithCode('body_observe_browser_required');const browser=this.runtime.browsers.require(browserInstanceId),active=request.tabId===undefined||request.tabId===null||request.tabId==='active';if(!active&&!finiteInteger(request.tabId))throw errorWithCode('body_observe_tab_required');const tabId=active?Number(browser.activeTabId):Number(request.tabId);if(!Number.isInteger(tabId))throw errorWithCode('body_observe_tab_required');return {browserInstanceId,tabId};
  }

  async observe(request={}){
    const {browserInstanceId,tabId}=this.scopeForObservation(request),browser=this.runtime.browsers.require(browserInstanceId),tab=browser.tabs.get(Number(tabId));if(!tab)throw errorWithCode('body_observe_tab_not_found');
    const extensionInstanceId=browser.extensionInstanceId||null,identity=this.runtime.identity.identityChain(browserInstanceId)||{browserInstanceId,extensionInstanceId},refresh=browser.online?await this.refreshEyes(browserInstanceId,extensionInstanceId,tabId):{attempted:false,succeeded:false,pointer:null};
    let pointer=refresh.pointer||this.runtime.pointerState.snapshot(identity,tabId);if(!refresh.pointer&&browser.online&&extensionInstanceId){try{pointer=await this.runtime.pointerStatus(extensionInstanceId,tabId);}catch{}}
    const key=this.key(browserInstanceId,tabId),semanticRow=this.semantic.get(key)||null,pageRow=this.page.get(key)||null,contextRow=this.tabContext.get(key)||null,controlRow=this.controls.get(key)||null,now=this.now(),context=contextRow?.value||null,page=pageRow?.value||null,semantic=semanticRow?.value||null;
    const observation={contractVersion:BODY_CONTRACT_VERSION,observedAt:now,scope:{browserInstanceId,extensionInstanceId,tabId:Number(tabId),siteKey:context?.siteKey??tab.siteKey??null,title:context?.title??tab.title??null,windowId:optionalInteger(context?.windowId??tab.windowId),navigationToken:context?.navigationToken??tab.navigationToken??null,navigationEpoch:optionalInteger(context?.navigationEpoch??tab.navigationEpoch),status:context?.status??tab.status??null},bodyState:{pointer:clone(pointer),browserState:String(browser.state||'UNKNOWN'),activeTabId:optionalInteger(browser.activeTabId)},control:{activeTarget:page?.activeTarget?clone(page.activeTarget):null,lastObservedTarget:controlRow?clone(controlRow.value):null,semanticControls:semantic?.controls?clone(semantic.controls):null},content:{tabContext:context?clone(context):null,page:page?clone(page):null,semantic:semantic?clone(semantic):null},environment:{online:browser.online===true,browserState:String(browser.state||'UNKNOWN'),eligible:browser.environment?.eligible===true,status:String(browser.environment?.status||'UNKNOWN'),reasons:Array.isArray(browser.environment?.reasons)?browser.environment.reasons.map(String):[]},freshness:{liveRefreshAttempted:refresh.attempted===true,liveRefreshSucceeded:refresh.succeeded===true,tabContextAgeMs:ageMs(now,contextRow),pageAgeMs:ageMs(now,pageRow),semanticAgeMs:ageMs(now,semanticRow),controlAgeMs:ageMs(now,controlRow)}};
    return stripJudgment(observation);
  }

  executionFacts(raw,kind){const nested=raw?.execution&&typeof raw.execution==='object'?raw.execution:null,commandId=raw?.commandId??nested?.commandId??null;if(kind==='motor'){const planned=optionalInteger(nested?.plannedStepCount),completed=optionalInteger(nested?.completedStepCount),issued=optionalInteger(nested?.issuedStepCount)??0;return {commandId,dispatched:nested?.delivered===true||issued>0,completed:nested?.delivered===true&&(planned===null||completed===planned),plannedLowLevelSteps:planned,completedLowLevelSteps:completed,changes:stripJudgment(nested?.observedEffect??null)};}if(kind==='browser_ui'){const count=optionalInteger(raw?.executionAudit?.stepCount);return {commandId,dispatched:raw?.delivered===true||raw?.focus?.fastExecuted===true||Boolean(count&&count>0),completed:raw?.delivered===true,plannedLowLevelSteps:count,completedLowLevelSteps:raw?.delivered===true?count:null,changes:stripJudgment(raw?.observedEffect??null)};}return {commandId,dispatched:raw?.switched===true,completed:raw?.switched===true,plannedLowLevelSteps:null,completedLowLevelSteps:null,changes:null};}
  rejectedResult(message,error,{replayed=false}={}){const stepId=nonEmpty(message?.stepId)?String(message.stepId):'__invalid__',taskId=nonEmpty(message?.taskId)?String(message.taskId):'__invalid__';return {contractVersion:BODY_CONTRACT_VERSION,type:'BODY_STEP_RESULT',stepId,taskId,action:{kind:STEP_KINDS.has(message?.step?.kind)?message.step.kind:'unknown',name:actionName(message?.step)},execution:{accepted:false,attemptCount:0,replayed:replayed===true,dispatched:false,completed:false,commandId:null,plannedLowLevelSteps:null,completedLowLevelSteps:null,error:technicalError(error)},observation:{before:null,after:null,changes:null}};}
  reservedUnknownResult(command){return this.rejectedResult(command,errorWithCode('body_step_outcome_unknown','step was durably reserved by an earlier execution context; BODY will not execute it again'),{replayed:true});}

  async executeOnce(command){
    const tabRef=command.step.kind==='tab_switch'?Number(command.step.targetTabId):command.tabId;let context=null,before=null,after=null,raw=null,accepted=false,attemptCount=0;
    try{
      context=this.runtime.tasks.executionContext(command.taskId,tabRef,{autoStart:false});accepted=true;
      before=await this.observe({browserInstanceId:context.browserInstanceId,tabId:context.tabId});
      attemptCount=1;
      if(command.step.kind==='motor')raw=await this.runtime.executeIntent(command.step.intent,{extensionId:context.extensionInstanceId,tabId:context.tabId});
      else if(command.step.kind==='browser_ui')raw=await this.runtime.executeBrowserCommand(command.step.action,{extensionId:context.extensionInstanceId,tabId:context.tabId,value:command.step.value??null});
      else raw=await this.runtime.switchTab(context.extensionInstanceId,context.tabId);
      after=await this.observe({browserInstanceId:context.browserInstanceId,tabId:context.tabId});
      const facts=this.executionFacts(raw,command.step.kind);
      return stripJudgment({contractVersion:BODY_CONTRACT_VERSION,type:'BODY_STEP_RESULT',stepId:command.stepId,taskId:command.taskId,action:{kind:command.step.kind,name:actionName(command.step)},execution:{accepted:true,attemptCount:1,replayed:false,dispatched:facts.dispatched,completed:facts.completed,commandId:facts.commandId,plannedLowLevelSteps:facts.plannedLowLevelSteps,completedLowLevelSteps:facts.completedLowLevelSteps,error:null},observation:{before,after,changes:facts.changes}});
    }catch(error){
      if(context)try{after=await this.observe({browserInstanceId:context.browserInstanceId,tabId:context.tabId});}catch{}
      return stripJudgment({contractVersion:BODY_CONTRACT_VERSION,type:'BODY_STEP_RESULT',stepId:command.stepId,taskId:command.taskId,action:{kind:command.step.kind,name:actionName(command.step)},execution:{accepted,attemptCount,replayed:false,dispatched:attemptCount===0?false:null,completed:false,commandId:raw?.commandId??raw?.execution?.commandId??null,plannedLowLevelSteps:null,completedLowLevelSteps:null,error:technicalError(error)},observation:{before,after,changes:null}});
    }
  }

  async execute(message={}){
    let command;try{command=validateBodyStepCommand(message);}catch(error){return this.rejectedResult(message,error);}
    let lookup;try{lookup=this.ledger.lookup(command);}catch(error){return this.rejectedResult(command,error);}
    if(lookup.status==='done'&&lookup.entry?.result)return replayResult(lookup.entry.result,true);
    if(lookup.status==='reserved'){
      const running=this.inflight.get(lookup.key);
      if(running&&running.hash===lookup.hash)return replayResult(await running.promise,true);
      return this.reservedUnknownResult(command);
    }
    let reserved;try{reserved=this.ledger.reserve(command);}catch(error){return this.rejectedResult(command,error);}
    if(reserved.status!=='reserved-new')return this.reservedUnknownResult(command);
    const promise=this.executeOnce(command).then(result=>{try{this.ledger.commit(command,result);this.lastLedgerError=null;}catch(error){this.lastLedgerError=technicalError(error);}return result;});
    this.inflight.set(reserved.key,{hash:reserved.hash,promise});
    try{return await promise;}finally{const current=this.inflight.get(reserved.key);if(current?.promise===promise)this.inflight.delete(reserved.key);}
  }
}

module.exports={BODY_CONTRACT_VERSION,MOTOR_TYPES,BROWSER_UI_ACTIONS,STEP_KINDS,FORBIDDEN_JUDGMENT_KEYS,stripJudgment,judgmentPaths,validateBodyStepCommand,BodyStepGateway};
