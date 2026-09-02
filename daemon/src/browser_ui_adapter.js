'use strict';

const BROWSER_COMMANDS=Object.freeze({
  back:{mode:'combo',value:'Alt+ArrowLeft',verify:'navigation'},
  forward:{mode:'combo',value:'Alt+ArrowRight',verify:'navigation'},
  reload:{mode:'combo',value:'Control+r',verify:'navigation-epoch'},
  hardreload:{mode:'combo',value:'Control+Shift+r',verify:'navigation-epoch'},
  stop:{mode:'key',value:'Escape',verify:'navigation-epoch'},
  newtab:{mode:'combo',value:'Control+t',verify:'new-tab'},
  closetab:{mode:'combo',value:'Control+w',verify:'close-tab'},
  reopentab:{mode:'combo',value:'Control+Shift+t',verify:'new-tab'},
  nexttab:{mode:'combo',value:'Control+Tab',verify:'active-tab-change'},
  prevtab:{mode:'combo',value:'Control+Shift+Tab',verify:'active-tab-change'},
  newwindow:{mode:'combo',value:'Control+n',verify:'new-window'},
  addressbar:{mode:'combo',value:'Control+l',verify:'unobservable'},
  find:{mode:'combo',value:'Control+f',verify:'unobservable'},
  downloads:{mode:'combo',value:'Control+j',verify:'unobservable'},
  history:{mode:'combo',value:'Control+h',verify:'unobservable'},
  devtools:{mode:'key',value:'F12',verify:'unobservable'},
  fullscreen:{mode:'key',value:'F11',verify:'unobservable'},
  bookmark:{mode:'combo',value:'Control+d',verify:'unobservable'},
  zoomin:{mode:'combo',value:'Control+EQUAL',verify:'unobservable'},
  zoomout:{mode:'combo',value:'Control+MINUS',verify:'unobservable'},
  zoomreset:{mode:'combo',value:'Control+0',verify:'unobservable'}
});

const COMPOUND_COMMANDS=Object.freeze({
  address:{verify:'navigation'},
  findtext:{verify:'unobservable'}
});

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,Math.max(0,Number(ms)||0)));}
function normalizeAction(value){return String(value||'').trim().toLowerCase();}
function publicNativeStep(step){
  if(step.mode==='text') return {mode:'text',valueLength:[...String(step.value||'')].length};
  return {mode:step.mode,value:step.value};
}
function activeOf(state){return state?.active||null;}
function tabCount(state){return Array.isArray(state?.tabs)?state.tabs.length:0;}
function windowCount(state){return new Set((state?.tabs||[]).map(t=>Number(t.windowId)).filter(Number.isInteger)).size;}

function verificationResult(kind,before,after,targetTabId){
  const b=activeOf(before),a=activeOf(after);
  if(kind==='unobservable') return {verified:false,reason:'browser_ui_state_not_observable'};
  if(kind==='new-tab') return {verified:tabCount(after)>tabCount(before),reason:tabCount(after)>tabCount(before)?'tab_count_increased':'tab_count_not_increased'};
  if(kind==='close-tab'){
    const exists=(after?.tabs||[]).some(t=>Number(t.id)===Number(targetTabId));
    const ok=!exists||tabCount(after)<tabCount(before);
    return {verified:ok,reason:ok?'target_tab_closed':'target_tab_still_present'};
  }
  if(kind==='active-tab-change'){
    if(tabCount(before)<=1) return {verified:false,reason:'single_tab_no_change_expected'};
    const ok=Number(a?.id)!==Number(b?.id);
    return {verified:ok,reason:ok?'active_tab_changed':'active_tab_unchanged'};
  }
  if(kind==='new-window'){
    const ok=windowCount(after)>windowCount(before);
    return {verified:ok,reason:ok?'window_count_increased':'window_count_not_increased'};
  }
  if(kind==='navigation'){
    const beforeToken=b?.navigationToken||null, afterToken=a?.navigationToken||null;
    const ok=Boolean(beforeToken&&afterToken&&beforeToken!==afterToken);
    return {verified:ok,reason:ok?'navigation_token_changed':'navigation_token_unchanged'};
  }
  if(kind==='navigation-epoch'){
    const beforeEpoch=Number(b?.navigationEpoch||0), afterEpoch=Number(a?.navigationEpoch||0);
    const ok=afterEpoch>beforeEpoch;
    return {verified:ok,reason:ok?'navigation_epoch_advanced':'navigation_epoch_not_advanced'};
  }
  return {verified:false,reason:'verification_rule_missing'};
}

class BrowserUiAdapter{
  constructor({resolveTarget,focusTarget,finishTarget=null,snapshot,runNativeInput,sleepImpl=sleep,verifyTimeoutMs=1400,verifyIntervalMs=80}={}){
    if(typeof resolveTarget!=='function'||typeof focusTarget!=='function'||typeof snapshot!=='function'||typeof runNativeInput!=='function') throw new Error('browser_ui_adapter_dependencies_required');
    this.resolveTarget=resolveTarget;
    this.focusTarget=focusTarget;
    this.finishTarget=typeof finishTarget==='function'?finishTarget:null;
    this.snapshot=snapshot;
    this.runNativeInput=runNativeInput;
    this.sleep=sleepImpl;
    this.verifyTimeoutMs=Math.max(100,Number(verifyTimeoutMs)||1400);
    this.verifyIntervalMs=Math.max(20,Number(verifyIntervalMs)||80);
    this.sequence=0;
  }

  nextId(action){this.sequence+=1;return `browser-${action}-${Date.now()}-${this.sequence}`;}

  stepsFor(action,value){
    if(BROWSER_COMMANDS[action]) return [BROWSER_COMMANDS[action]];
    if(action==='address'){
      if(!String(value||'').trim()) throw new Error('browser_address_value_required');
      return [
        {mode:'combo',value:'Control+l'},
        {mode:'text',value:String(value)},
        {mode:'key',value:'Enter'}
      ];
    }
    if(action==='findtext'){
      if(!String(value||'').length) throw new Error('browser_find_text_required');
      return [
        {mode:'combo',value:'Control+f'},
        {mode:'text',value:String(value)}
      ];
    }
    throw new Error(`unsupported_browser_command:${action}`);
  }

  verifyKind(action){return BROWSER_COMMANDS[action]?.verify||COMPOUND_COMMANDS[action]?.verify||'unobservable';}

  async pollVerification(kind,before,targetTabId,extensionId){
    let after=await this.snapshot(extensionId);
    let result=verificationResult(kind,before,after,targetTabId);
    if(result.verified||kind==='unobservable') return {after,result};
    const deadline=Date.now()+this.verifyTimeoutMs;
    while(Date.now()<deadline){
      await this.sleep(this.verifyIntervalMs);
      after=await this.snapshot(extensionId);
      result=verificationResult(kind,before,after,targetTabId);
      if(result.verified) break;
    }
    return {after,result};
  }

  async execute(actionInput,{extensionId=null,tabId='active',value=null}={}){
    const action=normalizeAction(actionInput);
    const target=await this.resolveTarget({extensionId,tabId});
    const commandId=this.nextId(action);
    const focus=await this.focusTarget({extensionId:target.extensionId,tab:target.tab,action,commandId});
    if(focus?.verified===false) throw new Error('browser_ui_focus_not_verified');
    try {
      const before=await this.snapshot(target.extensionId);
      const steps=this.stepsFor(action,value);
      const native=[];
      for(const step of steps){
        const result=await this.runNativeInput(step.mode,String(step.value));
        native.push({step:publicNativeStep(step),ok:result?.ok!==false});
        if(result?.ok===false)throw new Error('browser_ui_native_input_failed');
      }
      const kind=this.verifyKind(action);
      const {after,result}=await this.pollVerification(kind,before,Number(target.tab.id),target.extensionId);
      const observable=kind!=='unobservable';
      return {
        commandId,
        capability:'BROWSER_UI',
        browserAction:action,
        extensionId:target.extensionId,
        tabId:Number(target.tab.id),
        delivered:true,
        observed:true,
        observedEffect:{kind,observable,changed:observable?result.verified:null,reason:result.reason},
        verified:result.verified,
        taskSuccess:null,
        verification:{kind,...result},
        focus,
        native,
        executionAudit:{nativeInputOnly:true,stepCount:native.length},
        before:{tabCount:tabCount(before),activeTabId:activeOf(before)?.id??null,windowCount:windowCount(before)},
        after:{tabCount:tabCount(after),activeTabId:activeOf(after)?.id??null,windowCount:windowCount(after)}
      };
    } finally {
      if(this.finishTarget) await this.finishTarget({extensionId:target.extensionId,tab:target.tab,action,commandId}).catch(()=>{});
    }
  }
}

module.exports={BROWSER_COMMANDS,COMPOUND_COMMANDS,verificationResult,BrowserUiAdapter};
