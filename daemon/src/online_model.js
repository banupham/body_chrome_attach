'use strict';

const fs = require('node:fs');
const {SafeJsonPersistence}=require('./safe_json_persistence');

function distanceBucket(d) {
  if (!Number.isFinite(Number(d))) return 'unknown';
  if (d < 180) return 'near';
  if (d < 450) return 'medium';
  return 'far';
}

function sizeBucket(w,h) {
  if (!Number.isFinite(Number(w)) || !Number.isFinite(Number(h))) return 'unknown';
  const area = Number(w)*Number(h);
  if (area < 900) return 'small';
  if (area < 5000) return 'medium';
  return 'large';
}

function downsample(points, maxPoints=48) {
  if (points.length <= maxPoints) return points;
  const out=[];
  for(let i=0;i<maxPoints;i++) {
    const idx=Math.round(i*(points.length-1)/(maxPoints-1));
    out.push(points[idx]);
  }
  return out;
}

function normalizePath(points, start, end) {
  const dx=end.x-start.x;
  const dy=end.y-start.y;
  const dist=Math.max(1e-6, Math.hypot(dx,dy));
  const ux=dx/dist, uy=dy/dist;
  const nx=-uy, ny=ux;
  const duration=Math.max(1, Number(points.at(-1)?.t||0)-Number(points[0]?.t||0));

  return downsample(points).map(p => {
    const px=Number(p.x)-start.x;
    const py=Number(p.y)-start.y;
    return {
      t:Math.max(0,Math.min(1,(Number(p.t)-Number(points[0]?.t||0))/duration)),
      along:(px*ux+py*uy)/dist,
      lateral:(px*nx+py*ny)/dist
    };
  });
}

function finitePathPoint(p){return Number.isFinite(Number(p?.t))&&Number.isFinite(Number(p?.along))&&Number.isFinite(Number(p?.lateral));}
function usableMouseTemplate(template,{minMovementDurationMs=10,maxNormalizedExcursion=10}={}){
  const duration=Number(template?.movementDurationMs),path=Array.isArray(template?.path)?template.path:[];
  if(!Number.isFinite(duration)||duration<minMovementDurationMs||path.length<2)return false;
  let maxExcursion=0;
  for(const p of path){
    if(!finitePathPoint(p))return false;
    maxExcursion=Math.max(maxExcursion,Math.abs(Number(p.along)),Math.abs(Number(p.lateral)));
  }
  return maxExcursion<=maxNormalizedExcursion;
}

class OnlineBehaviorModel {
  constructor(modelPath, {maxTemplatesPerGroup=240,persistenceOptions={},random=Math.random,mouseCandidatePoolSize=4,minMovementDurationMs=10,maxNormalizedExcursion=10}={}) {
    this.modelPath=modelPath;
    this.maxTemplatesPerGroup=maxTemplatesPerGroup;
    this.random=typeof random==='function'?random:Math.random;
    this.mouseCandidatePoolSize=Math.max(1,Number(mouseCandidatePoolSize)||4);
    this.mouseQuality={minMovementDurationMs:Math.max(1,Number(minMovementDurationMs)||10),maxNormalizedExcursion:Math.max(1,Number(maxNormalizedExcursion)||10)};
    this.model={version:1,revision:0,updatedAt:null,groups:{}};
    this.persistence=new SafeJsonPersistence(this.modelPath,{getValue:()=>this.model,...persistenceOptions});
    this.load();
  }

  load() {
    if (!fs.existsSync(this.modelPath)) return;
    const parsed=JSON.parse(fs.readFileSync(this.modelPath,'utf8'));
    if (parsed?.version===1 && parsed?.groups) this.model=parsed;
  }

  save({immediate=false}={}) {
    this.persistence.schedule();
    return immediate ? this.persistence.flushSync() : this.persistence.status();
  }

  flushSync() { return this.persistence.flushSync(); }

  clear() {
    this.model={version:1,revision:0,updatedAt:null,groups:{}};
    this.save({immediate:true});
  }

  _push(groupKey, template) {
    const arr=this.model.groups[groupKey] || (this.model.groups[groupKey]=[]);
    arr.push(template);
    while(arr.length>this.maxTemplatesPerGroup) arr.shift();
    this.model.revision++;
    this.model.updatedAt=new Date().toISOString();
  }

  observe(sample) {
    if (sample?.source !== 'human') return false;

    let item=null;
    if (['click','drag','movePointer'].includes(sample.action)) item=this._mouseTemplate(sample);
    else if (sample.action==='typeText') item=this._typingTemplate(sample);
    else if (['scrollVertical','scrollHorizontal'].includes(sample.action)) item=this._scrollTemplate(sample);

    if (!item) return false;
    this._push(item.groupKey,item.template);
    this.save();
    return true;
  }

  _mouseTemplate(sample) {
    const points=sample.points || [];
    if(points.length<2) return null;

    const start={x:Number(sample.pointer_start?.x ?? points[0].x),y:Number(sample.pointer_start?.y ?? points[0].y)};
    const actualEnd={x:Number(points.at(-1).x),y:Number(points.at(-1).y)};
    if(![start.x,start.y,actualEnd.x,actualEnd.y].every(Number.isFinite))return null;

    const target=sample.context?.target_rect || {};
    const role=String(sample.context?.target_role || 'unknown').toLowerCase();
    const w=Math.max(1,Number(target.width||12));
    const h=Math.max(1,Number(target.height||12));
    const cx=Number(target.x||actualEnd.x-w/2)+w/2;
    const cy=Number(target.y||actualEnd.y-h/2)+h/2;
    const distance=Math.hypot(cx-start.x,cy-start.y);

    const duration=Math.max(1,Number(points.at(-1).t)-Number(points[0].t));
    const groupKey=`mouse|${sample.action}|${role}|${distanceBucket(distance)}|${sizeBucket(w,h)}`;

    return {
      groupKey,
      template:{
        source:'human',
        learnedAt:new Date().toISOString(),
        movementDurationMs:duration,
        holdMs:Number(sample.hold_ms || Math.max(0,Number(sample.mouse_up_t||0)-Number(sample.mouse_down_t||0)) || 55),
        endOffsetXRatio:(actualEnd.x-cx)/w,
        endOffsetYRatio:(actualEnd.y-cy)/h,
        path:normalizePath(points,start,actualEnd)
      }
    };
  }

  _typingTemplate(sample) {
    const events=sample.key_events || [];
    const downs=events.filter(x=>x.type==='keydown');
    if(downs.length<2) return null;

    const intervals=[];
    for(let i=1;i<downs.length;i++) intervals.push(Math.max(5,Number(downs[i].t)-Number(downs[i-1].t)));

    const holds=[];
    const open=[];
    for(const e of events) {
      if(e.type==='keydown') open.push({t:Number(e.t), keyClass:e.keyClass});
      else if(e.type==='keyup') {
        const idx=open.findIndex(x=>x.keyClass===e.keyClass);
        if(idx>=0) {
          holds.push(Math.max(5,Number(e.t)-open[idx].t));
          open.splice(idx,1);
        }
      }
    }

    return {groupKey:'typing|typeText',template:{source:'human',learnedAt:new Date().toISOString(),intervals:intervals.length?intervals:[80],holds:holds.length?holds:[45]}};
  }

  _scrollTemplate(sample) {
    const events=sample.wheel_events || [];
    if(!events.length) return null;

    const horizontal=sample.action==='scrollHorizontal';
    const total=horizontal?Number(sample.deltaX||0):Number(sample.deltaY||0);
    if(Math.abs(total)<1) return null;

    const ratios=events.map(e => {
      const d=horizontal?Number(e.deltaX||0):Number(e.deltaY||0);
      return d/total;
    });

    const gaps=[];
    for(let i=1;i<events.length;i++) gaps.push(Math.max(5,Number(events[i].t)-Number(events[i-1].t)));

    return {groupKey:`scroll|${sample.action}|${Math.abs(total)<=600?'small':'large'}`,template:{source:'human',learnedAt:new Date().toISOString(),ratios,gaps:gaps.length?gaps:[55]}};
  }

  _randomIndex(length){
    const raw=Number(this.random());
    const unit=Number.isFinite(raw)?Math.max(0,Math.min(0.999999999999,raw)):0;
    return Math.floor(unit*Math.max(1,length));
  }

  _choose(keys,{targetPoolSize=1,accept=()=>true}={}) {
    const pool=[],seen=new Set();
    for(const key of keys) {
      if(seen.has(key))continue;seen.add(key);
      const arr=this.model.groups[key];
      if(!arr?.length)continue;
      for(let index=0;index<arr.length;index++)if(accept(arr[index]))pool.push({groupKey:key,template:arr[index],groupIndex:index,groupCount:arr.length});
      if(pool.length>=targetPoolSize)break;
    }
    if(!pool.length)return null;
    const index=this._randomIndex(pool.length),chosen=pool[index];
    return {...chosen,count:pool.length,index,selection:'empirical-random'};
  }

  sampleMouse({action='click',role='unknown',distance,targetWidth=12,targetHeight=12}) {
    const d=distanceBucket(distance);
    const s=sizeBucket(targetWidth,targetHeight);
    const roleNorm=String(role||'unknown').toLowerCase();
    const keys=[];
    const addAction=mouseAction=>{
      keys.push(`mouse|${mouseAction}|${roleNorm}|${d}|${s}`);
      keys.push(`mouse|${mouseAction}|unknown|${d}|${s}`);
      keys.push(...Object.keys(this.model.groups).filter(k=>k.startsWith(`mouse|${mouseAction}|`)).sort());
    };
    addAction(action);
    if(['moveTo','hover'].includes(action)){addAction('movePointer');addAction('click');addAction('drag');}
    return this._choose(keys,{targetPoolSize:this.mouseCandidatePoolSize,accept:t=>usableMouseTemplate(t,this.mouseQuality)});
  }

  sampleTyping() { return this._choose(['typing|typeText']); }

  sampleScroll(action,amount) {
    const key=`scroll|${action}|${Math.abs(Number(amount||0))<=600?'small':'large'}`;
    const same=Object.keys(this.model.groups).filter(k=>k.startsWith(`scroll|${action}|`)).sort();
    return this._choose([key,...same]);
  }

  rebuild(samples) {
    this.model={version:1,revision:0,updatedAt:null,groups:{}};
    for(const sample of samples) {
      if(sample?.source==='human') {
        let item=null;
        if(['click','drag','movePointer'].includes(sample.action)) item=this._mouseTemplate(sample);
        else if(sample.action==='typeText') item=this._typingTemplate(sample);
        else if(['scrollVertical','scrollHorizontal'].includes(sample.action)) item=this._scrollTemplate(sample);
        if(item) this._push(item.groupKey,item.template);
      }
    }
    this.save({immediate:true});
  }

  stats() {
    const groups={};
    let total=0,usableMouseTemplates=0,rejectedMouseTemplates=0;
    for(const [k,v] of Object.entries(this.model.groups)) {
      groups[k]=v.length;total+=v.length;
      if(k.startsWith('mouse|'))for(const template of v)(usableMouseTemplate(template,this.mouseQuality)?usableMouseTemplates++:rejectedMouseTemplates++);
    }
    return {revision:this.model.revision,updatedAt:this.model.updatedAt,totalTemplates:total,groups,selection:'empirical-random',mouseCandidatePoolSize:this.mouseCandidatePoolSize,usableMouseTemplates,rejectedMouseTemplates,persistence:this.persistence.status()};
  }
}

module.exports={OnlineBehaviorModel,normalizePath,distanceBucket,sizeBucket,usableMouseTemplate};
