'use strict';

const POINTER_EVENT_TYPES=new Set(['mousemove','mousedown','mouseup','wheel']);
const CDP_POINTER_TYPES=new Set(['mouseMoved','mousePressed','mouseReleased','mouseWheel']);

function present(value){return value!==null&&value!==undefined&&!(typeof value==='string'&&value.trim()==='');}
function finiteNumber(value){return present(value)&&Number.isFinite(Number(value));}
function browserIdOf(ref){
  const value=typeof ref==='string'?ref:ref?.browserInstanceId;
  const id=String(value||'').trim();
  if(!id)throw new Error('pointer_browser_id_required');
  return id;
}
function tabIdOf(value){if(!present(value))throw new Error('pointer_tab_id_required');const id=Number(value);if(!Number.isInteger(id))throw new Error('pointer_tab_id_required');return id;}
function pointOf(value){if(!finiteNumber(value?.x)||!finiteNumber(value?.y))throw new Error('pointer_coordinates_required');return {x:Number(value.x),y:Number(value.y)};}

class PointerStateManager{
  constructor({now=Date.now}={}){this.now=now;this.states=new Map();this.sequence=0;}
  key(ref,tabId){return `${browserIdOf(ref)}/${tabIdOf(tabId)}`;}
  update(ref,tabId,point,{source='unknown',eventType=null,at=null}={}){
    const browserInstanceId=browserIdOf(ref),id=tabIdOf(tabId),p=pointOf(point),updatedAt=finiteNumber(at)?Number(at):Number(this.now());
    this.sequence+=1;
    const state={browserInstanceId,tabId:id,known:true,x:p.x,y:p.y,source:String(source||'unknown').toLowerCase(),eventType:eventType?String(eventType):null,updatedAt,sequence:this.sequence};
    this.states.set(this.key(browserInstanceId,id),state);
    return {...state};
  }
  observeRecorder(ref,tabId,event){
    if(!event||!POINTER_EVENT_TYPES.has(String(event.eventType||'')))return null;
    if(!finiteNumber(event.x)||!finiteNumber(event.y))return null;
    return this.update(ref,tabId,event,{source:event.source||'unknown',eventType:event.eventType,at:event.ts});
  }
  applyPlan(ref,tabId,plan,{source='agent',at=null}={}){
    let last=null;
    for(const step of plan?.steps||[]){
      if(step?.method!=='Input.dispatchMouseEvent')continue;
      const type=String(step?.params?.type||'');if(!CDP_POINTER_TYPES.has(type))continue;
      if(!finiteNumber(step.params?.x)||!finiteNumber(step.params?.y))continue;
      last={x:Number(step.params.x),y:Number(step.params.y),eventType:type};
    }
    return last?this.update(ref,tabId,last,{source,eventType:last.eventType,at}):this.get(ref,tabId);
  }
  get(ref,tabId){const state=this.states.get(this.key(ref,tabId));return state?{...state}:null;}
  snapshot(ref,tabId){const browserInstanceId=browserIdOf(ref),id=tabIdOf(tabId),state=this.get(browserInstanceId,id);return state||{browserInstanceId,tabId:id,known:false,x:null,y:null,source:null,eventType:null,updatedAt:null,sequence:null};}
  require(ref,tabId){const state=this.get(ref,tabId);if(!state){const error=new Error('pointer_state_required');error.code='pointer_state_required';throw error;}return state;}
  clearTab(ref,tabId){return this.states.delete(this.key(ref,tabId));}
  clearBrowser(ref){const prefix=`${browserIdOf(ref)}/`;let removed=0;for(const key of [...this.states.keys()])if(key.startsWith(prefix)){this.states.delete(key);removed++;}return removed;}
  stats(){return {trackedTabs:this.states.size,sequence:this.sequence};}
}

module.exports={PointerStateManager,POINTER_EVENT_TYPES,CDP_POINTER_TYPES};
