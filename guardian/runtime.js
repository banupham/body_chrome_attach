'use strict';

const os=require('node:os');
const path=require('node:path');
const {GuardianBodyClient}=require('./body_client');
const {GuardianBrowserRegistry}=require('./browser_registry');
const {EnvironmentGuardian}=require('../daemon/src/environment_guardian');
const {BehaviorGuardian}=require('../daemon/src/behavior_guardian');
const {ExternalControllerProbe,assessControllerConflict}=require('../daemon/src/external_controller_probe');

function envInt(value,fallback,min,max){const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.round(n))):fallback;}
function defaultGuardianDataDir(env=process.env){
  const explicit=String(env.GUARDIAN_DATA_DIR||'').trim();
  if(explicit)return path.resolve(explicit);
  const home=String(env.BODYBRAIN_HOME||'').trim();
  if(home)return path.join(path.resolve(home),'guardian');
  if(process.platform==='win32'&&String(env.LOCALAPPDATA||'').trim())return path.join(path.resolve(env.LOCALAPPDATA),'BodyBrain','guardian');
  return path.join(os.homedir(),'.bodybrain','guardian');
}
function deepSignalIds(browser){
  const deep=browser?.environment?.deepFingerprint;
  return Array.isArray(deep?.signalIds)?deep.signalIds.map(String):[];
}

class GuardianRuntime{
  constructor({
    env=process.env,
    client=null,
    registry=null,
    behavior=null,
    controllerProbe=null,
    environmentGuardian=null,
    now=()=>Date.now(),
    setIntervalImpl=setInterval,
    clearIntervalImpl=clearInterval
  }={}){
    this.env=env||{};
    this.now=now;
    this.setIntervalImpl=setIntervalImpl;
    this.clearIntervalImpl=clearIntervalImpl;
    this.client=client||new GuardianBodyClient({env:this.env});
    this.registry=registry||new GuardianBrowserRegistry();
    this.behavior=behavior||new BehaviorGuardian({now});
    this.controllerProbe=controllerProbe||new ExternalControllerProbe();
    this.controllerByBrowser=new Map();
    this.decisions=new Map();
    this.timers=[];
    this.started=false;
    this.guardianDataDir=defaultGuardianDataDir(this.env);
    const guardianEnv={...this.env,BODY_RUNTIME_DATA_DIR:this.guardianDataDir};
    this.environment=environmentGuardian||new EnvironmentGuardian(this.guardianDataDir,this.registry,{
      env:guardianEnv,
      now,
      requestExtension:(extensionId,type,payload)=>this._requestExtension(extensionId,type,payload)
    });
    this.policy={
      controllerScanMs:envInt(this.env.GUARDIAN_CONTROLLER_SCAN_MS,15000,5000,300000),
      fullScanMs:envInt(this.env.GUARDIAN_FULL_SCAN_MS,300000,30000,3600000),
      controllerUnavailableBlocks:String(this.env.GUARDIAN_CONTROLLER_UNAVAILABLE_BLOCKS??'true').toLowerCase()!=='false'
    };
    this._onEvent=event=>{Promise.resolve(this.handleEvent(event)).catch(()=>{});};
    this._onDisconnect=()=>{this.decisions.clear();};
  }

  async _requestExtension(extensionId,type,payload={}){
    if(type!=='ENVIRONMENT_PROBE')throw new Error('guardian_extension_request_unsupported:'+type);
    const browser=this.registry.browserForExtension(extensionId);
    if(!browser)throw new Error('guardian_extension_browser_not_found:'+extensionId);
    return this.client.probeEnvironment(browser.browserInstanceId,payload);
  }

  async syncFromBody(){
    const status=await this.client.bodyStatus();
    this.registry.sync(status?.browsers||[]);
    return status;
  }

  async scanControllers(){
    let observation;
    try{observation=await this.controllerProbe.probe();}
    catch(error){observation={available:false,reason:'controller_probe_exception:'+String(error?.message||error)};}
    for(const browser of this.registry.list().filter(row=>row.online)){
      const assessment=assessControllerConflict(observation,deepSignalIds(this.registry.require(browser.browserInstanceId)));
      this.controllerByBrowser.set(browser.browserInstanceId,{...assessment,observedAt:new Date(this.now()).toISOString()});
    }
    return observation;
  }

  decision(browserInstanceId){
    const id=String(browserInstanceId||'').trim();
    const browser=this.registry.require(id);
    const environment=browser.environment||{eligible:false,status:'PENDING',reasons:['ENVIRONMENT_NOT_EVALUATED'],evidence:[]};
    const controller=this.controllerByBrowser.get(id)||{available:false,reason:'controller_scan_pending',score:0,blocked:false,review:false,signalIds:[],details:{}};
    const behavior=this.behavior.status(id);
    const browserReasons=[];
    const environmentStatus=String(environment.status||'PENDING').toUpperCase();
    const browserValid=!browser.online?false:(environmentStatus==='ELIGIBLE'?true:(['INELIGIBLE','ERROR','BLOCKED'].includes(environmentStatus)?false:null));
    if(browserValid!==true)browserReasons.push(...(Array.isArray(environment.reasons)&&environment.reasons.length?environment.reasons:[browserValid===false?'ENVIRONMENT_NOT_ELIGIBLE':'ENVIRONMENT_CHECK_PENDING']));

    const learningReasons=[];
    if(!browserValid)learningReasons.push('BROWSER_INVALID');
    if(controller.available!==true&&this.policy.controllerUnavailableBlocks)learningReasons.push(String(controller.reason||'CONTROLLER_PROBE_UNAVAILABLE').toUpperCase());
    if(controller.blocked===true)learningReasons.push('EXTERNAL_CONTROLLER_CONFLICT');
    else if(controller.review===true)learningReasons.push('EXTERNAL_CONTROLLER_SUSPECT');
    if(behavior.blocked===true)learningReasons.push('BOT_BEHAVIOR_HIGH_CONFIDENCE');
    const learningAllowed=browserValid===true&&controller.blocked!==true&&controller.review!==true&&behavior.blocked!==true&&(!this.policy.controllerUnavailableBlocks||controller.available===true);

    return {
      browserInstanceId:id,
      browserValid,
      browserReasons:[...new Set(browserReasons)],
      learningAllowed,
      learningReasons:[...new Set(learningReasons)],
      environment:{
        eligible:environment.eligible===true,
        status:String(environment.status||'UNKNOWN'),
        observedAt:environment.observedAt||null,
        publicIp:environment.publicIp||null,
        environmentSignature:environment.environmentSignature||null,
        deepFingerprint:environment.deepFingerprint||null
      },
      controller:{...controller,signalIds:[...(controller.signalIds||[])]},
      behavior:{...behavior,signalIds:[...(behavior.signalIds||[])]},
      decidedAt:new Date(this.now()).toISOString()
    };
  }

  async publishDecision(browserInstanceId){
    const decision=this.decision(browserInstanceId),previous=this.decisions.get(browserInstanceId)||null;
    const browserChanged=!previous||previous.browserValid!==decision.browserValid||JSON.stringify(previous.browserReasons||[])!==JSON.stringify(decision.browserReasons||[]);
    const learningChanged=!previous||previous.learningAllowed!==decision.learningAllowed||JSON.stringify(previous.learningReasons||[])!==JSON.stringify(decision.learningReasons||[]);
    if(browserChanged)await this.client.setBrowserVerdict(browserInstanceId,{valid:decision.browserValid,reasons:decision.browserReasons});
    if(decision.browserValid===true&&learningChanged)await this.client.setLearning(browserInstanceId,{allowed:decision.learningAllowed,reasons:decision.learningReasons});
    this.decisions.set(browserInstanceId,{...decision});
    return decision;
  }

  async evaluateBrowser(browserInstanceId,{probeEnvironment=true,scanController=false}={}){
    const id=String(browserInstanceId||'').trim();
    const browser=this.registry.require(id);
    if(!browser.online){
      this.decisions.delete(id);
      return null;
    }
    if(probeEnvironment){
      try{
        const environmentResult=await this.environment.probeBrowser(id);
        if(environmentResult&&String(environmentResult.status||'').toUpperCase()==='PENDING')this.registry.setEnvironment(id,environmentResult,'environment_check_pending');
      }
      catch(error){
        browser.environment={eligible:false,status:'ERROR',observedAt:new Date(this.now()).toISOString(),reasons:['ENVIRONMENT_PROBE_ERROR:'+String(error?.message||error)],evidence:[]};
      }
    }
    if(scanController||!this.controllerByBrowser.has(id))await this.scanControllers();
    return this.publishDecision(id);
  }

  async evaluateAll({probeEnvironment=true,scanController=true}={}){
    await this.syncFromBody();
    if(scanController)await this.scanControllers();
    const results=[];
    for(const browser of this.registry.list().filter(row=>row.online)){
      try{results.push(await this.evaluateBrowser(browser.browserInstanceId,{probeEnvironment,scanController:false}));}
      catch(error){
        try{await this.client.setBrowserVerdict(browser.browserInstanceId,{valid:false,reasons:['GUARDIAN_EVALUATION_ERROR:'+String(error?.message||error)]});}catch{}
        results.push({browserInstanceId:browser.browserInstanceId,browserValid:false,learningAllowed:false,browserReasons:['GUARDIAN_EVALUATION_ERROR:'+String(error?.message||error)]});
      }
    }
    return results;
  }

  async handleEvent(event={}){
    const type=String(event.eventType||'');
    const browserInstanceId=String(event.browserInstanceId||event.identity?.browserInstanceId||'').trim();
    if(type==='browserOnline'){
      if(event.browser)this.registry.upsert(event.browser);
      else await this.syncFromBody();
      if(browserInstanceId)await this.evaluateBrowser(browserInstanceId,{probeEnvironment:true,scanController:true});
      return;
    }
    if(type==='browserOffline'){
      if(browserInstanceId&&this.registry.browsers.has(browserInstanceId))this.registry.markOffline(browserInstanceId);
      if(browserInstanceId){this.behavior.clear(browserInstanceId);this.controllerByBrowser.delete(browserInstanceId);this.decisions.delete(browserInstanceId);}
      return;
    }
    if(type==='input'&&browserInstanceId){
      this.behavior.observe(browserInstanceId,event.input||{});
      if(this.registry.browsers.has(browserInstanceId))await this.publishDecision(browserInstanceId);
      return;
    }
    if(['tabContext','tabActivated','tabCreated','tabUpdated','tabRemoved'].includes(type)){
      await this.syncFromBody();
      if(browserInstanceId&&this.registry.browsers.has(browserInstanceId))await this.evaluateBrowser(browserInstanceId,{probeEnvironment:type==='tabContext',scanController:false});
    }
  }


  async start(){
    if(this.started)return this.status();
    await this.client.connect();
    this.client.on('event',this._onEvent);
    this.client.on('disconnected',this._onDisconnect);
    await this.evaluateAll({probeEnvironment:true,scanController:true});
    const controllerTimer=this.setIntervalImpl(()=>{this.scanControllers().then(()=>this.evaluateAll({probeEnvironment:false,scanController:false})).catch(()=>{});},this.policy.controllerScanMs);
    const fullTimer=this.setIntervalImpl(()=>{this.evaluateAll({probeEnvironment:true,scanController:true}).catch(()=>{});},this.policy.fullScanMs);
    controllerTimer?.unref?.();fullTimer?.unref?.();
    this.timers.push(controllerTimer,fullTimer);
    this.started=true;
    return this.status();
  }

  async stop(){
    for(const timer of this.timers)if(timer)this.clearIntervalImpl(timer);
    this.timers=[];
    this.client.off?.('event',this._onEvent);
    this.client.off?.('disconnected',this._onDisconnect);
    try{this.environment.flushSync();}catch{}
    this.client.close();
    this.started=false;
  }

  status(){
    return {
      component:'Guardian',
      authorityOrder:'HUMAN > GUARDIAN > BRAIN > BODY',
      started:this.started,
      policy:{...this.policy},
      browsers:this.registry.list(),
      decisions:Object.fromEntries([...this.decisions.entries()].map(([id,row])=>[id,{...row}])),
      controller:Object.fromEntries([...this.controllerByBrowser.entries()].map(([id,row])=>[id,{...row}])),
      behavior:this.behavior.status()
    };
  }
}

module.exports={GuardianRuntime,defaultGuardianDataDir,deepSignalIds,envInt};
