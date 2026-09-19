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
function rectIntersection(rect,bounds){
  const a=finiteRect(rect),b=finiteRect(bounds);if(!a||!b)return null;
  const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),right=Math.min(a.x+a.width,b.x+b.width),bottom=Math.min(a.y+a.height,b.y+b.height);
  if(right<=x||bottom<=y)return null;
  return {x,y,width:right-x,height:bottom-y,centerX:(x+right)/2,centerY:(y+bottom)/2};
}
function blockerDescriptor(node){
  if(!node)return null;
  let tag=null,role=null,className=null;
  try{tag=String(node.tagName||'').toLowerCase()||null;role=String(node.getAttribute?.('role')||'').trim()||null;className=String(node.className||'').slice(0,120)||null;}catch{}
  return {tag,role,className};
}
function styleEvidence(node,windowRef=globalThis.window){
  const out={explicitHidden:false,inert:false,ariaHidden:false,displayNone:false,visibilityHidden:false,opacityZero:false,styleReadable:true,clipAncestors:[]};
  try{
    for(let parent=node;parent;parent=parent.parentElement){
      const style=windowRef?.getComputedStyle?.(parent),hidden=parent.hidden===true,inert=parent.inert===true,ariaHidden=parent.getAttribute?.('aria-hidden')==='true',displayNone=style?.display==='none',visibilityHidden=['hidden','collapse'].includes(style?.visibility),opacityZero=style?.opacity!==undefined&&style.opacity!==''&&Number(style.opacity)===0;
      out.explicitHidden=out.explicitHidden||hidden;out.inert=out.inert||inert;out.ariaHidden=out.ariaHidden||ariaHidden;out.displayNone=out.displayNone||displayNone;out.visibilityHidden=out.visibilityHidden||visibilityHidden;out.opacityZero=out.opacityZero||opacityZero;
      const overflowX=String(style?.overflowX||style?.overflow||''),overflowY=String(style?.overflowY||style?.overflow||'');
      if(/hidden|clip|scroll|auto/.test(overflowX)||/hidden|clip|scroll|auto/.test(overflowY)){
        const r=finiteRect(parent.getBoundingClientRect?.());if(r)out.clipAncestors.push({rect:r,overflowX,overflowY});
      }
    }
  }catch{out.styleReadable=false;}
  return out;
}
function hitSamples(node,visibleRect,documentRef=globalThis.document){
  const samples=[];if(!visibleRect||typeof documentRef?.elementFromPoint!=='function')return {hitTested:false,samples};
  const fractions=[[.5,.5],[.25,.25],[.75,.25],[.25,.75],[.75,.75]];
  for(const [fx,fy] of fractions){
    const x=visibleRect.x+visibleRect.width*fx,y=visibleRect.y+visibleRect.height*fy;let hit=null,owned=false,blocker=null;
    try{hit=documentRef.elementFromPoint(x,y);owned=Boolean(hit&&(hit===node||node.contains?.(hit)));if(hit&&!owned)blocker=blockerDescriptor(hit);}catch{}
    samples.push({x,y,owned,blocker});
  }
  return {hitTested:true,samples};
}

// BODY observation only: report geometry/style/hit-test facts. Do not decide
// whether Brain should act, which point to use, or which representation wins.
function nodeView(node,rect,{documentRef=node?.ownerDocument||globalThis.document,windowRef=globalThis.window}={}){
  const viewport=viewportEvidence(rect,windowRef),styles=node?styleEvidence(node,windowRef):styleEvidence(null,windowRef),viewportRect={x:0,y:0,width:viewport.viewport.width,height:viewport.viewport.height},visibleRect=rectIntersection(rect,viewportRect);
  let clippedRect=visibleRect,clippedByContainer=false;
  if(node&&visibleRect){
    for(const clip of styles.clipAncestors){
      const next=rectIntersection(clippedRect,clip.rect);if(!next){clippedRect=null;clippedByContainer=true;break;}
      if(next.x!==clippedRect.x||next.y!==clippedRect.y||next.width!==clippedRect.width||next.height!==clippedRect.height)clippedByContainer=true;
      clippedRect=next;
    }
  }
  const hardStyleHidden=Boolean(styles.explicitHidden||styles.inert||styles.displayNone||styles.visibilityHidden||styles.opacityZero),hits=node&&visibleRect&&!hardStyleHidden?hitSamples(node,visibleRect,documentRef):{hitTested:false,samples:[]};
  return {
    visible:Boolean(visibleRect&&!hardStyleHidden),
    visibleRect,
    hitTested:hits.hitTested,
    hitSamples:hits.samples,
    evidence:{
      ...viewport,
      explicitHidden:styles.explicitHidden,
      inert:styles.inert,
      ariaHidden:styles.ariaHidden,
      displayNone:styles.displayNone,
      visibilityHidden:styles.visibilityHidden,
      opacityZero:styles.opacityZero,
      styleReadable:styles.styleReadable,
      clippedByContainer,
      clippedRect,
      clipAncestors:styles.clipAncestors.slice(0,12)
    }
  };
}
function pageSignals(documentRef,windowRef,describe){
  const query=selector=>{try{return [...(documentRef?.querySelectorAll?.(selector)||[])];}catch{return [];}};
  const visible=nodes=>nodes.filter(n=>{const r=n.getBoundingClientRect?.();return r&&nodeView(n,r,{documentRef,windowRef}).visible;});
  const dialogs=visible(query('[role="dialog"],[role="alertdialog"],dialog[open],tp-yt-paper-dialog[opened]')).slice(0,8).map(n=>({role:n.getAttribute?.('role')||'dialog',modal:n.getAttribute?.('aria-modal')==='true',label:describe(n)}));
  const errors=visible(query('.ytp-error-content-wrap,.ytp-error-content,[role="alert"]')).slice(0,8).map(n=>({role:n.getAttribute?.('role')||'player_error',label:describe(n)}));
  let hasFocus=null;try{if(typeof documentRef?.hasFocus==='function')hasFocus=Boolean(documentRef.hasFocus());}catch{}
  return {hasFocus,visibilityState:documentRef?.visibilityState||'unknown',dialogs,errors,browserUi:{observed:false,state:hasFocus===false?'focus_outside_document':'unknown',reason:'native_chrome_ui_outside_dom'}};
}
module.exports={finiteRect,viewportEvidence,rectIntersection,blockerDescriptor,styleEvidence,hitSamples,nodeView,pageSignals};
