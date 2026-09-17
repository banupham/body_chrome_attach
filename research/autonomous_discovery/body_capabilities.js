'use strict';

const MOTOR_TYPES=Object.freeze([
  'click','doubleClick','moveTo','hover','drag','scrollVertical','scrollHorizontal','typeText','pressKey','keyCombo'
]);
const BROWSER_UI_ACTIONS=Object.freeze([
  'dismiss','back','forward','reload','hardreload','stop','newtab','closetab','reopentab','nexttab','prevtab','newwindow',
  'addressbar','find','downloads','history','devtools','fullscreen','bookmark','zoomin','zoomout','zoomreset','address','findtext'
]);
const STEP_KINDS=Object.freeze(['motor','browser_ui','tab_switch']);

function clone(value){return JSON.parse(JSON.stringify(value));}
function bodyCapabilityCatalog(){
  return {
    contractVersion:'1.0',
    stepKinds:[...STEP_KINDS],
    motor:[...MOTOR_TYPES],
    browserUi:[...BROWSER_UI_ACTIONS],
    tab:['tab_switch'],
    executionModel:'one_atomic_body_step_then_observe',
    plannerOwnership:'brain',
    pageActionTransport:'CDP',
    browserUiTransport:'explicit_browser_ui_adapter',
    browserUiObservation:'DOM focus evidence only; native popup contents are unknown',
    bodyOwnership:'physical_execution_only'
  };
}
function isSupportedStep(step){
  if(!step||typeof step!=='object')return false;
  if(step.kind==='motor')return MOTOR_TYPES.includes(String(step.intent?.type||''));
  if(step.kind==='browser_ui')return BROWSER_UI_ACTIONS.includes(String(step.action||'').toLowerCase());
  if(step.kind==='tab_switch')return Number.isInteger(Number(step.targetTabId));
  return false;
}
function capabilityId(step){
  if(step?.kind==='motor')return `motor.${String(step.intent?.type||'unknown')}`;
  if(step?.kind==='browser_ui')return `browser_ui.${String(step.action||'unknown').toLowerCase()}`;
  if(step?.kind==='tab_switch')return 'tab.tab_switch';
  return 'unknown';
}
function publicStep(step){
  const out=clone(step||{});
  if(out?.kind==='motor'&&out.intent?.type==='typeText'&&typeof out.intent.text==='string'){
    out.intent={...out.intent,textLength:[...out.intent.text].length,textFingerprint:null};delete out.intent.text;
  }
  return out;
}

module.exports={MOTOR_TYPES,BROWSER_UI_ACTIONS,STEP_KINDS,bodyCapabilityCatalog,isSupportedStep,capabilityId,publicStep};
