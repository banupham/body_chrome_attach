'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {DatasetStore}=require('./dataset_store');
const {OnlineBehaviorModel}=require('./online_model');
const {HabitModel}=require('./habit_model');
const {configuredRuntimeDataDir}=require('./runtime_data_dir');

function safeSegment(raw,fallback='unknown') {
  const s=String(raw||fallback)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g,'_')
    .replace(/^_+|_+$/g,'');
  return s || fallback;
}

function normalizeSiteKey(raw) {
  const s=String(raw||'__unknown__').toLowerCase().trim();
  if(s==='__global__' || s==='__unknown__' || s==='__non_web__') return s;
  return safeSegment(s,'__unknown__');
}

function normalizeLearningIdentity(value,fallbackRef=null) {
  if(value&&typeof value==='object') {
    const browserInstanceId=String(value.browserInstanceId||'').trim();
    if(!browserInstanceId) throw new Error('learning_browser_instance_id_required');
    return {
      companyId:value.companyId||null,
      deviceId:value.deviceId||null,
      browserInstanceId,
      extensionInstanceId:value.extensionInstanceId?String(value.extensionInstanceId):null,
      runtimeExtensionId:value.runtimeExtensionId?String(value.runtimeExtensionId):null
    };
  }
  const browserInstanceId=String(value||fallbackRef||'').trim();
  if(!browserInstanceId) throw new Error('learning_browser_instance_id_required');
  return {companyId:null,deviceId:null,browserInstanceId,extensionInstanceId:null,runtimeExtensionId:null};
}

class CascadingMotorModel {
  constructor(primary,fallback) {
    this.primary=primary;
    this.fallback=fallback;
  }
  sampleMouse(args) {
    return this.primary?.sampleMouse(args) || this.fallback?.sampleMouse(args) || null;
  }
  sampleTyping() {
    return this.primary?.sampleTyping() || this.fallback?.sampleTyping() || null;
  }
  sampleScroll(action,amount) {
    return this.primary?.sampleScroll(action,amount) || this.fallback?.sampleScroll(action,amount) || null;
  }
  samplePressKey(key) {
    return this.primary?.samplePressKey(key) || this.fallback?.samplePressKey(key) || null;
  }
  sampleKeyCombo(args) {
    return this.primary?.sampleKeyCombo(args) || this.fallback?.sampleKeyCombo(args) || null;
  }
}

class CascadingHabitModel {
  constructor(primary,fallback) {
    this.primary=primary;
    this.fallback=fallback;
  }

  scoreAlternatives(args) {
    const p=this.primary?.scoreAlternatives(args);
    const f=this.fallback?.scoreAlternatives(args);

    const pObs=Number(p?.totalHabitObservations||0);
    if(pObs>0) return {...p,scopeSource:'site'};
    if(f) return {...f,scopeSource:'browser_global'};
    return p;
  }

  stats() {
    return {
      primary:this.primary?.stats?.()||null,
      fallback:this.fallback?.stats?.()||null
    };
  }
}

class ScopedLearningManager {
  constructor(baseDir,{resolveIdentity=null,env=process.env}={}) {
    const dataRoot=configuredRuntimeDataDir(env);
    this.baseDir=dataRoot?path.join(dataRoot,'profiles'):baseDir;
    this.browserRoot=path.join(this.baseDir,'by-browser');
    this.resolveIdentity=typeof resolveIdentity==='function'?resolveIdentity:null;
    this.cache=new Map();
    this.migrations=new Map();
    fs.mkdirSync(this.browserRoot,{recursive:true});
  }

  _identity(ref) {
    const alreadyResolved=ref&&typeof ref==='object'&&String(ref.browserInstanceId||'').trim();
    const resolved=alreadyResolved?ref:(this.resolveIdentity?this.resolveIdentity(ref):ref);
    return normalizeLearningIdentity(resolved,ref);
  }

  _key(identity,siteKey) {
    return `${String(identity.browserInstanceId)}::${normalizeSiteKey(siteKey)}`;
  }

  _browserDir(identity) {
    return path.join(this.browserRoot,safeSegment(identity.browserInstanceId,'browser'));
  }

  _legacyDir(identity) {
    if(!identity.extensionInstanceId) return null;
    return path.join(this.baseDir,safeSegment(identity.extensionInstanceId,'extension'));
  }

  _hasPayload(dir) {
    if(!dir||!fs.existsSync(dir)) return false;
    return fs.readdirSync(dir,{withFileTypes:true}).some(entry=>entry.name!=='.DS_Store');
  }

  _ensureMigration(identity) {
    const browserKey=String(identity.browserInstanceId);
    const extensionKey=String(identity.extensionInstanceId||'');
    const key=`${browserKey}::${extensionKey}`;
    if(this.migrations.has(key)) return this.migrations.get(key);

    const browserDir=this._browserDir(identity);
    const legacyDir=this._legacyDir(identity);
    let result={browserInstanceId:browserKey,extensionInstanceId:identity.extensionInstanceId||null,migrated:false,legacyDir,browserDir,reason:'no_legacy_data'};

    if(legacyDir && path.resolve(legacyDir)!==path.resolve(browserDir) && this._hasPayload(legacyDir)) {
      if(!fs.existsSync(browserDir)) {
        fs.mkdirSync(path.dirname(browserDir),{recursive:true});
        fs.renameSync(legacyDir,browserDir);
        result={...result,migrated:true,reason:'legacy_extension_scope_moved'};
      } else if(this._hasPayload(browserDir)) {
        const error=new Error(`legacy_learning_migration_conflict:${identity.extensionInstanceId}:${identity.browserInstanceId}`);
        error.code='legacy_learning_migration_conflict';
        error.legacyDir=legacyDir;
        error.browserDir=browserDir;
        throw error;
      } else {
        fs.rmSync(browserDir,{recursive:true,force:true});
        fs.renameSync(legacyDir,browserDir);
        result={...result,migrated:true,reason:'legacy_extension_scope_replaced_empty_browser_scope'};
      }
    }

    this.migrations.set(key,result);
    return result;
  }

  bindIdentity(ref) {
    const identity=this._identity(ref);
    return {...identity,migration:this._ensureMigration(identity)};
  }

  _scopeDir(identity,siteKey) {
    this._ensureMigration(identity);
    return path.join(this._browserDir(identity),normalizeSiteKey(siteKey));
  }

  scope(ref,siteKey) {
    const identity=this._identity(ref);
    this._ensureMigration(identity);
    const key=this._key(identity,siteKey);
    if(this.cache.has(key)) {
      const existing=this.cache.get(key);
      existing.extensionInstanceId=identity.extensionInstanceId;
      existing.runtimeExtensionId=identity.runtimeExtensionId;
      return existing;
    }

    const dir=this._scopeDir(identity,siteKey);
    const scope={
      companyId:identity.companyId,
      deviceId:identity.deviceId,
      browserInstanceId:String(identity.browserInstanceId),
      extensionInstanceId:identity.extensionInstanceId,
      runtimeExtensionId:identity.runtimeExtensionId,
      siteKey:normalizeSiteKey(siteKey),
      dir,
      store:new DatasetStore(path.join(dir,'data')),
      motor:new OnlineBehaviorModel(path.join(dir,'model','behavior_model.json')),
      habit:new HabitModel(path.join(dir,'model','habit_model.json'))
    };

    this.cache.set(key,scope);
    return scope;
  }

  globalScope(ref) {
    return this.scope(ref,'__global__');
  }

  observeEvent(ref,siteKey,tabId,event) {
    const identity=this._identity(ref);
    const site=this.scope(identity,siteKey);
    const provenance={
      browserInstanceId:identity.browserInstanceId,
      extensionInstanceId:identity.extensionInstanceId,
      runtimeExtensionId:identity.runtimeExtensionId
    };
    site.store.appendEvent(tabId,{...event,...provenance});

    const global=this.globalScope(identity);
    if(global!==site) global.store.appendEvent(tabId,{...event,...provenance,siteKey:normalizeSiteKey(siteKey)});
  }

  observeHumanSample(ref,siteKey,sample,{learn=true}={}) {
    const identity=this._identity(ref);
    const site=this.scope(identity,siteKey);
    const global=this.globalScope(identity);
    const scopedSample={
      ...sample,
      browserInstanceId:String(identity.browserInstanceId),
      extensionInstanceId:identity.extensionInstanceId,
      runtimeExtensionId:identity.runtimeExtensionId,
      siteKey:normalizeSiteKey(siteKey),
      source:'human'
    };

    site.store.appendHumanSample(scopedSample);
    if(global!==site) global.store.appendHumanSample(scopedSample);

    if(learn) {
      site.motor.observe(scopedSample);
      site.habit.observe(scopedSample);
      if(global!==site) {
        global.motor.observe(scopedSample);
        global.habit.observe(scopedSample);
      }
    }

    return scopedSample;
  }

  motorFor(ref,siteKey) {
    const site=this.scope(ref,siteKey);
    const global=this.globalScope(ref);
    return new CascadingMotorModel(site.motor,global.motor);
  }

  habitFor(ref,siteKey) {
    const site=this.scope(ref,siteKey);
    const global=this.globalScope(ref);
    return new CascadingHabitModel(site.habit,global.habit);
  }

  flushSync() {
    const results=[];
    for(const scope of this.cache.values()) {
      let datasetOk=true;
      try{scope.store.flushSync();}catch{datasetOk=false;}
      const motor=scope.motor.flushSync();
      const habit=scope.habit.flushSync();
      results.push({browserInstanceId:scope.browserInstanceId,siteKey:scope.siteKey,datasetOk,motorOk:motor.ok,habitOk:habit.ok});
    }
    return results;
  }

  rebuild(ref,siteKey='__global__') {
    const identity=this._identity(ref);
    if(siteKey==='*') {
      const browserDir=this._browserDir(identity);
      this._ensureMigration(identity);
      if(!fs.existsSync(browserDir)) return [];
      const sites=fs.readdirSync(browserDir,{withFileTypes:true})
        .filter(x=>x.isDirectory())
        .map(x=>x.name);
      return sites.map(s=>this.rebuild(identity,s));
    }

    const scope=this.scope(identity,siteKey);
    const samples=scope.store.loadHumanSamples();
    scope.motor.rebuild(samples);

    scope.habit.state={
      version:1,
      revision:0,
      updatedAt:null,
      transitions:{},
      habits:{},
      lastHumanByTab:{}
    };
    for(const s of samples) scope.habit.observe(s);
    scope.habit.flushSync();

    return {
      browserInstanceId:String(identity.browserInstanceId),
      extensionInstanceId:identity.extensionInstanceId,
      siteKey:scope.siteKey,
      samples:samples.length,
      motor:scope.motor.stats(),
      habit:scope.habit.stats()
    };
  }

  stats(ref,siteKey) {
    const identity=this._identity(ref);
    const scope=this.scope(identity,siteKey);
    return {
      browserInstanceId:String(identity.browserInstanceId),
      extensionInstanceId:identity.extensionInstanceId,
      siteKey:scope.siteKey,
      dataset:scope.store.stats(),
      motor:scope.motor.stats(),
      habit:scope.habit.stats()
    };
  }

  listSites(ref) {
    const identity=this._identity(ref);
    const browserDir=this._browserDir(identity);
    this._ensureMigration(identity);
    if(!fs.existsSync(browserDir)) return [];
    return fs.readdirSync(browserDir,{withFileTypes:true})
      .filter(x=>x.isDirectory())
      .map(x=>x.name)
      .sort();
  }

  migrationStatus() {
    return [...this.migrations.values()].map(row=>({...row}));
  }
}

module.exports={
  ScopedLearningManager,
  CascadingMotorModel,
  CascadingHabitModel,
  normalizeLearningIdentity,
  normalizeSiteKey,
  safeSegment
};
