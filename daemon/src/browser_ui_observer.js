'use strict';

const path=require('node:path');
const readline=require('node:readline');
const {spawn}=require('node:child_process');

const MAX_CONTROLS=220;
const MAX_TABS=80;
const ACTIVE_OBSERVERS=new Set();
let EXIT_HOOK_INSTALLED=false;
function registerObserver(observer){ACTIVE_OBSERVERS.add(observer);if(EXIT_HOOK_INSTALLED)return;EXIT_HOOK_INSTALLED=true;process.once('exit',()=>{for(const item of ACTIVE_OBSERVERS)try{item.child?.kill();}catch{}});}

function text(value,max=240){const out=String(value??'').replace(/\s+/g,' ').trim();return out.slice(0,Math.max(0,Number(max)||0));}
function finite(value){const n=Number(value);return value===null||value===undefined||value===''?null:(Number.isFinite(n)?n:null);}
function optionalBool(value){return value===true?true:value===false?false:null;}
function rect(value){if(!value||typeof value!=='object')return null;const x=finite(value.x),y=finite(value.y),width=finite(value.width),height=finite(value.height);if([x,y,width,height].some(v=>v===null)||width<=0||height<=0)return null;return {x,y,width,height};}
function fingerprint(value){if(!value||typeof value!=='object')return null;const length=finite(value.length),sha256=text(value.sha256,32);return length===null||length<0||!sha256?null:{length:Math.trunc(length),sha256};}
function state(value={}){return {enabled:value.enabled===true,offscreen:value.offscreen===true,focused:value.focused===true,selected:value.selected===true?true:value.selected===false?false:null,expanded:text(value.expanded,40)||null,toggle:text(value.toggle,40)||null};}
function control(value={}){return {index:finite(value.index),surface:text(value.surface,40)||'browser_chrome',controlType:text(value.controlType,50)||'Unknown',name:text(value.name,240)||null,automationId:text(value.automationId,160)||null,className:text(value.className,160)||null,processId:finite(value.processId),nativeWindowHandle:finite(value.nativeWindowHandle),rect:rect(value.rect),state:state(value.state||{}),valueFingerprint:fingerprint(value.valueFingerprint)};}
function nativeWindow(value={}){return {handle:finite(value.handle),processId:finite(value.processId),processName:text(value.processName,160)||null,name:text(value.name,300)||null,className:text(value.className,160)||null,controlType:text(value.controlType,80)||null,rect:rect(value.rect),minimized:optionalBool(value.minimized),zOrder:finite(value.zOrder),windowIntersection:rect(value.windowIntersection),contentIntersection:rect(value.contentIntersection)};}
function nativeFacts(value={}){return {targetWindowHandle:finite(value.targetWindowHandle),targetWindowForeground:optionalBool(value.targetWindowForeground),targetWindowMinimized:optionalBool(value.targetWindowMinimized),windowSource:text(value.windowSource,40)||null,uiAutomationAvailable:optionalBool(value.uiAutomationAvailable),contentRect:rect(value.contentRect),contentRectSource:text(value.contentRectSource,60)||null,foregroundWindow:value.foregroundWindow?nativeWindow(value.foregroundWindow):null,focusedElement:value.focusedElement?control(value.focusedElement):null,topLevelOccluders:Array.isArray(value.topLevelOccluders)?value.topLevelOccluders.slice(0,20).map(nativeWindow):[]};}
function normalizeSnapshot(raw,request={}){
  const controls=Array.isArray(raw?.controls)?raw.controls.slice(0,MAX_CONTROLS).map(control):[];
  const tabs=Array.isArray(raw?.tabs)?raw.tabs.slice(0,MAX_TABS).map(control):controls.filter(row=>row.controlType==='TabItem').slice(0,MAX_TABS);
  const addressBar=raw?.addressBar?control(raw.addressBar):controls.find(row=>row.surface==='omnibox_or_find')||null;
  const focusedControl=raw?.focusedControl?control(raw.focusedControl):controls.find(row=>row.state.focused)||null;
  return {available:raw?.available!==false,observed:raw?.observed===true,reason:text(raw?.reason,120)||null,confidence:text(raw?.confidence,40)||'unknown',source:'windows_uia_read_only',observedAt:finite(raw?.observedAt)||Date.now(),scope:{browserInstanceId:text(request.browserInstanceId,180)||null,tabId:finite(request.tabId),windowId:finite(request.windowId),expectedTitle:text(request.title,240)||null},window:raw?.window?{handle:finite(raw.window.handle),processId:finite(raw.window.processId),name:text(raw.window.name,300)||null,className:text(raw.window.className,120)||null,rect:rect(raw.window.rect),minimized:optionalBool(raw.window.minimized)}:null,native:nativeFacts(raw?.native||{}),focusedControl,addressBar,tabs,controls,signature:text(raw?.signature,96)||null};
}
function scopeKey(request={}){return `${text(request.browserInstanceId,180)}|${finite(request.windowId)??'?'}`;}

class WindowsBrowserUiObserver{
  constructor({platform=process.platform,spawnImpl=spawn,helperPath=path.join(__dirname,'..','native','windows_ui_observer.ps1'),timeoutMs=1500,refreshIntervalMs=250,maxStaleMs=3000,failureCooldownMs=2500}={}){
    this.platform=platform;this.spawnImpl=spawnImpl;this.helperPath=helperPath;this.timeoutMs=Math.max(500,Number(timeoutMs)||1500);this.refreshIntervalMs=Math.max(100,Number(refreshIntervalMs)||250);this.maxStaleMs=Math.max(this.refreshIntervalMs,Number(maxStaleMs)||3000);this.failureCooldownMs=Math.max(500,Number(failureCooldownMs)||2500);this.child=null;this.starting=null;this.pending=new Map();this.sequence=0;this.cache=new Map();this.inflightScopes=new Map();this.nextRefresh=new Map();this.unavailableUntil=0;
    registerObserver(this);
  }
  unavailable(request,reason='platform_unsupported'){return normalizeSnapshot({available:false,observed:false,reason,confidence:'none',controls:[],tabs:[],observedAt:Date.now()},request);}
  pendingSnapshot(request,reason='uia_refresh_pending'){return normalizeSnapshot({available:true,observed:false,reason,confidence:'none',controls:[],tabs:[],observedAt:Date.now()},request);}
  async _spawn(exe,args){return new Promise((resolve,reject)=>{let child;try{child=this.spawnImpl(exe,args,{windowsHide:true,stdio:['pipe','pipe','pipe']});}catch(error){reject(error);return;}const cleanup=()=>{child.off?.('error',onError);child.off?.('spawn',onSpawn);};const onError=error=>{cleanup();try{child.kill();}catch{}reject(error);};const onSpawn=()=>{cleanup();resolve(child);};child.once?.('error',onError);child.once?.('spawn',onSpawn);if(!child.once)resolve(child);});}
  _bind(child){
    this.child=child;const lines=readline.createInterface({input:child.stdout});
    lines.on('line',line=>{let msg;try{msg=JSON.parse(String(line));}catch{return;}const id=String(msg.id??''),item=this.pending.get(id);if(!item)return;clearTimeout(item.timer);this.pending.delete(id);if(msg.ok===false)item.resolve(this.unavailable(item.request,text(msg.error,120)||'uia_worker_error'));else item.resolve(normalizeSnapshot(msg.snapshot||{},item.request));});
    child.stderr?.on('data',()=>{});child.once?.('close',code=>{if(this.child===child)this.child=null;this.unavailableUntil=Date.now()+this.failureCooldownMs;for(const [id,item] of this.pending){clearTimeout(item.timer);this.pending.delete(id);item.resolve(this.unavailable(item.request,`uia_worker_closed:${code}`));}});
  }
  async start(){
    if(this.platform!=='win32')return null;if(this.child&&!this.child.killed)return this.child;if(this.starting)return this.starting;
    this.starting=(async()=>{const candidates=[['powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',this.helperPath,'worker']],['powershell',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',this.helperPath,'worker']],['pwsh',['-NoProfile','-NonInteractive','-File',this.helperPath,'worker']]];let lastError=null;for(const [exe,args] of candidates){try{const child=await this._spawn(exe,args);this._bind(child);return child;}catch(error){lastError=error;}}throw lastError||new Error('powershell_unavailable');})();
    try{return await this.starting;}finally{this.starting=null;}
  }
  async _fresh(scoped){
    let child;try{child=await this.start();}catch(error){this.unavailableUntil=Date.now()+this.failureCooldownMs;return this.unavailable(scoped,`uia_worker_unavailable:${text(error?.message||error,100)}`);}
    const id=String(++this.sequence);return new Promise(resolve=>{const timer=setTimeout(()=>{this.pending.delete(id);this.unavailableUntil=Date.now()+this.failureCooldownMs;if(this.child===child){this.child=null;try{child.kill();}catch{}}resolve(this.unavailable(scoped,'uia_observe_timeout'));},this.timeoutMs);this.pending.set(id,{resolve,timer,request:scoped});try{child.stdin.write(JSON.stringify({id,title:scoped.title,windowId:scoped.windowId,tabId:scoped.tabId})+'\n');}catch(error){clearTimeout(timer);this.pending.delete(id);this.unavailableUntil=Date.now()+this.failureCooldownMs;resolve(this.unavailable(scoped,`uia_worker_write_failed:${text(error?.message||error,100)}`));}});
  }
  _schedule(scoped,key){
    if(this.inflightScopes.has(key)||Date.now()<this.unavailableUntil)return;
    this.nextRefresh.set(key,Date.now()+this.refreshIntervalMs);
    const work=this._fresh(scoped).then(snapshot=>{if(snapshot.observed===true)this.cache.set(key,{at:Date.now(),snapshot});return snapshot;}).catch(()=>null).finally(()=>this.inflightScopes.delete(key));
    this.inflightScopes.set(key,work);
  }
  async observe(request={}){
    const scoped={browserInstanceId:text(request.browserInstanceId,180),tabId:finite(request.tabId),windowId:finite(request.windowId),title:text(request.title,240)},key=scopeKey(request),now=Date.now();
    if(this.platform!=='win32')return this.unavailable(scoped);
    const cached=this.cache.get(key)||null,next=this.nextRefresh.get(key)||0;
    if(now>=next)this._schedule(scoped,key);
    if(cached&&now-cached.at<=this.maxStaleMs)return cached.snapshot;
    if(now<this.unavailableUntil)return this.unavailable(scoped,'uia_cooldown');
    return this.pendingSnapshot(scoped);
  }
  invalidate(request={}){const key=scopeKey(request);this.cache.delete(key);this.nextRefresh.set(key,0);return true;}
  async close(){const child=this.child;this.child=null;this.cache.clear();this.inflightScopes.clear();ACTIVE_OBSERVERS.delete(this);if(!child)return;try{child.stdin.end();}catch{}await new Promise(resolve=>{child.once?.('close',resolve);setTimeout(()=>{try{child.kill();}catch{}resolve();},300);});}
}
function createBrowserUiObserver(options={}){return new WindowsBrowserUiObserver(options);}

module.exports={MAX_CONTROLS,MAX_TABS,normalizeSnapshot,scopeKey,WindowsBrowserUiObserver,createBrowserUiObserver};
