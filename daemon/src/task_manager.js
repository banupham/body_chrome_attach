'use strict';

const crypto=require('node:crypto');
const path=require('node:path');
const fs=require('node:fs');
const {SafeJsonPersistence}=require('./safe_json_persistence');
const {runtimeDataDir}=require('./runtime_data_dir');

const TASK_STATES=new Set(['READY','WAITING_APPROVAL','RUNNING','RECOVERY_REQUIRED','COMPLETED','FAILED','CANCELLED','REJECTED']);
const POLICY_CLASSES=new Set(['SAFE_AUTO','HUMAN_APPROVED','RESTRICTED']);
const ACTIVE_OWNERSHIP_STATES=new Set(['READY','RUNNING','RECOVERY_REQUIRED']);
const RESTRICTED_SIGNALS=new Set(['spam','fake_engagement','metric_manipulation','detector_evasion','anti_bot_evasion','fingerprint_spoofing','fingerprint_manipulation','proxy_concealment','vpn_concealment']);
const SAFE_CAPABILITIES=new Set(['youtube.search','youtube.open_video','youtube.open_channel','youtube.navigation','youtube.back','youtube.tab_switch','youtube.content_discovery','youtube.content_review','youtube.collect_metadata']);

function clone(v){return JSON.parse(JSON.stringify(v));}
function uniqueTabs(primaryTabId,tabIds=[]){const ids=[primaryTabId,...(Array.isArray(tabIds)?tabIds:[])].filter(x=>x!==null&&x!==undefined).map(Number);if(!ids.length||ids.some(x=>!Number.isInteger(x)))throw new Error('task_workspace_tabs_required');return [...new Set(ids)];}

class TaskPolicyGate{
  evaluate(task={}){
    const signals=[task.taskType,task.intentType,task.interactionIntent,...(Array.isArray(task.policySignals)?task.policySignals:[])].map(x=>String(x||'').trim().toLowerCase()).filter(Boolean);
    if(signals.some(x=>RESTRICTED_SIGNALS.has(x)))return {policyClass:'RESTRICTED',eligible:false,requiresApproval:false,reason:'restricted_signal'};
    const explicit=String(task.policyClass||'').trim().toUpperCase(),capability=String(task.capability||task.goal?.capability||'').trim();
    if(explicit==='RESTRICTED')return {policyClass:'RESTRICTED',eligible:false,requiresApproval:false,reason:'explicit_restricted'};
    if(task.externalInteraction===true||explicit==='HUMAN_APPROVED')return {policyClass:'HUMAN_APPROVED',eligible:task.humanApproved===true,requiresApproval:task.humanApproved!==true,reason:task.humanApproved===true?'approved':'human_approval_required'};
    if(explicit==='SAFE_AUTO'){
      if(SAFE_CAPABILITIES.has(capability)||task.internalOnly===true)return {policyClass:'SAFE_AUTO',eligible:true,requiresApproval:false,reason:'explicit_safe_validated'};
      return {policyClass:'HUMAN_APPROVED',eligible:false,requiresApproval:true,reason:'safe_auto_not_proven'};
    }
    if(SAFE_CAPABILITIES.has(capability))return {policyClass:'SAFE_AUTO',eligible:true,requiresApproval:false,reason:'safe_capability'};
    return {policyClass:'HUMAN_APPROVED',eligible:false,requiresApproval:true,reason:'unknown_task_requires_approval'};
  }
}

class TaskManager{
  constructor(baseDir,browserManager,{uuid=()=>crypto.randomUUID(),now=()=>Date.now(),env=process.env}={}){
    if(!browserManager)throw new Error('task_manager_browser_manager_required');
    const resolvedBaseDir=runtimeDataDir(baseDir,env);
    this.browserManager=browserManager;this.uuid=uuid;this.now=now;this.policy=new TaskPolicyGate();this.dir=path.join(resolvedBaseDir,'state');this.file=path.join(this.dir,'tasks.json');fs.mkdirSync(this.dir,{recursive:true});
    this.state=this._load();this.tabOwners=new Map();this._rebuildOwners();
    this.persistence=new SafeJsonPersistence(this.file,{getValue:()=>this.state,debounceMs:0,retryAfterMs:1000,log:null});
    let recovered=false;for(const task of Object.values(this.state.tasks)){if(task.state==='RUNNING'){task.state='RECOVERY_REQUIRED';task.error='daemon_restart_during_running_task';task.updatedAt=this._ts();recovered=true;}}
    if(recovered)this._persist();
  }
  _ts(){return new Date(this.now()).toISOString();}
  _load(){if(!fs.existsSync(this.file))return {schemaVersion:1,tasks:{}};let x;try{x=JSON.parse(fs.readFileSync(this.file,'utf8'));}catch{throw new Error('task_state_invalid_json');}if(Number(x.schemaVersion)!==1||!x.tasks||typeof x.tasks!=='object'||Array.isArray(x.tasks))throw new Error('task_state_invalid');return x;}
  _persist(){this.persistence.schedule();const r=this.persistence.flushSync();if(!r.ok)throw new Error(`task_state_persistence_failed:${r.lastError?.code||'UNKNOWN'}`);return r;}
  _mutate(work){const beforeState=clone(this.state),beforeOwners=new Map(this.tabOwners);try{const result=work();this._persist();return result;}catch(error){this.state=beforeState;this.tabOwners=beforeOwners;throw error;}}
  _key(browserId,tabId){return `${browserId}/${Number(tabId)}`;}
  _rebuildOwners(){for(const task of Object.values(this.state.tasks)){if(!ACTIVE_OWNERSHIP_STATES.has(task.state))continue;for(const tabId of task.workspace?.tabIds||[]){const key=this._key(task.workspace.browserInstanceId,tabId);if(this.tabOwners.has(key))throw new Error(`task_workspace_conflict_persisted:${key}`);this.tabOwners.set(key,task.taskId);}}}
  _claim(task){const ws=task.workspace;for(const tabId of ws.tabIds){const key=this._key(ws.browserInstanceId,tabId),owner=this.tabOwners.get(key);if(owner&&owner!==task.taskId)throw new Error(`tab_already_owned:${ws.browserInstanceId}:${tabId}:${owner}`);}for(const tabId of ws.tabIds)this.tabOwners.set(this._key(ws.browserInstanceId,tabId),task.taskId);}
  _release(task){for(const tabId of task.workspace?.tabIds||[]){const key=this._key(task.workspace.browserInstanceId,tabId);if(this.tabOwners.get(key)===task.taskId)this.tabOwners.delete(key);}}
  _assertWorkspace(browserInstanceId,primaryTabId,tabIds){const ids=uniqueTabs(primaryTabId,tabIds);for(const id of ids)this.browserManager.assertTab(browserInstanceId,id);return {browserInstanceId:String(browserInstanceId),primaryTabId:Number(primaryTabId??ids[0]),tabIds:ids};}

  create(spec={}){
    const taskId=String(spec.taskId||`task-${this.uuid()}`).trim();if(!taskId)throw new Error('task_id_required');if(this.state.tasks[taskId])throw new Error(`task_exists:${taskId}`);const browserId=String(spec.browserInstanceId||'').trim();if(!browserId)throw new Error('task_browser_required');
    const policy=this.policy.evaluate(spec),workspace=this._assertWorkspace(browserId,spec.primaryTabId,spec.tabIds),now=this._ts(),state=policy.policyClass==='RESTRICTED'?'REJECTED':policy.requiresApproval?'WAITING_APPROVAL':'READY';
    const task={taskId,capability:String(spec.capability||spec.goal?.capability||''),goal:clone(spec.goal||null),taskType:spec.taskType||null,policy,state,humanApproved:spec.humanApproved===true,workspace,createdAt:now,updatedAt:now,result:null,error:null};
    return this._mutate(()=>{if(ACTIVE_OWNERSHIP_STATES.has(state))this._claim(task);this.state.tasks[taskId]=task;return clone(task);});
  }

  get(taskId){const task=this.state.tasks[String(taskId||'')];if(!task)throw new Error(`task_not_found:${taskId}`);return task;}
  public(task){return clone(task);}
  list(){return Object.values(this.state.tasks).map(x=>clone(x)).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt),'en'));}
  approve(taskId){return this._mutate(()=>{const task=this.get(taskId);if(task.state!=='WAITING_APPROVAL')throw new Error(`task_not_waiting_approval:${task.taskId}`);task.humanApproved=true;task.policy={...task.policy,eligible:true,requiresApproval:false,reason:'approved'};this._claim(task);task.state='READY';task.updatedAt=this._ts();return clone(task);});}
  start(taskId){return this._mutate(()=>{const task=this.get(taskId);if(task.state!=='READY'&&task.state!=='RUNNING')throw new Error(`task_not_executable:${task.taskId}:${task.state}`);for(const tabId of task.workspace.tabIds)this.browserManager.assertTab(task.workspace.browserInstanceId,tabId);this._claim(task);task.state='RUNNING';task.updatedAt=this._ts();return clone(task);});}
  recover(taskId,{retry=false}={}){return this._mutate(()=>{const task=this.get(taskId);if(task.state!=='RECOVERY_REQUIRED')throw new Error(`task_not_recovery_required:${task.taskId}`);if(retry){for(const tabId of task.workspace.tabIds)this.browserManager.assertTab(task.workspace.browserInstanceId,tabId);task.state='READY';task.error=null;}else{this._release(task);task.state='FAILED';task.error='recovery_rejected';}task.updatedAt=this._ts();return clone(task);});}
  finish(taskId,state,payload=null){return this._mutate(()=>{const task=this.get(taskId),next=String(state||'').toUpperCase();if(!['COMPLETED','FAILED','CANCELLED'].includes(next))throw new Error(`invalid_task_terminal_state:${next}`);this._release(task);task.state=next;task.updatedAt=this._ts();if(next==='COMPLETED')task.result=clone(payload);else task.error=payload==null?null:String(payload);return clone(task);});}

  executionContext(taskId,tabRef='primary',{autoStart=true}={}){
    let task=this.get(taskId);
    if(task.state==='READY'&&autoStart){this.start(task.taskId);task=this.get(taskId);}
    else if(task.state!=='RUNNING')throw new Error(`task_not_executable:${task.taskId}:${task.state}`);
    const tabId=tabRef==='primary'||tabRef==null?task.workspace.primaryTabId:Number(tabRef);if(!task.workspace.tabIds.includes(Number(tabId)))throw new Error(`tab_not_owned_by_task:${task.taskId}:${tabId}`);
    const browser=this.browserManager.require(task.workspace.browserInstanceId);if(!browser.online)throw new Error(`browser_offline:${browser.browserInstanceId}`);this.browserManager.assertTab(browser.browserInstanceId,tabId);
    return {taskId:task.taskId,browserInstanceId:browser.browserInstanceId,extensionInstanceId:browser.extensionInstanceId,tabId:Number(tabId),policy:clone(task.policy)};
  }

  reconcileBrowser(browserInstanceId){
    const browser=this.browserManager.require(browserInstanceId),changed=[];
    this._mutate(()=>{for(const task of Object.values(this.state.tasks)){if(task.workspace?.browserInstanceId!==browser.browserInstanceId||!ACTIVE_OWNERSHIP_STATES.has(task.state))continue;const missing=task.workspace.tabIds.filter(id=>!browser.tabs.has(Number(id)));if(missing.length){this._release(task);task.state='FAILED';task.error=`workspace_tabs_missing:${missing.join(',')}`;task.updatedAt=this._ts();changed.push(task.taskId);}}return null;});
    return {browserInstanceId:browser.browserInstanceId,failedTasks:changed};
  }

  owners(){return [...this.tabOwners.entries()].map(([resource,taskId])=>({resource,taskId})).sort((a,b)=>a.resource.localeCompare(b.resource,'en'));}
  flushSync(){return this.persistence.flushSync();}
}

module.exports={TaskManager,TaskPolicyGate,TASK_STATES,POLICY_CLASSES,SAFE_CAPABILITIES,RESTRICTED_SIGNALS};
