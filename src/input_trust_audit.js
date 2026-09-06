'use strict';

const {VIRTUAL_CURSOR_SCOPE,MESSAGE_TYPES,SOURCES}=require('./virtual_cursor_protocol');

const AUDITED_EVENTS=['mousedown','mouseup','wheel','keydown','keyup','click'];

function installInputTrustAudit({chromeApi,documentRef}={}){
  if(!chromeApi?.runtime?.sendMessage||!documentRef?.addEventListener)throw new Error('input_trust_audit_dependencies_required');
  let emitted=0;
  const listener=event=>{
    if(event?.isTrusted!==false)return;
    emitted++;
    chromeApi.runtime.sendMessage({scope:VIRTUAL_CURSOR_SCOPE,type:MESSAGE_TYPES.USER_MOTOR_EVENT,payload:{source:SOURCES.USER,kind:'trust_audit',event:{type:String(event.type||'unknown'),isTrusted:false,at:Date.now()},url:String(documentRef.defaultView?.location?.href||''),at:Date.now()}}).catch(()=>{});
  };
  for(const type of AUDITED_EVENTS)documentRef.addEventListener(type,listener,true);
  return {status:()=>({installed:true,emitted}),uninstall(){for(const type of AUDITED_EVENTS)documentRef.removeEventListener(type,listener,true);}};
}

module.exports={installInputTrustAudit,AUDITED_EVENTS};
