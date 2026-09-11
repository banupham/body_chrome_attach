'use strict';

const assert=require('node:assert/strict');
const {installVirtualCursorOverlay,CDP_DOM_ECHO_GUARD_MS}=require('../src/virtual_cursor_overlay');
const {VIRTUAL_CURSOR_SCOPE,MESSAGE_TYPES}=require('../src/virtual_cursor_protocol');

function fixture(){
  let now=100;
  const runtimeListeners=[];
  const domListeners=new Map();
  const sent=[];
  const storage=new Map();
  const cursor={style:{display:'none',transform:''},dataset:{state:'move',source:'USER'}};
  const label={textContent:'USER'};
  const ring={};
  const host={
    isConnected:false,
    style:{cssText:''},
    setAttribute(){},
    attachShadow(){return {innerHTML:'',getElementById(id){if(id==='cursor')return cursor;if(id==='label')return label;if(id==='ring')return ring;return null;}};},
    remove(){this.isConnected=false;}
  };
  const root={appendChild(node){node.isConnected=true;}};
  const win={
    performance:{now:()=>now},
    location:{href:'https://example.com/'},
    sessionStorage:{getItem:k=>storage.has(k)?storage.get(k):null,setItem:(k,v)=>storage.set(k,String(v))}
  };
  const documentRef={
    defaultView:win,
    documentElement:root,
    body:root,
    querySelector(){return null;},
    createElement(){return host;},
    addEventListener(type,fn){domListeners.set(type,fn);},
    removeEventListener(type){domListeners.delete(type);}
  };
  const chromeApi={runtime:{
    onMessage:{addListener(fn){runtimeListeners.push(fn);},removeListener(fn){const i=runtimeListeners.indexOf(fn);if(i>=0)runtimeListeners.splice(i,1);}},
    sendMessage(message){sent.push(message);return Promise.resolve({ok:true});}
  }};
  const overlay=installVirtualCursorOverlay({chromeApi,documentRef});
  return {overlay,runtimeListeners,domListeners,sent,cursor,label,setNow:value=>{now=value;},advance:delta=>{now+=delta;}};
}

function pointerDom(x,y,type='mousemove'){
  return {type,clientX:x,clientY:y,button:0,buttons:0,detail:0,deltaX:0,deltaY:0,target:null};
}

{
  const f=fixture();
  const dispatch=f.runtimeListeners[0];
  dispatch({scope:VIRTUAL_CURSOR_SCOPE,type:MESSAGE_TYPES.CDP_POINTER_EXPECTED,event:{eventId:'p1',type:'mouseMoved',x:100,y:100,button:'none',buttons:0,clickCount:0,deltaX:0,deltaY:0}},null,()=>{});
  assert.equal(f.overlay.status().source,'CDP');

  f.domListeners.get('mousemove')(pointerDom(135,135));
  assert.equal(f.sent.length,0,'unmatched DOM echo inside CDP guard must not become USER_MOTOR_EVENT');
  assert.equal(f.overlay.status().source,'CDP','ambiguous CDP echo must not flip cursor label back to USER');
  assert.equal(f.overlay.status().ambiguousDomEvents,1);
  assert.equal(f.overlay.status().suppressedDomEvents,1);

  f.advance(CDP_DOM_ECHO_GUARD_MS+1);
  f.domListeners.get('mousemove')(pointerDom(150,150));
  assert.equal(f.sent.length,1,'real user event after guard must still be observable');
  assert.equal(f.sent[0].type,MESSAGE_TYPES.USER_MOTOR_EVENT);
  assert.equal(f.sent[0].payload.source,'USER');
  assert.equal(f.overlay.status().source,'USER');
  f.overlay.uninstall();
}

{
  const f=fixture();
  const dispatch=f.runtimeListeners[0];
  dispatch({scope:VIRTUAL_CURSOR_SCOPE,type:MESSAGE_TYPES.CDP_KEY_EXPECTED,event:{eventId:'k1',type:'rawKeyDown',key:'a',code:'KeyA'}},null,()=>{});
  const before=f.sent.length;
  f.domListeners.get('keydown')({type:'keydown',key:'b',code:'KeyB',repeat:false,target:null});
  assert.equal(f.sent.length,before,'unmatched key DOM echo inside CDP guard must not become USER_MOTOR_EVENT');
  assert.equal(f.overlay.status().source,'CDP');
  assert.equal(f.overlay.status().ambiguousDomEvents,1);

  f.advance(CDP_DOM_ECHO_GUARD_MS+1);
  f.domListeners.get('keydown')({type:'keydown',key:'c',code:'KeyC',repeat:false,target:null});
  assert.equal(f.sent.length,before+1,'keyboard user event after guard must still pass');
  assert.equal(f.sent.at(-1).payload.source,'USER');
  f.overlay.uninstall();
}

console.log('virtual_cursor_provenance_contract: PASS');
