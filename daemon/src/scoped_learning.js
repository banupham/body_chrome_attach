'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {DatasetStore}=require('./dataset_store');
const {OnlineBehaviorModel}=require('./online_model');
const {HabitModel}=require('./habit_model');
const {configuredRuntimeDataDir}=require('./runtime_data_dir');

const DATA_FILES=Object.freeze(['human_samples.jsonl','human_events.jsonl','agent_events.jsonl']);

function safeSegment(raw,fallback='unknown') {
  const s=String(raw||fallback).toLowerCase().replace(/[^a-z0-9._-]+/g,'_').replace(/^_+|_+$/g,'');
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

function readJsonlLines(file) {
  if(!fs.existsSync(file)) return [];
  return fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean).map((line,index)=>{
    try{return JSON.stringify(JSON.parse(line));}
    catch(error){const e=new Error(`learning_jsonl_invalid:${file}:${index+1}`);e.cause=error;throw e;}
  });
}

function lineCounts(lines) {
  const counts=new Map();
  for(const line of lines) counts.set(line,(counts.get(line)||0)+1);
  return counts;
}

function mergeJsonlLines(incoming,target) {
  const existing=readJsonlLines(target);
  if(!incoming.length) return {target,sourceRows:0,added:0,total:existing.length};

  const have=lineCounts(existing);
  const need=lineCounts(incoming);
  const remaining=new Map();
  for(const [line,count] of need) {
    const deficit=Math.max(0,count-(have.get(line)||0));
    if(deficit>0) remaining.set(line,deficit);
  }

  const additions=[];
  for(const line of incoming) {
    const left=remaining.get(line)||0;
    if(left<=0) continue;
    additions.push(line);
    if(left===1) remaining.delete(line);
    else remaining.set(line,left-1);
  }

  if(additions.length) {
    fs.mkdirSync(path.dirname(target),{recursive:true});
    const merged=existing.concat(additions);
    fs.writeFileSync(target,merged.join('\n')+'\n','utf8');
  }
  return {target,sourceRows:incoming.length,added:additions.length,total:existing.length+additions.length};
}

function mergeJsonlFile(source,target) {
  const incoming=readJsonlLines(source);
  return {source,...mergeJsonlLines(incoming,target)};
}

function mergeJsonlSources(sources,target) {
  const incoming=[];
  for(const source of sources) incoming.push(...readJsonlLines(source));
  return {sources:[...sources],...mergeJsonlLines(incoming,target)};
}

class CascadingMotorModel {
  constructor(primary,fallback) {this.primary=primary;this.fallback=fallback;}
  sampleMouse(args) {return this.primary?.sampleMouse(args) || this.fallback?.sampleMouse(args) || null;}
  sampleTyping() {return this.primary?.sampleTyping() || this.fallback?.sampleTyping() || null;}
  sampleScroll(action,amount) {return this.primary?.sampleScroll(action,amount) || this.fallback?.sampleScroll(action,amount) || null;}
  samplePressKey(key) {return this.primary?.samplePressKey(key) || this.fallback?.samplePressKey(key) || null;}
  sampleKeyCombo(args) {return this.primary?.sampleKeyCombo(args) || this.fallback?.sampleKeyCombo(args) || null;}
}

class CascadingHabitModel {
  constructor(primary,fallback) {this.primary=primary;this.fallback=fallback;}
  scoreAlternatives(args) {
    const p=this.primary?.scoreAlternatives(args),f=this.fallback?.scoreAlternatives(args),pObs=Number(p?.totalHabitObservations||0);
    if(pObs>0) return {...p,scopeSource:'site'};
    if(f) return {...f,scopeSource:'device_global'};
    return p;
  }
  stats() {return {primary:this.primary?.stats?.()||null,fallback:this.fallback?.stats?.()||null};}
}

class ScopedLearningManager {
  constructor(baseDir,{resolveIdentity=null,env=process.env}={}) {
    const dataRoot=configuredRuntimeDataDir(env);
    this.baseDir=dataRoot?path.join(dataRoot,'profiles'):baseDir;
    this.browserRoot=path.join(this.baseDir,'by-browser');
    this.siteRoot=path.join(this.baseDir,'by-site');
    this.resolveIdentity=typeof resolveIdentity==='function'?resolveIdentity:null;
    this.cache=new Map();
    this.migrations=[];
    this.browserMigrationChecked=false;
    this.checkedLegacyExtensions=new Set();
    this.legacyRoots=new Map();
    fs.mkdirSync(this.siteRoot,{recursive:true});
    this._ensureSharedMigration();
  }

  _identity(ref) {
    const alreadyResolved=ref&&typeof ref==='object'&&String(ref.browserInstanceId||'').trim();
    const resolved=alreadyResolved?ref:(this.resolveIdentity?this.resolveIdentity(ref):ref);
    return normalizeLearningIdentity(resolved,ref);
  }

  _key(siteKey) {return normalizeSiteKey(siteKey);}
  _scopeDir(siteKey) {return path.join(this.siteRoot,normalizeSiteKey(siteKey));}
  _legacyExtensionDir(identity) {return identity?.extensionInstanceId?path.join(this.baseDir,safeSegment(identity.extensionInstanceId,'extension')):null;}
  _hasPayload(dir) {return Boolean(dir&&fs.existsSync(dir)&&fs.readdirSync(dir,{withFileTypes:true}).some(entry=>entry.name!=='.DS_Store'));}

  _rememberLegacyRoot(sourceKey,sourceRoot) {
    if(!this._hasPayload(sourceRoot)) return false;
    const resolved=path.resolve(sourceRoot);
    if(resolved===path.resolve(this.siteRoot) || resolved===path.resolve(this.browserRoot)) return false;
    const previous=this.legacyRoots.get(sourceKey);
    this.legacyRoots.set(sourceKey,sourceRoot);
    return previous!==sourceRoot;
  }

  _rememberBrowserRoots() {
    if(!fs.existsSync(this.browserRoot)) return false;
    let changed=false;
    for(const browser of fs.readdirSync(this.browserRoot,{withFileTypes:true}).filter(x=>x.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name,'en'))) {
      const root=path.join(this.browserRoot,browser.name);
      if(this._hasPayload(root)) {
        const key=`browser:${browser.name}`;
        if(this.legacyRoots.get(key)!==root) {this.legacyRoots.set(key,root);changed=true;}
      }
    }
    return changed;
  }

  _flushCachedSite(siteKey) {
    const scope=this.cache.get(this._key(siteKey));
    if(!scope) return;
    try{scope.store.flushSync();}catch{}
    try{scope.motor.flushSync();}catch{}
    try{scope.habit.flushSync();}catch{}
  }

  _resetCachedSite(siteKey) {
    const key=this._key(siteKey),scope=this.cache.get(key);if(!scope)return;
    this._flushCachedSite(siteKey);
    this.cache.delete(key);
  }

  _rebuildSharedSite(siteKey) {
    const normalized=normalizeSiteKey(siteKey),dir=this._scopeDir(normalized);
    this._resetCachedSite(normalized);
    const samples=readJsonlLines(path.join(dir,'data','human_samples.jsonl')).map(line=>JSON.parse(line));
    const motor=new OnlineBehaviorModel(path.join(dir,'model','behavior_model.json'));
    motor.rebuild(samples);
    const habit=new HabitModel(path.join(dir,'model','habit_model.json'));
    habit.state={version:1,revision:0,updatedAt:null,transitions:{},habits:{},lastHumanByTab:{}};
    for(const sample of samples) habit.observe(sample);
    habit.flushSync();
    return {siteKey:normalized,samples:samples.length,motor:motor.stats(),habit:habit.stats()};
  }

  _repairSharedFromLegacyRoots(reason='legacy_repair') {
    const roots=[...this.legacyRoots.entries()];
    if(!roots.length) return null;

    const targets=new Map();
    for(const [sourceKey,sourceRoot] of roots) {
      if(!this._hasPayload(sourceRoot)) continue;
      for(const entry of fs.readdirSync(sourceRoot,{withFileTypes:true}).filter(x=>x.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name,'en'))) {
        const siteKey=normalizeSiteKey(entry.name),sourceData=path.join(sourceRoot,entry.name,'data');
        for(const file of DATA_FILES) {
          const source=path.join(sourceData,file);
          if(!fs.existsSync(source)) continue;
          const key=`${siteKey}\u0000${file}`;
          if(!targets.has(key)) targets.set(key,{siteKey,file,sources:[]});
          targets.get(key).sources.push({sourceKey,source});
        }
      }
    }

    const sitesToFlush=new Set([...targets.values()].map(row=>row.siteKey));
    for(const siteKey of sitesToFlush) this._flushCachedSite(siteKey);

    const files=[];
    const touchedData=new Set();
    const touchedSamples=new Set();
    for(const target of targets.values()) {
      const targetFile=path.join(this._scopeDir(target.siteKey),'data',target.file);
      const merged=mergeJsonlSources(target.sources.map(row=>row.source),targetFile);
      files.push({siteKey:target.siteKey,file:target.file,sourceKeys:target.sources.map(row=>row.sourceKey),...merged});
      if(merged.added>0) {
        touchedData.add(target.siteKey);
        if(target.file==='human_samples.jsonl') touchedSamples.add(target.siteKey);
      }
    }

    for(const siteKey of touchedData) this._resetCachedSite(siteKey);
    const rebuilt=[...touchedSamples].sort().map(siteKey=>this._rebuildSharedSite(siteKey));
    const report={
      reason,
      importedAt:new Date().toISOString(),
      sourceKeys:roots.map(([key])=>key).sort(),
      addedRows:files.reduce((sum,row)=>sum+row.added,0),
      touchedSites:[...touchedData].sort(),
      repairedSampleSites:[...touchedSamples].sort(),
      files,
      rebuilt
    };
    this.migrations.push(report);
    return report;
  }

  _ensureSharedMigration(identity=null) {
    let shouldRepair=false;
    if(!this.browserMigrationChecked) {
      this.browserMigrationChecked=true;
      this._rememberBrowserRoots();
      shouldRepair=true;
    }

    if(identity?.extensionInstanceId&&!this.checkedLegacyExtensions.has(identity.extensionInstanceId)) {
      this.checkedLegacyExtensions.add(identity.extensionInstanceId);
      const legacy=this._legacyExtensionDir(identity);
      if(legacy&&this._rememberLegacyRoot(`extension:${identity.extensionInstanceId}`,legacy)) shouldRepair=true;
    }

    if(shouldRepair) this._repairSharedFromLegacyRoots(identity?.extensionInstanceId?'legacy_identity_bound':'startup_legacy_repair');
    return this.migrationStatus();
  }

  bindIdentity(ref) {
    const identity=this._identity(ref);
    this._ensureSharedMigration(identity);
    return {...identity,learningScope:'site_shared',migration:this.migrationStatus()};
  }

  scope(ref,siteKey) {
    const identity=this._identity(ref);
    this._ensureSharedMigration(identity);
    const key=this._key(siteKey);
    if(this.cache.has(key)) return this.cache.get(key);
    const dir=this._scopeDir(siteKey);
    const scope={
      companyId:identity.companyId,
      deviceId:identity.deviceId,
      browserInstanceId:null,
      extensionInstanceId:null,
      runtimeExtensionId:null,
      learningScope:'site_shared',
      siteKey:normalizeSiteKey(siteKey),
      dir,
      store:new DatasetStore(path.join(dir,'data')),
      motor:new OnlineBehaviorModel(path.join(dir,'model','behavior_model.json')),
      habit:new HabitModel(path.join(dir,'model','habit_model.json'))
    };
    this.cache.set(key,scope);
    return scope;
  }

  globalScope(ref) {return this.scope(ref,'__global__');}

  observeEvent(ref,siteKey,tabId,event) {
    const identity=this._identity(ref),site=this.scope(identity,siteKey),provenance={browserInstanceId:identity.browserInstanceId,extensionInstanceId:identity.extensionInstanceId,runtimeExtensionId:identity.runtimeExtensionId};
    site.store.appendEvent(tabId,{...event,...provenance});
    const global=this.globalScope(identity);
    if(global!==site) global.store.appendEvent(tabId,{...event,...provenance,siteKey:normalizeSiteKey(siteKey)});
  }

  observeHumanSample(ref,siteKey,sample,{learn=true}={}) {
    const identity=this._identity(ref),site=this.scope(identity,siteKey),global=this.globalScope(identity),scopedSample={...sample,browserInstanceId:String(identity.browserInstanceId),extensionInstanceId:identity.extensionInstanceId,runtimeExtensionId:identity.runtimeExtensionId,siteKey:normalizeSiteKey(siteKey),source:'human'};
    site.store.appendHumanSample(scopedSample);
    if(global!==site) global.store.appendHumanSample(scopedSample);
    if(learn) {
      site.motor.observe(scopedSample);
      site.habit.observe(scopedSample);
      if(global!==site) {global.motor.observe(scopedSample);global.habit.observe(scopedSample);}
    }
    return scopedSample;
  }

  motorFor(ref,siteKey) {const site=this.scope(ref,siteKey),global=this.globalScope(ref);return new CascadingMotorModel(site.motor,global.motor);}
  habitFor(ref,siteKey) {const site=this.scope(ref,siteKey),global=this.globalScope(ref);return new CascadingHabitModel(site.habit,global.habit);}

  flushSync() {
    const results=[];
    for(const scope of this.cache.values()) {
      let datasetOk=true;
      try{scope.store.flushSync();}catch{datasetOk=false;}
      const motor=scope.motor.flushSync(),habit=scope.habit.flushSync();
      results.push({learningScope:'site_shared',siteKey:scope.siteKey,datasetOk,motorOk:motor.ok,habitOk:habit.ok});
    }
    return results;
  }

  rebuild(ref,siteKey='__global__') {
    const identity=this._identity(ref);
    this._ensureSharedMigration(identity);
    if(siteKey==='*') return this.listSites(identity).map(site=>this.rebuild(identity,site));
    const scope=this.scope(identity,siteKey),samples=scope.store.loadHumanSamples();
    scope.motor.rebuild(samples);
    scope.habit.state={version:1,revision:0,updatedAt:null,transitions:{},habits:{},lastHumanByTab:{}};
    for(const sample of samples) scope.habit.observe(sample);
    scope.habit.flushSync();
    return {browserInstanceId:String(identity.browserInstanceId),extensionInstanceId:identity.extensionInstanceId,learningScope:'site_shared',siteKey:scope.siteKey,samples:samples.length,motor:scope.motor.stats(),habit:scope.habit.stats()};
  }

  stats(ref,siteKey) {
    const identity=this._identity(ref),scope=this.scope(identity,siteKey);
    return {browserInstanceId:String(identity.browserInstanceId),extensionInstanceId:identity.extensionInstanceId,learningScope:'site_shared',siteKey:scope.siteKey,dataset:scope.store.stats(),motor:scope.motor.stats(),habit:scope.habit.stats()};
  }

  listSites(ref) {
    const identity=this._identity(ref);
    this._ensureSharedMigration(identity);
    if(!fs.existsSync(this.siteRoot)) return [];
    return fs.readdirSync(this.siteRoot,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>x.name).sort();
  }

  migrationStatus() {
    return {
      learningScope:'site_shared',
      siteRoot:this.siteRoot,
      legacyBrowserRoot:this.browserRoot,
      legacySources:[...this.legacyRoots.keys()].sort(),
      recent:this.migrations.slice(-20).map(row=>({reason:row.reason,importedAt:row.importedAt,addedRows:row.addedRows,touchedSites:row.touchedSites,repairedSampleSites:row.repairedSampleSites}))
    };
  }
}

module.exports={
  ScopedLearningManager,
  CascadingMotorModel,
  CascadingHabitModel,
  normalizeLearningIdentity,
  normalizeSiteKey,
  safeSegment,
  mergeJsonlFile,
  mergeJsonlSources
};
