'use strict';

const fs=require('node:fs');
const {SafeJsonPersistence}=require('./safe_json_persistence');

function normalizeIdentity(value,fallbackRef=null){
  if(value&&typeof value==='object'){
    const browserInstanceId=String(value.browserInstanceId||'').trim();
    if(!browserInstanceId)throw new Error('tab_habit_browser_instance_id_required');
    return {browserInstanceId,extensionInstanceId:value.extensionInstanceId?String(value.extensionInstanceId):null};
  }
  const browserInstanceId=String(value||fallbackRef||'').trim();
  if(!browserInstanceId)throw new Error('tab_habit_browser_instance_id_required');
  return {browserInstanceId,extensionInstanceId:null};
}

class TabHabitModel {
  constructor(file,{persistenceOptions={},resolveIdentity=null}={}) {
    this.file=file;
    this.resolveIdentity=typeof resolveIdentity==='function'?resolveIdentity:null;
    this.state={
      version:2,
      revision:0,
      updatedAt:null,
      transitionsByBrowser:{},
      lastActiveByBrowser:{},
      legacyUnscopedTransitions:{},
      legacyLastActiveByExtension:{},
      legacyBindings:{}
    };
    this.persistence=new SafeJsonPersistence(this.file,{getValue:()=>this.state,...persistenceOptions});
    this.load();
  }

  _identity(ref){return normalizeIdentity(this.resolveIdentity?this.resolveIdentity(ref):ref,ref);}

  load() {
    if(!fs.existsSync(this.file)) return;
    const p=JSON.parse(fs.readFileSync(this.file,'utf8'));
    if(p?.version===2){
      this.state={...this.state,...p,version:2};
      return;
    }
    if(p?.version===1){
      this.state={
        ...this.state,
        revision:Number(p.revision||0),
        updatedAt:p.updatedAt||null,
        legacyUnscopedTransitions:{...(p.transitions||{})},
        legacyLastActiveByExtension:{...(p.lastActiveByExtension||{})}
      };
      this.save({immediate:true});
    }
  }

  save({immediate=false}={}) {
    this.persistence.schedule();
    return immediate ? this.persistence.flushSync() : this.persistence.status();
  }

  flushSync(){ return this.persistence.flushSync(); }

  bindIdentity(ref){
    const identity=this._identity(ref),browser=identity.browserInstanceId,extension=identity.extensionInstanceId;
    if(!this.state.transitionsByBrowser[browser])this.state.transitionsByBrowser[browser]={};
    if(extension&&this.state.legacyLastActiveByExtension[extension]){
      const bound=this.state.legacyBindings[extension]||null;
      if(bound&&bound!==browser)throw new Error(`tab_habit_legacy_binding_conflict:${extension}`);
      if(!this.state.lastActiveByBrowser[browser])this.state.lastActiveByBrowser[browser]={...this.state.legacyLastActiveByExtension[extension]};
      this.state.legacyBindings[extension]=browser;
      delete this.state.legacyLastActiveByExtension[extension];
      this.state.revision++;
      this.state.updatedAt=new Date().toISOString();
      this.save();
    }
    return identity;
  }

  observe(ref,event) {
    if(event?.source!=='human' || event?.eventType!=='tabActivated') return false;

    const identity=this.bindIdentity(ref);
    const browser=identity.browserInstanceId;
    const nextSite=String(event.siteKey||'__unknown__');
    const prev=this.state.lastActiveByBrowser[browser]||null;
    const transitions=this.state.transitionsByBrowser[browser]||(this.state.transitionsByBrowser[browser]={});

    if(prev?.siteKey) {
      const key=`${prev.siteKey}=>${nextSite}`;
      transitions[key]=(transitions[key]||0)+1;
    }

    this.state.lastActiveByBrowser[browser]={
      tabId:Number(event.tabId),
      siteKey:nextSite,
      ts:Number(event.ts||Date.now())
    };
    this.state.revision++;
    this.state.updatedAt=new Date().toISOString();
    this.save();
    return true;
  }

  stats(ref=null) {
    if(!ref){
      return {
        version:2,
        revision:this.state.revision,
        updatedAt:this.state.updatedAt,
        browserCount:Object.keys(this.state.transitionsByBrowser).length,
        legacyUnscopedTransitionCount:Object.keys(this.state.legacyUnscopedTransitions||{}).length,
        persistence:this.persistence.status()
      };
    }
    const identity=this.bindIdentity(ref),browser=identity.browserInstanceId;
    return {
      version:2,
      browserInstanceId:browser,
      extensionInstanceId:identity.extensionInstanceId,
      revision:this.state.revision,
      updatedAt:this.state.updatedAt,
      transitions:{...(this.state.transitionsByBrowser[browser]||{})},
      lastActive:this.state.lastActiveByBrowser[browser]||null,
      legacyUnscopedTransitionsIgnored:true,
      legacyUnscopedTransitionCount:Object.keys(this.state.legacyUnscopedTransitions||{}).length,
      persistence:this.persistence.status()
    };
  }
}

module.exports={TabHabitModel,normalizeIdentity};
