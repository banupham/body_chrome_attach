'use strict';

class DetachedGuardian{
  constructor({browsers,reason='guardian_detached'}={}){
    if(!browsers)throw new Error('detached_guardian_browser_manager_required');
    this.browsers=browsers;
    this.reason=String(reason||'guardian_detached');
    this.mode='DETACHED';
    this.policy={mode:'external',attached:false,failClosed:true};
  }
  status(){
    return {
      mode:this.mode,
      attached:false,
      reason:this.reason,
      policy:{...this.policy},
      protection:{mode:this.mode,attached:false,policy:{enabled:true},browsers:{}}
    };
  }
  async probeBrowser(browserInstanceId){
    const browser=this.browsers.require(browserInstanceId);
    return {
      browserInstanceId:browser.browserInstanceId,
      eligible:false,
      status:'PENDING',
      observedAt:null,
      reasons:['GUARDIAN_DETACHED'],
      evidence:[],
      probeDeferred:true,
      deferReason:'GUARDIAN_DETACHED'
    };
  }
  async probeAll(){
    const rows=[];
    for(const browser of this.browsers.list().filter(row=>row.online))rows.push(await this.probeBrowser(browser.browserInstanceId));
    return rows;
  }
  browserOffline(){return null;}
  flushSync(){return {ok:true,mode:this.mode,detached:true};}
}

function guardianMode(environmentOptions={},identityOptions={}){
  const raw=environmentOptions.guardianMode||environmentOptions.env?.BODY_GUARDIAN_MODE||identityOptions.env?.BODY_GUARDIAN_MODE||process.env.BODY_GUARDIAN_MODE||'embedded';
  return String(raw).trim().toLowerCase();
}

function createRuntimeGuardian({baseDir,browsers,requestExtension,environmentOptions={},identityOptions={}}={}){
  const mode=guardianMode(environmentOptions,identityOptions);
  if(mode==='detached'||mode==='external')return new DetachedGuardian({browsers});
  if(mode!=='embedded')throw new Error(`guardian_mode_invalid:${mode}`);
  const {EnvironmentGuardian}=require('./environment_guardian');
  const guardian=new EnvironmentGuardian(baseDir,browsers,{...environmentOptions,requestExtension,env:environmentOptions.env||identityOptions.env||process.env});
  guardian.mode='EMBEDDED';
  return guardian;
}

function attachProtectionGuardian(server){
  if(!server?.runtime)throw new Error('guardian_server_runtime_required');
  if(server.runtime.guardian?.mode==='DETACHED')throw new Error('guardian_cannot_attach_inside_detached_body');
  const {ProtectionSupervisor}=require('./protection_supervisor');
  const protection=new ProtectionSupervisor(server.runtime).start();
  server.runtime.protection=protection;
  return protection;
}

module.exports={DetachedGuardian,guardianMode,createRuntimeGuardian,attachProtectionGuardian};
