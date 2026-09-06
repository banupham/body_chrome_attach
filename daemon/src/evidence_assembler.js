'use strict';

function clone(value){return JSON.parse(JSON.stringify(value));}
function pendingKey(identity,tabId){return `${String(identity?.browserInstanceId||'')}/${Number(tabId)}`;}

function isYoutubeSearchTrigger(event){
  const before=event?.semanticBefore;
  return event?.source==='human' && event?.isTrusted===true && event?.eventType==='keydown' && event?.key==='Enter' &&
    before?.available===true && before?.platform==='youtube' && before?.controls?.searchInput?.active===true;
}

function sanitizeObservation(observation){
  if(!observation||observation.available!==true)return {available:false};
  return {
    available:true,
    platform:observation.platform||null,
    observerVersion:Number(observation.observerVersion||0),
    observedAt:Number(observation.observedAt||0),
    privacy:{...(observation.privacy||{})},
    route:{...(observation.route||{})},
    controls:{
      searchInput:{...(observation.controls?.searchInput||{})},
      searchButton:{...(observation.controls?.searchButton||{})}
    },
    surfaces:Array.isArray(observation.surfaces)?observation.surfaces.map(row=>({...row})):[],
    viewport:{...(observation.viewport||{})}
  };
}

function observedEffect(before,after){
  const beforeType=before?.route?.pageType||null,afterType=after?.route?.pageType||null;
  const searchSurface=(after?.surfaces||[]).find(row=>row.surface==='search_results')||null;
  const searchResultCount=Number(searchSurface?.itemCount||0);
  return {
    navigationObserved:Boolean(beforeType&&afterType&&(beforeType!==afterType||afterType==='search')),
    pageTypeChanged:Boolean(beforeType&&afterType&&beforeType!==afterType),
    fromPageType:beforeType,
    toPageType:afterType,
    searchResultsObserved:afterType==='search'&&searchSurface!==null,
    searchResultCount
  };
}

class EvidenceAssembler{
  constructor(store,{now=()=>Date.now(),ttlMs=10000}={}){
    if(!store)throw new Error('evidence_assembler_store_required');
    this.store=store;
    this.now=now;
    this.ttlMs=Math.max(1000,Number(ttlMs)||10000);
    this.pending=new Map();
    this.completed=0;
    this.expired=0;
  }

  _prune(){
    const now=this.now();
    for(const [key,row] of this.pending){if(now-row.createdAt>this.ttlMs){this.pending.delete(key);this.expired++;}}
  }

  observeRecorder(identity,siteKey,tabId,event){
    this._prune();
    if(!isYoutubeSearchTrigger(event))return null;
    const key=pendingKey(identity,tabId);
    const before=sanitizeObservation(event.semanticBefore);
    const row={
      createdAt:this.now(),
      identity:clone(identity),
      siteKey:String(siteKey||'__unknown__'),
      tabId:Number(tabId),
      triggerTs:Number(event.ts||this.now()),
      before
    };
    this.pending.set(key,row);
    return {accepted:true,key,action:'youtube.search'};
  }

  observeAfter(identity,siteKey,tabId,observation){
    this._prune();
    const key=pendingKey(identity,tabId),pending=this.pending.get(key);
    if(!pending)return null;
    const after=sanitizeObservation(observation);
    if(after.available!==true||after.platform!=='youtube'||after.route?.pageType!=='search')return null;
    this.pending.delete(key);
    const effect=observedEffect(pending.before,after);
    const record=this.store.append({
      identity:pending.identity,
      siteKey:pending.siteKey||siteKey,
      tabId:pending.tabId,
      source:'human',
      provenance:{kind:'human_demonstration',trustedInput:true,triggerEventTs:pending.triggerTs,semanticObserver:'youtube-v1'},
      beforeState:pending.before,
      action:{type:'youtube.search',trigger:'keyboard_enter',queryCaptured:false},
      afterState:after,
      observedEffect:effect
    });
    this.completed++;
    return record;
  }

  clearBrowser(browserInstanceId){
    const prefix=`${String(browserInstanceId||'')}/`;let cleared=0;
    for(const key of [...this.pending.keys()])if(key.startsWith(prefix)){this.pending.delete(key);cleared++;}
    return cleared;
  }

  status(){this._prune();return {pending:this.pending.size,completed:this.completed,expired:this.expired,ttlMs:this.ttlMs};}
}

module.exports={EvidenceAssembler,isYoutubeSearchTrigger,sanitizeObservation,observedEffect,pendingKey};
