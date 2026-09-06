'use strict';

const { installVirtualCursorOverlay } = require('./virtual_cursor_overlay');
const { installInputTrustAudit } = require('./input_trust_audit');
const { youtubeSemanticObservation } = require('./youtube_semantic_observer');

let overlay = installVirtualCursorOverlay({ chromeApi: chrome, documentRef: document });
const inputTrustAudit = installInputTrustAudit({ chromeApi: chrome, documentRef: document });
let enabled = true;

function describeTarget(el) {
  const node = el?.nodeType === 1 ? el : null;
  if (!node) return { tag:null, role:null, inputType:null, editable:false, sensitive:false, rect:null };
  const tag = String(node.tagName || '').toLowerCase();
  const role = String(node.getAttribute?.('role') || '').toLowerCase() || null;
  const inputType = String(node.getAttribute?.('type') || '').toLowerCase() || null;
  const autocomplete = String(node.getAttribute?.('autocomplete') || '').toLowerCase();
  const sensitive = inputType === 'password' || /password|cc-|one-time-code/.test(autocomplete);
  const editable = !sensitive && (tag === 'input' || tag === 'textarea' || node.isContentEditable === true);
  let rect = null;
  try { const r = node.getBoundingClientRect?.(); if (r && [r.x,r.y,r.width,r.height].every(Number.isFinite)) rect = { x:r.x, y:r.y, width:r.width, height:r.height }; } catch {}
  return { tag, role, inputType, editable, sensitive, rect };
}

function pageObservation() {
  const activeTarget = describeTarget(document.activeElement);
  return {available:true,hasFocus:document.hasFocus?.()===true,visibilityState:String(document.visibilityState||'unknown'),activeTarget,scrollX:Number(window.scrollX||0),scrollY:Number(window.scrollY||0),viewport:{width:Number(window.innerWidth||0),height:Number(window.innerHeight||0)}};
}

function environmentObservation(){
  const s=window.screen||{};
  let timezone='unknown';try{timezone=Intl.DateTimeFormat().resolvedOptions().timeZone||'unknown';}catch{}
  return {
    available:true,
    userAgent:String(navigator.userAgent||''),
    platform:String(navigator.platform||''),
    language:String(navigator.language||''),
    languages:Array.isArray(navigator.languages)?navigator.languages.map(String):[],
    hardwareConcurrency:Number(navigator.hardwareConcurrency||0),
    deviceMemory:Number(navigator.deviceMemory||0),
    maxTouchPoints:Number(navigator.maxTouchPoints||0),
    webdriver:navigator.webdriver===true,
    timezone,
    screen:{width:Number(s.width||0),height:Number(s.height||0),availWidth:Number(s.availWidth||0),availHeight:Number(s.availHeight||0),colorDepth:Number(s.colorDepth||0),pixelDepth:Number(s.pixelDepth||0)},
    devicePixelRatio:Number(window.devicePixelRatio||1)
  };
}

function semanticObservation(){
  return youtubeSemanticObservation({documentRef:document,windowRef:window,locationRef:window.location});
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action === 'body.virtualCursorSet') {const next=message.enabled!==false;if(next&&!enabled)overlay=installVirtualCursorOverlay({chromeApi:chrome,documentRef:document});if(!next&&enabled)overlay.uninstall();enabled=next;sendResponse({ok:true,result:{enabled,...(enabled?overlay.status():{installed:false,visible:false}),inputTrustAudit:inputTrustAudit.status()}});return false;}
  if (message?.action === 'body.targetContextAt') {const x=Number(message.x),y=Number(message.y),target=Number.isFinite(x)&&Number.isFinite(y)?document.elementFromPoint(x,y):document.activeElement;sendResponse({ok:true,result:describeTarget(target)});return false;}
  if (message?.action === 'body.pageObservation') {sendResponse({ok:true,result:pageObservation()});return false;}
  if (message?.action === 'body.environmentObservation') {sendResponse({ok:true,result:environmentObservation()});return false;}
  if (message?.action === 'body.semanticObservation') {sendResponse({ok:true,result:semanticObservation()});return false;}
  if (message?.action !== 'body.virtualCursorPing') return false;
  sendResponse({ok:true,result:{enabled,...(enabled?overlay.status():{installed:false,visible:false}),inputTrustAudit:inputTrustAudit.status()}});return false;
});

module.exports={describeTarget,pageObservation,environmentObservation,semanticObservation};
