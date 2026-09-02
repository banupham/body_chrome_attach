
'use strict';

const fs = require('node:fs');
const path = require('node:path');

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

class OnlineBehaviorModel {
  constructor(modelPath, {maxTemplatesPerGroup=240}={}) {
    this.modelPath=modelPath;
    this.maxTemplatesPerGroup=maxTemplatesPerGroup;
    this.model={version:1,revision:0,updatedAt:null,groups:{}};
    this.selectionCursor={};
    this.load();
  }

  load() {
    if (!fs.existsSync(this.modelPath)) return;
    const parsed=JSON.parse(fs.readFileSync(this.modelPath,'utf8'));
    if (parsed?.version===1 && parsed?.groups) this.model=parsed;
  }

  save() {
    fs.mkdirSync(path.dirname(this.modelPath),{recursive:true});
    const tmp=this.modelPath+'.tmp';
    fs.writeFileSync(tmp,JSON.stringify(this.model,null,2),'utf8');
    fs.renameSync(tmp,this.modelPath);
  }

  clear() {
    this.model={version:1,revision:0,updatedAt:null,groups:{}};
    this.save();
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
    if (['click','drag'].includes(sample.action)) item=this._mouseTemplate(sample);
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

  _choose(keys) {
    for(const key of keys) {
      const arr=this.model.groups[key];
      if(arr?.length) {
        const cursor=Number(this.selectionCursor[key]||0);
        const index=Math.abs(cursor)%arr.length;
        this.selectionCursor[key]=cursor+1;
        return {groupKey:key,template:arr[index],count:arr.length,index,selection:'deterministic-cycle'};
      }
    }
    return null;
  }

  sampleMouse({action='click',role='unknown',distance,targetWidth=12,targetHeight=12}) {
    const d=distanceBucket(distance);
    const s=sizeBucket(targetWidth,targetHeight);
    const roleNorm=String(role||'unknown').toLowerCase();
    const exact=`mouse|${action}|${roleNorm}|${d}|${s}`;
    const unknownRole=`mouse|${action}|unknown|${d}|${s}`;
    const sameAction=Object.keys(this.model.groups).filter(k=>k.startsWith(`mouse|${action}|`)).sort();
    return this._choose([exact,unknownRole,...sameAction]);
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
        if(['click','drag'].includes(sample.action)) item=this._mouseTemplate(sample);
        else if(sample.action==='typeText') item=this._typingTemplate(sample);
        else if(['scrollVertical','scrollHorizontal'].includes(sample.action)) item=this._scrollTemplate(sample);
        if(item) this._push(item.groupKey,item.template);
      }
    }
    this.save();
  }

  stats() {
    const groups={};
    let total=0;
    for(const [k,v] of Object.entries(this.model.groups)) { groups[k]=v.length; total+=v.length; }
    return {revision:this.model.revision,updatedAt:this.model.updatedAt,totalTemplates:total,groups};
  }
}

module.exports={OnlineBehaviorModel,normalizePath,distanceBucket,sizeBucket};
