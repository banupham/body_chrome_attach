'use strict';

const {nodeView,pageSignals}=require('./dom_perception');

const WATCH_PATH_RE=/^\/(?:watch|shorts\/)/i;
const DURATION_ONLY_RE=/^(?:▶\s*)?(?:\d{1,2}:)?\d{1,2}:\d{2}(?:\s*(?:Đang phát|Now playing))?$/iu;
const NOISE_ONLY_RE=/^(?:Đang phát|Now playing|Mix|Playlist|Shorts?)$/iu;
const CARD_SELECTORS=[
  'ytd-rich-item-renderer','ytd-video-renderer','ytd-grid-video-renderer','ytd-compact-video-renderer',
  'ytd-playlist-panel-video-renderer','yt-lockup-view-model','ytm-shorts-lockup-view-model','ytd-radio-renderer','ytd-playlist-renderer'
];
const AD_CONTAINER_SELECTOR='ytd-promoted-sparkles-web-renderer,ytd-ad-slot-renderer,ytd-in-feed-ad-layout-renderer,ytd-display-ad-renderer,ytd-action-companion-ad-renderer,[is-ad],[data-ad-impressions]';
const INTERACTIVE_SELECTOR='button,a[href],input,textarea,select,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="option"],[role="slider"],[contenteditable="true"],[tabindex]:not([tabindex="-1"])';

function cleanText(value){return String(value??'').replace(/\s+/g,' ').trim();}
function textFingerprint(value){const text=cleanText(value);let hash=2166136261;for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}return {length:text.length,fnv1a32:(hash>>>0).toString(16).padStart(8,'0')};}
function safeUrl(raw,base='https://www.youtube.com/'){try{return new URL(String(raw||''),base);}catch{return null;}}
function isYoutubeHost(host){return /(^|\.)youtube\.com$/i.test(String(host||''));}
function youtubeRoute(locationRef=globalThis.location){
  const url=safeUrl(locationRef?.href||'');
  if(!url||!isYoutubeHost(url.hostname))return {supported:false,pageType:'other',path:'/',videoId:null,listId:null,isRadio:false,searchQueryPresent:false,searchQueryFingerprint:null};
  const path=url.pathname||'/';let pageType='other';
  if(path==='/')pageType='home';else if(path==='/results')pageType='search';else if(path==='/watch')pageType='watch';else if(path.startsWith('/shorts/'))pageType='shorts';else if(path.startsWith('/playlist'))pageType='playlist';else if(path.startsWith('/feed/'))pageType='feed';else if(/^\/(?:@|channel\/|c\/|user\/)/.test(path))pageType='channel';
  const videoId=path.startsWith('/shorts/')?cleanText(path.split('/')[2]||''):(cleanText(url.searchParams.get('v')||'')||null);
  const listId=cleanText(url.searchParams.get('list')||'')||null;
  const isRadio=Boolean(/^RD/i.test(String(listId||''))||url.searchParams.get('start_radio')==='1');
  const kept=new URLSearchParams();for(const key of ['v','list','index','start_radio'])if(url.searchParams.has(key))kept.set(key,url.searchParams.get(key));
  const searchQueryPresent=url.searchParams.has('search_query');
  const searchQueryFingerprint=searchQueryPresent?textFingerprint(url.searchParams.get('search_query')||''):null;
  return {supported:true,pageType,path:`${path}${kept.toString()?`?${kept.toString()}`:''}`,videoId,listId,isRadio,searchQueryPresent,searchQueryFingerprint};
}
function rectOf(node){try{const r=node?.getBoundingClientRect?.();if(!r||![r.x,r.y,r.width,r.height].every(Number.isFinite)||r.width<=0||r.height<=0)return null;return {x:r.x,y:r.y,width:r.width,height:r.height,centerX:r.x+r.width/2,centerY:r.y+r.height/2};}catch{return null;}}
function isVisible(rect,windowRef=globalThis.window){if(!rect)return false;const width=Number(windowRef?.innerWidth||0),height=Number(windowRef?.innerHeight||0);return rect.x<width&&rect.y<height&&rect.x+rect.width>0&&rect.y+rect.height>0;}
function rectIntersects(a,b){return Boolean(a&&b&&a.width>0&&a.height>0&&b.width>0&&b.height>0&&a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y);}
function firstNode(documentRef,selectors,windowRef=globalThis.window){let fallback=null;for(const selector of selectors){try{let nodes=[...(documentRef?.querySelectorAll?.(selector)||[])];if(!nodes.length){const node=documentRef?.querySelector?.(selector);if(node)nodes=[node];}for(const node of nodes){fallback=fallback||node;if(nodeView(node,rectOf(node),{documentRef,windowRef}).visible)return node;}}catch{}}return fallback;}
function editableSelection(node,documentRef=globalThis.document){
  if(!node)return {available:false,active:false,collapsed:true,fullSelection:false,start:null,end:null,direction:null,valueLength:0,selectedLength:0};
  const active=documentRef?.activeElement===node,value=String(node?.value??''),valueLength=value.length;let start=null,end=null,direction=null;
  try{if(Number.isInteger(node.selectionStart)&&Number.isInteger(node.selectionEnd)){start=Number(node.selectionStart);end=Number(node.selectionEnd);direction=cleanText(node.selectionDirection||'')||null;}}catch{}
  const available=Number.isInteger(start)&&Number.isInteger(end),selectedLength=available?Math.max(0,end-start):0;
  return {available,active,collapsed:!available||selectedLength===0,fullSelection:Boolean(available&&valueLength>0&&start===0&&end===valueLength),start,end,direction,valueLength,selectedLength};
}
function documentSelection(documentRef=globalThis.document){
  try{const selection=documentRef?.getSelection?.();if(!selection)return {available:false,collapsed:true,selectedLength:0,textFingerprint:textFingerprint('')};const text=String(selection.toString?.()||''),selectedLength=text.length;return {available:true,collapsed:Boolean(selection.isCollapsed||selectedLength===0),rangeCount:Number(selection.rangeCount||0),selectedLength,textFingerprint:textFingerprint(text)};}catch{return {available:false,collapsed:true,selectedLength:0,textFingerprint:textFingerprint('')};}
}
function controlDescriptor(node,name,{documentRef=globalThis.document,windowRef=globalThis.window,valueFingerprint=false}={}){
  if(!node)return {name,available:false,visible:false,active:false,tag:null,actionRect:null,...(valueFingerprint?{valueFingerprint:textFingerprint(''),selection:editableSelection(null,documentRef)}:{})};
  const rect=rectOf(node),view=nodeView(node,rect,{documentRef,windowRef}),out={name,available:true,...view,active:documentRef?.activeElement===node,tag:cleanText(node.tagName||'').toLowerCase()||null,actionRect:rect};
  if(valueFingerprint){out.valueFingerprint=textFingerprint(node?.value||'');out.selection=editableSelection(node,documentRef);}return out;
}
function searchControls(documentRef=globalThis.document,windowRef=globalThis.window){
  const searchInput=firstNode(documentRef,['input#search','input[name="search_query"]','ytd-searchbox input','yt-searchbox input','input[placeholder*="Search"]','input[placeholder*="Tìm kiếm"]'],windowRef);
  const searchButton=firstNode(documentRef,['button#search-icon-legacy','ytd-searchbox button[aria-label]','yt-searchbox button[aria-label]','button[aria-label*="Search"]','button[aria-label*="Tìm kiếm"]'],windowRef);
  const homeLink=firstNode(documentRef,['ytd-topbar-logo-renderer a[href="/"]','a#logo[href="/"]','a[title="YouTube Home"]','a[aria-label="YouTube Home"]'],windowRef);
  return {searchInput:controlDescriptor(searchInput,'search_input',{documentRef,windowRef,valueFingerprint:true}),searchButton:controlDescriptor(searchButton,'search_button',{documentRef,windowRef}),homeLink:controlDescriptor(homeLink,'home_link',{documentRef,windowRef})};
}
function attr(node,name){try{return cleanText(node?.getAttribute?.(name)||'');}catch{return '';}}
function accessibleLabel(node){
  for(const value of [attr(node,'aria-label'),attr(node,'title'),attr(node,'placeholder'),attr(node,'alt'),attr(node,'data-tooltip-text'),attr(node,'data-title')])if(value)return value.slice(0,180);
  const text=cleanText(node?.textContent||'');return text?text.slice(0,180):null;
}
function linkDescriptor(node){
  const raw=attr(node,'href')||cleanText(node?.href||'');if(!raw)return null;const url=safeUrl(raw);if(!url)return null;
  const kept=new URLSearchParams();if(isYoutubeHost(url.hostname))for(const key of ['v','list','index','start_radio'])if(url.searchParams.has(key))kept.set(key,url.searchParams.get(key));
  return {host:url.hostname,path:`${url.pathname||'/'}${kept.toString()?`?${kept.toString()}`:''}`,youtube:isYoutubeHost(url.hostname)};
}
function interactiveAffordances(documentRef=globalThis.document,windowRef=globalThis.window,{maxItems=100}={}){
  let nodes=[];try{nodes=[...(documentRef?.querySelectorAll?.(INTERACTIVE_SELECTOR)||[])];}catch{}
  const out=[],seen=new Set(),limit=Math.max(1,Math.min(180,Number(maxItems)||100));
  for(const node of nodes){
    if(seen.has(node))continue;seen.add(node);const rect=rectOf(node),view=nodeView(node,rect,{documentRef,windowRef});if(!view.visible)continue;
    const tag=cleanText(node?.tagName||'').toLowerCase(),role=attr(node,'role')||null,type=attr(node,'type')||null,editable=tag==='input'||tag==='textarea'||attr(node,'contenteditable')==='true',label=accessibleLabel(node),link=linkDescriptor(node);
    let disabled=false,checked=null,selected=null,expanded=null,pressed=null;
    try{disabled=Boolean(node.disabled)||attr(node,'aria-disabled')==='true';checked=typeof node.checked==='boolean'?node.checked:(attr(node,'aria-checked')||null);selected=typeof node.selected==='boolean'?node.selected:(attr(node,'aria-selected')||null);expanded=attr(node,'aria-expanded')||null;pressed=attr(node,'aria-pressed')||null;}catch{}
    let sponsored=false;try{sponsored=Boolean(node.closest?.(AD_CONTAINER_SELECTOR));}catch{}
    out.push({index:out.length+1,...view,sponsored,tag,role,type,editable:editable&&type!=='password',disabled,label,labelFingerprint:textFingerprint(label||''),link,active:documentRef?.activeElement===node,state:{checked,selected,expanded,pressed,valueNow:attr(node,'aria-valuenow')||null,...(editable&&type!=='password'?{valueFingerprint:textFingerprint(node.value||''),selection:editableSelection(node,documentRef)}: {})},actionRect:rect});
    if(out.length>=limit)break;
  }
  return out;
}
function countNodes(documentRef,selector){try{return Number(documentRef?.querySelectorAll?.(selector)?.length||0);}catch{return 0;}}
function visibleAdMarker(node,playerRect,windowRef){
  const rect=rectOf(node);if(!isVisible(rect,windowRef)||!rectIntersects(rect,playerRect))return false;
  try{
    if(node.hidden||node.closest?.('[hidden], [aria-hidden="true"]'))return false;
    const style=windowRef?.getComputedStyle?.(node);
    if(style&&(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||Number(style.opacity)===0))return false;
  }catch{return false;}
  return true;
}
function advertisingObservation(documentRef=globalThis.document,windowRef=globalThis.window){
  const player=firstNode(documentRef,['#movie_player','.html5-video-player','ytd-player #container'],windowRef);let classAd=false;try{classAd=Boolean(player?.classList?.contains?.('ad-showing')||player?.classList?.contains?.('ad-interrupting'));}catch{}
  // A persistent module or a sponsored feed card is not evidence of a playing ad.
  const playerRect=rectOf(player),adMarker=['.ytp-ad-player-overlay','.ytp-ad-text','.ytp-ad-preview-container'].some(selector=>{
    let nodes=[];try{nodes=[...(player?.querySelectorAll?.(selector)||[])];}catch{}
    return nodes.some(node=>visibleAdMarker(node,playerRect,windowRef));
  });
  const skipButton=firstNode(documentRef,['button.ytp-skip-ad-button','.ytp-skip-ad-button','button.ytp-ad-skip-button-modern','.ytp-ad-skip-button-modern','button.ytp-ad-skip-button','.ytp-ad-skip-button','button[aria-label*="Skip"]','button[aria-label*="skip"]','button[aria-label*="Bỏ qua"]','button[aria-label*="bỏ qua"]'],windowRef);
  const skip=controlDescriptor(skipButton,'ad_skip_button',{documentRef,windowRef});const playingAd=Boolean(classAd||adMarker),feedAdCount=countNodes(documentRef,AD_CONTAINER_SELECTOR);
  return {playingAd,skippable:Boolean(playingAd&&skip.available&&skip.visible),skipButton:skip,feedAdCount};
}
function countSearchResults(documentRef=globalThis.document,{maxItems=100}={}){
  const limit=Math.max(1,Math.min(100,Number(maxItems)||100));let nodes=[];
  for(const selector of ['ytd-search ytd-video-renderer','ytd-search yt-lockup-view-model','ytd-search ytd-channel-renderer']){try{nodes.push(...(documentRef?.querySelectorAll?.(selector)||[]));}catch{}if(nodes.length>=limit)break;}
  const unique=new Set();for(const node of nodes.slice(0,limit)){let key='';try{const anchor=node?.querySelector?.('a[href*="/watch"],a[href*="/shorts/"],a[href*="/@"],a[href*="/channel/"]');key=cleanText(anchor?.getAttribute?.('href')||anchor?.href||'');}catch{}unique.add(key||`node:${unique.size}`);}return unique.size;
}
function isDurationOnly(value){const text=cleanText(value);return !text||DURATION_ONLY_RE.test(text)||NOISE_ONLY_RE.test(text);}
function stripDurationNoise(value){return cleanText(value).replace(/^(?:▶\s*)?(?:(?:\d{1,2}:)?\d{1,2}:\d{2}\s*){1,2}(?:Đang phát\s*)?/iu,'').trim();}
function uniqueStrings(values){const out=[],seen=new Set();for(const value of values){const text=cleanText(value);if(!text||seen.has(text))continue;seen.add(text);out.push(text);}return out;}
function closestCard(anchor){for(const selector of CARD_SELECTORS){try{const card=anchor?.closest?.(selector);if(card)return card;}catch{}}return anchor?.parentElement||anchor||null;}
function titleCandidates(card,anchor){
  const rows=[],push=(value,weight,source)=>{const text=stripDurationNoise(value);if(!text||isDurationOnly(text))return;rows.push({text,weight,source});};push(anchor?.getAttribute?.('title'),120,'anchor.title');push(anchor?.getAttribute?.('aria-label'),110,'anchor.aria-label');
  for(const selector of ['#video-title','a#video-title','yt-formatted-string#video-title','.yt-lockup-metadata-view-model__title','.yt-lockup-metadata-view-model__title span','h3 a[href*="/watch"]','h3 a[href*="/shorts/"]','h3','[data-title]']){let nodes=[];try{nodes=[...(card?.querySelectorAll?.(selector)||[])];}catch{}for(const node of nodes){push(node.getAttribute?.('title'),115,`${selector}.title`);push(node.getAttribute?.('aria-label'),108,`${selector}.aria-label`);push(node.getAttribute?.('data-title'),105,`${selector}.data-title`);push(node.textContent,selector.includes('video-title')?100:82,`${selector}.text`);}}
  let parent=anchor?.parentElement||null;for(let depth=0;parent&&depth<4;depth++,parent=parent.parentElement){push(parent.getAttribute?.('aria-label'),92-depth,'ancestor.aria-label');push(parent.getAttribute?.('title'),88-depth,'ancestor.title');}return rows;
}
function chooseSemanticTitle(card,anchor){const rows=titleCandidates(card,anchor);if(!rows.length)return {title:null,titleSource:null,semantic:false};rows.sort((a,b)=>(b.weight+Math.min(50,b.text.length/2)-(b.text.length<6?30:0))-(a.weight+Math.min(50,a.text.length/2)-(a.text.length<6?30:0)));return {title:rows[0].text,titleSource:rows[0].source,semantic:true};}
function candidateFromAnchor(anchor,surface,position,{windowRef=globalThis.window,documentRef=anchor?.ownerDocument||globalThis.document}={}){
  const href=anchor?.getAttribute?.('href')||anchor?.href||'',url=safeUrl(href);if(!url||!isYoutubeHost(url.hostname)||!WATCH_PATH_RE.test(url.pathname||''))return null;
  const path=url.pathname||'',videoId=path.startsWith('/shorts/')?cleanText(path.split('/')[2]||''):cleanText(url.searchParams.get('v')||'');if(!videoId)return null;
  const card=closestCard(anchor),semantic=chooseSemanticTitle(card,anchor),listId=cleanText(url.searchParams.get('list')||''),isRadio=/^RD/i.test(listId)||url.searchParams.get('start_radio')==='1',actionRect=rectOf(anchor)||rectOf(card);
  const channelNodes=[];for(const selector of ['#channel-name','ytd-channel-name','.yt-lockup-metadata-view-model__metadata','[class*="channel-name"]']){try{channelNodes.push(...(card?.querySelectorAll?.(selector)||[]));}catch{}}const channel=uniqueStrings(channelNodes.map(n=>n.textContent))[0]||null;
  const metadataNodes=[];for(const selector of ['#metadata-line span','#metadata span','.inline-metadata-item','.yt-content-metadata-view-model__metadata-text']){try{metadataNodes.push(...(card?.querySelectorAll?.(selector)||[]));}catch{}}const metadata=uniqueStrings(metadataNodes.map(n=>n.textContent)).slice(0,8);
  const kept=new URLSearchParams();for(const key of ['v','list','index','start_radio'])if(url.searchParams.has(key))kept.set(key,url.searchParams.get(key));
  const view=nodeView(anchor,actionRect,{documentRef,windowRef}),representation={...view,actionRect};
  return {surface,position,videoId,listId:listId||null,isRadio,path:`${path}${kept.toString()?`?${kept.toString()}`:''}`,title:semantic.title,titleSource:semantic.titleSource,semanticTitle:semantic.semantic,channel,metadata,...view,actionRect,representationCount:1,representations:[representation]};
}
function rootsForSurface(documentRef,surface){const selectors={channel_feed:['ytd-browse[page-subtype="channels"]','ytd-browse[page-subtype="channel"]','ytd-browse'],home_feed:['ytd-browse[page-subtype="home"] ytd-rich-grid-renderer','ytd-browse[page-subtype="home"] #contents','ytd-browse[page-subtype="home"]','ytd-rich-grid-renderer'],search_results:['ytd-search #contents','ytd-search'],related:['#related','#secondary-inner','ytd-watch-next-secondary-results-renderer','#secondary'],mix_queue:['ytd-playlist-panel-renderer'],history_feed:['ytd-browse[page-subtype="history"] #contents','ytd-browse[page-subtype="history"]','ytd-browse #contents','ytd-section-list-renderer #contents']}[surface]||[];for(const selector of selectors){try{const root=documentRef?.querySelector?.(selector);if(root)return {root,rootSelector:selector};}catch{}}return {root:null,rootSelector:null};}
function anchorsIn(root,surface){if(!root)return [];let anchors=[];try{anchors=[...root.querySelectorAll('a[href*="/watch"], a[href*="/shorts/"]')];}catch{}anchors=anchors.filter(a=>{try{return !a.closest(AD_CONTAINER_SELECTOR);}catch{return true;}});if(surface==='related')anchors=anchors.filter(a=>{try{return !a.closest('ytd-playlist-panel-renderer');}catch{return true;}});return anchors;}
function extractSurface(documentRef,surface,{windowRef=globalThis.window,maxItems=50}={}){
  const {root,rootSelector}=rootsForSurface(documentRef,surface),rootRect=rectOf(root),anchors=anchorsIn(root,surface),items=[],seen=new Set(),limit=Math.max(1,Math.min(100,Number(maxItems)||50));
  for(const anchor of anchors){const item=candidateFromAnchor(anchor,surface,items.length+1,{windowRef,documentRef});if(!item)continue;if(seen.has(item.videoId)){const previous=items.findIndex(row=>row.videoId===item.videoId),prior=items[previous],mergedRepresentations=[...(prior.representations||[]),...(item.representations||[])].slice(0,8);items[previous]={...prior,position:prior.position,representationCount:Number(prior.representationCount||1)+1,representations:mergedRepresentations};continue;}seen.add(item.videoId);item.position=items.length+1;if(surface==='mix_queue'&&rootRect&&item.actionRect)item.visible=item.visible&&rectIntersects(item.actionRect,rootRect);items.push(item);if(items.length>=limit)break;}
  const semanticCount=items.filter(x=>x.semanticTitle&&x.title).length;return {surface,itemCount:items.length,scrollRect:surface==='mix_queue'?rootRect:null,diagnostics:{rootSelector,candidateAnchors:anchors.length,extractedItems:items.length,semanticTitleItems:semanticCount,semanticCoverage:items.length?semanticCount/items.length:0,extractorVersion:10},items};
}
function currentVideoDescriptor(documentRef,route){if(!route?.videoId)return null;const titleNode=firstNode(documentRef,['ytd-watch-metadata h1 yt-formatted-string','ytd-watch-metadata h1','#title h1 yt-formatted-string','#title h1','h1.title']),channelNode=firstNode(documentRef,['ytd-watch-metadata ytd-channel-name','#owner ytd-channel-name','#channel-name']);let title=stripDurationNoise(titleNode?.textContent||'');if(!title||isDurationOnly(title)){const docTitle=cleanText(documentRef?.title||'').replace(/\s*-\s*YouTube\s*$/i,'').trim();if(docTitle&&!isDurationOnly(docTitle))title=docTitle;}return {videoId:route.videoId,listId:route.listId||null,isRadio:route.isRadio===true,title:title||null,semanticTitle:Boolean(title),channel:cleanText(channelNode?.textContent||'')||null,metadata:[]};}
function previewSurface(route){if(route?.pageType==='search')return 'search_results';if(route?.pageType==='home')return 'home_feed';if(['watch','shorts'].includes(route?.pageType))return 'related';return route?.pageType||'unknown';}
function previewObservation(documentRef=globalThis.document,windowRef=globalThis.window,route={}){
  let videos=[];try{videos=[...(documentRef?.querySelectorAll?.('video')||[])];}catch{}
  for(const video of videos){
    let mainPlayer=false;try{mainPlayer=Boolean(video?.closest?.('#movie_player,.html5-video-player,ytd-player'));}catch{}if(mainPlayer)continue;
    const rect=rectOf(video);if(!nodeView(video,rect,{documentRef,windowRef}).visible)continue;
    const currentTime=Number(video?.currentTime||0),duration=Number(video?.duration||0),readyState=Number(video?.readyState||0);if(Boolean(video?.paused)||Boolean(video?.ended)||readyState<2||currentTime<=0)continue;
    const card=closestCard(video);let anchor=null;try{anchor=card?.querySelector?.('a[href*="/watch"],a[href*="/shorts/"]')||video?.closest?.('a[href*="/watch"],a[href*="/shorts/"]');}catch{}if(!anchor)continue;
    const raw=anchor?.getAttribute?.('href')||anchor?.href||'',url=safeUrl(raw);if(!url||!isYoutubeHost(url.hostname))continue;const path=url.pathname||'',videoId=path.startsWith('/shorts/')?cleanText(path.split('/')[2]||''):cleanText(url.searchParams.get('v')||'');if(!videoId)continue;
    return {active:true,playing:true,videoId,surface:previewSurface(route),currentTime:Number(currentTime.toFixed(3)),duration:Number.isFinite(duration)&&duration>0?Number(duration.toFixed(3)):null,muted:Boolean(video?.muted),volume:Number.isFinite(Number(video?.volume))?Number(video.volume):null,actionRect:rect};
  }
  return {active:false,playing:false,videoId:null,surface:previewSurface(route),currentTime:0,duration:null,muted:null,volume:null,actionRect:null};
}
function signedInState(documentRef){try{if(documentRef?.querySelector?.('a[href*="accounts.google.com/ServiceLogin"], a[href*="ServiceLogin"]'))return 'signed_out';if(documentRef?.querySelector?.('button#avatar-btn, ytd-topbar-menu-button-renderer button#avatar-btn'))return 'signed_in';}catch{}return 'unknown';}
function viewportState(documentRef,windowRef){const docEl=documentRef?.documentElement||{},body=documentRef?.body||{};return {width:Number(windowRef?.innerWidth||0),height:Number(windowRef?.innerHeight||0),scrollX:Number(windowRef?.scrollX||windowRef?.pageXOffset||0),scrollY:Number(windowRef?.scrollY||windowRef?.pageYOffset||0),documentHeight:Math.max(Number(docEl.scrollHeight||0),Number(body.scrollHeight||0),Number(windowRef?.innerHeight||0))};}
function youtubeSemanticObservation({documentRef=globalThis.document,windowRef=globalThis.window,locationRef=globalThis.location,maxItems=50}={}){
  const route=youtubeRoute(locationRef);if(!route.supported)return {available:false,platform:null,observerVersion:9,reason:'unsupported_site'};
  const controls=searchControls(documentRef,windowRef),advertising=advertisingObservation(documentRef,windowRef),surfaces=[];
  if(route.pageType==='channel')surfaces.push(extractSurface(documentRef,'channel_feed',{windowRef,maxItems}));
  if(route.pageType==='home')surfaces.push(extractSurface(documentRef,'home_feed',{windowRef,maxItems}));
  if(route.pageType==='search'){const surface=extractSurface(documentRef,'search_results',{windowRef,maxItems});surface.itemCount=Math.max(surface.itemCount,countSearchResults(documentRef,{maxItems:100}));surfaces.push(surface);}
  if(['watch','shorts'].includes(route.pageType)){surfaces.push(extractSurface(documentRef,'related',{windowRef,maxItems}));surfaces.push(extractSurface(documentRef,'mix_queue',{windowRef,maxItems}));}
  if(route.pageType==='feed'&&/^\/feed\/history(?:$|[?\/])/i.test(route.path||''))surfaces.push(extractSurface(documentRef,'history_feed',{windowRef,maxItems:Math.max(80,maxItems)}));
  const affordances=interactiveAffordances(documentRef,windowRef,{maxItems:120}),preview=previewObservation(documentRef,windowRef,route);
  return {available:true,platform:'youtube',observerVersion:9,observedAt:Date.now(),privacy:{searchQueryCaptured:false,searchQueryFingerprintCaptured:true,accountIdentityCaptured:false,textContentCaptured:false,candidateSemanticTextCaptured:true,genericAffordanceLabelsCaptured:true,inputValuesCaptured:false,selectionTextCaptured:false,selectionFingerprintCaptured:true,watchHistorySurfaceCaptured:surfaces.some(x=>x.surface==='history_feed'),hoverPreviewPlaybackCaptured:true},route,currentVideo:currentVideoDescriptor(documentRef,route),signedInState:signedInState(documentRef),controls,selection:documentSelection(documentRef),advertising,preview,affordances,scene:pageSignals(documentRef,windowRef,accessibleLabel),surfaces,viewport:viewportState(documentRef,windowRef)};
}

module.exports={CARD_SELECTORS,AD_CONTAINER_SELECTOR,INTERACTIVE_SELECTOR,cleanText,textFingerprint,safeUrl,isYoutubeHost,youtubeRoute,rectOf,isVisible,editableSelection,documentSelection,controlDescriptor,searchControls,accessibleLabel,linkDescriptor,interactiveAffordances,advertisingObservation,countSearchResults,isDurationOnly,stripDurationNoise,chooseSemanticTitle,candidateFromAnchor,extractSurface,currentVideoDescriptor,previewObservation,viewportState,youtubeSemanticObservation};
