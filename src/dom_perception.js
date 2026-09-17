'use strict';

// Read-only DOM evidence. A rectangle alone does not imply an actionable target.
function nodeView(node,rect,{documentRef=node?.ownerDocument||globalThis.document,windowRef=globalThis.window}={}){
  const out={visible:false,actionable:false,reason:'no_geometry',hitTested:false,actionPoint:null,visibleRect:null};
  if(!node||!rect)return out;
  try{
    for(let parent=node;parent;parent=parent.parentElement){
      const style=windowRef?.getComputedStyle?.(parent);
      if(parent.hidden||parent.inert||parent.getAttribute?.('aria-hidden')==='true'||style?.display==='none'||['hidden','collapse'].includes(style?.visibility)||(style?.opacity!==undefined&&style.opacity!==''&&Number(style.opacity)===0))return {...out,reason:'hidden'};
    }
  }catch{return {...out,reason:'style_unavailable'};}
  let x=Math.max(0,rect.x),y=Math.max(0,rect.y),right=Math.min(Number(windowRef?.innerWidth||0),rect.x+rect.width),bottom=Math.min(Number(windowRef?.innerHeight||0),rect.y+rect.height);
  // Scroll containers can clip a target even when it intersects the viewport.
  for(let parent=node.parentElement;parent;parent=parent.parentElement){
    const style=windowRef?.getComputedStyle?.(parent),r=parent.getBoundingClientRect?.();if(!style||!r)continue;
    if(/hidden|clip|scroll|auto/.test(style.overflowX||style.overflow||'')){x=Math.max(x,r.x);right=Math.min(right,r.x+r.width);}
    if(/hidden|clip|scroll|auto/.test(style.overflowY||style.overflow||'')){y=Math.max(y,r.y);bottom=Math.min(bottom,r.y+r.height);}
  }
  if(right<=x||bottom<=y)return {...out,reason:'outside_view'};
  out.visibleRect={x,y,width:right-x,height:bottom-y,centerX:(x+right)/2,centerY:(y+bottom)/2};out.visible=true;
  const fractions=[[.5,.5],[.25,.25],[.75,.25],[.25,.75],[.75,.75]];
  for(const [fx,fy] of fractions){
    const point={x:x+(right-x)*fx,y:y+(bottom-y)*fy};
    if(typeof documentRef?.elementFromPoint!=='function'){out.actionPoint=point;out.actionable=true;out.reason='geometry_only';return out;}
    out.hitTested=true;const hit=documentRef.elementFromPoint(point.x,point.y);
    if(hit&&(hit===node||node.contains?.(hit))){out.actionPoint=point;out.actionable=true;out.reason='hit_test';return out;}
  }
  return {...out,visible:false,reason:'occluded'};
}
function pageSignals(documentRef,windowRef,describe){
  const query=selector=>{try{return [...(documentRef?.querySelectorAll?.(selector)||[])];}catch{return [];}};
  const visible=nodes=>nodes.filter(n=>{const r=n.getBoundingClientRect?.();return r&&nodeView(n,r,{documentRef,windowRef}).visible;});
  const dialogs=visible(query('[role="dialog"],[role="alertdialog"],dialog[open],tp-yt-paper-dialog[opened]')).slice(0,8).map(n=>({role:n.getAttribute?.('role')||'dialog',modal:n.getAttribute?.('aria-modal')==='true',label:describe(n)}));
  const errors=visible(query('.ytp-error-content-wrap,.ytp-error-content,[role="alert"]')).slice(0,8).map(n=>({role:n.getAttribute?.('role')||'player_error',label:describe(n)}));
  let hasFocus=null;try{if(typeof documentRef?.hasFocus==='function')hasFocus=Boolean(documentRef.hasFocus());}catch{}
  return {hasFocus,visibilityState:documentRef?.visibilityState||'unknown',dialogs,errors,browserUi:{observed:false,state:hasFocus===false?'focus_outside_document':'unknown',reason:'native_chrome_ui_outside_dom'}};
}
module.exports={nodeView,pageSignals};
