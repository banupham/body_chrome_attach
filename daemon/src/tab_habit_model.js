'use strict';

const fs=require('node:fs');
const {SafeJsonPersistence}=require('./safe_json_persistence');

class TabHabitModel {
  constructor(file,{persistenceOptions={}}={}) {
    this.file=file;
    this.state={
      version:1,
      revision:0,
      updatedAt:null,
      transitions:{},
      lastActiveByExtension:{}
    };
    this.persistence=new SafeJsonPersistence(this.file,{getValue:()=>this.state,...persistenceOptions});
    this.load();
  }

  load() {
    if(!fs.existsSync(this.file)) return;
    const p=JSON.parse(fs.readFileSync(this.file,'utf8'));
    if(p?.version===1) this.state={...this.state,...p};
  }

  save({immediate=false}={}) {
    this.persistence.schedule();
    return immediate ? this.persistence.flushSync() : this.persistence.status();
  }

  flushSync(){ return this.persistence.flushSync(); }

  observe(extensionId,event) {
    if(event?.source!=='human' || event?.eventType!=='tabActivated') return false;

    const ext=String(extensionId);
    const nextSite=String(event.siteKey||'__unknown__');
    const prev=this.state.lastActiveByExtension[ext]||null;

    if(prev?.siteKey) {
      const key=`${prev.siteKey}=>${nextSite}`;
      this.state.transitions[key]=(this.state.transitions[key]||0)+1;
    }

    this.state.lastActiveByExtension[ext]={
      tabId:Number(event.tabId),
      siteKey:nextSite,
      ts:Number(event.ts||Date.now())
    };
    this.state.revision++;
    this.state.updatedAt=new Date().toISOString();
    this.save();
    return true;
  }

  stats(extensionId=null) {
    const last=extensionId ? this.state.lastActiveByExtension[String(extensionId)]||null : null;
    return {
      revision:this.state.revision,
      updatedAt:this.state.updatedAt,
      transitions:this.state.transitions,
      lastActive:last,
      persistence:this.persistence.status()
    };
  }
}

module.exports={TabHabitModel};
