'use strict';

const fs = require('node:fs');
const {SafeJsonPersistence}=require('./safe_json_persistence');

function modalityOf(sample) {
  const a=String(sample?.action||'');
  if(['click','doubleClick','drag','hover','moveTo','focus'].includes(a)) return 'mouse';
  if(['typeText','type','pressKey','keyCombo'].includes(a)) return 'keyboard';
  if(['scrollVertical','scrollHorizontal','scroll'].includes(a)) return 'scroll';
  return 'other';
}

function targetRole(sample) {
  return String(sample?.context?.target_role || sample?.context?.targetRole || 'unknown').toLowerCase();
}

function nowIso(){ return new Date().toISOString(); }

class HabitModel {
  constructor(modelPath,{persistenceOptions={}}={}) {
    this.modelPath=modelPath;
    this.state={
      version:1,
      revision:0,
      updatedAt:null,
      transitions:{},
      habits:{},
      lastHumanByTab:{}
    };
    this.persistence=new SafeJsonPersistence(this.modelPath,{getValue:()=>this.state,...persistenceOptions});
    this.load();
  }

  load() {
    if(!fs.existsSync(this.modelPath)) return;
    const p=JSON.parse(fs.readFileSync(this.modelPath,'utf8'));
    if(p?.version===1) this.state={...this.state,...p};
  }

  save({immediate=false}={}) {
    this.persistence.schedule();
    return immediate ? this.persistence.flushSync() : this.persistence.status();
  }

  flushSync(){ return this.persistence.flushSync(); }

  _inc(obj,key,by=1) {
    obj[key]=(obj[key]||0)+by;
  }

  _observeNamedHabits(prev,current) {
    if(!prev || !current) return;

    if(prev.action==='typeText') {
      if(current.action==='pressKey' && String(current.key)==='Tab') {
        this._habit('after_typing_next_focus','keyboard_tab');
      } else if(current.action==='click' && current.context?.target_editable===true) {
        this._habit('after_typing_next_focus','mouse_click');
      }

      if(current.action==='pressKey' && String(current.key)==='Enter') {
        this._habit('after_typing_submit','keyboard_enter');
      } else if(current.action==='click' && ['button','submit'].includes(targetRole(current))) {
        this._habit('after_typing_submit','mouse_click');
      }

      if(current.action==='pressKey' && String(current.key)==='Escape') {
        this._habit('after_typing_dismiss','keyboard_escape');
      }
    }

    const key=`after:${prev.action}|prevModality:${modalityOf(prev)}|targetRole:${targetRole(current)}`;
    if(!this.state.transitions[key]) this.state.transitions[key]={total:0,modalities:{},actions:{}};
    const t=this.state.transitions[key];
    t.total++;
    this._inc(t.modalities,modalityOf(current));
    this._inc(t.actions,current.action);
  }

  _habit(key,strategyId) {
    if(!this.state.habits[key]) this.state.habits[key]={total:0,strategies:{}};
    const h=this.state.habits[key];
    h.total++;
    this._inc(h.strategies,strategyId);
  }

  observe(sample) {
    if(sample?.source!=='human') return false;

    const tabId=String(sample.tabId ?? 'unknown');
    const prev=this.state.lastHumanByTab[tabId] || null;

    this._observeNamedHabits(prev,sample);

    this.state.lastHumanByTab[tabId]={
      action:sample.action,
      key:sample.key||null,
      context:sample.context||{},
      source:'human',
      ts:Date.now()
    };

    this.state.revision++;
    this.state.updatedAt=nowIso();
    this.save();
    return true;
  }

  recordExplicit(habitKey,strategyId) {
    this._habit(String(habitKey),String(strategyId));
    this.state.revision++;
    this.state.updatedAt=nowIso();
    this.save();
  }

  scoreAlternatives({habitKey,alternatives=[],context={}}) {
    const h=this.state.habits[String(habitKey)] || {total:0,strategies:{}};
    const prevAction=String(context.previousAction||'unknown');
    const prevModality=String(context.previousModality||'unknown');
    const role=String(context.targetRole||'unknown').toLowerCase();
    const transitionKey=`after:${prevAction}|prevModality:${prevModality}|targetRole:${role}`;
    const tr=this.state.transitions[transitionKey] || null;

    const scored=alternatives.map((alt,index)=>{
      const id=String(alt.id||`strategy_${index}`);
      const modality=String(alt.modality||'other');
      const habitCount=Number(h.strategies[id]||0);
      const modalityCount=Number(tr?.modalities?.[modality]||0);
      const actionCount=(alt.actions||[]).reduce((sum,a)=>sum+Number(tr?.actions?.[a.type]||0),0);

      const habitProb=(habitCount+1)/(Number(h.total||0)+Math.max(1,alternatives.length));
      const modalityProb=tr ? (modalityCount+1)/(Number(tr.total||0)+4) : 0.25;
      const actionProb=tr ? (actionCount+1)/(Number(tr.total||0)+Math.max(1,Object.keys(tr.actions||{}).length)) : 0.25;
      const score=habitProb*0.62 + modalityProb*0.23 + actionProb*0.15;

      return {
        id,
        modality,
        score,
        habitCount,
        transitionModalityCount:modalityCount,
        transitionActionCount:actionCount,
        index,
        alternative:alt
      };
    });

    scored.sort((a,b)=>{
      if(b.score!==a.score) return b.score-a.score;
      if(b.habitCount!==a.habitCount) return b.habitCount-a.habitCount;
      return String(a.id).localeCompare(String(b.id),'en');
    });

    return {
      habitKey:String(habitKey),
      totalHabitObservations:Number(h.total||0),
      transitionKey,
      selected:scored[0]||null,
      ranking:scored
    };
  }

  stats() {
    return {
      revision:this.state.revision,
      updatedAt:this.state.updatedAt,
      habitCount:Object.keys(this.state.habits).length,
      transitionCount:Object.keys(this.state.transitions).length,
      habits:this.state.habits,
      persistence:this.persistence.status()
    };
  }
}

module.exports={HabitModel,modalityOf,targetRole};
