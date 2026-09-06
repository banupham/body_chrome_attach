'use strict';

const {BehaviorGuardian}=require('./behavior_guardian');
const {ExternalControllerProbe,assessControllerConflict}=require('./external_controller_probe');

function envBool(value,fallback){const raw=String(value??'').trim().toLowerCase();if(!raw)return fallback;if(['1','true','yes','on'].includes(raw))return true;if(['0','false','no','off'].includes(raw))return false;return fallback;}
function envInt(value,fallback,min,max){const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.round(n))):fallback;}
function deepSignals(browser){const evidence=Array.isArray(browser?.environment?.evidence)?browser.environment.evidence:[];const deep=evidence.find(x=>x?.type==='deep_fingerprint');return Array.isArray(deep?.signalIds)?deep.signalIds.map(String):[];}
function transientEnvironment(browser){const reasons=Array.isArray(browser?.environment?.reasons)?browser.environment.reasons:[];return browser?.state==='ENV_CHECK'||String(browser?.stateReason||'').includes('waiting_for_http_tab')||reasons.includes('ENVIRONMENT_SIGNATURE_UNAVAILABLE')||reasons.includes('NO_BROWSER_TAB_FOR_ENVIRONMENT_PROBE');}

class ProtectionSupervisor{
  constructor(runtime,{env=process.env,behavior=new BehaviorGuardian(),controllerProbe=new ExternalControllerProbe(),setIntervalImpl=setInterval,clearIntervalImpl=clearInterval}={}){
    if(!runtime?.browsers||!runtime?.tasks||!runtime?.guardian)throw new Error('protection_supervisor_runtime_required');
    this.runtime=runtime;this.env=env||{};this.behavior=behavior;this.controllerProbe=controllerProbe;this.setIntervalImpl=setIntervalImpl;this.clearIntervalImpl=clearIntervalImpl;
    this.policy={enabled:envBool(this.env.BODY_PROTECTION_GUARDIAN_ENABLED,true),controllerBlock:envBool(this.env.BODY_PROTECTION_CONTROLLER_BLOCK,true),behaviorBlock:envBool(this.env.BODY_PROTECTION_BEHAVIOR_BLOCK,true),lightIntervalMs:envInt(this.env.BODY_PROTECTION_LIGHT_INTERVAL_MS,15000,5000,300000),fullIntervalMs:envInt(this.env.BODY_PROTECTION_FULL_INTERVAL_MS,300000,60000,3600000)};
    this.controllerByBrowser=new Map();this.timers=[];this.installed=false;this.lightRunning=false;this.fullRunning=false;this.transientProbeInFlight=new Set();this.original={};
  }
  _decorateProbeResult(result,browserId){const protection=this.browserStatus(browserId),reasons=[...(Array.isArray(result?.reasons)?result.reasons:[]),...protection.reasons];const pending=result?.status==='PENDING'||result?.probeDeferred===true;return {...result,eligible:pending?false:result?.eligible===true&&!protection.blocked,status:pending?'PENDING':result?.eligible===true&&!protection.blocked?String(result?.status||'ELIGIBLE'):'INELIGIBLE',reasons:[...new Set(reasons)],protection};}
  _kickTransientProbe(browser){
    const id=String(browser?.browserInstanceId||'');if(!id||!browser?.online||['BUSY','HUMAN_CONTROL'].includes(browser.state)||!transientEnvironment(browser)||typeof this.original.probeEnvironment!=='function'||this.transientProbeInFlight.has(id))return false;
    this.transientProbeInFlight.add(id);
    Promise.resolve().then(()=>this.original.probeEnvironment(id)).then(()=>this.enforce(id)).catch(()=>{}).finally(()=>this.transientProbeInFlight.delete(id));
    return true;
  }
  install(){
    if(this.installed)return this;this.installed=true;
    this.original.recorderEvent=this.runtime.recorderEvent.bind(this.runtime);
    this.runtime.recorderEvent=(extId,msg)=>{const result=this.original.recorderEvent(extId,msg);const browser=this.runtime.browsers.browserForExtension(extId);if(browser&&msg?.event){this.behavior.observe(browser.browserInstanceId,msg.event);this.enforce(browser.browserInstanceId);}return result;};
    this.original.taskCreate=this.runtime.tasks.create.bind(this.runtime.tasks);
    this.runtime.tasks.create=spec=>{this.assertAssignable(spec?.browserInstanceId);return this.original.taskCreate(spec);};
    this.original.guardianStatus=this.runtime.guardian.status.bind(this.runtime.guardian);
    this.runtime.guardian.status=()=>({...this.original.guardianStatus(),protection:this.status()});
    if(typeof this.runtime.probeEnvironment==='function'){
      this.original.probeEnvironment=this.runtime.probeEnvironment.bind(this.runtime);
      this.runtime.probeEnvironment=async browserId=>{const result=await this.original.probeEnvironment(browserId);this.scanLightAll();return this._decorateProbeResult(result,browserId);};
    }
    if(typeof this.runtime.probeAllEnvironments==='function'){
      this.original.probeAllEnvironments=this.runtime.probeAllEnvironments.bind(this.runtime);
      this.runtime.probeAllEnvironments=async()=>{const result=await this.original.probeAllEnvironments();this.scanLightAll();return Array.isArray(result)?result.map(x=>this._decorateProbeResult(x,x.browserInstanceId)):result;};
    }
    return this;
  }
  start(){
    this.install();if(!this.policy.enabled)return this;
    this.scanLightAll();
    const light=this.setIntervalImpl(()=>{try{this.scanLightAll();}catch{}},this.policy.lightIntervalMs);light?.unref?.();
    const full=this.setIntervalImpl(()=>{this.scanFullAll().catch(()=>{});},this.policy.fullIntervalMs);full?.unref?.();this.timers.push(light,full);return this;
  }
  stop(){for(const timer of this.timers)if(timer)this.clearIntervalImpl(timer);this.timers=[];}
  scanLightAll(){
    if(!this.policy.enabled||this.lightRunning)return this.status();const online=this.runtime.browsers.list().filter(x=>x.online);if(!online.length)return this.status();this.lightRunning=true;
    try{
      const observation=this.controllerProbe.probe();
      for(const browser of online){
        const assessment=assessControllerConflict(observation,deepSignals(browser));
        this.controllerByBrowser.set(browser.browserInstanceId,{...assessment,observedAt:new Date().toISOString()});this.enforce(browser.browserInstanceId);this._kickTransientProbe(browser);
      }
      return this.status();
    }finally{this.lightRunning=false;}
  }
  async scanFullAll(){
    if(!this.policy.enabled||this.fullRunning)return this.status();this.fullRunning=true;
    try{
      const browsers=this.runtime.browsers.list().filter(x=>x.online&&!['BUSY','HUMAN_CONTROL'].includes(x.state));
      for(const browser of browsers){try{if(this.original.probeEnvironment)await this.original.probeEnvironment(browser.browserInstanceId);else if(typeof this.runtime.guardian.probeBrowser==='function')await this.runtime.guardian.probeBrowser(browser.browserInstanceId);}catch{}}
      this.scanLightAll();return this.status();
    }finally{this.fullRunning=false;}
  }
  combined(browserInstanceId){
    const id=String(browserInstanceId||''),controller=this.controllerByBrowser.get(id)||{score:0,blocked:false,review:false,signalIds:[],available:false},behavior=this.behavior.status(id);const combinedScore=Math.min(100,Number(controller.score||0)+Number(behavior.score||0));
    const crossBlocked=Number(controller.score||0)>=25&&Number(behavior.score||0)>=40&&combinedScore>=80;
    const blocked=(this.policy.controllerBlock&&controller.blocked===true)||(this.policy.behaviorBlock&&behavior.blocked===true)||((this.policy.controllerBlock||this.policy.behaviorBlock)&&crossBlocked);
    const reasons=[];if(this.policy.controllerBlock&&controller.blocked)reasons.push('EXTERNAL_CONTROLLER_CONFLICT');if(this.policy.behaviorBlock&&behavior.blocked)reasons.push('BOT_BEHAVIOR_HIGH_CONFIDENCE');if(crossBlocked)reasons.push('CONTROLLER_BEHAVIOR_CORRELATED');
    return {blocked,score:combinedScore,reasons,controller,behavior};
  }
  enforce(browserInstanceId){
    const id=String(browserInstanceId||'').trim();if(!id)return null;let browser;try{browser=this.runtime.browsers.require(id);}catch{return null;}if(!browser.online)return null;const decision=this.combined(id);
    if(decision.blocked){const reason=decision.reasons.includes('EXTERNAL_CONTROLLER_CONFLICT')?'protection_external_controller':'protection_behavior_conflict';if(browser.state!=='QUARANTINED'||String(browser.stateReason||'')!==reason)return this.runtime.browsers.setState(id,'QUARANTINED',reason);return this.runtime.browsers.public(browser);}
    if(browser.state==='QUARANTINED'&&String(browser.stateReason||'').startsWith('protection_')&&browser.environment?.eligible===true)return this.runtime.browsers.setState(id,'ACTIVE','protection_cleared');
    return this.runtime.browsers.public(browser);
  }
  assertAssignable(browserInstanceId){const id=String(browserInstanceId||'').trim();if(!id)return;const decision=this.combined(id);if(decision.blocked)throw new Error(`browser_protection_blocked:${id}:${decision.reasons.join(',')}`);}
  browserStatus(browserInstanceId){return this.combined(browserInstanceId);}
  status(){const browsers={};for(const browser of this.runtime.browsers.list())if(browser.online)browsers[browser.browserInstanceId]=this.combined(browser.browserInstanceId);return {policy:{...this.policy},transientProbeInFlight:[...this.transientProbeInFlight],browsers};}
}

module.exports={ProtectionSupervisor,envBool,envInt,deepSignals,transientEnvironment};
