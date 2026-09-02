
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {DatasetStore}=require('./dataset_store');
const {OnlineBehaviorModel}=require('./online_model');
const {HabitModel}=require('./habit_model');

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
    if(f) return {...f,scopeSource:'extension_global'};
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
  constructor(baseDir) {
    this.baseDir=baseDir;
    this.cache=new Map();
  }

  _key(extensionId,siteKey) {
    return `${String(extensionId)}::${normalizeSiteKey(siteKey)}`;
  }

  _scopeDir(extensionId,siteKey) {
    return path.join(
      this.baseDir,
      safeSegment(extensionId,'extension'),
      normalizeSiteKey(siteKey)
    );
  }

  scope(extensionId,siteKey) {
    const key=this._key(extensionId,siteKey);
    if(this.cache.has(key)) return this.cache.get(key);

    const dir=this._scopeDir(extensionId,siteKey);
    const scope={
      extensionId:String(extensionId),
      siteKey:normalizeSiteKey(siteKey),
      dir,
      store:new DatasetStore(path.join(dir,'data')),
      motor:new OnlineBehaviorModel(path.join(dir,'model','behavior_model.json')),
      habit:new HabitModel(path.join(dir,'model','habit_model.json'))
    };

    this.cache.set(key,scope);
    return scope;
  }

  globalScope(extensionId) {
    return this.scope(extensionId,'__global__');
  }

  observeEvent(extensionId,siteKey,tabId,event) {
    const site=this.scope(extensionId,siteKey);
    site.store.appendEvent(tabId,event);

    const global=this.globalScope(extensionId);
    if(global!==site) global.store.appendEvent(tabId,{...event,siteKey:normalizeSiteKey(siteKey)});
  }

  observeHumanSample(extensionId,siteKey,sample,{learn=true}={}) {
    const site=this.scope(extensionId,siteKey);
    const global=this.globalScope(extensionId);
    const scopedSample={
      ...sample,
      extensionId:String(extensionId),
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

  motorFor(extensionId,siteKey) {
    const site=this.scope(extensionId,siteKey);
    const global=this.globalScope(extensionId);
    return new CascadingMotorModel(site.motor,global.motor);
  }

  habitFor(extensionId,siteKey) {
    const site=this.scope(extensionId,siteKey);
    const global=this.globalScope(extensionId);
    return new CascadingHabitModel(site.habit,global.habit);
  }

  rebuild(extensionId,siteKey='__global__') {
    if(siteKey==='*') {
      const extDir=path.join(this.baseDir,safeSegment(extensionId,'extension'));
      if(!fs.existsSync(extDir)) return [];
      const sites=fs.readdirSync(extDir,{withFileTypes:true})
        .filter(x=>x.isDirectory())
        .map(x=>x.name);
      return sites.map(s=>this.rebuild(extensionId,s));
    }

    const scope=this.scope(extensionId,siteKey);
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

    return {
      extensionId:String(extensionId),
      siteKey:scope.siteKey,
      samples:samples.length,
      motor:scope.motor.stats(),
      habit:scope.habit.stats()
    };
  }

  stats(extensionId,siteKey) {
    const scope=this.scope(extensionId,siteKey);
    return {
      extensionId:String(extensionId),
      siteKey:scope.siteKey,
      dataset:scope.store.stats(),
      motor:scope.motor.stats(),
      habit:scope.habit.stats()
    };
  }

  listSites(extensionId) {
    const extDir=path.join(this.baseDir,safeSegment(extensionId,'extension'));
    if(!fs.existsSync(extDir)) return [];
    return fs.readdirSync(extDir,{withFileTypes:true})
      .filter(x=>x.isDirectory())
      .map(x=>x.name)
      .sort();
  }
}

module.exports={
  ScopedLearningManager,
  CascadingMotorModel,
  CascadingHabitModel,
  normalizeSiteKey,
  safeSegment
};
