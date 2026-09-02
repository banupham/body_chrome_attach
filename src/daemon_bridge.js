'use strict';

const DEFAULT_DAEMON_URL='ws://127.0.0.1:8765';
const PROTOCOL_VERSION=5;
const ALLOWED_METHODS=new Set(['Input.dispatchMouseEvent','Input.dispatchKeyEvent']);

function sleep(ms){ return new Promise(resolve=>setTimeout(resolve,Math.max(0,Number(ms)||0))); }
function siteKeyFromUrl(raw){try{const u=new URL(String(raw||''));if(u.protocol==='http:'||u.protocol==='https:')return u.hostname.toLowerCase();}catch{}return '__non_web__';}
function navigationToken(raw){const text=String(raw||'');let hash=0x811c9dc5;for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,0x01000193)>>>0;}return hash.toString(16).padStart(8,'0');}
function pointerEventType(type){return {mouseMoved:'mousemove',mousePressed:'mousedown',mouseReleased:'mouseup',mouseWheel:'wheel'}[type]||null;}
function keyEventType(type){if(type==='rawKeyDown'||type==='keyDown')return 'keydown';if(type==='keyUp')return 'keyup';return null;}
function targetSignature(target){if(!target)return null;return JSON.stringify({tag:target.tag||null,role:target.role||null,inputType:target.inputType||null,editable:target.editable===true,sensitive:target.sensitive===true,rect:target.rect||null});}
function observedEffect(before,after){
  const beforePage=before?.page?.available?before.page:null,afterPage=after?.page?.available?after.page:null;
  const navigationChanged=Boolean((before?.navigationToken&&after?.navigationToken&&before.navigationToken!==after.navigationToken)||Number(after?.navigationEpoch||0)>Number(before?.navigationEpoch||0));
  const activeTargetChanged=Boolean(beforePage&&afterPage&&targetSignature(beforePage.activeTarget)!==targetSignature(afterPage.activeTarget));
  const scrollChanged=Boolean(beforePage&&afterPage&&(Number(beforePage.scrollX)!==Number(afterPage.scrollX)||Number(beforePage.scrollY)!==Number(afterPage.scrollY)));
  const focusChanged=Boolean(beforePage&&afterPage&&beforePage.hasFocus!==afterPage.hasFocus);
  const visibilityChanged=Boolean(beforePage&&afterPage&&beforePage.visibilityState!==afterPage.visibilityState);
  const changed=navigationChanged||activeTargetChanged||scrollChanged||focusChanged||visibilityChanged;
  return {observed:Boolean(beforePage||afterPage||before||after),changed,navigationChanged,activeTargetChanged,scrollChanged,focusChanged,visibilityChanged};
}

class DaemonBridge{
  constructor(chromeApi,{gateway,WebSocketImpl=WebSocket,url=DEFAULT_DAEMON_URL}={}){
    if(!chromeApi||!gateway)throw new Error('daemon_bridge_dependencies_required');
    this.chrome=chromeApi;this.gateway=gateway;this.WebSocketImpl=WebSocketImpl;this.url=url;this.socket=null;this.reconnectTimer=null;this.keepaliveTimer=null;this.extensionInstanceId=null;this.authToken=null;this.recordingEnabled=true;this.cursorEnabled=true;this.expectedTabSwitch=new Map();this.expectedBrowserUi=null;this.navigationEpochByTab=new Map();this.started=false;
  }
  async identity(){const saved=await this.chrome.storage.local.get({bodyDaemonExtensionInstanceId:null,bodyDaemonAuthToken:null});if(saved.bodyDaemonExtensionInstanceId)this.extensionInstanceId=saved.bodyDaemonExtensionInstanceId;if(saved.bodyDaemonAuthToken)this.authToken=saved.bodyDaemonAuthToken;if(!this.extensionInstanceId){this.extensionInstanceId=crypto.randomUUID();await this.chrome.storage.local.set({bodyDaemonExtensionInstanceId:this.extensionInstanceId});}return {extensionInstanceId:this.extensionInstanceId,authToken:this.authToken};}
  async instanceId(){await this.identity();return this.extensionInstanceId;}
  send(obj){if(!this.socket||this.socket.readyState!==1)return false;this.socket.send(JSON.stringify({extensionId:this.extensionInstanceId,...obj}));return true;}
  async tabSnapshot(){const tabs=await this.chrome.tabs.query({});return tabs.map(t=>({id:t.id,active:t.active,windowId:t.windowId,title:t.title||'',siteKey:siteKeyFromUrl(t.url),navigationToken:navigationToken(t.url),navigationEpoch:Number(this.navigationEpochByTab.get(Number(t.id))||0),urlScheme:(()=>{try{return new URL(t.url).protocol;}catch{return '';}})()}));}
  async start(){if(this.started)return this.status();this.started=true;await this.identity();this.installTabListeners();this.connect();return this.status();}
  connect(){
    clearTimeout(this.reconnectTimer);let socket;try{socket=new this.WebSocketImpl(this.url);}catch{this.reconnectTimer=setTimeout(()=>this.connect(),1200);return;}this.socket=socket;
    socket.onopen=async()=>{const tabs=await this.tabSnapshot();this.send({type:'HELLO',role:'extension',protocolVersion:PROTOCOL_VERSION,token:this.authToken||null,extensionVersion:this.chrome.runtime.getManifest().version,runtimeExtensionId:this.chrome.runtime.id,tabs});clearInterval(this.keepaliveTimer);this.keepaliveTimer=setInterval(()=>this.send({type:'KEEPALIVE',ts:Date.now()}),20000);};
    socket.onmessage=event=>this.onMessage(event.data);socket.onerror=()=>{try{socket.close();}catch{}};socket.onclose=()=>{clearInterval(this.keepaliveTimer);if(this.started)this.reconnectTimer=setTimeout(()=>this.connect(),1200);};
  }
  async onMessage(raw){
    let msg;try{msg=JSON.parse(String(raw));}catch{return;}
    if(msg?.type==='AUTH_PAIRED'&&msg.token){this.authToken=String(msg.token);await this.chrome.storage.local.set({bodyDaemonAuthToken:this.authToken});return;}
    if(msg?.type==='AUTH_ERROR'){console.error('Body daemon authentication failed:',msg.error||'auth_error');try{this.socket?.close();}catch{}return;}
    if(!msg?.type)return;try{const result=await this.handle(msg);if(msg.requestId)this.send({type:'RESPONSE',requestId:msg.requestId,ok:true,result});}catch(error){if(msg.requestId)this.send({type:'RESPONSE',requestId:msg.requestId,ok:false,error:{code:error?.code||'extension_error',message:String(error?.message||error)}});}
  }
  activeTab(){return this.chrome.tabs.query({active:true,lastFocusedWindow:true}).then(tabs=>{const tab=tabs?.[0];if(!tab||!Number.isInteger(tab.id))throw new Error('active_tab_not_found');return tab;});}
  validatePlan(plan){if(!plan||plan.executionCapability!=='HUMAN_MOTOR')throw new Error('human_motor_capability_required');if(!Array.isArray(plan.steps)||plan.steps.length<1||plan.steps.length>20000)throw new Error('invalid_plan_steps');for(const [index,step] of plan.steps.entries()){if(!ALLOWED_METHODS.has(step?.method))throw new Error(`forbidden_method:${step?.method}:${index}`);const d=Number(step.delayMs||0),p=Number(step.postDelayMs||0);if(!Number.isFinite(d)||d<0||d>15000||!Number.isFinite(p)||p<0||p>15000)throw new Error(`invalid_delay:${index}`);}return plan;}
  agentEventFromStep(commandId,stepIndex,step){if(step.method==='Input.dispatchMouseEvent'){const eventType=pointerEventType(step.params?.type);if(!eventType)return null;return {eventType,ts:Date.now(),source:'agent',sourceConfidence:1,agentCommandId:commandId||null,agentStepIndex:stepIndex,x:Number(step.params?.x),y:Number(step.params?.y),deltaX:Number(step.params?.deltaX||0),deltaY:Number(step.params?.deltaY||0)};}if(step.method==='Input.dispatchKeyEvent'){const eventType=keyEventType(step.params?.type);if(!eventType)return null;return {eventType,ts:Date.now(),source:'agent',sourceConfidence:1,agentCommandId:commandId||null,agentStepIndex:stepIndex,key:step.params?.key||null,code:step.params?.code||null};}return null;}
  async pageObservation(tabId){try{const response=await this.chrome.tabs.sendMessage(Number(tabId),{action:'body.pageObservation'});if(response?.ok&&response.result)return response.result;}catch{}return {available:false};}
  async observeState(tabId){let tab=null;try{tab=await this.chrome.tabs.get(Number(tabId));}catch{}return {tabId:Number(tabId),siteKey:siteKeyFromUrl(tab?.url),navigationToken:navigationToken(tab?.url),navigationEpoch:Number(this.navigationEpochByTab.get(Number(tabId))||0),status:tab?.status||null,page:await this.pageObservation(tabId)};}
  async executePlan(msg){
    const plan=this.validatePlan(msg.plan),tabId=Number(msg.tabId);if(!Number.isInteger(tabId))throw new Error('invalid_tab_id');let siteKey='__unknown__';try{siteKey=siteKeyFromUrl((await this.chrome.tabs.get(tabId)).url);}catch{}
    const before=await this.observeState(tabId),startedAt=Date.now(),deadlineMs=Math.max(100,Math.min(120000,Number(msg.deadlineMs||30000)));let completed=0;const methods={};
    for(let i=0;i<plan.steps.length;i++){const step=plan.steps[i];if(Date.now()-startedAt>deadlineMs){await this.gateway.detach(tabId).catch(()=>{});throw new Error('execution_deadline_exceeded');}if(step.delayMs)await sleep(step.delayMs);await this.gateway.sendInput(tabId,step.method,step.params||{});completed++;methods[step.method]=(methods[step.method]||0)+1;const event=this.agentEventFromStep(msg.commandId,i,step);if(event)this.send({type:'RECORDER_EVENT',tabId,siteKey,event});if(step.postDelayMs)await sleep(step.postDelayMs);}
    await sleep(80);const after=await this.observeState(tabId),effect=observedEffect(before,after);
    return {commandId:msg.commandId||null,tabId,ok:true,delivered:true,plannedStepCount:plan.steps.length,issuedStepCount:completed,completedStepCount:completed,observed:effect.observed,observedEffect:effect,verified:effect.changed,taskSuccess:null,executionAudit:{allowedMethodsOnly:true,methods}};
  }
  async setCursor(enabled){this.cursorEnabled=enabled===true;const tabs=await this.chrome.tabs.query({});await Promise.allSettled(tabs.filter(t=>/^https?:\/\//i.test(String(t.url||''))).map(t=>this.chrome.tabs.sendMessage(t.id,{action:'body.virtualCursorSet',enabled:this.cursorEnabled})));return {cursorEnabled:this.cursorEnabled};}
  async handle(msg){
    if(msg.type==='PING')return {online:true,extensionId:this.extensionInstanceId,protocolVersion:PROTOCOL_VERSION,authenticated:Boolean(this.authToken),attachedTabs:[...this.gateway.attachedTabs],recordingEnabled:this.recordingEnabled,cursorEnabled:this.cursorEnabled};
    if(msg.type==='LIST_TABS')return this.tabSnapshot();
    if(msg.type==='ACTIVE_TAB'){const t=await this.activeTab();return {id:t.id,title:t.title||'',siteKey:siteKeyFromUrl(t.url),navigationToken:navigationToken(t.url),navigationEpoch:Number(this.navigationEpochByTab.get(Number(t.id))||0),active:t.active,windowId:t.windowId};}
    if(msg.type==='BODY_EXECUTE')return this.executePlan(msg);if(msg.type==='BODY_DETACH')return this.gateway.detach(Number(msg.tabId));if(msg.type==='RECORD_SET'){this.recordingEnabled=msg.enabled===true;return {recordingEnabled:this.recordingEnabled};}if(msg.type==='CURSOR_SET')return this.setCursor(msg.enabled===true);
    if(msg.type==='FOCUS_WINDOW'){const tabId=Number(msg.tabId),tab=Number.isInteger(tabId)?await this.chrome.tabs.get(tabId):await this.activeTab();this.expectedBrowserUi={commandId:msg.commandId||null,action:String(msg.browserAction||'unknown'),expiresAt:Date.now()+3500};await this.chrome.tabs.update(tab.id,{active:true});if(Number.isInteger(tab.windowId))await this.chrome.windows.update(tab.windowId,{focused:true});let active=false,focused=null;for(let i=0;i<5;i++){const current=await this.chrome.tabs.get(tab.id).catch(()=>null);active=current?.active===true;if(this.chrome.windows.get&&Number.isInteger(tab.windowId)){const win=await this.chrome.windows.get(tab.windowId).catch(()=>null);focused=win?.focused===true;}if(active&&(focused===true||focused===null))break;await sleep(40*(i+1));}return {focused:active&&(focused===true||focused===null),verified:active&&(focused===true||focused===null),tabId:tab.id,windowId:tab.windowId,siteKey:siteKeyFromUrl(tab.url),navigationToken:navigationToken(tab.url),title:tab.title||''};}
    if(msg.type==='BROWSER_UI_END'){if(this.expectedBrowserUi?.commandId===msg.commandId||!msg.commandId)this.expectedBrowserUi=null;return {cleared:true};}
    if(msg.type==='TAB_SWITCH'){const tabId=Number(msg.tabId),tab=await this.chrome.tabs.get(tabId);this.expectedTabSwitch.set(tabId,{commandId:msg.commandId||null,expiresAt:Date.now()+1200});await this.chrome.tabs.update(tabId,{active:true});if(Number.isInteger(tab.windowId))try{await this.chrome.windows.update(tab.windowId,{focused:true});}catch{}return {switched:true,tabId,siteKey:siteKeyFromUrl(tab.url),title:tab.title||''};}
    throw new Error(`unsupported_daemon_message:${msg.type}`);
  }
  async forwardUserMotor(tabId,payload){
    if(!this.recordingEnabled||payload?.source!=='USER')return false;const event=payload.event||{};let context={...(payload.context||{})};const pointerBoundary=payload.kind==='pointer'&&['mousePressed','mouseReleased'].includes(String(event.type));const needsTargetContext=payload.kind==='keyboard'||pointerBoundary;
    if(needsTargetContext){try{const response=await this.chrome.tabs.sendMessage(Number(tabId),{action:'body.targetContextAt',x:event.x,y:event.y});if(response?.ok&&response.result)context={...context,...response.result};}catch{}}
    const tag=context.tag||null,inputType=context.inputType||null,sensitive=context.sensitive===true||inputType==='password';const target={tag,role:context.role||null,inputType,editable:context.editable===true||(!sensitive&&['input','textarea'].includes(tag)),sensitive,rect:context.rect||null};let row=null;
    if(payload.kind==='pointer'){const eventType=pointerEventType(event.type);if(eventType)row={eventType,ts:Number(event.at||Date.now()),source:'human',sourceConfidence:1,agentCommandId:null,agentStepIndex:null,x:Number(event.x),y:Number(event.y),button:event.button,buttons:Number(event.buttons||0),deltaX:Number(event.deltaX||0),deltaY:Number(event.deltaY||0),target,isTrusted:true};}
    else if(payload.kind==='keyboard'){const rawKey=String(event.key||''),printable=rawKey.length===1;row={eventType:event.type,ts:Number(event.at||Date.now()),source:'human',sourceConfidence:1,agentCommandId:null,agentStepIndex:null,key:sensitive||printable?null:rawKey,keyClass:sensitive?'redacted':this.keyClass(rawKey),code:sensitive||printable?null:event.code,repeat:event.repeat===true,target,isTrusted:true};}
    if(!row)return false;return this.send({type:'RECORDER_EVENT',tabId:Number(tabId),siteKey:siteKeyFromUrl(payload.url),event:row});
  }
  keyClass(key){const s=String(key??'');if(s.length===1){if(/\s/.test(s))return 'space';if(/[A-Za-zÀ-ỹ]/u.test(s))return 'alpha';if(/[0-9]/.test(s))return 'digit';return 'punct';}if(['Enter','Tab','Backspace','Delete','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(s))return s;if(['Shift','Control','Alt','Meta'].includes(s))return 'modifier';return 'special';}
  installTabListeners(){
    this.chrome.tabs.onActivated?.addListener(async info=>{const tabId=Number(info.tabId);let tab;try{tab=await this.chrome.tabs.get(tabId);}catch{return;}const marker=this.expectedTabSwitch.get(tabId),switchAgent=marker&&marker.expiresAt>Date.now();if(marker)this.expectedTabSwitch.delete(tabId);const browserMarker=this.expectedBrowserUi&&this.expectedBrowserUi.expiresAt>Date.now()?this.expectedBrowserUi:null;const agent=Boolean(switchAgent||browserMarker);this.send({type:'TAB_EVENT',event:{eventType:'tabActivated',tabId,windowId:tab.windowId,title:tab.title||'',siteKey:siteKeyFromUrl(tab.url),source:agent?'agent':'human',agentCommandId:switchAgent?marker.commandId:browserMarker?.commandId||null,browserAction:browserMarker?.action||null,ts:Date.now()}});});
    this.chrome.tabs.onUpdated?.addListener((tabId,changeInfo,tab)=>{if(changeInfo.url||changeInfo.title||changeInfo.status)this.navigationEpochByTab.set(Number(tabId),Number(this.navigationEpochByTab.get(Number(tabId))||0)+1);if(!changeInfo.url&&!changeInfo.title&&!changeInfo.status)return;this.send({type:'TAB_CONTEXT',tabId:Number(tabId),context:{siteKey:siteKeyFromUrl(tab.url),navigationToken:navigationToken(tab.url),navigationEpoch:Number(this.navigationEpochByTab.get(Number(tabId))||0),title:tab.title||'',windowId:tab.windowId,status:tab.status||changeInfo.status||null}});});
    this.chrome.tabs.onRemoved?.addListener(tabId=>{this.navigationEpochByTab.delete(Number(tabId));this.send({type:'TAB_REMOVED',tabId:Number(tabId)});});
  }
  status(){return {url:this.url,started:this.started,connected:this.socket?.readyState===1,protocolVersion:PROTOCOL_VERSION,extensionInstanceId:this.extensionInstanceId,authenticated:Boolean(this.authToken),recordingEnabled:this.recordingEnabled,cursorEnabled:this.cursorEnabled};}
}

module.exports={DEFAULT_DAEMON_URL,PROTOCOL_VERSION,ALLOWED_METHODS,siteKeyFromUrl,navigationToken,observedEffect,DaemonBridge};
