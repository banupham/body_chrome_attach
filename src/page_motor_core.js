'use strict';

function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function finiteCoordinate(value){return value!==null&&value!==undefined&&!(typeof value==='string'&&value.trim()==='')&&Number.isFinite(Number(value));}
function requirePointerStart(context={}){
  const raw=context?.pointerStart;
  if(!finiteCoordinate(raw?.x)||!finiteCoordinate(raw?.y)){const error=new Error('pointer_state_required');error.code='pointer_state_required';throw error;}
  return {x:Number(raw.x),y:Number(raw.y)};
}

function mapTemplatePath(template,start,end) {
  const dx=end.x-start.x;
  const dy=end.y-start.y;
  const dist=Math.max(1e-6,Math.hypot(dx,dy));
  const ux=dx/dist, uy=dy/dist;
  const nx=-uy, ny=ux;
  const path=template.path || [];
  const duration=Math.max(40,Number(template.movementDurationMs||250));
  let prevT=0;
  return path.map((p,index)=>{
    const t=clamp(Number(p.t||0),0,1);
    const x=start.x + ux*(Number(p.along||0)*dist) + nx*(Number(p.lateral||0)*dist);
    const y=start.y + uy*(Number(p.along||0)*dist) + ny*(Number(p.lateral||0)*dist);
    const delayMs=index===0?0:Math.max(0,(t-prevT)*duration);
    prevT=t;
    return {delayMs,method:'Input.dispatchMouseEvent',params:{type:'mouseMoved',x,y,button:'none'},behaviorPhase:'learned-path'};
  });
}

function bootstrapMove(start,end) {
  const dx=end.x-start.x;
  const dy=end.y-start.y;
  const distance=Math.max(1,Math.hypot(dx,dy));
  const steps=clamp(Math.round(distance/14),4,72);
  const duration=clamp((distance/900)*1000,45,2600);
  const out=[];
  for(let i=1;i<=steps;i++) {
    const t=i/steps;
    out.push({
      delayMs:i===1?0:duration/steps,
      method:'Input.dispatchMouseEvent',
      params:{type:'mouseMoved',x:start.x+dx*t,y:start.y+dy*t,button:'none'},
      behaviorPhase:'bootstrap-linear'
    });
  }
  return out;
}

const KEY_SPECS=Object.freeze({
  Enter:{code:'Enter',vk:13,text:'\r'},Tab:{code:'Tab',vk:9},Escape:{code:'Escape',vk:27},
  Backspace:{code:'Backspace',vk:8},Delete:{code:'Delete',vk:46},ArrowUp:{code:'ArrowUp',vk:38},
  ArrowDown:{code:'ArrowDown',vk:40},ArrowLeft:{code:'ArrowLeft',vk:37},ArrowRight:{code:'ArrowRight',vk:39},
  Home:{code:'Home',vk:36},End:{code:'End',vk:35},Control:{code:'ControlLeft',vk:17},
  Shift:{code:'ShiftLeft',vk:16},Alt:{code:'AltLeft',vk:18},Meta:{code:'MetaLeft',vk:91}
});
const KEY_ALIASES=Object.freeze({esc:'Escape',return:'Enter',ctrl:'Control',control:'Control',cmd:'Meta',command:'Meta'});
const MODIFIER_BITS=Object.freeze({Alt:1,Control:2,Meta:4,Shift:8});
const SHIFTED_DIGITS=Object.freeze({'!':'1','@':'2','#':'3','$':'4','%':'5','^':'6','&':'7','*':'8','(':'9',')':'0'});
const PUNCTUATION=Object.freeze({
  '-':['Minus',189,false],'_':['Minus',189,true],'=':['Equal',187,false],'+':['Equal',187,true],
  '[':['BracketLeft',219,false],'{':['BracketLeft',219,true],']':['BracketRight',221,false],'}':['BracketRight',221,true],
  '\\':['Backslash',220,false],'|':['Backslash',220,true],';':['Semicolon',186,false],':':['Semicolon',186,true],
  "'":['Quote',222,false],'"':['Quote',222,true],',':['Comma',188,false],'<':['Comma',188,true],
  '.':['Period',190,false],'>':['Period',190,true],'/':['Slash',191,false],'?':['Slash',191,true],
  '`':['Backquote',192,false],'~':['Backquote',192,true],' ':['Space',32,false]
});
const SHIFTED_PRINTABLES=new Set([...Object.keys(SHIFTED_DIGITS),...Object.entries(PUNCTUATION).filter(([,s])=>s[2]).map(([c])=>c),...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']);

function normalizeKeyName(value){ const raw=String(value??'').trim(); return KEY_ALIASES[raw.toLowerCase()]||raw; }
function printableCode(ch){
  if(/^[a-z]$/i.test(ch)) return `Key${ch.toUpperCase()}`;
  if(/^[0-9]$/.test(ch)) return `Digit${ch}`;
  if(SHIFTED_DIGITS[ch]) return `Digit${SHIFTED_DIGITS[ch]}`;
  return PUNCTUATION[ch]?.[0]||'Unidentified';
}
function printableVk(ch){
  if(/^[a-z]$/i.test(ch)) return ch.toUpperCase().charCodeAt(0);
  if(/^[0-9]$/.test(ch)) return ch.charCodeAt(0);
  if(SHIFTED_DIGITS[ch]) return SHIFTED_DIGITS[ch].charCodeAt(0);
  return PUNCTUATION[ch]?.[1]||0;
}
function keyClassForName(value){
  const key=normalizeKeyName(value);
  if(key.length===1){if(/\s/.test(key))return 'space';if(/[A-Za-zÀ-ỹ]/u.test(key))return 'alpha';if(/[0-9]/.test(key))return 'digit';return 'punct';}
  return key||'special';
}
function comboDescriptor(combo){
  const parts=String(combo||'').split('+').map(normalizeKeyName).filter(Boolean);
  const modifiers=parts.filter(x=>MODIFIER_BITS[x]);
  const keys=parts.filter(x=>!MODIFIER_BITS[x]);
  if(!modifiers.length||!keys.length) throw new Error('key_combo_requires_modifier_and_key');
  return {parts,modifiers,keys,keyClass:keyClassForName(keys[0])};
}
function characterParams(ch,type='rawKeyDown',extraModifiers=0){
  const modifiers=Number(extraModifiers||0)|(SHIFTED_PRINTABLES.has(ch)?MODIFIER_BITS.Shift:0);
  const vk=printableVk(ch);
  const params={type,key:ch,code:printableCode(ch),modifiers};
  if(vk){ params.windowsVirtualKeyCode=vk; params.nativeVirtualKeyCode=vk; }
  if(type==='char'){ params.text=ch; params.unmodifiedText=ch; }
  return params;
}
function keySpec(name){
  const key=normalizeKeyName(name);
  if(KEY_SPECS[key]) return {key,code:KEY_SPECS[key].code,vk:KEY_SPECS[key].vk||0};
  if(key.length===1) return {key,code:printableCode(key),vk:printableVk(key)};
  return {key,code:key,vk:0};
}
function keyStep(name,type,modifiers=0,delayMs=0){
  const key=normalizeKeyName(name);
  if(key.length===1) return {delayMs,method:'Input.dispatchKeyEvent',params:characterParams(key,type,modifiers)};
  const s=keySpec(key);
  const params={type,key:s.key,code:s.code,modifiers};
  if(s.vk){ params.windowsVirtualKeyCode=s.vk; params.nativeVirtualKeyCode=s.vk; }
  return {delayMs,method:'Input.dispatchKeyEvent',params};
}
function comboSteps(combo,timing=null){
  const descriptor=comboDescriptor(combo),{modifiers,keys}=descriptor;
  const learned=timing&&typeof timing==='object'?timing:null;
  const downGaps=Array.isArray(learned?.modifierDownGaps)?learned.modifierDownGaps:[];
  const releaseGaps=Array.isArray(learned?.modifierReleaseGaps)?learned.modifierReleaseGaps:[];
  const keyDownDelay=learned?clamp(Number(learned.keyDownDelayMs??28),0,2000):28;
  const keyHold=learned?clamp(Number(learned.keyHoldMs??45),5,4000):45;
  let mask=0; const out=[];
  for(let i=0;i<modifiers.length;i++){
    const m=modifiers[i];mask|=MODIFIER_BITS[m];
    const delayMs=i===0?0:(learned?clamp(Number(downGaps[Math.min(i-1,downGaps.length-1)]??0),0,2000):0);
    out.push(keyStep(m,'rawKeyDown',mask,delayMs));
  }
  for(const k of keys){out.push(keyStep(k,'rawKeyDown',mask,keyDownDelay));out.push(keyStep(k,'keyUp',mask,keyHold));}
  let releaseIndex=0;
  for(const m of [...modifiers].reverse()){
    mask&=~MODIFIER_BITS[m];
    const delayMs=learned?clamp(Number(releaseGaps[Math.min(releaseIndex,releaseGaps.length-1)]??24),0,2000):24;
    out.push(keyStep(m,'keyUp',mask,delayMs));releaseIndex++;
  }
  return out;
}
function charSteps(ch,holdMs,delayBefore){
  if(ch.length!==1) return [];
  if(ch.charCodeAt(0)>127){
    return [{delayMs:delayBefore,method:'Input.dispatchKeyEvent',params:{type:'char',text:ch,key:ch,code:'Unidentified',modifiers:0}}];
  }
  const shifted=SHIFTED_PRINTABLES.has(ch);
  const out=[];
  if(shifted) out.push(keyStep('Shift','rawKeyDown',MODIFIER_BITS.Shift,delayBefore));
  out.push({delayMs:shifted?8:delayBefore,method:'Input.dispatchKeyEvent',params:characterParams(ch,'rawKeyDown')});
  out.push({delayMs:0,method:'Input.dispatchKeyEvent',params:characterParams(ch,'char')});
  out.push({delayMs:Math.max(5,holdMs),method:'Input.dispatchKeyEvent',params:characterParams(ch,'keyUp')});
  if(shifted) out.push(keyStep('Shift','keyUp',0,8));
  return out;
}

class MotorPlanner {
  constructor(model) { this.model=model; }

  plan(intent,context={}) {
    const action=String(intent.type||'');
    if(['click','doubleClick','moveTo','hover','focus'].includes(action)) return this._pointer(intent,context);
    if(action==='drag') return this._drag(intent,context);
    if(['scroll','scrollVertical','scrollHorizontal'].includes(action)) return this._scroll(intent,context);
    if(['type','typeText'].includes(action)) return this._type(intent,context);
    if(action==='pressKey') return this._pressKey(intent);
    if(action==='keyCombo') return this._combo(intent);
    if(action==='back') return this._combo({key:'Alt+ArrowLeft'});
    if(action==='forward') return this._combo({key:'Alt+ArrowRight'});
    if(action==='reload') return this._combo({key:'Control+r'});
    throw new Error(`unsupported_intent:${action}`);
  }

  _modelSample(method,...args){
    if(typeof this.model?.[method]==='function')return this.model[method](...args);
    const primary=typeof this.model?.primary?.[method]==='function'?this.model.primary[method](...args):null;
    if(primary)return primary;
    return typeof this.model?.fallback?.[method]==='function'?this.model.fallback[method](...args):null;
  }

  _targetRect(intent) {
    const w=Math.max(4,Number(intent.width||intent.targetWidth||12));
    const h=Math.max(4,Number(intent.height||intent.targetHeight||12));
    const x=Number(intent.x), y=Number(intent.y);
    if(!Number.isFinite(x)||!Number.isFinite(y)) throw new Error('target_coordinates_required');
    return {x:x-w/2,y:y-h/2,width:w,height:h};
  }

  _pointer(intent,context) {
    const action=intent.type;
    const rect=this._targetRect(intent);
    const center={x:rect.x+rect.width/2,y:rect.y+rect.height/2};
    const start=requirePointerStart(context);
    const distance=Math.hypot(center.x-start.x,center.y-start.y);
    const learned=this.model.sampleMouse({action:action==='doubleClick'?'click':action==='focus'?'click':action,role:intent.role||'unknown',distance,targetWidth:rect.width,targetHeight:rect.height});

    let end=center,steps,source='bootstrap',holdMs=55;
    if(learned) {
      source='learned';
      const t=learned.template;
      if(!['moveTo','hover'].includes(action)){
        end={x:center.x+Number(t.endOffsetXRatio||0)*rect.width,y:center.y+Number(t.endOffsetYRatio||0)*rect.height};
        end.x=clamp(end.x,rect.x+1,rect.x+rect.width-1);
        end.y=clamp(end.y,rect.y+1,rect.y+rect.height-1);
      }
      steps=mapTemplatePath(t,start,end);
      holdMs=Math.max(20,Number(t.holdMs||55));
    } else steps=bootstrapMove(start,end);

    if(['moveTo','hover'].includes(action)) return this._wrap(action,steps,source,learned);

    const clicks=action==='doubleClick'?2:1;
    for(let i=1;i<=clicks;i++) {
      steps.push({delayMs:i===1?35:95,method:'Input.dispatchMouseEvent',params:{type:'mousePressed',x:end.x,y:end.y,button:'left',clickCount:i}});
      steps.push({delayMs:holdMs,method:'Input.dispatchMouseEvent',params:{type:'mouseReleased',x:end.x,y:end.y,button:'left',clickCount:i}});
    }
    return this._wrap(action,steps,source,learned);
  }

  _drag(intent,context) {
    const start={x:Number(intent.x1),y:Number(intent.y1)};
    const end={x:Number(intent.x2),y:Number(intent.y2)};
    if (![start.x,start.y,end.x,end.y].every(Number.isFinite)) throw new Error('drag_coordinates_required');
    const approach=bootstrapMove(requirePointerStart(context),start);
    const distance=Math.hypot(end.x-start.x,end.y-start.y);
    const learned=this.model.sampleMouse({action:'drag',role:intent.role||'unknown',distance,targetWidth:12,targetHeight:12});
    let dragPath,source='bootstrap';
    if(learned){source='learned';dragPath=mapTemplatePath(learned.template,start,end);}else dragPath=bootstrapMove(start,end);
    const steps=[
      ...approach,
      {delayMs:45,method:'Input.dispatchMouseEvent',params:{type:'mousePressed',x:start.x,y:start.y,button:'left',buttons:1}},
      ...dragPath.map(s=>({...s,params:{...s.params,button:'left',buttons:1},behaviorPhase:'drag'})),
      {delayMs:45,method:'Input.dispatchMouseEvent',params:{type:'mouseReleased',x:end.x,y:end.y,button:'left',buttons:0}}
    ];
    return this._wrap('drag',steps,source,learned);
  }

  _scroll(intent,context) {
    const action=intent.type==='scroll'?'scrollVertical':intent.type;
    const delta=Number(intent.delta??intent.amount);
    if(!Number.isFinite(delta)) throw new Error('scroll_delta_required');
    const learned=this.model.sampleScroll(action,delta);
    const p=requirePointerStart(context);
    const steps=[];
    if(learned) {
      const t=learned.template;
      for(let i=0;i<t.ratios.length;i++) {
        const ratio=Number(t.ratios[i]);
        const gap=i===0?0:Number(t.gaps[Math.min(i-1,t.gaps.length-1)]||55);
        steps.push({delayMs:gap,method:'Input.dispatchMouseEvent',params:{type:'mouseWheel',x:p.x,y:p.y,deltaX:action==='scrollHorizontal'?delta*ratio:0,deltaY:action==='scrollHorizontal'?0:delta*ratio}});
      }
      return this._wrap(action,steps,'learned',learned);
    }
    const count=5;
    for(let i=0;i<count;i++) steps.push({delayMs:i===0?0:55,method:'Input.dispatchMouseEvent',params:{type:'mouseWheel',x:p.x,y:p.y,deltaX:action==='scrollHorizontal'?delta/count:0,deltaY:action==='scrollHorizontal'?0:delta/count}});
    return this._wrap(action,steps,'bootstrap',null);
  }

  _type(intent,context) {
    const text=String(intent.text??'');
    if(!text.length) throw new Error('text_required');
    const clickPlan=this._pointer({type:'click',x:intent.x,y:intent.y,width:intent.width||intent.targetWidth||12,height:intent.height||intent.targetHeight||12,role:intent.role||'textbox'},context);
    const learned=this.model.sampleTyping();
    const intervals=learned?.template?.intervals || [82,76,90,71,88];
    const holds=learned?.template?.holds || [45,48,42,50];
    const chars=[...text];
    const keySteps=[];
    for(let i=0;i<chars.length;i++) {
      const hold=Math.max(5,Number(holds[i%holds.length]||45));
      const interval=i===0?80:Math.max(10,Number(intervals[(i-1)%intervals.length]||80));
      const delayBefore=i===0?80:Math.max(5,interval-hold);
      keySteps.push(...charSteps(chars[i],hold,delayBefore));
    }
    return this._wrap(intent.type,[...clickPlan.plan.steps,...keySteps],learned?'learned':'bootstrap',learned);
  }

  _pressKey(intent) {
    const k=normalizeKeyName(intent.key);
    const learned=this._modelSample('samplePressKey',k);
    const holdMs=learned?clamp(Number(learned.template?.holdMs??45),5,4000):45;
    return this._wrap('pressKey',[keyStep(k,'rawKeyDown',0,0),keyStep(k,'keyUp',0,holdMs)],learned?'learned':'bootstrap',learned);
  }

  _combo(intent) {
    const combo=intent.key||intent.combo,descriptor=comboDescriptor(combo);
    const learned=this._modelSample('sampleKeyCombo',{modifiers:descriptor.modifiers,keyClass:descriptor.keyClass});
    return this._wrap('keyCombo',comboSteps(combo,learned?.template||null),learned?'learned':'bootstrap',learned);
  }

  _wrap(actionType,steps,source,learned) {
    return {source,learnedGroup:learned?.groupKey || null,learnedTemplateCount:learned?.count || 0,learnedSelection:learned?.selection||null,learnedTemplateIndex:Number.isInteger(learned?.index)?learned.index:null,plan:{executionCapability:'HUMAN_MOTOR',actionType,steps}};
  }
}

module.exports={MotorPlanner,mapTemplatePath,bootstrapMove,comboSteps,comboDescriptor,keyClassForName,requirePointerStart};
