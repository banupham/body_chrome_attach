'use strict';

const path=require('node:path');
const {WebSocket}=require('ws');
const {ExtensionRegistry,ScopedLearningManager,normalizeSiteKey,HumanActionSegmenter,StrategyExecutor,modalityOf,TabHabitModel}=require('./runtime_exports');
const {MotorPlanner}=require('./motor_planner');
const {BrowserUiAdapter}=require('./browser_ui_adapter');
const {createWindowsInputRunner}=require('./windows_native_input');
const {ExecutionLane}=require('./execution_lane');
const {LocalIdentityStore}=require('./local_identity');
const {BrowserManager}=require('./browser_manager');
const {TaskManager}=require('./task_manager');
const {EnvironmentGuardian}=require('./environment_guardian');
const {EvidenceStore}=require('./evidence_store');
const {EvidenceAssembler}=require('./evidence_assembler');
const {PointerStateManager}=require('./pointer_state_manager');

function syncBrowserExecutionState(browsers,extensionId,laneState={}){
  const browser=browsers?.browserForExtension?.(extensionId)||null;
  if(!browser||!browser.online)return null;
  if(laneState.busy===true){
    if(['ACTIVE','BUSY'].includes(browser.state)){
      const operation=laneState.current?.operation||'queued';
      return browsers.setState(browser.browserInstanceId,'BUSY',`execution_lane:${operation}`);
    }
    return browsers.public(browser);
  }
  if(browser.state!=='BUSY')return browsers.public(browser);
  if(browser.environment?.eligible===true)return browsers.setState(browser.browserInstanceId,'ACTIVE','execution_lane_idle');
  return browsers.setState(browser.browserInstanceId,'QUARANTINED','execution_lane_idle_environment_ineligible');
}

function createDaemonRuntime({baseDir=path.join(__dirname,'..'),printAsync=()=>{},identityOptions={},taskOptions={},environmentOptions={}}={}){
  const identity=new LocalIdentityStore(baseDir,identityOptions);
  const registry=new ExtensionRegistry();
  const browsers=new BrowserManager(identity);
  const tasks=new TaskManager(baseDir,browsers,taskOptions);
  const resolveLearningIdentity=ref=>identityForExtension(ref);
  const learning=new ScopedLearningManager(path.join(baseDir,'profiles'),{resolveIdentity:resolveLearningIdentity});
  const tabHabit=new TabHabitModel(path.join(baseDir,'profiles','_tab_habits.json'),{resolveIdentity:resolveLearningIdentity});
  const evidenceStore=new EvidenceStore(path.join(baseDir,'evidence'));
  const evidence=new EvidenceAssembler(evidenceStore);
  const execution=new ExecutionLane({onStateChange:(extensionId,state)=>syncBrowserExecutionState(browsers,extensionId,state)});
  const pointerState=new PointerStateManager();
  const pending=new Map(),segmenters=new Map(),tabSites=new Map();let recordingEnabled=true,learningEnabled=true;
  const id=(p='r')=>`${p}-${Date.now()}-${process.hrtime.bigint().toString(36)}`,ctx=(ext,tab)=>`${ext}/${Number(tab)}`,segKey=(ext,tab,site)=>`${ctx(ext,tab)}/${normalizeSiteKey(site)}`;
  const send=(ws,obj)=>ws?.readyState===WebSocket.OPEN?(ws.send(JSON.stringify(obj)),true):false,pnum=(v,n)=>{const x=Number(v);if(!Number.isFinite(x))throw new Error(`${n}_required`);return x;};

  function requestExtension(extensionId,type,payload={},timeoutMs=30000){const ext=registry.require(extensionId),requestId=id(type.toLowerCase());return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(requestId);reject(new Error(`extension_timeout:${extensionId}:${type}`));},timeoutMs);pending.set(requestId,{extensionId:ext.extensionId,type,resolve,reject,timer});if(!send(ext.ws,{type,requestId,...payload})){clearTimeout(timer);pending.delete(requestId);reject(new Error(`extension_not_connected:${extensionId}:${type}`));}});}
  const guardian=new EnvironmentGuardian(baseDir,browsers,{...environmentOptions,requestExtension,env:environmentOptions.env||identityOptions.env||process.env});

  function registerExtensionIdentity({browserInstanceId,extensionInstanceId,runtimeExtensionId}){return identity.registerBrowser({browserInstanceId,extensionInstanceId,runtimeExtensionId});}
  function identityForExtension(extensionId=null){const item=registry.get(extensionId||null);if(item?.browserInstanceId){const chain=identity.identityChain(item.browserInstanceId);if(chain)return chain;}return {...identity.snapshot(),browserInstanceId:item?.browserInstanceId||null,extensionInstanceId:item?.extensionInstanceId||item?.extensionId||extensionId||null,runtimeExtensionId:item?.runtimeExtensionId||null,platformIdentities:{}};}
  function extensionOnline(item){const browser=browsers.registerExtension(item);learning.bindIdentity(item.extensionId);tabHabit.bindIdentity(item.extensionId);const reconcile=tasks.reconcileBrowser(browser.browserInstanceId);return {browser,reconcile};}
  function rejectPendingForExtension(extensionId,reason='extension_disconnected'){const extId=String(extensionId);let rejected=0;for(const [requestId,p] of [...pending.entries()]){if(String(p.extensionId)!==extId)continue;clearTimeout(p.timer);pending.delete(requestId);rejected++;p.reject(new Error(`${reason}:${extId}:${p.type||'request'}`));}return rejected;}
  function resolveResponse(extId,msg){if(msg.type!=='RESPONSE'||!msg.requestId)return false;const p=pending.get(msg.requestId);if(!p)return true;clearTimeout(p.timer);pending.delete(msg.requestId);if(p.extensionId!==extId)p.reject(new Error('extension_response_scope_mismatch'));else if(msg.ok)p.resolve(msg.result);else p.reject(new Error(msg.error?.message||'extension_error'));return true;}
  function selected(explicit=null){return registry.require(explicit||null).extensionId;}
  async function refreshTabs(extId){const tabs=await requestExtension(extId,'LIST_TABS');registry.updateTabs(extId,tabs);browsers.updateTabsByExtension(extId,tabs);for(const t of tabs)tabSites.set(ctx(extId,t.id),normalizeSiteKey(t.siteKey));return tabs;}
  async function resolveTab(extId,ref='active'){const ext=registry.require(extId);if(ref==='active'||ref==null){if(Number.isInteger(ext.activeTabId)&&ext.tabs.get(ext.activeTabId))return ext.tabs.get(ext.activeTabId);const tab=await requestExtension(extId,'ACTIVE_TAB');registry.activateTab(extId,tab.id,tab);browsers.updateTabByExtension(extId,tab.id,{...tab,active:true});tabSites.set(ctx(extId,tab.id),normalizeSiteKey(tab.siteKey));return tab;}const tabId=Number(ref);if(!Number.isInteger(tabId))throw new Error('invalid_tab_id');let tab=ext.tabs.get(tabId);if(!tab){await refreshTabs(extId);tab=registry.require(extId).tabs.get(tabId);}if(!tab)throw new Error(`tab_not_found:${extId}:${tabId}`);return tab;}
  async function pointerStatus(extensionId=null,tabId='active'){const extId=selected(extensionId),tab=await resolveTab(extId,tabId);return pointerState.snapshot(identityForExtension(extId),Number(tab.id));}
  function pointerContext(extId,tabId){const state=pointerState.get(identityForExtension(extId),tabId);return state?{state,pointerStart:{x:state.x,y:state.y}}:{state:null};}
  function segmenter(extId,tabId,siteKey){const key=segKey(extId,tabId,siteKey);if(segmenters.has(key))return segmenters.get(key);const s=new HumanActionSegmenter(sample=>{const learned=learning.observeHumanSample(extId,siteKey,{...sample,tabId:Number(tabId)},{learn:learningEnabled});printAsync(`[HỌC] browser=${String(learned.browserInstanceId).slice(0,12)} tab=${tabId} site=${normalizeSiteKey(siteKey)} action=${learned.action}`);});segmenters.set(key,s);return s;}
  function disposeSegmentersForTab(extId,tabId,{flush=true}={}){const prefix=`${ctx(extId,tabId)}/`;let disposed=0,emitted=0;for(const [key,s] of [...segmenters.entries()]){if(!key.startsWith(prefix))continue;const result=s.dispose(Number(tabId),{flush});disposed++;emitted+=Number(result?.emitted||0);segmenters.delete(key);}return {disposed,emitted};}
  function disposeSegmentersForExtension(extId,{flush=true}={}){const prefix=`${String(extId)}/`;let disposed=0,emitted=0;for(const [key,s] of [...segmenters.entries()]){if(!key.startsWith(prefix))continue;const result=s.dispose(null,{flush});disposed++;emitted+=Number(result?.emitted||0);segmenters.delete(key);}return {disposed,emitted};}
  function recorderEvent(extId,msg){
    const tabId=Number(msg.tabId),event=msg.event;if(!event)return null;
    const siteKey=normalizeSiteKey(msg.siteKey||tabSites.get(ctx(extId,tabId))||'__unknown__');
    tabSites.set(ctx(extId,tabId),siteKey);
    const identityChain=identityForExtension(extId);
    const evidenceCandidate=evidence.observeRecorder(identityChain,siteKey,tabId,event);
    const trainingEvent={...event};delete trainingEvent.semanticBefore;
    learning.observeEvent(extId,siteKey,tabId,trainingEvent);
    pointerState.observeRecorder(identityChain,tabId,trainingEvent);
    if(trainingEvent.source==='human')segmenter(extId,tabId,siteKey).handle(tabId,trainingEvent);
    return evidenceCandidate;
  }
  function semanticObservation(extId,msg){
    const tabId=Number(msg.tabId);if(!Number.isInteger(tabId)||!msg.observation)return null;
    const siteKey=normalizeSiteKey(msg.siteKey||tabSites.get(ctx(extId,tabId))||'__unknown__');
    tabSites.set(ctx(extId,tabId),siteKey);
    return evidence.observeAfter(identityForExtension(extId),siteKey,tabId,msg.observation);
  }
  function tabEvent(extId,event){const tabId=Number(event.tabId),siteKey=normalizeSiteKey(event.siteKey);tabSites.set(ctx(extId,tabId),siteKey);registry.activateTab(extId,tabId,{siteKey,title:event.title||'',windowId:event.windowId});browsers.updateTabByExtension(extId,tabId,{siteKey,title:event.title||'',windowId:event.windowId,active:true});tabHabit.observe(extId,{...event,siteKey});if(event.source==='human')learning.observeHumanSample(extId,siteKey,{source:'human',action:'switchTab',tabId,context:{target_role:'browser_tab',target_site:siteKey,windowId:event.windowId}},{learn:learningEnabled});}
  function tabContext(extId,msg){const key=ctx(extId,msg.tabId),previous=tabSites.get(key)||null,siteKey=normalizeSiteKey(msg.context?.siteKey);if(previous&&previous!==siteKey)disposeSegmentersForTab(extId,msg.tabId,{flush:true});tabSites.set(key,siteKey);registry.updateTab(extId,msg.tabId,{...msg.context,siteKey});browsers.updateTabByExtension(extId,msg.tabId,{...msg.context,siteKey});}
  function tabRemoved(extId,tabId){const chain=identityForExtension(extId);evidence.clearTab(chain,tabId);disposeSegmentersForTab(extId,tabId,{flush:true});registry.removeTab(extId,tabId);browsers.removeTabByExtension(extId,tabId);if(chain.browserInstanceId)pointerState.clearTab(chain,tabId);tabSites.delete(ctx(extId,tabId));}
  function extensionOffline(extId){const chain=identityForExtension(extId),browser=browsers.browserForExtension(extId),browserId=browser?.browserInstanceId||chain.browserInstanceId||null,rejected=rejectPendingForExtension(extId,'extension_disconnected'),segments=disposeSegmentersForExtension(extId,{flush:true});if(browserId)evidence.clearBrowser(browserId);if(browserId)pointerState.clearBrowser(browserId);browsers.extensionOffline(extId);if(browserId)guardian.browserOffline(browserId);for(const key of [...tabSites.keys()])if(key.startsWith(`${String(extId)}/`))tabSites.delete(key);return {rejectedPending:rejected,...segments};}

  async function executeIntent(intent,{extensionId=null,tabId='active'}={}){
    const extId=selected(extensionId);
    return execution.run(extId,{capability:'HUMAN_MOTOR',operation:'intent',action:String(intent?.type||'unknown')},async()=>{
      const tab=await resolveTab(extId,tabId),tid=Number(tab.id),siteKey=normalizeSiteKey(tab.siteKey||tabSites.get(ctx(extId,tid))),chain=identityForExtension(extId),pointer=pointerContext(extId,tid),planner=new MotorPlanner(learning.motorFor(extId,siteKey)),planned=planner.plan(intent,pointer.pointerStart?{pointerStart:pointer.pointerStart}:{}),commandId=id(intent.type||'action'),result=await requestExtension(extId,'BODY_EXECUTE',{commandId,tabId:tid,deadlineMs:Number(intent.deadlineMs||60000),plan:planned.plan},65000),pointerAfter=pointerState.applyPlan(chain,tid,planned.plan,{source:'agent'});
      return {commandId,identity:chain,extensionId:extId,tabId:tid,siteKey,behaviorSource:planned.source,learnedGroup:planned.learnedGroup,learnedTemplateCount:planned.learnedTemplateCount,pointerBefore:pointer.state?{...pointer.state}:pointerState.snapshot(chain,tid),pointerAfter,execution:result};
    });
  }
  function history(extId,siteKey,tabId,targetRole='unknown'){const site=learning.scope(extId,siteKey),global=learning.globalScope(extId),last=site.habit.state?.lastHumanByTab?.[String(tabId)]||global.habit.state?.lastHumanByTab?.[String(tabId)]||null;return {previousAction:last?.action||'unknown',previousModality:last?modalityOf(last):'unknown',targetRole:String(targetRole||'unknown').toLowerCase()};}
  async function executeStrategy(task,{extensionId=null,tabId='active'}={}){
    const extId=selected(extensionId);
    return execution.run(extId,{capability:'HUMAN_MOTOR',operation:'strategy',habitKey:String(task?.habitKey||'unknown')},async()=>{
      const tab=await resolveTab(extId,tabId),tid=Number(tab.id),siteKey=normalizeSiteKey(tab.siteKey||tabSites.get(ctx(extId,tid))),chain=identityForExtension(extId),pointer=pointerContext(extId,tid),executor=new StrategyExecutor(learning.habitFor(extId,siteKey),new MotorPlanner(learning.motorFor(extId,siteKey))),decision=executor.choose(task,history(extId,siteKey,tid,task.targetRole||task.role)),planned=executor.planSelected(decision,pointer.pointerStart?{pointerStart:pointer.pointerStart}:{}),commandId=id(`strategy-${planned.strategyId}`),result=await requestExtension(extId,'BODY_EXECUTE',{commandId,tabId:tid,deadlineMs:Number(task.deadlineMs||60000),plan:planned.plan},65000),pointerAfter=pointerState.applyPlan(chain,tid,planned.plan,{source:'agent'});
      return {commandId,identity:chain,extensionId:extId,tabId:tid,siteKey,habitScope:decision.scopeSource||'site',habitKey:task.habitKey,selectedStrategy:planned.strategyId,selectedModality:planned.modality,score:planned.score,habitObservations:decision.totalHabitObservations,ranking:decision.ranking.map(x=>({id:x.id,modality:x.modality,score:x.score,habitCount:x.habitCount,transitionModalityCount:x.transitionModalityCount,transitionActionCount:x.transitionActionCount})),subPlans:planned.subPlans,pointerBefore:pointer.state?{...pointer.state}:pointerState.snapshot(chain,tid),pointerAfter,execution:result};
    });
  }
  async function switchTab(extensionId,tabId){const extId=selected(extensionId);return execution.run(extId,{capability:'BROWSER_UI',operation:'tab_switch',tabId:Number(tabId)},async()=>{const tab=await resolveTab(extId,tabId),commandId=id('switch-tab'),result=await requestExtension(extId,'TAB_SWITCH',{commandId,tabId:Number(tab.id)});registry.activateTab(extId,Number(tab.id),{...tab,active:true,siteKey:normalizeSiteKey(result.siteKey||tab.siteKey)});browsers.updateTabByExtension(extId,Number(tab.id),{...tab,active:true,siteKey:normalizeSiteKey(result.siteKey||tab.siteKey)});return {identity:identityForExtension(extId),extensionId:extId,commandId,source:'agent',...result};});}
  const runWindowsInput=createWindowsInputRunner({baseDir});async function browserSnapshot(extId){const tabs=await refreshTabs(extId);let active=tabs.find(t=>t.active)||null;try{active=await requestExtension(extId,'ACTIVE_TAB');}catch{}return {tabs,active};}
  const browserUi=new BrowserUiAdapter({resolveTarget:async({extensionId,tabId})=>{const extId=selected(extensionId),tab=await resolveTab(extId,tabId);return {extensionId:extId,tab};},focusTarget:({extensionId,tab,action,commandId})=>requestExtension(extensionId,'FOCUS_WINDOW',{tabId:Number(tab.id),browserAction:action,commandId}),finishTarget:({extensionId,commandId})=>requestExtension(extensionId,'BROWSER_UI_END',{commandId},5000),snapshot:browserSnapshot,runNativeInput:runWindowsInput});
  function executeBrowserCommand(action,{extensionId=null,tabId='active',value=null}={}){const extId=selected(extensionId);return execution.run(extId,{capability:'BROWSER_UI',operation:'browser_command',action:String(action||'unknown')},async()=>({identity:identityForExtension(extId),...await browserUi.execute(action,{extensionId:extId,tabId,value})}));}

  async function withTask(taskId,tabRef,work){const taskContext=tasks.executionContext(taskId,tabRef);return work(taskContext);}
  const executeTaskIntent=(taskId,intent,{tabId='primary'}={})=>withTask(taskId,tabId,async c=>({taskId:c.taskId,taskContext:c,...await executeIntent(intent,{extensionId:c.extensionInstanceId,tabId:c.tabId})}));
  const executeTaskStrategy=(taskId,strategy,{tabId='primary'}={})=>withTask(taskId,tabId,async c=>({taskId:c.taskId,taskContext:c,...await executeStrategy(strategy,{extensionId:c.extensionInstanceId,tabId:c.tabId})}));
  const executeTaskBrowserCommand=(taskId,action,{tabId='primary',value=null}={})=>withTask(taskId,tabId,async c=>({taskId:c.taskId,taskContext:c,...await executeBrowserCommand(action,{extensionId:c.extensionInstanceId,tabId:c.tabId,value})}));
  const executeTaskTabSwitch=(taskId,tabId)=>withTask(taskId,tabId,async c=>({taskId:c.taskId,taskContext:c,...await switchTab(c.extensionInstanceId,c.tabId)}));
  const probeEnvironment=browserInstanceId=>guardian.probeBrowser(browserInstanceId),probeAllEnvironments=()=>guardian.probeAll();

  function flushSync(){let emitted=0;for(const s of segmenters.values())emitted+=Number(s.flush()?.emitted||0);const learningResult=learning.flushSync(),tabHabitResult=tabHabit.flushSync(),identityResult=identity.flushSync(),taskResult=tasks.flushSync(),environmentResult=guardian.flushSync();return {segmenterEmitted:emitted,learning:learningResult,tabHabitOk:tabHabitResult.ok,identityOk:identityResult.ok,taskStateOk:taskResult.ok,environmentStateOk:environmentResult.ok,evidence:evidenceStore.stats(),pointerState:pointerState.stats()};}
  return {identity,registry,browsers,tasks,guardian,learning,tabHabit,evidenceStore,evidence,execution,pending,pointerState,tabSites,id,ctx,pnum,send,registerExtensionIdentity,identityForExtension,extensionOnline,requestExtension,rejectPendingForExtension,resolveResponse,selected,refreshTabs,resolveTab,pointerStatus,recorderEvent,semanticObservation,tabEvent,tabContext,tabRemoved,extensionOffline,disposeSegmentersForTab,disposeSegmentersForExtension,executeIntent,executeStrategy,switchTab,executeBrowserCommand,executeTaskIntent,executeTaskStrategy,executeTaskBrowserCommand,executeTaskTabSwitch,probeEnvironment,probeAllEnvironments,flushSync,get recordingEnabled(){return recordingEnabled;},set recordingEnabled(value){recordingEnabled=value===true;},get learningEnabled(){return learningEnabled;},set learningEnabled(value){learningEnabled=value===true;}};
}
module.exports={createDaemonRuntime,syncBrowserExecutionState};
