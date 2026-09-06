'use strict';

function mean(values){return values.length?values.reduce((a,b)=>a+b,0)/values.length:0;}
function stddev(values){if(values.length<2)return 0;const m=mean(values);return Math.sqrt(values.reduce((a,b)=>a+((b-m)**2),0)/values.length);}
function cadence(events){const times=events.map(e=>Number(e.ts)).filter(Number.isFinite).sort((a,b)=>a-b),gaps=[];for(let i=1;i<times.length;i++){const d=times[i]-times[i-1];if(d>0)gaps.push(d);}if(gaps.length<3)return null;const m=mean(gaps),sd=stddev(gaps);return {count:gaps.length+1,meanMs:m,cv:m>0?sd/m:1};}
function samePoint(a,b,tolerance=1){return Number.isFinite(Number(a?.x))&&Number.isFinite(Number(b?.x))&&Math.hypot(Number(a.x)-Number(b.x),Number(a.y)-Number(b.y))<=tolerance;}

class BehaviorGuardian{
  constructor({windowMs=15000,maxEvents=600,now=()=>Date.now()}={}){this.windowMs=Math.max(5000,Math.min(120000,Number(windowMs)||15000));this.maxEvents=Math.max(100,Math.min(5000,Number(maxEvents)||600));this.now=now;this.windows=new Map();this.summaries=new Map();}
  _rows(browserId){const id=String(browserId||'');const rows=this.windows.get(id)||[],cutoff=this.now()-this.windowMs,next=rows.filter(row=>Number(row.ts)>=cutoff);if(next.length>this.maxEvents)next.splice(0,next.length-this.maxEvents);this.windows.set(id,next);return next;}
  observe(browserInstanceId,event={}){
    const id=String(browserInstanceId||'').trim();if(!id)return null;
    if(String(event.source||'')==='agent')return this.status(id);
    const row={eventType:String(event.eventType||''),ts:Number(event.ts||this.now()),isTrusted:event.isTrusted!==false,x:Number(event.x),y:Number(event.y),deltaX:Number(event.deltaX||0),deltaY:Number(event.deltaY||0),keyClass:event.keyClass||null,repeat:event.repeat===true};
    const rows=this._rows(id);rows.push(row);if(rows.length>this.maxEvents)rows.splice(0,rows.length-this.maxEvents);const summary=this._analyze(rows);this.summaries.set(id,summary);return summary;
  }
  _analyze(rows){
    const signals=[];let score=0;const add=(id,weight,severity='review')=>{if(signals.some(x=>x.id===id))return;signals.push({id,weight,severity});score+=weight;};
    const untrusted=rows.filter(e=>e.isTrusted===false);if(untrusted.length>=2)add('synthetic_untrusted_input',100,'block');
    const keydowns=rows.filter(e=>e.eventType==='keydown'&&!e.repeat);if(keydowns.length>=12){const c=cadence(keydowns.slice(-20));if(c&&c.meanMs>=15&&c.meanMs<=900&&c.cv<=0.025)add('machine_keyboard_cadence',35);}
    const presses=rows.filter(e=>e.eventType==='mousedown');if(presses.length>=6){const recent=presses.slice(-8),anchor=recent[0];if(recent.every(x=>samePoint(anchor,x,1.25))){const c=cadence(recent);if(c&&c.meanMs>=20&&c.meanMs<=3000&&c.cv<=0.035)add('repeated_exact_click_cadence',35);}}
    const wheels=rows.filter(e=>e.eventType==='wheel');if(wheels.length>=8){const recent=wheels.slice(-10),dx=recent[0].deltaX,dy=recent[0].deltaY;if(recent.every(x=>x.deltaX===dx&&x.deltaY===dy)){const c=cadence(recent);if(c&&c.meanMs>=15&&c.meanMs<=2500&&c.cv<=0.035)add('repeated_exact_scroll_cadence',30);}}
    const recent5=rows.filter(e=>Number(e.ts)>=this.now()-5000);if(recent5.length>=500)add('input_rate_implausibly_high',45);
    score=Math.min(100,score);const blocked=signals.some(x=>x.severity==='block')||score>=70;return {score,blocked,review:score>=30,signalIds:signals.map(x=>x.id),eventCount:rows.length,untrustedEventCount:untrusted.length,lastObservedAt:rows.length?new Date(Math.max(...rows.map(x=>Number(x.ts)||0))).toISOString():null};
  }
  status(browserInstanceId=null){
    if(browserInstanceId!=null){const id=String(browserInstanceId),summary=this._analyze(this._rows(id));this.summaries.set(id,summary);return summary;}
    const ids=new Set([...this.windows.keys(),...this.summaries.keys()]),out={};for(const id of ids){const summary=this._analyze(this._rows(id));this.summaries.set(id,summary);out[id]={...summary,signalIds:[...summary.signalIds]};}return out;
  }
  clear(browserInstanceId){const id=String(browserInstanceId||'');this.windows.delete(id);this.summaries.delete(id);}
}

module.exports={BehaviorGuardian,cadence,mean,stddev};
