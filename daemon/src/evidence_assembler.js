'use strict';

function clone(value){return JSON.parse(JSON.stringify(value));}
function pendingKey(identity,tabId){return `${String(identity?.browserInstanceId||'')}/${Number(tabId)}`;}
function finite(value,fallback=0){const number=Number(value);return Number.isFinite(number)?number:fallback;}
function safeRect(rect){if(!rect)return null;const value={x:finite(rect.x),y:finite(rect.y),width:finite(rect.width),height:finite(rect.height)};return value.width>0&&value.height>0?value:null;}
function safeControl(control,name){return {name,available:control?.available===true,visible:control?.visible===true,active:control?.active===true,tag:['input','button'].includes(String(control?.tag||''))?String(control.tag):null,actionRect:safeRect(control?.actionRect)};}

function privacySafe(observation){
  return observation?.privacy?.searchQueryCaptured!==true && observation?.privacy?.accountIdentityCaptured!==true && observation?.privacy?.textContentCaptured!==true;
}

function isYoutubeSearchTrigger(event){
  const before=event?.semanticBefore;
  return event?.source==='human' && event?.isTrusted===true && event?.eventType==='keydown' && event?.key==='Enter' && privacySafe(before) &&
    before?.available===true && before?.platform==='youtube' && before?.controls?.searchInput?.active===true;
}

function sanitizeObservation(observation){
  if(!observation||observation.available!==true)return {available:false,reason:'semantic_observation_unavailable'};
  if(observation.platform!=='youtube')return {available:false,reason:'semantic_platform_unsupported'};
  if(!privacySafe(observation))return {available:false,reason:'semantic_privacy_policy_violation'};
  const route=observation.route||{};
  const surfaces=Array.isArray(observation.surfaces)?observation.surfaces.filter(row=>row?.surface==='search_results').map(row=>({surface:'search_results',itemCount:Math.max(0,Math.min(100,Math.trunc(finite(row.itemCount))))})):[];
  return {
    available:true,
    platform:'youtube',
    observerVersion:Math.max(0,Math.trunc(finite(observation.observerVersion))),
    observedAt:Math.max(0,Math.trunc(finite(observation.observedAt))),
    privacy:{searchQueryCaptured:false,accountIdentityCaptured:false,textContentCaptured:false},
    route:{
      supported:route.supported===true,
      pageType:['home','search','watch','shorts','playlist','feed','channel','other'].includes(String(route.pageType||''))?String(route.pageType):'other',
      path:String(route.path||'/').slice(0,200),
      videoId:route.videoId?String(route.videoId).slice(0,64):null,
      listId:route.listId?String(route.listId).slice(0,128):null,
      searchQueryPresent:route.searchQueryPresent===true
    },
    controls:{searchInput:safeControl(observation.controls?.searchInput,'search_input'),searchButton:safeControl(observation.controls?.searchButton,'search_button')},
    surfaces,
    viewport:{width:Math.max(0,finite(observation.viewport?.width)),height:Math.max(0,finite(observation.viewport?.height))}
  };
}

function searchResultCount(state){const surface=(state?.surfaces||[]).find(row=>row.surface==='search_results');return surface?Number(surface.itemCount||0):null;}
function observedEffect(before,after){
  const beforeType=before?.route?.pageType||null,afterType=after?.route?.pageType||null;
  const beforeCount=searchResultCount(before),afterCount=searchResultCount(after);
  const pageTypeChanged=Boolean(beforeType&&afterType&&beforeType!==afterType);
  const searchSurfaceAppeared=beforeCount===null&&afterCount!==null;
  const searchResultCountChanged=beforeCount!==null&&afterCount!==null&&beforeCount!==afterCount;
  return {
    navigationObserved:pageTypeChanged||searchSurfaceAppeared||searchResultCountChanged,
    pageTypeChanged,
    fromPageType:beforeType,
    toPageType:afterType,
    searchResultsObserved:afterType==='search'&&afterCount!==null,
    searchResultCount:afterCount===null?0:afterCount,
    searchResultCountChanged
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

  _prune(){const now=this.now();for(const [key,row] of this.pending){if(now-row.createdAt>this.ttlMs){this.pending.delete(key);this.expired++;}}}

  observeRecorder(identity,siteKey,tabId,event){
    this._prune();
    if(!isYoutubeSearchTrigger(event))return null;
    const before=sanitizeObservation(event.semanticBefore);
    if(before.available!==true)return null;
    const key=pendingKey(identity,tabId);
    const row={createdAt:this.now(),identity:clone(identity),siteKey:String(siteKey||'__unknown__'),tabId:Number(tabId),triggerTs:Number(event.ts||this.now()),before};
    this.pending.set(key,row);
    return {accepted:true,key,action:'youtube.search'};
  }

  observeAfter(identity,siteKey,tabId,observation){
    this._prune();
    const key=pendingKey(identity,tabId),pending=this.pending.get(key);
    if(!pending)return null;
    const after=sanitizeObservation(observation);
    if(after.available!==true||after.route?.pageType!=='search')return null;
    if(after.observedAt&&pending.before.observedAt&&after.observedAt<pending.before.observedAt)return null;
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

  clearTab(identity,tabId){return this.pending.delete(pendingKey(identity,tabId));}
  clearBrowser(browserInstanceId){const prefix=`${String(browserInstanceId||'')}/`;let cleared=0;for(const key of [...this.pending.keys()])if(key.startsWith(prefix)){this.pending.delete(key);cleared++;}return cleared;}
  status(){this._prune();return {pending:this.pending.size,completed:this.completed,expired:this.expired,ttlMs:this.ttlMs};}
}

module.exports={EvidenceAssembler,isYoutubeSearchTrigger,sanitizeObservation,observedEffect,pendingKey,privacySafe};
