'use strict';

const assert=require('node:assert/strict');
const {installInputTrustAudit,AUDITED_EVENTS}=require('../src/input_trust_audit');
const {DaemonBridge}=require('../src/daemon_bridge');

(async()=>{
  const listeners=new Map(),sent=[];
  const documentRef={defaultView:{location:{href:'https://example.com/'}},addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(type){listeners.delete(type);}};
  const chromeApi={runtime:{sendMessage(message){sent.push(message);return Promise.resolve();}}};
  const audit=installInputTrustAudit({chromeApi,documentRef});
  assert.equal(audit.status().installed,true);
  assert.deepEqual([...listeners.keys()].sort(),[...AUDITED_EVENTS].sort());
  listeners.get('click')({type:'click',isTrusted:true});
  assert.equal(sent.length,0);
  listeners.get('click')({type:'click',isTrusted:false});
  assert.equal(sent.length,1);
  assert.equal(sent[0].payload.kind,'trust_audit');
  assert.equal(sent[0].payload.event.isTrusted,false);
  assert.equal(audit.status().emitted,1);

  const forwarded=[];
  const bridgeChrome={tabs:{sendMessage:async()=>({ok:false})}};
  const bridge=new DaemonBridge(bridgeChrome,{gateway:{},WebSocketImpl:function FakeSocket(){},url:'ws://127.0.0.1:1'});
  bridge.send=message=>{forwarded.push(message);return true;};
  const forwardedOk=await bridge.forwardUserMotor(7,sent[0].payload);
  assert.equal(forwardedOk,true);
  assert.equal(forwarded.length,1);
  assert.equal(forwarded[0].type,'RECORDER_EVENT');
  assert.equal(forwarded[0].event.eventType,'synthetic_input');
  assert.equal(forwarded[0].event.isTrusted,false);
  assert.equal(forwarded[0].event.source,'unattributed');

  audit.uninstall();
  assert.equal(listeners.size,0);
  console.log('input_trust_audit_contract: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
