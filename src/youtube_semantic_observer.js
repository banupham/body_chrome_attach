'use strict';

function cleanText(value){return String(value??'').replace(/\s+/g,' ').trim();}
function safeUrl(raw){try{return new URL(String(raw||''));}catch{return null;}}
function isYoutubeHost(host){return /(^|\.)youtube\.com$/i.test(String(host||''));}

function youtubeRoute(locationRef=globalThis.location){
  const url=safeUrl(locationRef?.href||'');
  if(!url||!isYoutubeHost(url.hostname))return {supported:false,pageType:'other',path:'/',videoId:null,listId:null,searchQueryPresent:false};
  const path=url.pathname||'/';
  let pageType='other';
  if(path==='/')pageType='home';
  else if(path==='/results')pageType='search';
  else if(path==='/watch')pageType='watch';
  else if(path.startsWith('/shorts/'))pageType='shorts';
  else if(path.startsWith('/playlist'))pageType='playlist';
  else if(path.startsWith('/feed/'))pageType='feed';
  else if(/^\/(?:@|channel\/|c\/|user\/)/.test(path))pageType='channel';
  const videoId=path.startsWith('/shorts/')?cleanText(path.split('/')[2]||''):(url.searchParams.get('v')||null);
  const listId=url.searchParams.get('list')||null;
  return {
    supported:true,
    pageType,
    path,
    videoId:videoId||null,
    listId:listId||null,
    searchQueryPresent:url.searchParams.has('search_query')
  };
}

function rectOf(node){
  try{
    const rect=node?.getBoundingClientRect?.();
    if(!rect||![rect.x,rect.y,rect.width,rect.height].every(Number.isFinite)||rect.width<=0||rect.height<=0)return null;
    return {x:rect.x,y:rect.y,width:rect.width,height:rect.height};
  }catch{return null;}
}

function isVisible(rect,windowRef=globalThis.window){
  if(!rect)return false;
  const width=Number(windowRef?.innerWidth||0),height=Number(windowRef?.innerHeight||0);
  return rect.x<width&&rect.y<height&&rect.x+rect.width>0&&rect.y+rect.height>0;
}

function firstNode(documentRef,selectors){
  for(const selector of selectors){
    try{const node=documentRef?.querySelector?.(selector);if(node)return node;}catch{}
  }
  return null;
}

function controlDescriptor(node,name,{documentRef=globalThis.document,windowRef=globalThis.window}={}){
  if(!node)return {name,available:false,visible:false,active:false,tag:null,actionRect:null};
  const rect=rectOf(node);
  return {
    name,
    available:true,
    visible:isVisible(rect,windowRef),
    active:documentRef?.activeElement===node,
    tag:cleanText(node.tagName||'').toLowerCase()||null,
    actionRect:rect
  };
}

function searchControls(documentRef=globalThis.document,windowRef=globalThis.window){
  const searchInput=firstNode(documentRef,[
    'input#search','input[name="search_query"]','ytd-searchbox input','yt-searchbox input',
    'input[placeholder*="Search"]','input[placeholder*="Tìm kiếm"]'
  ]);
  const searchButton=firstNode(documentRef,[
    'button#search-icon-legacy','ytd-searchbox button[aria-label]','yt-searchbox button[aria-label]',
    'button[aria-label*="Search"]','button[aria-label*="Tìm kiếm"]'
  ]);
  return {
    searchInput:controlDescriptor(searchInput,'search_input',{documentRef,windowRef}),
    searchButton:controlDescriptor(searchButton,'search_button',{documentRef,windowRef})
  };
}

function countSearchResults(documentRef=globalThis.document,{maxItems=100}={}){
  const limit=Math.max(1,Math.min(100,Number(maxItems)||100));
  let nodes=[];
  for(const selector of ['ytd-search ytd-video-renderer','ytd-search yt-lockup-view-model','ytd-search ytd-channel-renderer']){
    try{nodes.push(...(documentRef?.querySelectorAll?.(selector)||[]));}catch{}
    if(nodes.length>=limit)break;
  }
  const unique=new Set();
  for(const node of nodes.slice(0,limit)){
    let key='';
    try{
      const anchor=node?.querySelector?.('a[href*="/watch"],a[href*="/shorts/"],a[href*="/@"],a[href*="/channel/"]');
      key=cleanText(anchor?.getAttribute?.('href')||anchor?.href||'');
    }catch{}
    unique.add(key||`node:${unique.size}`);
  }
  return unique.size;
}

function youtubeSemanticObservation({documentRef=globalThis.document,windowRef=globalThis.window,locationRef=globalThis.location}={}){
  const route=youtubeRoute(locationRef);
  if(!route.supported)return {available:false,platform:null,observerVersion:1,reason:'unsupported_site'};
  const controls=searchControls(documentRef,windowRef);
  const searchResultCount=route.pageType==='search'?countSearchResults(documentRef):0;
  return {
    available:true,
    platform:'youtube',
    observerVersion:1,
    observedAt:Date.now(),
    privacy:{searchQueryCaptured:false,accountIdentityCaptured:false,textContentCaptured:false},
    route,
    controls,
    surfaces:route.pageType==='search'?[{surface:'search_results',itemCount:searchResultCount}]:[],
    viewport:{width:Number(windowRef?.innerWidth||0),height:Number(windowRef?.innerHeight||0)}
  };
}

module.exports={cleanText,safeUrl,isYoutubeHost,youtubeRoute,rectOf,isVisible,controlDescriptor,searchControls,countSearchResults,youtubeSemanticObservation};
