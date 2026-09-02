'use strict';

const path=require('node:path');
const {WebSocket}=require('ws');
const {
  ExtensionRegistry,ScopedLearningManager,normalizeSiteKey,HumanActionSegmenter,
  StrategyExecutor,modalityOf,TabHabitModel
}=require('./runtime_exports');
const {MotorPlanner}=require('./motor_planner');
const {BrowserUiAdapter}=require('./browser_ui_adapter');
const {createWindowsInputRunner}=require('./windows_native_input');
const {ExecutionLane}=require('./execution_lane');

function createDaemonRuntime({baseDir=path.join(__dirname,'..'),printAsync=()=>{}}={}){
  const registry=new ExtensionRegistry();
  const learning=new ScopedLearningManager(path.join(baseDir,'profiles'));
  const tabHabit=new TabHabitModel(path.join(baseDir,'profiles','_tab_habits.json'));
  const execution=new ExecutionLane();
  const pending=new Map(),pointers=new Map(),segmenters=new Map(),tabSites=new Map();
  let recordingEnabled=true,learningEnabled=true;
  const id=(p='r')=>`${p}-${Date.now()}-${process.hrtime.bigint().toString(36)}`;
  const ctx=(ext,tab)=>`${ext}/${Number(tab)}`;
  const segKey=(ext,tab,site)=>`${ctx(ext,tab)}/${normalizeSiteKey(site)}`;
  const send=(ws,obj)=>ws?.readyState===WebSocket.OPEN?(ws.send(JSON.stringify(obj)),true):false;
  const pnum=(v,n)=>{const x=Number(v);if(!Number.isFinite(x))throw new Error(`${n}_required`);return x;};

  function requestExtension(extensionId,type,payload={},timeoutMs=30000){
    const ext=registry.require(extensionId),requestId=id(type.toLowerCase());
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(requestId);reject(new Error(`extension_timeout:${extensionId}:${type}`));},timeoutMs);
      pending.set(requestId,{extensionId:ext.extensionId,type,resolve,reject,timer});
      if(!send(ext.ws,{type,requestId,...payload})){
        clearTimeout(timer);pending.delete(requestId);reject(new Error(`extension_not_connected:${extensionId}:${type}`));
      }
    });
  }

  function rejectPendingForExtension(extensionId,reason='extension_disconnected'){
    const extId=String(extensionId);
    let rejected=0;
    for(const [requestId,p] of [...pending.entries()]){
      if(String(p.extensionId)!==extId)continue;
      clearTimeout(p.timer);pending.delete(requestId);rejected++;
      p.reject(new Error(`${reason}:${extId}:${p.type||'request'}`));
    }
    return rejected;
  }

  function resolveResponse(extId,msg){
    if(msg.type!=='RESPONSE'||!msg.requestId)return false;
    const p=pending.get(msg.requestId);if(!p)return true;
    clearTimeout(p.timer);pending.delete(msg.requestId);
    if(p.extensionId!==extId)p.reject(new Error('extension_response_scope_mismatch'));
    else if(msg.ok)p.resolve(msg.result);
    else p.reject(new Error(msg.error?.message||'extension_error'));
    return true;
  }
  function selected(explicit=null){return registry.require(explicit||null).extensionId;}
  async function refreshTabs(extId){
    const tabs=await requestExtension(extId,'LIST_TABS');registry.updateTabs(extId,tabs);
    for(const t of tabs)tabSites.set(ctx(extId,t.id),normalizeSiteKey(t.siteKey));return tabs;
  }
  async function resolveTab(extId,ref='active'){
    const ext=registry.require(extId);
    if(ref==='active'||ref==null){
      if(Number.isInteger(ext.activeTabId)&&ext.tabs.get(ext.activeTabId))return ext.tabs.get(ext.activeTabId);
      const tab=await requestExtension(extId,'ACTIVE_TAB');registry.activateTab(extId,tab.id,tab);tabSites.set(ctx(extId,tab.id),normalizeSiteKey(tab.siteKey));return tab;
    }
    const tabId=Number(ref);if(!Number.isInteger(tabId))throw new Error('invalid_tab_id');
    let tab=ext.tabs.get(tabId);if(!tab){await refreshTabs(extId);tab=registry.require(extId).tabs.get(tabId);}
    if(!tab)throw new Error(`tab_not_found:${extId}:${tabId}`);return tab;
  }

  function segmenter(extId,tabId,siteKey){
    const key=segKey(extId,tabId,siteKey);if(segmenters.has(key))return segmenters.get(key);
    const s=new HumanActionSegmenter(sample=>{
      const learned=learning.observeHumanSample(extId,siteKey,{...sample,tabId:Number(tabId)},{learn:learningEnabled});
      printAsync(`[HỌC] ext=${String(extId).slice(0,8)} tab=${tabId} site=${normalizeSiteKey(siteKey)} action=${learned.action}`);
    });segmenters.set(key,s);return s;
  }

  function disposeSegmentersForTab(extId,tabId,{flush=true}={}){
    const prefix=`${ctx(extId,tabId)}/`;
    let disposed=0,emitted=0;
    for(const [key,s] of [...segmenters.entries()]){
      if(!key.startsWith(prefix))continue;
      const result=s.dispose(Number(tabId),{flush});
      disposed++;emitted+=Number(result?.emitted||0);segmenters.delete(key);
    }
    return {disposed,emitted};
  }

  function disposeSegmentersForExtension(extId,{flush=true}={}){
    const prefix=`${String(extId)}/`;
    let disposed=0,emitted=0;
    for(const [key,s] of [...segmenters.entries()]){
      if(!key.startsWith(prefix))continue;
      const result=s.dispose(null,{flush});
      disposed++;emitted+=Number(result?.emitted||0);segmenters.delete(key);
    }
    return {disposed,emitted};
  }

  function recorderEvent(extId,msg){
    const tabId=Number(msg.tabId),event=msg.event;if(!event)return;
    const siteKey=normalizeSiteKey(msg.siteKey||tabSites.get(ctx(extId,tabId))||'__unknown__');
    tabSites.set(ctx(extId,tabId),siteKey);learning.observeEvent(extId,siteKey,tabId,event);
    if(['mousemove','mousedown','mouseup','wheel'].includes(event.eventType)&&Number.isFinite(Number(event.x))&&Number.isFinite(Number(event.y)))pointers.set(ctx(extId,tabId),{x:Number(event.x),y:Number(event.y)});
    if(event.source==='human')segmenter(extId,tabId,siteKey).handle(tabId,event);
  }
  function tabEvent(extId,event){
    const tabId=Number(event.tabId),siteKey=normalizeSiteKey(event.siteKey);tabSites.set(ctx(extId,tabId),siteKey);
    registry.activateTab(extId,tabId,{siteKey,title:event.title||'',windowId:event.windowId});tabHabit.observe(extId,{...event,siteKey});
    if(event.source==='human')learning.observeHumanSample(extId,siteKey,{source:'human',action:'switchTab',tabId,context:{target_role:'browser_tab',target_site:siteKey,windowId:event.windowId}},{learn:learningEnabled});
  }
  function tabContext(extId,msg){
    const key=ctx(extId,msg.tabId),previous=tabSites.get(key)||null,siteKey=normalizeSiteKey(msg.context?.siteKey);
    if(previous&&previous!==siteKey)disposeSegmentersForTab(extId,msg.tabId,{flush:true});
    tabSites.set(key,siteKey);registry.updateTab(extId,msg.tabId,{...msg.context,siteKey});
  }
  function tabRemoved(extId,tabId){
    disposeSegmentersForTab(extId,tabId,{flush:true});
    registry.removeTab(extId,tabId);pointers.delete(ctx(extId,tabId));tabSites.delete(ctx(extId,tabId));
  }
  function extensionOffline(extId){
    const rejected=rejectPendingForExtension(extId,'extension_disconnected');
    const segments=disposeSegmentersForExtension(extId,{flush:true});
    for(const key of [...pointers.keys()])if(key.startsWith(`${String(extId)}/`))pointers.delete(key);
    for(const key of [...tabSites.keys()])if(key.startsWith(`${String(extId)}/`))tabSites.delete(key);
    return {rejectedPending:rejected,...segments};
  }

  async function executeIntent(intent,{extensionId=null,tabId='active'}={}){
    const extId=selected(extensionId);
    return execution.run(extId,{capability:'HUMAN_MOTOR',operation:'intent',action:String(intent?.type||'unknown')},async()=>{
      const tab=await resolveTab(extId,tabId),tid=Number(tab.id),siteKey=normalizeSiteKey(tab.siteKey||tabSites.get(ctx(extId,tid)));
      const planner=new MotorPlanner(learning.motorFor(extId,siteKey)),planned=planner.plan(intent,{pointerStart:pointers.get(ctx(extId,tid))||{x:400,y:300}}),commandId=id(intent.type||'action');
      const result=await requestExtension(extId,'BODY_EXECUTE',{commandId,tabId:tid,deadlineMs:Number(intent.deadlineMs||60000),plan:planned.plan},65000);
      return {commandId,extensionId:extId,tabId:tid,siteKey,behaviorSource:planned.source,learnedGroup:planned.learnedGroup,learnedTemplateCount:planned.learnedTemplateCount,execution:result};
    });
  }
  function history(extId,siteKey,tabId,targetRole='unknown'){
    const site=learning.scope(extId,siteKey),global=learning.globalScope(extId),last=site.habit.state?.lastHumanByTab?.[String(tabId)]||global.habit.state?.lastHumanByTab?.[String(tabId)]||null;
    return {previousAction:last?.action||'unknown',previousModality:last?modalityOf(last):'unknown',targetRole:String(targetRole||'unknown').toLowerCase()};
  }
  async function executeStrategy(task,{extensionId=null,tabId='active'}={}){
    const extId=selected(extensionId);
    return execution.run(extId,{capability:'HUMAN_MOTOR',operation:'strategy',habitKey:String(task?.habitKey||'unknown')},async()=>{
      const tab=await resolveTab(extId,tabId),tid=Number(tab.id),siteKey=normalizeSiteKey(tab.siteKey||tabSites.get(ctx(extId,tid)));
      const executor=new StrategyExecutor(learning.habitFor(extId,siteKey),new MotorPlanner(learning.motorFor(extId,siteKey))),decision=executor.choose(task,history(extId,siteKey,tid,task.targetRole||task.role));
      const planned=executor.planSelected(decision,{pointerStart:pointers.get(ctx(extId,tid))||{x:400,y:300}}),commandId=id(`strategy-${planned.strategyId}`);
      const result=await requestExtension(extId,'BODY_EXECUTE',{commandId,tabId:tid,deadlineMs:Number(task.deadlineMs||60000),plan:planned.plan},65000);
      return {commandId,extensionId:extId,tabId:tid,siteKey,habitScope:decision.scopeSource||'site',habitKey:task.habitKey,selectedStrategy:planned.strategyId,selectedModality:planned.modality,score:planned.score,habitObservations:decision.totalHabitObservations,ranking:decision.ranking.map(x=>({id:x.id,modality:x.modality,score:x.score,habitCount:x.habitCount,transitionModalityCount:x.transitionModalityCount,transitionActionCount:x.transitionActionCount})),subPlans:planned.subPlans,execution:result};
    });
  }
  async function switchTab(extensionId,tabId){
    const extId=selected(extensionId);
    return execution.run(extId,{capability:'BROWSER_UI',operation:'tab_switch',tabId:Number(tabId)},async()=>{
      const tab=await resolveTab(extId,tabId),commandId=id('switch-tab');
      const result=await requestExtension(extId,'TAB_SWITCH',{commandId,tabId:Number(tab.id)});registry.activateTab(extId,Number(tab.id),{...tab,active:true,siteKey:normalizeSiteKey(result.siteKey||tab.siteKey)});
      return {extensionId:extId,commandId,source:'agent',...result};
    });
  }
  const runWindowsInput=createWindowsInputRunner({baseDir});
  async function browserSnapshot(extId){
    const tabs=await refreshTabs(extId);let active=tabs.find(t=>t.active)||null;try{active=await requestExtension(extId,'ACTIVE_TAB');}catch{}return {tabs,active};
  }
  const browserUi=new BrowserUiAdapter({
    resolveTarget:async({extensionId,tabId})=>{const extId=selected(extensionId),tab=await resolveTab(extId,tabId);return {extensionId:extId,tab};},
    focusTarget:({extensionId,tab,action,commandId})=>requestExtension(extensionId,'FOCUS_WINDOW',{tabId:Number(tab.id),browserAction:action,commandId}),
    finishTarget:({extensionId,commandId})=>requestExtension(extensionId,'BROWSER_UI_END',{commandId},5000),
    snapshot:browserSnapshot,runNativeInput:runWindowsInput
  });
  function executeBrowserCommand(action,{extensionId=null,tabId='active',value=null}={}){
    const extId=selected(extensionId);
    return execution.run(extId,{capability:'BROWSER_UI',operation:'browser_command',action:String(action||'unknown')},()=>browserUi.execute(action,{extensionId:extId,tabId,value}));
  }

  function flushSync(){
    let emitted=0;
    for(const s of segmenters.values())emitted+=Number(s.flush()?.emitted||0);
    const learningResult=learning.flushSync();
    const tabHabitResult=tabHabit.flushSync();
    return {segmenterEmitted:emitted,learning:learningResult,tabHabitOk:tabHabitResult.ok};
  }

  return {
    registry,learning,tabHabit,execution,pending,pointers,tabSites,id,ctx,pnum,send,requestExtension,rejectPendingForExtension,resolveResponse,selected,refreshTabs,resolveTab,
    recorderEvent,tabEvent,tabContext,tabRemoved,extensionOffline,disposeSegmentersForTab,disposeSegmentersForExtension,
    executeIntent,executeStrategy,switchTab,executeBrowserCommand,flushSync,
    get recordingEnabled(){return recordingEnabled;},set recordingEnabled(value){recordingEnabled=value===true;},
    get learningEnabled(){return learningEnabled;},set learningEnabled(value){learningEnabled=value===true;}
  };
}

module.exports={createDaemonRuntime};
