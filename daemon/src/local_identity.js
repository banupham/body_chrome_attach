'use strict';

const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {SafeJsonPersistence}=require('./safe_json_persistence');
const {runtimeDataDir}=require('./runtime_data_dir');

const ID_PATTERN=/^[A-Za-z0-9._:-]+$/;

function normalizeId(value,name){
  const id=String(value||'').trim();
  if(!id)throw new Error(`${name}_required`);
  if(id.length>180||!ID_PATTERN.test(id))throw new Error(`${name}_invalid`);
  return id;
}

function clone(value){return JSON.parse(JSON.stringify(value));}

class LocalIdentityStore{
  constructor(baseDir,{env=process.env,uuid=()=>crypto.randomUUID(),now=()=>Date.now()}={}){
    const resolvedBaseDir=runtimeDataDir(baseDir,env);
    this.baseDir=resolvedBaseDir;
    this.dir=path.join(resolvedBaseDir,'identity');
    this.companyPath=path.join(this.dir,'company.json');
    this.devicePath=path.join(this.dir,'device.json');
    this.browsersPath=path.join(this.dir,'browsers.json');
    this.env=env||{};
    this.uuid=uuid;
    this.now=now;
    fs.mkdirSync(this.dir,{recursive:true});

    this.company=this._loadOrCreateCompany();
    this.device=this._loadOrCreateDevice();
    this.browserState=this._loadOrCreateBrowsers();
    this.browserPersistence=new SafeJsonPersistence(this.browsersPath,{
      getValue:()=>this.browserState,
      debounceMs:0,
      retryAfterMs:1000,
      log:null
    });
  }

  _timestamp(){return new Date(this.now()).toISOString();}
  _generated(prefix){return `${prefix}-${this.uuid()}`;}

  _read(file,label){
    if(!fs.existsSync(file))return null;
    try{return JSON.parse(fs.readFileSync(file,'utf8'));}
    catch{throw new Error(`identity_${label}_invalid`);}
  }

  _writeInitial(file,value,label){
    const persistence=new SafeJsonPersistence(file,{getValue:()=>value,debounceMs:0,retryAfterMs:1000,log:null});
    persistence.schedule();
    const result=persistence.flushSync();
    if(!result.ok)throw new Error(`identity_${label}_persistence_failed:${result.lastError?.code||'UNKNOWN'}`);
  }

  _loadOrCreateCompany(){
    const requested=String(this.env.BODY_COMPANY_ID||'').trim();
    const existing=this._read(this.companyPath,'company');
    if(existing){
      if(Number(existing.schemaVersion)!==1)throw new Error('identity_company_schema_unsupported');
      const companyId=normalizeId(existing.companyId,'company_id');
      if(requested&&requested!==companyId)throw new Error('company_id_mismatch');
      return {...existing,companyId};
    }
    const companyId=normalizeId(requested||this._generated('company'),'company_id');
    const value={schemaVersion:1,companyId,createdAt:this._timestamp()};
    this._writeInitial(this.companyPath,value,'company');
    return value;
  }

  _loadOrCreateDevice(){
    const requested=String(this.env.BODY_DEVICE_ID||'').trim();
    const existing=this._read(this.devicePath,'device');
    if(existing){
      if(Number(existing.schemaVersion)!==1)throw new Error('identity_device_schema_unsupported');
      const companyId=normalizeId(existing.companyId,'company_id');
      const deviceId=normalizeId(existing.deviceId,'device_id');
      if(companyId!==this.company.companyId)throw new Error('device_company_binding_mismatch');
      if(requested&&requested!==deviceId)throw new Error('device_id_mismatch');
      return {...existing,companyId,deviceId};
    }
    const deviceId=normalizeId(requested||this._generated('device'),'device_id');
    const value={schemaVersion:1,companyId:this.company.companyId,deviceId,createdAt:this._timestamp()};
    this._writeInitial(this.devicePath,value,'device');
    return value;
  }

  _loadOrCreateBrowsers(){
    const existing=this._read(this.browsersPath,'browsers');
    if(existing){
      if(Number(existing.schemaVersion)!==1)throw new Error('identity_browsers_schema_unsupported');
      if(existing.companyId!==this.company.companyId||existing.deviceId!==this.device.deviceId)throw new Error('browser_registry_device_binding_mismatch');
      if(!existing.browsers||typeof existing.browsers!=='object'||Array.isArray(existing.browsers))throw new Error('identity_browsers_invalid');
      return existing;
    }
    const value={schemaVersion:1,companyId:this.company.companyId,deviceId:this.device.deviceId,browsers:{}};
    this._writeInitial(this.browsersPath,value,'browsers');
    return value;
  }

  _persistBrowsers(){
    this.browserPersistence.schedule();
    const result=this.browserPersistence.flushSync();
    if(!result.ok)throw new Error(`identity_browsers_persistence_failed:${result.lastError?.code||'UNKNOWN'}`);
    return result;
  }

  snapshot(){
    return {
      schemaVersion:1,
      companyId:this.company.companyId,
      deviceId:this.device.deviceId,
      applicationModel:'one-company-runtime-per-device',
      browserRegistrationCount:Object.keys(this.browserState.browsers).length
    };
  }

  registerBrowser({browserInstanceId,extensionInstanceId,runtimeExtensionId}){
    const browserId=normalizeId(browserInstanceId,'browser_instance_id');
    const extensionId=normalizeId(extensionInstanceId,'extension_instance_id');
    const runtimeId=normalizeId(runtimeExtensionId,'runtime_extension_id');

    for(const record of Object.values(this.browserState.browsers)){
      if(record.extensionInstanceId===extensionId&&record.browserInstanceId!==browserId){
        throw new Error(`extension_browser_binding_mismatch:${extensionId}`);
      }
    }

    const existing=this.browserState.browsers[browserId]||null;
    if(existing&&existing.extensionInstanceId!==extensionId)throw new Error(`browser_extension_binding_mismatch:${browserId}`);
    if(existing&&existing.runtimeExtensionId!==runtimeId)throw new Error(`browser_runtime_extension_mismatch:${browserId}`);

    const before=clone(this.browserState);
    const now=this._timestamp();
    this.browserState.browsers[browserId]={
      browserInstanceId:browserId,
      extensionInstanceId:extensionId,
      runtimeExtensionId:runtimeId,
      firstSeenAt:existing?.firstSeenAt||now,
      lastSeenAt:now,
      platformIdentities:existing?.platformIdentities||{}
    };
    try{this._persistBrowsers();}
    catch(error){this.browserState=before;throw error;}
    return this.identityChain(browserId);
  }

  bindPlatformIdentity(browserInstanceId,{platform,accountId,channelId=null}){
    const browserId=normalizeId(browserInstanceId,'browser_instance_id');
    const record=this.browserState.browsers[browserId];
    if(!record)throw new Error(`browser_identity_not_registered:${browserId}`);
    const platformKey=normalizeId(String(platform||'').toLowerCase(),'platform');
    const account=normalizeId(accountId,'platform_account_id');
    const channel=channelId==null||String(channelId).trim()===''?null:normalizeId(channelId,'platform_channel_id');
    const before=clone(this.browserState);
    record.platformIdentities[platformKey]={platform:platformKey,accountId:account,channelId:channel,updatedAt:this._timestamp()};
    try{this._persistBrowsers();}
    catch(error){this.browserState=before;throw error;}
    return clone(record.platformIdentities[platformKey]);
  }

  identityChain(browserInstanceId){
    const browserId=normalizeId(browserInstanceId,'browser_instance_id');
    const record=this.browserState.browsers[browserId];
    if(!record)return null;
    return {
      schemaVersion:1,
      companyId:this.company.companyId,
      deviceId:this.device.deviceId,
      applicationModel:'one-company-runtime-per-device',
      browserInstanceId:record.browserInstanceId,
      extensionInstanceId:record.extensionInstanceId,
      runtimeExtensionId:record.runtimeExtensionId,
      platformIdentities:clone(record.platformIdentities||{})
    };
  }

  browserRegistrations(){
    return Object.values(this.browserState.browsers).map(record=>({
      companyId:this.company.companyId,
      deviceId:this.device.deviceId,
      ...clone(record)
    })).sort((a,b)=>a.browserInstanceId.localeCompare(b.browserInstanceId,'en'));
  }

  flushSync(){return this.browserPersistence.flushSync();}
}

module.exports={LocalIdentityStore,normalizeId};
