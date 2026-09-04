'use strict';

const SIGNED_IN_SELECTORS=Object.freeze([
  ['avatar_button','button#avatar-btn'],
  ['avatar_button_topbar','ytd-topbar-menu-button-renderer button#avatar-btn'],
  ['avatar_control','#avatar-btn'],
  ['account_button_en','button[aria-label*="Account"]'],
  ['account_button_vi','button[aria-label*="Tài khoản"]']
]);
const SIGNED_OUT_SELECTORS=Object.freeze([
  ['service_login','a[href*="accounts.google.com/ServiceLogin"]'],
  ['google_signin','a[href*="accounts.google.com/signin"]'],
  ['account_chooser','a[href*="accounts.google.com/AccountChooser"]'],
  ['topbar_google_account_link','ytd-button-renderer a[href*="accounts.google.com"]'],
  ['signin_aria_en','a[aria-label*="Sign in"]'],
  ['signin_aria_vi','a[aria-label*="Đăng nhập"]']
]);
const TOPBAR_SELECTORS=['ytd-masthead','#masthead-container','ytm-mobile-topbar-renderer','header'];
const SEARCH_SELECTORS=['input#search','input[name="search_query"]','ytd-searchbox input','yt-searchbox input'];

function clean(value){return String(value??'').replace(/\s+/g,' ').trim();}
function fold(value){return clean(value).toLowerCase().normalize('NFD').replace(/\p{M}+/gu,'').replace(/đ/g,'d');}
function firstNode(documentRef,selectors){for(const selector of selectors){try{const node=documentRef?.querySelector?.(selector);if(node)return {node,selector};}catch{}}return null;}
function visibleState(node,windowRef=globalThis.window){
  try{
    const r=node?.getBoundingClientRect?.();if(!r||![r.x,r.y,r.width,r.height].every(Number.isFinite))return null;
    const w=Number(windowRef?.innerWidth||0),h=Number(windowRef?.innerHeight||0);
    return r.width>1&&r.height>1&&r.x<w&&r.y<h&&r.x+r.width>0&&r.y+r.height>0;
  }catch{return null;}
}
function matchSelectorEvidence(documentRef,windowRef,rows,kind){
  const out=[];
  for(const [signal,selector] of rows){
    let node=null;try{node=documentRef?.querySelector?.(selector)||null;}catch{}
    if(!node)continue;const visible=visibleState(node,windowRef);if(visible===false)continue;
    out.push({kind,signal,visible});
  }
  return out;
}
function topbarTextEvidence(documentRef,windowRef){
  const root=firstNode(documentRef,TOPBAR_SELECTORS)?.node||null;if(!root)return [];
  let nodes=[];try{nodes=[...(root.querySelectorAll?.('a,button,tp-yt-paper-button,yt-formatted-string,span')||[])].slice(0,240);}catch{}
  const out=[];for(const node of nodes){const visible=visibleState(node,windowRef);if(visible===false)continue;const values=[node.getAttribute?.('aria-label'),node.getAttribute?.('title'),node.textContent].map(fold).filter(Boolean);for(const value of values){
    if(/^(?:sign in|dang nhap)(?:\b|$)/u.test(value)){out.push({kind:'signed_out',signal:'topbar_signin_text',visible});break;}
    if(/^(?:sign out|dang xuat)(?:\b|$)/u.test(value)){out.push({kind:'signed_in',signal:'topbar_signout_text',visible});break;}
  }}return out;
}
function uiReadiness(documentRef){
  const appShell=Boolean(firstNode(documentRef,['ytd-app','ytm-app'])?.node);
  const masthead=Boolean(firstNode(documentRef,TOPBAR_SELECTORS)?.node);
  const search=Boolean(firstNode(documentRef,SEARCH_SELECTORS)?.node);
  const homeSurface=Boolean(firstNode(documentRef,['ytd-browse[page-subtype="home"]','ytd-rich-grid-renderer'])?.node);
  const uiHydrated=appShell&&(masthead||search||homeSurface);
  return {appShell,masthead,search,homeSurface,uiHydrated};
}
function youtubeAuthObservation({documentRef=globalThis.document,windowRef=globalThis.window,fallbackState='unknown'}={}){
  const selectorIn=matchSelectorEvidence(documentRef,windowRef,SIGNED_IN_SELECTORS,'signed_in');
  const selectorOut=matchSelectorEvidence(documentRef,windowRef,SIGNED_OUT_SELECTORS,'signed_out');
  const text=topbarTextEvidence(documentRef,windowRef),signedIn=[...selectorIn,...text.filter(x=>x.kind==='signed_in')],signedOut=[...selectorOut,...text.filter(x=>x.kind==='signed_out')];
  const conflict=signedIn.length>0&&signedOut.length>0;
  let state='unknown';
  if(signedIn.length)state='signed_in';
  else if(signedOut.length)state='signed_out';
  else if(['signed_in','signed_out'].includes(String(fallbackState)))state=String(fallbackState);
  return {state,conflict,signedInSignals:[...new Set(signedIn.map(x=>x.signal))],signedOutSignals:[...new Set(signedOut.map(x=>x.signal))],readiness:uiReadiness(documentRef),privacy:'signals_only_no_account_identity'};
}

module.exports={SIGNED_IN_SELECTORS,SIGNED_OUT_SELECTORS,clean,fold,visibleState,uiReadiness,youtubeAuthObservation};