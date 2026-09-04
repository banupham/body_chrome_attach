'use strict';

const {YouTubeEnrichedTopicTransitionRunner}=require('./youtube_enriched_runner');
const {surfaceItems,surfaceScrollPoint,findCandidate,usableSeedCandidate,semanticArrivalReady}=require('./topic_transition_runner');
const {queryEvidence}=require('./search_exposure_runner');
const {replaceSearchQuery}=require('./youtube_search_input');

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,Math.max(0,Number(ms)||0)));
const clean=value=>String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim();
const fold=value=>clean(value).toLowerCase().normalize('NFD').replace(/\p{M}+/gu,'').replace(/đ/g,'d');
const number=value=>Number.isFinite(Number(value))?Number(value):null;
const uniq=values=>[...new Set((values||[]).map(x=>clean(x)).filter(Boolean))];

function tokenSet(value){return new Set(fold(value).split(/[^\p{L}\p{N}+#._-]+/gu).filter(x=>x.length>=2));}
function intersection(a,b,limit=30){const aa=new Set((a||[]).map(fold).filter(Boolean)),bb=new Set((b||[]).map(fold).filter(Boolean)),out=[];for(const x of aa)if(bb.has(x)){out.push(x);if(out.length>=limit)break;}return out;}
function tokenIntersection(a,b,limit=30){const aa=tokenSet(a),bb=tokenSet(b),out=[];for(const x of aa)if(bb.has(x)){out.push(x);if(out.length>=limit)break;}return out;}
function ageHours(iso,at=Date.now()){const ts=Date.parse(String(iso||''));return Number.isFinite(ts)?Math.max(0,(Number(at)-ts)/3600000):null;}
function apiOf(node){return node?.youtubeApi||node||null;}
function keywordTerms(api){return uniq((api?.keywords||[]).map(x=>x?.term||x));}
function channelKeywords(api){return uniq(api?.channel?.keywords||[]);}
function topicLabels(api){return uniq(api?.topicLabels||[]);}
function channelTopics(api){return uniq(api?.channel?.topicLabels||[]);}
function viewsPerHour(api,at=Date.now()){const views=number(api?.statistics?.viewCount),age=ageHours(api?.publishedAt,at);return views!=null&&age!=null?Number((views/Math.max(age,1/60)).toFixed(2)):null;}

function publicFactorComparison(sourceNode,targetNode,at=Date.now()){
  const source=apiOf(sourceNode)||{},target=apiOf(targetNode)||{};
  const sharedTags=intersection(source.tags,target.tags);
  const sharedKeywords=intersection(keywordTerms(source),keywordTerms(target));
  const sharedTopics=intersection(topicLabels(source),topicLabels(target));
  const sharedChannelKeywords=intersection(channelKeywords(source),channelKeywords(target));
  const sharedChannelTopics=intersection(channelTopics(source),channelTopics(target));
  const sharedTitleTokens=tokenIntersection(source.title,target.title);
  const sameCategory=Boolean(source.categoryId&&target.categoryId&&String(source.categoryId)===String(target.categoryId));
  const sourceLanguage=source.defaultAudioLanguage||source.defaultLanguage||null,targetLanguage=target.defaultAudioLanguage||target.defaultLanguage||null;
  const sameLanguage=Boolean(sourceLanguage&&targetLanguage&&String(sourceLanguage).toLowerCase()===String(targetLanguage).toLowerCase());
  const sourceCountry=source.channel?.country||null,targetCountry=target.channel?.country||null;
  const sameCountry=Boolean(sourceCountry&&targetCountry&&String(sourceCountry).toUpperCase()===String(targetCountry).toUpperCase());
  const sameChannel=Boolean(source.channelId&&target.channelId&&String(source.channelId)===String(target.channelId));
  const publicAffinityScore=Number((
    sharedTags.length*3+
    sharedKeywords.length*2+
    sharedTopics.length*3+
    sharedChannelKeywords.length*1.2+
    sharedChannelTopics.length*1.5+
    Math.min(sharedTitleTokens.length,6)*0.45+
    Number(sameCategory)*1.5+
    Number(sameLanguage)*0.35+
    Number(sameCountry)*0.2+
    Number(sameChannel)*5
  ).toFixed(3));
  return {
    sharedTags,sharedKeywords,sharedTopics,sharedChannelKeywords,sharedChannelTopics,sharedTitleTokens,
    sameCategory,sameLanguage,sameCountry,sameChannel,
    sourceCategoryId:source.categoryId||null,targetCategoryId:target.categoryId||null,
    sourceLanguage,targetLanguage,sourceCountry,targetCountry,
    sourceVideoAgeHours:ageHours(source.publishedAt,at),targetVideoAgeHours:ageHours(target.publishedAt,at),
    sourceViews:number(source.statistics?.viewCount),targetViews:number(target.statistics?.viewCount),
    sourceViewsPerHour:viewsPerHour(source,at),targetViewsPerHour:viewsPerHour(target,at),
    sourceChannelSubscribers:number(source.channel?.statistics?.subscriberCount),targetChannelSubscribers:number(target.channel?.statistics?.subscriberCount),
    sourceChannelVideoCount:number(source.channel?.statistics?.videoCount),targetChannelVideoCount:number(target.channel?.statistics?.videoCount),
    publicAffinityScore,heuristicOnly:true,
    interpretationBoundary:'Public metadata affinity is a BODY research heuristic. YouTube does not expose recommendation feature weights or the causal reason for an Up Next/Related rank.'
  };
}

function compactNode(node,at=Date.now()){
  if(!node)return null;const api=apiOf(node)||{};
  return {
    videoId:node.videoId||api.videoId||null,title:api.title||node.title||null,channelTitle:api.channelTitle||node.channel||null,
    surface:node.surface||null,position:Number(node.position||0)||null,path:node.path||null,isRadio:node.isRadio===true,
    publishedAt:api.publishedAt||null,videoAgeHours:ageHours(api.publishedAt,at),categoryId:api.categoryId||null,
    tags:uniq(api.tags).slice(0,40),keywords:(api.keywords||[]).slice(0,24),topicLabels:topicLabels(api),
    statistics:api.statistics||{},viewsPerHour:viewsPerHour(api,at),
    channel:api.channel?{channelId:api.channel.channelId||null,title:api.channel.title||null,publishedAt:api.channel.publishedAt||null,channelAgeHours:ageHours(api.channel.publishedAt,at),country:api.channel.country||null,keywords:channelKeywords(api).slice(0,30),topicLabels:channelTopics(api),statistics:api.channel.statistics||{}}:null
  };
}

function canonicalSurfaceRows(obs,surfaces=['related','mix_queue']){
  const allowed=new Set(surfaces),byKey=new Map();
  for(const row of surfaceItems(obs).filter(x=>x?.videoId&&allowed.has(x.surface)&&x.semanticTitle!==false)){
    const key=`${row.surface}:${row.videoId}`,old=byKey.get(key);
    if(!old||Number(row.position||9999)<Number(old.position||9999))byKey.set(key,row);
  }
  return [...byKey.values()].sort((a,b)=>{
    const sa=a.surface==='related'?0:1,sb=b.surface==='related'?0:1;
    return sa-sb||Number(a.position||9999)-Number(b.position||9999);
  });
}
function canonicalSearchRows(obs){
  const byId=new Map();
  for(const row of surfaceItems(obs).filter(x=>x?.videoId&&x.surface==='search_results'&&x.semanticTitle!==false)){
    const id=String(row.videoId),old=byId.get(id);if(!old||Number(row.position||9999)<Number(old.position||9999))byId.set(id,row);
  }
  return [...byId.values()].sort((a,b)=>Number(a.position||9999)-Number(b.position||9999));
}
function usableWatchCandidate(row){return usableSeedCandidate(row)&&row.isRadio!==true&&String(row.path||'').startsWith('/watch');}
function targetNode(api){return {videoId:api?.videoId||null,title:api?.title||null,semanticTitle:true,youtubeApi:api};}

function chooseNaturalNext(rows,visited){
  const usable=rows.filter(x=>usableWatchCandidate(x)&&!visited.has(String(x.videoId)));
  return usable.sort((a,b)=>Number(a.position||9999)-Number(b.position||9999))[0]||null;
}
function chooseMetadataBridge(rows,trackApi,visited){
  const track=targetNode(trackApi);
  const scored=rows.filter(x=>usableWatchCandidate(x)&&!visited.has(String(x.videoId)))
    .map(row=>({row,factors:publicFactorComparison(row,track)}))
    .sort((a,b)=>b.factors.publicAffinityScore-a.factors.publicAffinityScore||Number(a.row.position||9999)-Number(b.row.position||9999));
  return scored[0]||null;
}

function factorFrequency(exposures,key){
  const counts=new Map();for(const edge of exposures)for(const value of edge?.factors?.[key]||[])counts.set(value,(counts.get(value)||0)+1);
  return [...counts.entries()].map(([value,count])=>({value,count})).sort((a,b)=>b.count-a.count||a.value.localeCompare(b.value)).slice(0,30);
}
function summarizeRuns(runs){
  const exposures=[];
  for(const run of runs||[])for(const branch of run.branches||[])for(const hop of branch.hops||[])if(hop.targetExposure?.seen)exposures.push({query:run.query,seedVideoId:branch.seedVideoId,branchMode:branch.branchMode,depth:hop.depth,sourceVideoId:hop.sourceVideoId,surface:hop.targetExposure.surface,rank:hop.targetExposure.rank,factors:hop.targetExposure.edgeFactors});
  return {
    observedTargetEdgeCount:exposures.length,
    observedTargetEdges:exposures,
    sharedTagsAcrossObservedEdges:factorFrequency(exposures,'sharedTags'),
    sharedKeywordsAcrossObservedEdges:factorFrequency(exposures,'sharedKeywords'),
    sharedTopicsAcrossObservedEdges:factorFrequency(exposures,'sharedTopics'),
    sharedChannelKeywordsAcrossObservedEdges:factorFrequency(exposures,'sharedChannelKeywords'),
    sharedChannelTopicsAcrossObservedEdges:factorFrequency(exposures,'sharedChannelTopics')
  };
}

class HeadKeywordNextRunner extends YouTubeEnrichedTopicTransitionRunner{
  constructor(config,client=null,options={}){
    super(config,client,options);this.environmentCondition=null;this.pristineEvidence=null;this.trackedVideoApi=null;this.trackedVideoHistory=[];this.headKeywordRuns=[];
  }
  async createTask(){
    const task=await this.req('TASK_CREATE',{task:{taskId:this.taskId,browserInstanceId:this.browser.browserInstanceId,primaryTabId:this.tabId,tabIds:[this.tabId],capability:'youtube.content_discovery',policyClass:'SAFE_AUTO',internalOnly:true,goal:{capability:'youtube.content_discovery',experimentId:this.experimentId,mode:'head_keyword_next_video_discovery',headQueries:this.config.headQueries,trackVideoId:this.config.trackVideoId}}});
    if(task.state==='READY')await this.req('TASK_START',{taskId:this.taskId});await this.req('TAB_SWITCH',{taskId:this.taskId,tabId:this.tabId});
  }
  captureEnvironment(){const e=this.browser?.environment||{};this.environmentCondition={browserInstanceId:this.browser?.browserInstanceId||null,extensionInstanceId:this.browser?.extensionInstanceId||null,publicIp:e.publicIp||null,environmentSignature:e.environmentSignature||null,status:e.status||null,eligible:e.eligible===true,reasons:Array.isArray(e.reasons)?e.reasons:[]};}
  async validatePristine(){
    const obs=await this.observe('head_next_pristine_preflight'),tabs=this.browser?.tabs||[],yt=tabs.filter(x=>String(x.siteKey||'').includes('youtube.com')),pass=obs?.signedInState==='signed_out'&&tabs.length<=2&&yt.length===1;
    this.pristineEvidence={requested:this.config.requirePristine!==false,pass,signedInState:obs?.signedInState||null,tabCount:tabs.length,youtubeTabCount:yt.length,pageType:obs?.route?.pageType||null};
    this.log('pristine_browser_check',this.pristineEvidence);if(this.config.requirePristine!==false&&!pass)throw new Error(`pristine_browser_required:signedIn=${this.pristineEvidence.signedInState}:tabs=${tabs.length}:youtubeTabs=${yt.length}`);return obs;
  }
  async loadTrackedVideo({refresh=false}={}){
    if(!this.youtubeEnricher.enabled)throw new Error('youtube_data_api_required_for_head_keyword_next');const id=String(this.config.trackVideoId||'');if(!id)throw new Error('track_video_id_required');
    if(refresh){const old=this.youtubeEnricher.videoCache.get(id),channelId=old?.channelId||this.trackedVideoApi?.channelId||null;this.youtubeEnricher.videoCache.delete(id);if(channelId)this.youtubeEnricher.channelCache.delete(String(channelId));}
    const api=(await this.youtubeEnricher.enrichVideoIds([id])).get(id)||null;if(!api)throw new Error(`tracked_video_not_public_or_api_missing:${id}`);this.trackedVideoApi=api;
    const at=Date.now(),row={at,atIso:new Date(at).toISOString(),video:compactNode(targetNode(api),at)};this.trackedVideoHistory.push(row);this.log('tracked_video_metadata',{videoId:id,title:api.title||null,videoAgeHours:row.video.videoAgeHours,viewCount:row.video.statistics?.viewCount||null,subscriberCount:row.video.channel?.statistics?.subscriberCount||null,channelVideoCount:row.video.channel?.statistics?.videoCount||null});return api;
  }
  async openHeadSearch(query,{reason='head_search'}={}){
    let obs=await this.observe(`${reason}_initial`);if(obs.route?.pageType!=='home')obs=await this.goHome(`${reason}_home`);
    if(!obs.controls?.searchInput?.actionRect)obs=await this.waitFor(o=>Boolean(o.controls?.searchInput?.actionRect),{timeoutMs:8000,reason:`${reason}_control`});
    const intents=await replaceSearchQuery(this,obs.controls.searchInput,query);this.log('search_query_replaced',{query,intentTypes:intents.map(x=>x.type),clearSequence:['Control+a','Backspace']});
    return this.waitFor(o=>o.route?.pageType==='search'&&canonicalSearchRows(o).length>0,{timeoutMs:12000,intervalMs:300,reason:`${reason}_results`});
  }
  async collectSearchSeeds(query){
    let obs=await this.openHeadSearch(query,{reason:`head_${fold(query).slice(0,24)}`});const seen=new Map();
    for(let pass=0;pass<=this.config.searchSeedScrolls;pass++){
      if(pass)obs=await this.observe(`head_seed_scan_${pass}`);for(const row of canonicalSearchRows(obs)){const id=String(row.videoId),old=seen.get(id);if(!old||Number(row.position||9999)<Number(old.position||9999))seen.set(id,row);}
      const preferred=[...seen.values()].filter(usableWatchCandidate);if(preferred.length>=this.config.seedCount||pass>=this.config.searchSeedScrolls)break;
      const p=surfaceScrollPoint(obs,'search_results');await this.intent({type:'moveTo',x:p.x,y:p.y,role:p.scoped?'scroll_container':'page'});await this.intent({type:'scrollVertical',delta:this.config.searchScrollDelta});await sleep(this.config.searchSettleMs);
    }
    const rows=[...seen.values()].sort((a,b)=>Number(a.position||9999)-Number(b.position||9999));const watch=rows.filter(usableWatchCandidate),fallback=rows.filter(x=>usableSeedCandidate(x)&&x.isRadio!==true&&!watch.some(w=>w.videoId===x.videoId));const seeds=[...watch,...fallback].slice(0,this.config.seedCount);
    const trackEvidence=queryEvidence(this.trackedVideoApi,query);
    const compactSeeds=seeds.map(seed=>({candidate:compactNode(seed),headKeywordEvidence:queryEvidence(seed.youtubeApi||{},query),seedToTrackedFactors:publicFactorComparison(seed,targetNode(this.trackedVideoApi))}));
    this.log('head_keyword_seed_pool',{query,observedSearchResults:rows.length,selectedSeedCount:seeds.length,trackHeuristicRelevance:trackEvidence.heuristicScore});
    return {query,trackedVideoHeadKeywordEvidence:trackEvidence,seeds,compactSeeds};
  }
  async openSeed(query,seed,branchMode){
    let obs=await this.openHeadSearch(query,{reason:`branch_${branchMode}_search`});let current=findCandidate(obs,seed);
    for(let pass=0;pass<=this.config.searchSeedScrolls+2&&!current;pass++){
      if(pass){const p=surfaceScrollPoint(obs,'search_results');await this.intent({type:'moveTo',x:p.x,y:p.y,role:p.scoped?'scroll_container':'page'});await this.intent({type:'scrollVertical',delta:this.config.searchScrollDelta});await sleep(this.config.searchSettleMs);obs=await this.observe(`branch_${branchMode}_seed_lookup_${pass}`);current=findCandidate(obs,seed);}
    }
    if(!current)throw new Error(`head_seed_not_found_after_research:${seed.videoId}`);const clicked=await this.clickCandidate(current,{reason:`head_keyword_seed:${branchMode}`});if(!clicked)throw new Error(`head_seed_unactionable:${seed.videoId}`);
    return this.waitFor(o=>semanticArrivalReady(o,current),{timeoutMs:12000,intervalMs:250,reason:`head_seed_arrival_${branchMode}`}).catch(async()=>this.observe(`head_seed_arrival_timeout_${branchMode}`));
  }
  async scanNextSurface(obs,{depth,branchMode,visited}){
    const source=obs.currentVideo||null,sourceId=source?.videoId||obs.route?.videoId||null,seen=new Map(),targetTimeline=[];let lastObs=obs;
    for(let pass=0;pass<=this.config.relatedScrolls;pass++){
      if(pass)lastObs=await this.observe(`next_scan_${branchMode}_${depth}_${pass}`);const rows=canonicalSurfaceRows(lastObs);
      for(const row of rows){const key=`${row.surface}:${row.videoId}`,old=seen.get(key);if(!old||Number(row.position||9999)<Number(old.position||9999))seen.set(key,row);}
      const hits=rows.filter(x=>String(x.videoId)===String(this.config.trackVideoId));for(const hit of hits)targetTimeline.push({pass,surface:hit.surface,rank:Number(hit.position||0)||null,visible:hit.visible===true});
      const relatedMax=rows.filter(x=>x.surface==='related').reduce((m,x)=>Math.max(m,Number(x.position||0)),0);if(hits.length||relatedMax>=this.config.maxRelatedRank||pass>=this.config.relatedScrolls)break;
      const p=surfaceScrollPoint(lastObs,'related');await this.intent({type:'moveTo',x:p.x,y:p.y,role:p.scoped?'scroll_container':'page'});await this.intent({type:'scrollVertical',delta:this.config.relatedScrollDelta});await sleep(this.config.relatedSettleMs);
    }
    const rows=[...seen.values()].sort((a,b)=>(a.surface==='related'?0:1)-(b.surface==='related'?0:1)||Number(a.position||9999)-Number(b.position||9999));
    const targetHits=rows.filter(x=>String(x.videoId)===String(this.config.trackVideoId)).sort((a,b)=>(a.surface==='related'?0:1)-(b.surface==='related'?0:1)||Number(a.position||9999)-Number(b.position||9999));const targetHit=targetHits[0]||null;
    const sourceTrackFactors=publicFactorComparison(source,targetNode(this.trackedVideoApi));
    const candidateFactors=rows.slice(0,this.config.relatedSampleLimit).map(row=>({candidate:compactNode(row),fromSourceFactors:publicFactorComparison(source,row),toTrackedFactors:publicFactorComparison(row,targetNode(this.trackedVideoApi))}));
    const exposure={seen:Boolean(targetHit),surface:targetHit?.surface||null,rank:targetHit?Number(targetHit.position||0)||null:null,visible:targetHit?.visible===true,timeline:targetTimeline,edgeFactors:targetHit?publicFactorComparison(source,targetHit):null};
    this.log('next_surface_scan',{branchMode,depth,sourceVideoId:sourceId,candidateCount:rows.length,targetSeen:exposure.seen,targetSurface:exposure.surface,targetRank:exposure.rank,sourceTrackAffinity:sourceTrackFactors.publicAffinityScore});
    return {depth,branchMode,sourceVideoId:sourceId,source:compactNode(source),sourceToTrackedFactors:sourceTrackFactors,targetExposure:exposure,candidates:candidateFactors,rawRows:rows,lastObs,visited:[...visited]};
  }
  chooseNext(scan,branchMode,visited){
    if(branchMode==='metadata_bridge'){
      const choice=chooseMetadataBridge(scan.rawRows,this.trackedVideoApi,visited);return choice?{candidate:choice.row,selectionFactors:choice.factors,reason:'highest_public_metadata_affinity_to_tracked_video'}:null;
    }
    const candidate=chooseNaturalNext(scan.rawRows,visited);return candidate?{candidate,selectionFactors:publicFactorComparison(candidate,targetNode(this.trackedVideoApi)),reason:'natural_top_related_non_radio'}:null;
  }
  async exploreBranch(query,seed,branchMode){
    let obs=await this.openSeed(query,seed,branchMode);const visited=new Set([String(seed.videoId)]),hops=[];
    for(let depth=1;depth<=this.config.maxHops;depth++){
      if(this.config.dwellSec>0){await sleep(this.config.dwellSec*1000);obs=await this.observe(`branch_${branchMode}_dwell_${depth}`);}
      const scan=await this.scanNextSurface(obs,{depth,branchMode,visited});const publicScan={depth:scan.depth,branchMode:scan.branchMode,sourceVideoId:scan.sourceVideoId,source:scan.source,sourceToTrackedFactors:scan.sourceToTrackedFactors,targetExposure:scan.targetExposure,candidates:scan.candidates,visited:scan.visited};hops.push(publicScan);
      if(scan.targetExposure.seen||depth>=this.config.maxHops)break;const next=this.chooseNext(scan,branchMode,visited);if(!next)break;if(String(next.candidate.videoId)===String(this.config.trackVideoId))break;
      const clicked=await this.clickCandidate(next.candidate,{reason:`next_hop:${branchMode}:${next.reason}`});if(!clicked)break;visited.add(String(next.candidate.videoId));publicScan.nextSelection={videoId:next.candidate.videoId,title:next.candidate.title||next.candidate.youtubeApi?.title||null,surface:next.candidate.surface,position:next.candidate.position,reason:next.reason,selectionFactors:next.selectionFactors};
      obs=await this.waitFor(o=>semanticArrivalReady(o,next.candidate),{timeoutMs:12000,intervalMs:250,reason:`next_arrival_${branchMode}_${depth+1}`}).catch(async()=>this.observe(`next_arrival_timeout_${branchMode}_${depth+1}`));
    }
    return {query,seedVideoId:seed.videoId,seed:compactNode(seed),branchMode,hops,targetSeen:hops.some(x=>x.targetExposure?.seen)};
  }
  async run(){
    try{
      await this.selectBrowser();await this.createTask();this.captureEnvironment();await this.validatePristine();await this.loadTrackedVideo();
      for(const query of this.config.headQueries){
        if(Date.now()-this.startedAt>this.config.maxRuntimeSec*1000)break;const pool=await this.collectSearchSeeds(query);const run={query,trackedVideoHeadKeywordEvidence:pool.trackedVideoHeadKeywordEvidence,searchSeeds:pool.compactSeeds,branches:[]};
        for(const seed of pool.seeds){for(const branchMode of this.config.branchModes){if(Date.now()-this.startedAt>this.config.maxRuntimeSec*1000)break;run.branches.push(await this.exploreBranch(query,seed,branchMode));}}
        this.headKeywordRuns.push(run);
      }
      await this.loadTrackedVideo({refresh:true});const factorSummary=summarizeRuns(this.headKeywordRuns);return this.complete('head_keyword_next_complete',{mode:'head_keyword_next_video_discovery',headKeywordRuns:this.headKeywordRuns,factorSummary});
    }catch(error){
      this.log('runner_error',{error:String(error?.stack||error)});await this.req('TASK_FAIL',{taskId:this.taskId,error:String(error?.message||error)}).catch(finalizeError=>this.log('task_finalize_error',{operation:'TASK_FAIL',error:String(finalizeError?.message||finalizeError)}));this.endedAt=Date.now();const report=this.report('error',{error:String(error?.stack||error),headKeywordRuns:this.headKeywordRuns,factorSummary:summarizeRuns(this.headKeywordRuns)});this.writeReport(report);throw error;
    }finally{await this.client.close().catch(()=>{});}
  }
  report(outcome,extra={}){
    const base=super.report(outcome,extra);return {...base,tool:'BODY Head Keyword -> Next Video Discovery Lab',mode:'head_keyword_next_video_discovery',objective:'Start only from broad/head YouTube search keywords, open real search-result seed videos, observe Up Next/Related graph edges, and measure when the tracked new video appears. The tracked video title is never used as a search query.',environmentCondition:this.environmentCondition,pristineBrowser:this.pristineEvidence,trackedVideo:compactNode(targetNode(this.trackedVideoApi)),trackedVideoHistory:this.trackedVideoHistory,headKeywordRuns:this.headKeywordRuns,factorSummary:summarizeRuns(this.headKeywordRuns),guardrails:{...base.guardrails,searchOnlyAtStart:false,genericHeadKeywordSearchOnly:true,trackedVideoTitleUsedAsSearchQuery:false,trackedVideoClicked:false,engagementActions:false},interpretationBoundary:'Observed Search/Related positions are real DOM evidence. Tags, derived keywords, topics, category, language, channel metadata, freshness and popularity comparisons are diagnostic correlations only; public YouTube APIs do not expose the causal recommendation weights.'};
  }
}

module.exports={HeadKeywordNextRunner,publicFactorComparison,compactNode,canonicalSurfaceRows,canonicalSearchRows,chooseNaturalNext,chooseMetadataBridge,summarizeRuns};
