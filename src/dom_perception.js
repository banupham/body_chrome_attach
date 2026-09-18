'use strict';

function finiteRect(rect){
  if(!rect||![rect.x,rect.y,rect.width,rect.height].every(Number.isFinite)||rect.width<=0||rect.height<=0)return null;
  return {x:Number(rect.x),y:Number(rect.y),width:Number(rect.width),height:Number(rect.height)};
}
function viewportEvidence(rect,windowRef=globalThis.window){
  const clean=finiteRect(rect),width=Math.max(0,Number(windowRef?.innerWidth||0)),height=Math.max(0,Number(windowRef?.innerHeight||0));
  if(!clean)return {geometryKnown:false,rectIntersectsViewport:false,rectFullyInViewport:false,viewport:{width,height}};
  const right=clean.x+clean.width,bottom=clean.y+clean.height,intersects=clean.x<width&&clean.y<height&&right>0&&bottom>0,fully=clean.x>=0&&clean.y>=0&&right<=width&&bottom<=height;
  return {geometryKnown:true,rectIntersectsViewport:intersects,rectFullyInViewport:fully,viewport:{width,height}};
}
function blockerDescriptor(node){
  if(!node)return null;
  let tag=null,role=null,className=null;
  try{tag=String(node.tagName||'').toLowerCase()||null;role=String(node.getAttribute?.('role')||'').trim()||null;className=String(node.className||'').slice(0,120)||null;}catch{}
  return {tag,role,className};
}
function actionabilityEvidence(view={}){
  return {
    geometryKnown:view.evidence?.geometryKnown===true,
    rectIntersectsViewport:view.evidence?.rectIntersectsViewport===true,
    rectFullyInViewport:view.evidence?.rectFullyInViewport===true,
    explicitHidden:view.evidence?.explicitHidden===true,
    inert:view.evidence?.inert===true,
    ariaHidden:view.evidence?.ariaHidden===true,
    displayNone:view.evidence?.displayNone===true,
    visibilityHidden:view.evidence?.visibilityHidden===true,
    opacityZero:view.evidence?.opacityZero===true,
    clippedByContainer:view.evidence?.clippedByContainer===true,
    visibleRectKnown:Boolean(view.visibleRect),
    hitTested:view.hitTested===true,
    hitOwned:view.evidence?.hitOwned===true,
    actionPointKnown:Boolean(view.actionPoint),
    actionable:view.actionable===true,
    reason:view.reason||'unknown',
    blocker:view.evidence?.blocker||null,
    hitPointsTried:Number(view.evidence?.hitPointsTried||0)
  };
}
function actionabilityQuality(view={}){
  const e=actionabilityEvidence(view);
  return Number(
    (e.geometryKnown?1:0)+
    (e.rectIntersectsViewport?2:0)+
    (e.visibleRectKnown?4:0)+
    (e.hitTested?1:0)+
    (e.hitOwned?8:0)+
    (e.actionPointKnown?16:0)+
    (e.actionable?32:0)
  );
}

// Read-only DOM evidence. A rectangle alone does not imply an actionable target.
function nodeView(node,rect,{documentRef=node?.ownerDocument||globalThis.document,windowRef=globalThis.window}={}){
  const viewport=viewportEvidence(rect,windowRef),baseEvidence={...viewport,explicitHidden:false,inert:false,ariaHidden:false,displayNone:false,visibilityHidden:false,opacityZero:false,clippedByContainer:false,hitOwned:false,hitPointsTried:0,blocker:null};
  const out={visible:false,actionable:false,reason:'no_geometry',hitTested:false,actionPoint:null,visibleRect:null,evidence:baseEvidence};
  if(!node||!rect)return out;
  let ariaHiddenObserved=false;
  try{
    for(let parent=node;parent;parent=parent.parentElement){
      const style=windowRef?.getComputedStyle?.(parent),hidden=parent.hidden===true,inert=parent.inert===true,ariaHidden=parent.getAttribute?.('aria-hidden')==='true',displayNone=style?.display==='none',visibilityHidden=['hidden','collapse'].includes(style?.visibility),opacityZero=style?.opacity!==undefined&&style.opacity!==''&&Number(style.opacity)===0;
      if(ariaHidden)ariaHiddenObserved=true;
      // aria-hidden is accessibility-tree evidence, not proof that a visual
      // element cannot receive a physical pointer hit. Preserve it as
      // evidence and let geometry + elementFromPoint decide actionability.
      if(hidden||inert||displayNone||visibilityHidden||opacityZero){
        return {...out,reason:'hidden',evidence:{...baseEvidence,explicitHidden:hidden,inert,ariaHidden:ariaHiddenObserved,displayNone,visibilityHidden,opacityZero}};
      }
    }
  }catch{return {...out,reason:'style_unavailable',evidence:{...baseEvidence,ariaHidden:ariaHiddenObserved}};}
  let x=Math.max(0,rect.x),y=Math.max(0,rect.y),right=Math.min(Number(windowRef?.innerWidth||0),rect.x+rect.width),bottom=Math.min(Number(windowRef?.innerHeight||0),rect.y+rect.height),clippedByContainer=false;
  for(let parent=node.parentElement;parent;parent=parent.parentElement){
    const style=windowRef?.getComputedStyle?.(parent),r=parent.getBoundingClientRect?.();if(!style||!r)continue;
    const before={x,y,right,bottom};
    if(/hidden|clip|scroll|auto/.test(style.overflowX||style.overflow||'')){x=Math.max(x,r.x);right=Math.min(right,r.x+r.width);}
    if(/hidden|clip|scroll|auto/.test(style.overflowY||style.overflow||'')){y=Math.max(y,r.y);bottom=Math.min(bottom,r.y+r.height);}
    if(x!==before.x||y!==before.y||right!==before.right||bottom!==before.bottom)clippedByContainer=true;
  }
  if(right<=x||bottom<=y)return {...out,reason:'outside_view',evidence:{...baseEvidence,ariaHidden:ariaHiddenObserved,clippedByContainer}};
  out.visibleRect={x,y,width:right-x,height:bottom-y,centerX:(x+right)/2,centerY:(y+bottom)/2};out.visible=true;out.evidence={...baseEvidence,ariaHidden:ariaHiddenObserved,clippedByContainer};
  const fractions=[[.5,.5],[.25,.25],[.75,.25],[.25,.75],[.75,.75]];
  let lastBlocker=null,tried=0;
  for(const [fx,fy] of fractions){
    const point={x:x+(right-x)*fx,y:y+(bottom-y)*fy};tried++;
    if(typeof documentRef?.elementFromPoint!=='function'){
      if(ariaHiddenObserved){out.reason='aria_hidden_unverified';out.evidence={...out.evidence,hitPointsTried:tried};return out;}
      out.actionPoint=point;out.actionable=true;out.reason='geometry_only';out.evidence={...out.evidence,hitPointsTried:tried};return out;
    }
    out.hitTested=true;const hit=documentRef.elementFromPoint(point.x,point.y);
    if(hit&&(hit===node||node.contains?.(hit))){out.actionPoint=point;out.actionable=true;out.reason='hit_test';out.evidence={...out.evidence,hitOwned:true,hitPointsTried:tried};return out;}
    if(hit)lastBlocker=blockerDescriptor(hit);
  }
  return {...out,visible:false,reason:'occluded',evidence:{...out.evidence,hitPointsTried:tried,blocker:lastBlocker}};
}
function pageSignals(documentRef,windowRef,describe){
  const query=selector=>{try{return [...(documentRef?.querySelectorAll?.(selector)||[])];}catch{return [];}};
  const visible=nodes=>nodes.filter(n=>{const r=n.getBoundingClientRect?.();return r&&nodeView(n,r,{documentRef,windowRef}).visible;});
  const dialogs=visible(query('[role="dialog"],[role="alertdialog"],dialog[open],tp-yt-paper-dialog[opened]')).slice(0,8).map(n=>({role:n.getAttribute?.('role')||'dialog',modal:n.getAttribute?.('aria-modal')==='true',label:describe(n)}));
  const errors=visible(query('.ytp-error-content-wrap,.ytp-error-content,[role="alert"]')).slice(0,8).map(n=>({role:n.getAttribute?.('role')||'player_error',label:describe(n)}));
  let hasFocus=null;try{if(typeof documentRef?.hasFocus==='function')hasFocus=Boolean(documentRef.hasFocus());}catch{}
  return {hasFocus,visibilityState:documentRef?.visibilityState||'unknown',dialogs,errors,browserUi:{observed:false,state:hasFocus===false?'focus_outside_document':'unknown',reason:'native_chrome_ui_outside_dom'}};
}
module.exports={finiteRect,viewportEvidence,blockerDescriptor,actionabilityEvidence,actionabilityQuality,nodeView,pageSignals};
