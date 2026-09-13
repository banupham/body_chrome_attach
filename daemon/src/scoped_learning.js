'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {DatasetStore}=require('./dataset_store');
const {OnlineBehaviorModel}=require('./online_model');
const {HabitModel}=require('./habit_model');
const {configuredRuntimeDataDir}=require('./runtime_data_dir');

const DATA_FILES=Object.freeze(['human_samples.jsonl','human_events.jsonl','agent_events.jsonl']);

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

function readJsonlLines(file) {
  if(!fs.existsSync(file)) return [];
  return fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean).map((line,index)=>{
    try{return JSON.stringify(JSON.parse(line));}
    catch(error){const e=new Error(`learning_jsonl_invalid:${file}:${index+1}`);e.cause=error;throw e;}
  });
}

function mergeJsonlFile(source,target) {
  if(!fs.existsSync(source)) return {source,target,sourceRows:0,added:0,total:fs.existsSync(target)?readJsonlLines(target).length:0};
  const existing=readJsonlLines(target),seen=new Set(existing),incoming=readJsonlLines(source);
  let added=0;
  for(const line of incoming)if(!seen.has(line)){seen.add(line);existing.push(line);added++;}
  if(added){fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,existing.join('\n')+'\n','utf8');}
  return {source,target,sourceRows:incoming.length,added,total:existing.length};
}

function sourceSignature(root) {
  if(!root||!fs.existsSync(root)) return null;
  const rows=[];
  for(const site of fs.readdirSync(root,{withFileTypes:true}).filter(x=>x.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
    const dataDir=path.join(root,site.name,'data');
    for(const file of DATA_FILES){
      const full=path.join(dataDir,file);if(!fs.existsSync(full))continue;
      const stat=fs.statSync(full);rows.push(`${site.name}/${file}:${stat.size}:${Math.trunc(stat.mtimeMs)}`);
    }
  }
  return rows.join('|');
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
    const p=this.primary?.scoreAlternatives(args),f=this.fallback?.scoreAlternatives(args);
    const pObs=Number(p?.totalHabitObservations||0);
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
    this.migrationStatePath=path.join(this.siteRoot,'.browser-learning-imports.json');
    this.resolveIdentity=typeof resolveIdentity==='function'?resolveIdentity:null;
    this.cache=new Map();
    this.migrations=[];
    fs.mkdirSync(this.siteRoot,{recursive:true});
    this.migrationState=this._loadMigrationState();
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

  _loadMigrationState() {
    if(!fs.existsSync(this.migrationStatePath))return {schemaVersion:1,sources:{}};
    try{
      const parsed=JSON.parse(fs.readFileSync(this.migrationStatePath,'utf8'));
      if(parsed?.schemaVersion===1&&parsed?.sources&&typeof parsed.sources==='object')return parsed;
    }catch{}
    return {schemaVersion:1,sources:{}};
  }

  _saveMigrationState() {
    fs.mkdirSync(path.dirname(this.migrationStatePath),{recursive:true});
    fs.writeFileSync(this.migrationStatePath,JSON.stringify(this.migrationState,null,2),'utf8');
  }

  _resetCachedSite(siteKey) {
    const key=this._key(siteKey),scope=this.cache.get(key);if(!scope)return;
    try{scope.store.flushSync();}catch{}
    try{scope.motor.flushSync();}catch{}
    try{scope.habit.flushSync();}catch{}
    this.cache.delete(key);
  }

  _rebuildSharedSite(siteKey) {
    const normalized=normalizeSiteKey(siteKey),dir=this._scopeDir(normalized);
    this._resetCachedSite(normalized);
    const sampleFile=path.join(dir,'data','human_samples.jsonl');
    const samples=readJsonlLines(sampleFile).map(line=>JSON.parse(line));
    const motor=new OnlineBehaviorModel(path.join(dir,'model','behavior_model.json'));
    motor.rebuild(samples);
    const habit=new HabitModel(path.join(dir,'model','habit_model.json'));
    habit.state={version:1,revision:0,updatedAt:null,transitions:{},habits:{},lastHumanByTab:{}};
    for(const sample of samples)habit.observe(sample);
    habit.flushSync();
    return {siteKey:normalized,samples:samples.length,motor:motor.stats(),habit:habit.stats()};
  }

  _importSourceRoot(sourceKey,sourceRoot) {
    if(!this._hasPayload(sourceRoot))return null;
    const signature=sourceSignature(sourceRoot);
    if(this.migrationState.sources[sourceKey]?.signature===signature)return null;
    const touched=new Set(),files=[];
    for(const entry of fs.readdirSync(sourceRoot,{withFileTypes:true}).filter(x=>x.isDirectory())){
      const siteKey=normalizeSiteKey(entry.name),sourceData=path.join(sourceRoot,entry.name,'data'),targetData=path.join(this._scopeDir(siteKey),'data');
      let siteAdded=0;
      for(const file of DATA_FILES){const merged=mergeJsonlFile(path.join(sourceData,file),path.join(targetData,file));files.push(merged);siteAdded+=merged.added;}
      if(siteAdded>0)touched.add(siteKey);
    }
    const rebuilt=[...touched].map(site=>this._rebuildSharedSite(site));
    const report={sourceKey,sourceRoot,signature,importedAt:new Date().toISOString(),touchedSites:[...touched].sort(),addedRows:files.reduce((sum,row)=>sum+row.added,0),files,rebuilt};
    this.migrationState.sources[sourceKey]={signature,importedAt:report.importedAt,addedRows:report.addedRows,touchedSites:report.touchedSites};
    this._saveMigrationState();
    this.migrations.push(report);
    return report;
  }

  _ensureSharedMigration(identity=null) {
    if(fs.existsSync(this.browserRoot)){
      for(const browser of fs.readdirSync(this.browserRoot,{withFileTypes:true}).filter(x=>x.isDirectory()))this._importSourceRoot(`browser:${browser.name}`,path.join(this.browserRoot,browser.name));
    }
    if(identity?.extensionInstanceId){
      const legacy=this._legacyExtensionDir(identity);
      if(legacy&&path.resolve(legacy)!==path.resolve(this.siteRoot)&&path.resolve(legacy)!==path.resolve(this.browserRoot))this._importSourceRoot(`extension:${identity.extensionInstanceId}`,legacy);
    }
    return this.migrationStatus();
  }

  bindIdentity(ref) {
    const identity=this._identity(ref);
    this._ensureSharedMigration(identity);
    return {...identity,learningScope:'site_shared',migration:this.migrationStatus()};
  }

  scope(ref,siteKey) {
    const identity=this._identity(ref);this._ensureSharedMigration(identity);
    const key=this._key(siteKey);
    if(this.cache.has(key))return this.cache.get(key);
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
    const identity=this._identity(ref),site=this.scope(identity,siteKey);
    const provenance={browserInstanceId:identity.browserInstanceId,extensionInstanceId:identity.extensionInstanceId,runtimeExtensionId:identity.runtimeExtensionId};
    site.store.appendEvent(tabId,{...event,...provenance});
    const global=this.globalScope(identity);
    if(global!==site)global.store.appendEvent(tabId,{...event,...provenance,siteKey:normalizeSiteKey(siteKey)});
  }

  observeHumanSample(ref,siteKey,sample,{learn=true}={}) {
    const identity=this._identity(ref),site=this.scope(identity,siteKey),global=this.globalScope(identity);
    const scopedSample={...sample,browserInstanceId:String(identity.browserInstanceId),extensionInstanceId:identity.extensionInstanceId,runtimeExtensionId:identity.runtimeExtensionId,siteKey:normalizeSiteKey(siteKey),source:'human'};
    site.store.appendHumanSample(scopedSample);
    if(global!==site)global.store.appendHumanSample(scopedSample);
    if(learn){site.motor.observe(scopedSample);site.habit.observe(scopedSample);if(global!==site){global.motor.observe(scopedSample);global.habit.observe(scopedSample);}}
    return scopedSample;
  }

  motorFor(ref,siteKey) {const site=this.scope(ref,siteKey),global=this.globalScope(ref);return new CascadingMotorModel(site.motor,global.motor);}
  habitFor(ref,siteKey) {const site=this.scope(ref,siteKey),global=this.globalScope(ref);return new CascadingHabitModel(site.habit,global.habit);}

  flushSync() {
    const results=[];
    for(const scope of this.cache.values()){
      let datasetOk=true;try{scope.store.flushSync();}catch{datasetOk=false;}
      const motor=scope.motor.flushSync(),habit=scope.habit.flushSync();
      results.push({learningScope:'site_shared',siteKey:scope.siteKey,datasetOk,motorOk:motor.ok,habitOk:habit.ok});
    }
    return results;
  }

  rebuild(ref,siteKey='__global__') {
    const identity=this._identity(ref);this._ensureSharedMigration(identity);
    if(siteKey==='*'){
      const sites=this.listSites(identity);return sites.map(site=>this.rebuild(identity,site));
    }
    const scope=this.scope(identity,siteKey),samples=scope.store.loadHumanSamples();
    scope.motor.rebuild(samples);
    scope.habit.state={version:1,revision:0,updatedAt:null,transitions:{},habits:{},lastHumanByTab:{}};
    for(const sample of samples)scope.habit.observe(sample);
    scope.habit.flushSync();
    return {browserInstanceId:String(identity.browserInstanceId),extensionInstanceId:identity.extensionInstanceId,learningScope:'site_shared',siteKey:scope.siteKey,samples:samples.length,motor:scope.motor.stats(),habit:scope.habit.stats()};
  }

  stats(ref,siteKey) {
    const identity=this._identity(ref),scope=this.scope(identity,siteKey);
    return {browserInstanceId:String(identity.browserInstanceId),extensionInstanceId:identity.extensionInstanceId,learningScope:'site_shared',siteKey:scope.siteKey,dataset:scope.store.stats(),motor:scope.motor.stats(),habit:scope.habit.stats()};
  }

  listSites(ref) {
    const identity=this._identity(ref);this._ensureSharedMigration(identity);
    if(!fs.existsSync(this.siteRoot))return [];
    return fs.readdirSync(this.siteRoot,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>x.name).sort();
  }

  migrationStatus() {
    return {learningScope:'site_shared',siteRoot:this.siteRoot,legacyBrowserRoot:this.browserRoot,sources:{...this.migrationState.sources},recent:this.migrations.slice(-20).map(row=>({sourceKey:row.sourceKey,importedAt:row.importedAt,addedRows:row.addedRows,touchedSites:row.touchedSites}))};
  }
}

module.exports={ScopedLearningManager,CascadingMotorModel,CascadingHabitModel,normalizeLearningIdentity,normalizeSiteKey,safeSegment,mergeJsonlFile};
