'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {atomicWrite}=require('./experience_memory');

const MODE={AUTO:'auto',DIVERSITY:'diversity',SURFACE_TEST:'surface_test'};
const SURFACE={AUTO:'auto',HOME:'home_feed',SEARCH:'search_results',RELATED:'related',MIX:'mix_queue'};
const SURFACES=[SURFACE.HOME,SURFACE.SEARCH,SURFACE.RELATED,SURFACE.MIX];
function clean(value){return String(value??'').trim().toLowerCase();}
function normalizeMode(value){const raw=clean(value).replace(/-/g,'_');return Object.values(MODE).includes(raw)?raw:MODE.AUTO;}
function normalizeSurface(value){const raw=clean(value).replace(/-/g,'_');if(!raw||raw==='auto')return SURFACE.AUTO;if(['home','home_feed'].includes(raw))return SURFACE.HOME;if(['search','search_results'].includes(raw))return SURFACE.SEARCH;if(['related','next','next_video'].includes(raw))return SURFACE.RELATED;if(['mix','mix_queue'].includes(raw))return SURFACE.MIX;return SURFACE.AUTO;}
function targetKey(videoId){return crypto.createHash('sha256').update(String(videoId||''),'utf8').digest('hex').slice(0,20);}
function fresh(){return {schemaVersion:1,updatedAt:null,targets:{}};}
function load(file){try{const row=JSON.parse(fs.readFileSync(file,'utf8'));return Number(row?.schemaVersion)===1&&row.targets?row:fresh();}catch{return fresh();}}
function surfaceRow(target,surface){target.surfaces=target.surfaces||{};return target.surfaces[surface]||(target.surfaces[surface]={attempts:0,discoveries:0,lastAttemptAt:null,lastDiscoveryAt:null});}
function chooseLeastUsed(target){const rows=SURFACES.map(surface=>({surface,...surfaceRow(target,surface)}));rows.sort((a,b)=>a.discoveries-b.discoveries||a.attempts-b.attempts||String(a.lastAttemptAt||'').localeCompare(String(b.lastAttemptAt||'')));const best=rows.filter(row=>row.discoveries===rows[0].discoveries&&row.attempts===rows[0].attempts);return best[Math.floor(Math.random()*best.length)]?.surface||SURFACE.SEARCH;}
class SurfacePolicyStore{
  constructor(root){this.file=path.join(root,'surface-outcomes.json');this.state=load(this.file);}
  save(){this.state.updatedAt=new Date().toISOString();atomicWrite(this.file,this.state);}
  beginRun({targetVideoId,mode=MODE.AUTO,requestedSurface=SURFACE.AUTO}={}){
    const normalizedMode=normalizeMode(mode),requested=normalizeSurface(requestedSurface),key=targetKey(targetVideoId),target=this.state.targets[key]||(this.state.targets[key]={targetKey:key,totalAttempts:0,totalDiscoveries:0,surfaces:{}});let preferred=requested;
    if(normalizedMode===MODE.AUTO)preferred=SURFACE.AUTO;else if(preferred===SURFACE.AUTO)preferred=chooseLeastUsed(target);
    target.totalAttempts++;if(preferred!==SURFACE.AUTO){const row=surfaceRow(target,preferred);row.attempts++;row.lastAttemptAt=new Date().toISOString();}this.save();
    return {mode:normalizedMode,requestedSurface:requested,preferredSurface:preferred,targetKey:key,fallbackAfterSteps:25,fallbackActive:false,storeFile:this.file,prior:{totalAttempts:Math.max(0,target.totalAttempts-1),totalDiscoveries:target.totalDiscoveries||0,surfaces:JSON.parse(JSON.stringify(target.surfaces||{}))}};
  }
  recordDiscovery(policy,surface){if(!policy?.targetKey)return null;const target=this.state.targets[policy.targetKey]||(this.state.targets[policy.targetKey]={targetKey:policy.targetKey,totalAttempts:0,totalDiscoveries:0,surfaces:{}}),normalized=normalizeSurface(surface);target.totalDiscoveries++;if(normalized!==SURFACE.AUTO){const row=surfaceRow(target,normalized);row.discoveries++;row.lastDiscoveryAt=new Date().toISOString();}this.save();return {targetKey:policy.targetKey,surface:normalized,totalDiscoveries:target.totalDiscoveries};}
  summary(policy){const target=policy?.targetKey?this.state.targets[policy.targetKey]:null;return target?JSON.parse(JSON.stringify(target)):null;}
}
module.exports={MODE,SURFACE,SURFACES,normalizeMode,normalizeSurface,targetKey,SurfacePolicyStore};
