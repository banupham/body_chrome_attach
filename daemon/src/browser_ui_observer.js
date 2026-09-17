'use strict';

const path=require('node:path');
const readline=require('node:readline');
const {spawn}=require('node:child_process');

const MAX_CONTROLS=220;
const MAX_TABS=80;

function text(value,max=240){const out=String(value??'').replace(/\s+/g,' ').trim();return out.slice(0,Math.max(0,Number(max)||0));}
function finite(value){const n=Number(value);return Number.isFinite(n)?n:null;}
function rect(value){if(!value||typeof value!=='object')return null;const x=finite(value.x),y=finite(value.y),width=finite(value.width),height=finite(value.height);if([x,y,width,height].some(v=>v===null)||width<=0||height<=0)return null;return {x,y,width,height};}
function fingerprint(value){if(!value||typeof value!=='object')return null;const length=finite(value.length),sha256=text(value.sha256,32);return length===null||length<0||!sha256?null:{length:Math.trunc(length),sha256};}
function state(value={}){return {enabled:value.enabled===true,offscreen:value.offscreen===true,focused:value.focused===true,selected:value.selected===true?true:value.selected===false?false:null,expanded:text(value.expanded,40)||null,toggle:text(value.toggle,40)||null};}
function control(value={}){return {index:finite(value.index),surface:text(value.surface,40)||'browser_chrome',controlType:text(value.controlType,50)||'Unknown',name:text(value.name,240)||null,automationId:text(value.automationId,160)||null,className:text(value.className,160)||null,rect:rect(value.rect),state:state(value.state||{}),valueFingerprint:fingerprint(value.valueFingerprint)};}
function normalizeSnapshot(raw,request={}){
  const controls=Array.isArray(raw?.controls)?raw.controls.slice(0,MAX_CONTROLS).map(control):[];
  const tabs=Array.isArray(raw?.tabs)?raw.tabs.slice(0,MAX_TABS).map(control):controls.filter(row=>row.controlType==='TabItem').slice(0,MAX_TABS);
  const addressBar=raw?.addressBar?control(raw.addressBar):controls.find(row=>row.surface==='omnibox_or_find')||null;
  const focusedControl=raw?.focusedControl?control(raw.focusedControl):controls.find(row=>row.state.focused)||null;
  return {
    available:raw?.available!==false,
    observed:raw?.observed===true,
    reason:text(raw?.reason,120)||null,
    confidence:text(raw?.confidence,40)||'unknown',
    source:'windows_uia_read_only',
    observedAt:finite(raw?.observedAt)||Date.now(),
    scope:{browserInstanceId:text(request.browserInstanceId,180)||null,tabId:finite(request.tabId),windowId:finite(request.windowId),expectedTitle:text(request.title,240)||null},
    window:raw?.window?{processId:finite(raw.window.processId),name:text(raw.window.name,300)||null,className:text(raw.window.className,120)||null,rect:rect(raw.window.rect)}:null,
    focusedControl,addressBar,tabs,controls,
    signature:text(raw?.signature,96)||null
  };
}

class WindowsBrowserUiObserver{
  constructor({platform=process.platform,spawnImpl=spawn,helperPath=path.join(__dirname,'..','native','windows_ui_observer.ps1'),timeoutMs=4500,env=process.env}={}){
    this.platform=platform;this.spawnImpl=spawnImpl;this.helperPath=helperPath;this.timeoutMs=Math.max(1000,Number(timeoutMs)||4500);this.env=env||{};this.child=null;this.starting=null;this.pending=new Map();this.sequence=0;
    process.once('exit',()=>{try{this.child?.kill();}catch{}});
  }
  unsupported(request,reason='platform_unsupported'){return normalizeSnapshot({available:false,observed:false,reason,confidence:'none',controls:[],tabs:[],observedAt:Date.now()},request);}
  async _spawn(exe,args){return new Promise((resolve,reject)=>{let child;try{child=this.spawnImpl(exe,args,{windowsHide:true,stdio:['pipe','pipe','pipe']});}catch(error){reject(error);return;}const cleanup=()=>{child.off?.('error',onError);child.off?.('spawn',onSpawn);};const onError=error=>{cleanup();try{child.kill();}catch{}reject(error);};const onSpawn=()=>{cleanup();resolve(child);};child.once?.('error',onError);child.once?.('spawn',onSpawn);if(!child.once)resolve(child);});}
  _bind(child){
    this.child=child;const lines=readline.createInterface({input:child.stdout});
    lines.on('line',line=>{let msg;try{msg=JSON.parse(String(line));}catch{return;}const id=String(msg.id??''),item=this.pending.get(id);if(!item)return;clearTimeout(item.timer);this.pending.delete(id);if(msg.ok===false)item.resolve(this.unsupported(item.request,text(msg.error,120)||'uia_worker_error'));else item.resolve(normalizeSnapshot(msg.snapshot||{},item.request));});
    child.stderr?.on('data',()=>{});child.once?.('close',code=>{if(this.child===child)this.child=null;for(const [id,item] of this.pending){clearTimeout(item.timer);this.pending.delete(id);item.resolve(this.unsupported(item.request,`uia_worker_closed:${code}`));}});
  }
  async start(){
    if(this.platform!=='win32')return null;if(this.child&&!this.child.killed)return this.child;if(this.starting)return this.starting;
    this.starting=(async()=>{const candidates=[['powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',this.helperPath,'worker']],['powershell',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',this.helperPath,'worker']],['pwsh',['-NoProfile','-NonInteractive','-File',this.helperPath,'worker']]];let lastError=null;for(const [exe,args] of candidates){try{const child=await this._spawn(exe,args);this._bind(child);return child;}catch(error){lastError=error;}}throw lastError||new Error('powershell_unavailable');})();
    try{return await this.starting;}finally{this.starting=null;}
  }
  async observe(request={}){
    const scoped={browserInstanceId:text(request.browserInstanceId,180),tabId:finite(request.tabId),windowId:finite(request.windowId),title:text(request.title,240)};
    if(this.platform!=='win32')return this.unsupported(scoped);
    let child;try{child=await this.start();}catch(error){return this.unsupported(scoped,`uia_worker_unavailable:${text(error?.message||error,100)}`);}
    const id=String(++this.sequence),result=new Promise(resolve=>{const timer=setTimeout(()=>{this.pending.delete(id);resolve(this.unsupported(scoped,'uia_observe_timeout'));},this.timeoutMs);this.pending.set(id,{resolve,timer,request:scoped});});
    try{child.stdin.write(JSON.stringify({id,title:scoped.title,windowId:scoped.windowId,tabId:scoped.tabId})+'\n');}catch(error){const item=this.pending.get(id);if(item){clearTimeout(item.timer);this.pending.delete(id);}return this.unsupported(scoped,`uia_worker_write_failed:${text(error?.message||error,100)}`);}
    return result;
  }
  async close(){const child=this.child;this.child=null;if(!child)return;try{child.stdin.end();}catch{}await new Promise(resolve=>{child.once?.('close',resolve);setTimeout(()=>{try{child.kill();}catch{}resolve();},300);});}
}
function createBrowserUiObserver(options={}){return new WindowsBrowserUiObserver(options);}

module.exports={MAX_CONTROLS,MAX_TABS,normalizeSnapshot,WindowsBrowserUiObserver,createBrowserUiObserver};
