'use strict';

class HumanActionSegmenter {
  constructor(onSample,{moveIdleMs=450,minMoveDistance=12,minMovePoints=3}={}) {
    this.onSample = onSample;
    this.tabs = new Map();
    this.moveIdleMs=Math.max(50,Number(moveIdleMs)||450);
    this.minMoveDistance=Math.max(1,Number(minMoveDistance)||12);
    this.minMovePoints=Math.max(2,Number(minMovePoints)||3);
  }

  _state(tabId) {
    if (!this.tabs.has(tabId)) {
      this.tabs.set(tabId, {recentMouse: [],mouseLastTs: 0,mouseTarget:null,moveTimer:null,down: null,typing: null,typingTimer: null,scroll: null,scrollTimer: null});
    }
    return this.tabs.get(tabId);
  }

  handle(tabId, event) {
    if (event?.source !== 'human') return;
    if (event?.target?.sensitive) return;

    const s = this._state(tabId);
    if (event.eventType === 'mousemove') return this._mouseMove(tabId,s,event);
    if (event.eventType === 'mousedown') return this._mouseDown(tabId, s, event);
    if (event.eventType === 'mouseup') return this._mouseUp(tabId, s, event);
    if (event.eventType === 'keydown' || event.eventType === 'keyup') {this._flushMove(tabId,s);return this._typing(tabId, s, event);}
    if (event.eventType === 'wheel') {this._flushMove(tabId,s);this._scroll(tabId, s, event);}
  }

  _scheduleMove(tabId,s){
    if(s.down)return;
    clearTimeout(s.moveTimer);
    s.moveTimer=setTimeout(()=>this._flushMove(tabId,s),this.moveIdleMs);
    s.moveTimer.unref?.();
  }

  _mouseMove(tabId,s, e) {
    if (s.mouseLastTs && e.ts - s.mouseLastTs > this.moveIdleMs) this._flushMove(tabId,s);
    s.mouseLastTs = e.ts;
    s.mouseTarget=e.target||s.mouseTarget;
    const p = {ts:e.ts, x:e.x, y:e.y};
    s.recentMouse.push(p);
    if (s.recentMouse.length > 300) s.recentMouse.shift();
    if (s.down) {
      s.down.points.push(p);
      if (s.down.points.length > 500) s.down.points.shift();
    } else this._scheduleMove(tabId,s);
  }

  _flushMove(tabId,s){
    clearTimeout(s.moveTimer);s.moveTimer=null;
    if(s.down||s.recentMouse.length<this.minMovePoints)return false;
    const points=[...s.recentMouse],first=points[0],last=points.at(-1);
    const distance=Math.hypot(Number(last.x)-Number(first.x),Number(last.y)-Number(first.y));
    s.recentMouse=last?[last]:[];
    if(!Number.isFinite(distance)||distance<this.minMoveDistance)return false;
    const t0=Number(first.ts||0),normalizedPoints=points.map(p=>({t:Math.max(0,Number(p.ts)-t0),x:Number(p.x),y:Number(p.y)}));
    this.onSample({source:'human',action:'movePointer',tabId,context:{target_role:s.mouseTarget?.role||null,target_tag:s.mouseTarget?.tag||null,target_rect:s.mouseTarget?.rect||null,target_editable:s.mouseTarget?.editable===true},pointer_start:{x:normalizedPoints[0].x,y:normalizedPoints[0].y},points:normalizedPoints});
    return true;
  }

  _mouseDown(tabId, s, e) {
    clearTimeout(s.moveTimer);s.moveTimer=null;
    this._flushTyping(tabId, s);
    const recent = s.recentMouse.filter(p => e.ts - p.ts <= 1800);
    if (!recent.length || recent.at(-1).x !== e.x || recent.at(-1).y !== e.y) recent.push({ts:e.ts,x:e.x,y:e.y});
    s.down = {ts:e.ts,x:e.x,y:e.y,button:e.button,target:e.target,points:[...recent]};
  }

  _mouseUp(tabId, s, e) {
    if (!s.down) { s.recentMouse = [{ts:e.ts,x:e.x,y:e.y}];s.mouseLastTs=e.ts; return; }

    const d = s.down;
    const points = [...d.points, {ts:e.ts,x:e.x,y:e.y}];
    const dragDistance = Math.hypot(Number(e.x)-Number(d.x), Number(e.y)-Number(d.y));
    const holdMs = Math.max(0, e.ts - d.ts);
    const action = dragDistance >= 10 ? 'drag' : 'click';
    const t0 = points[0]?.ts ?? d.ts;
    const normalizedPoints = points.map(p => ({t: Math.max(0, p.ts - t0),x:p.x,y:p.y}));

    const sample = {
      source:'human',action,tabId,
      context:{
        target_role:d.target?.role || null,
        target_tag:d.target?.tag || null,
        target_rect:d.target?.rect || null,
        target_editable:d.target?.editable === true,
        destination_rect:e.target?.rect || null,
        destination_editable:e.target?.editable === true
      },
      pointer_start:{x:normalizedPoints[0]?.x ?? d.x,y:normalizedPoints[0]?.y ?? d.y},
      points:normalizedPoints,
      mouse_down_t:d.ts - t0,
      mouse_up_t:e.ts - t0,
      hold_ms:holdMs
    };

    if (normalizedPoints.length >= 2) this.onSample(sample);
    s.down = null;
    s.recentMouse = [{ts:e.ts,x:e.x,y:e.y}];
    s.mouseLastTs=e.ts;
    s.mouseTarget=e.target||s.mouseTarget;
  }

  _typing(tabId, s, e) {
    if (e.keyClass === 'redacted') return;
    const specialKeys=new Set(['Tab','Enter','Escape','Backspace','Delete','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End']);
    if(e.keyClass==='modifier') return;

    if(e.eventType==='keydown' && specialKeys.has(String(e.keyClass))) {
      this._flushTyping(tabId,s);
      this.onSample({source:'human',action:'pressKey',key:String(e.keyClass),tabId,context:{target_role:e.target?.role || null,target_tag:e.target?.tag || null,target_rect:e.target?.rect || null,target_editable:e.target?.editable === true}});
      return;
    }

    if(!['alpha','digit','space','punct'].includes(String(e.keyClass))) return;

    if (!s.typing || e.ts - s.typing.lastTs > 1200) {
      this._flushTyping(tabId, s);
      s.typing = {startedAt:e.ts,lastTs:e.ts,target:e.target,events:[]};
    }

    s.typing.lastTs = e.ts;
    s.typing.events.push({type:e.eventType,t:e.ts - s.typing.startedAt,keyClass:e.keyClass || 'unknown'});
    clearTimeout(s.typingTimer);
    s.typingTimer = setTimeout(() => this._flushTyping(tabId, s), 1000);
    s.typingTimer.unref?.();
  }

  _flushTyping(tabId, s) {
    clearTimeout(s.typingTimer);
    s.typingTimer = null;
    if (!s.typing || !s.typing.events.length) { s.typing = null; return false; }
    const downs = s.typing.events.filter(x => x.type === 'keydown');
    let emitted=false;
    if (downs.length >= 2) {
      this.onSample({source:'human',action:'typeText',tabId,context:{target_role:s.typing.target?.role || null,target_tag:s.typing.target?.tag || null,target_rect:s.typing.target?.rect || null,target_editable:s.typing.target?.editable === true},key_events:s.typing.events});
      emitted=true;
    }
    s.typing = null;
    return emitted;
  }

  _scroll(tabId, s, e) {
    if (!s.scroll || e.ts - s.scroll.lastTs > 260) {
      this._flushScroll(tabId, s);
      s.scroll = {startedAt:e.ts,lastTs:e.ts,target:e.target,events:[]};
    }
    s.scroll.lastTs = e.ts;
    s.scroll.events.push({t:e.ts - s.scroll.startedAt,deltaX:e.deltaX,deltaY:e.deltaY,x:e.x,y:e.y});
    clearTimeout(s.scrollTimer);
    s.scrollTimer = setTimeout(() => this._flushScroll(tabId, s), 260);
    s.scrollTimer.unref?.();
  }

  _flushScroll(tabId, s) {
    clearTimeout(s.scrollTimer);
    s.scrollTimer = null;
    if (!s.scroll || !s.scroll.events.length) { s.scroll = null; return false; }
    const sumX = s.scroll.events.reduce((a,x) => a + Number(x.deltaX||0), 0);
    const sumY = s.scroll.events.reduce((a,x) => a + Number(x.deltaY||0), 0);
    let emitted=false;
    if (Math.abs(sumX) + Math.abs(sumY) >= 1) {
      this.onSample({source:'human',action:Math.abs(sumX) > Math.abs(sumY) ? 'scrollHorizontal' : 'scrollVertical',tabId,deltaX:sumX,deltaY:sumY,wheel_events:s.scroll.events,context:{target_role:s.scroll.target?.role || null,target_tag:s.scroll.target?.tag || null,target_rect:s.scroll.target?.rect || null}});
      emitted=true;
    }
    s.scroll = null;
    return emitted;
  }

  flush(tabId=null) {
    const ids=tabId===null||tabId===undefined?[...this.tabs.keys()]:[Number(tabId)];
    let emitted=0;
    for(const id of ids){
      const s=this.tabs.get(id);if(!s)continue;
      if(this._flushMove(id,s))emitted++;
      if(this._flushTyping(id,s))emitted++;
      if(this._flushScroll(id,s))emitted++;
    }
    return {tabs:ids.length,emitted};
  }

  dispose(tabId=null,{flush=true}={}) {
    const ids=tabId===null||tabId===undefined?[...this.tabs.keys()]:[Number(tabId)];
    let emitted=0;
    for(const id of ids){
      const s=this.tabs.get(id);if(!s)continue;
      if(flush){
        if(this._flushMove(id,s))emitted++;
        if(this._flushTyping(id,s))emitted++;
        if(this._flushScroll(id,s))emitted++;
      }else{
        clearTimeout(s.moveTimer);clearTimeout(s.typingTimer);clearTimeout(s.scrollTimer);
      }
      s.down=null;
      s.recentMouse=[];
      this.tabs.delete(id);
    }
    return {tabs:ids.length,emitted};
  }
}

module.exports = { HumanActionSegmenter };
