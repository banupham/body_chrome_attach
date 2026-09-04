'use strict';

const {KeyGraphRouteRunner,ObservedKeyGraph,GENERIC_TOPIC_KEYS,clean,fold,meaningfulKey,topicFamily,videoKeyRows,topicDistance}=require('./key_graph_route_runner');
const {canonicalSearchRows,compactNode,publicFactorComparison}=require('./head_keyword_next_runner');
const {surfaceScrollPoint,usableSeedCandidate}=require('./topic_transition_runner');
const {queryEvidence}=require('./search_exposure_runner');
const {replaceSearchQuery}=require('./youtube_search_input');

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,Math.max(0,Number(ms)||0)));
const uniq=values=>[...new Set((values||[]).map(clean).filter(Boolean))];
const median=values=>{const xs=(values||[]).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);if(!xs.length)return 0;const i=Math.floor(xs.length/2);return xs.length%2?xs[i]:(xs[i-1]+xs[i])/2;};
const targetNode=api=>({videoId:api?.videoId||null,title:api?.title||null,semanticTitle:true,youtubeApi:api});

function ageHours(iso,at=Date.now()){const ts=Date.parse(String(iso||''));return Number.isFinite(ts)?Math.max(0,(Number(at)-ts)/3600000):null;}
function robustViewStats(node,at=Date.now()){
  const api=node?.youtubeApi||node||{},views=Number(api.statistics?.viewCount||0),age=ageHours(api.publishedAt,at),direct=Number(node?.viewsPerHour??api.viewsPerHour);
  const viewsPerHour=Number.isFinite(direct)&&direct>0?direct:(Number.isFinite(views)&&age!=null?views/Math.max(age,1/60):0);
  return {views:Number.isFinite(views)?views:0,viewsPerHour:Number.isFinite(viewsPerHour)?viewsPerHour:0};
}
function searchResultSignature(obs,limit=12){return canonicalSearchRows(obs).slice(0,Math.max(1,limit)).map(x=>String(x.videoId||'')).filter(Boolean).join('|');}
function searchQuerySupport(obs,query,limit=12){
  const q=fold(query),rows=canonicalSearchRows(obs).slice(0,Math.max(1,limit));let matches=0,bestScore=0;
  for(const row of rows){const title=fold(row?.youtubeApi?.title||row?.title||'');const lexical=Boolean(q&&title&&(title.includes(q)||q.includes(title)));const evidence=queryEvidence(row?.youtubeApi||{},query),score=Number(evidence?.heuristicScore||0);if(lexical||score>0)matches++;bestScore=Math.max(bestScore,score);}
  return {matches,bestScore:Number(bestScore.toFixed(3)),sampleSize:rows.length};
}
function recoverableSeedError(error){const message=String(error?.message||error||'');return /^head_seed_(?:unactionable|not_found_after_research|stale_after_query_change):/i.test(message);}
function queryKind(row){
  const normalized=fold(row?.key||row?.display||''),sources=new Set(row?.sourceTypes||[]),multiword=/\s/u.test(clean(row?.key||row?.display||''));
  if(GENERIC_TOPIC_KEYS.has(normalized))return 'generic_topic';
  if(sources.has('tag'))return 'tag_bridge';
  if(sources.has('video_topic'))return 'topic_bridge';
  if(multiword)return 'phrase_bridge';
  return 'token_fragment';
}
function frontierRole(row){return Number(row?.crossTopicEdges||0)>0&&Number(row?.topicDiversity||0)>=2?'cross_topic_bridge':'cluster_deepening';}
function keySearchEligible(row){
  const kind=queryKind(row),videos=Number(row?.videoCount||0),videoLevel=Number(row?.videoLevelCount||0),cross=Number(row?.crossTopicEdges||0),diversity=Number(row?.topicDiversity||0);
  if(videos<2||videoLevel<2)return false;
  if(kind==='token_fragment')return false;
  if(kind==='generic_topic')return cross>=1&&diversity>=2;
  return cross>=1||videos>=3;
}
function chooseFrontierKey(rows,usedRoles=new Set(),usedKinds=new Set()){
  const available=(rows||[]).filter(x=>!x.used);
  if(!available.length)return null;
  return available.find(x=>!usedRoles.has(x.frontierRole)&&x.queryKind!=='generic_topic')||available.find(x=>!usedKinds.has(x.queryKind)&&x.queryKind!=='generic_topic')||available.find(x=>x.queryKind!=='generic_topic')||available[0];
}

class ReliableObservedKeyGraph extends ObservedKeyGraph{
  constructor(){super();this.edgeKeySet=new Set();this.edgePairSet=new Set();}
  addNode(node,{surface='unknown',reason='observe',trackVideoId=null}={}){
    const api=node?.youtubeApi||node||{},videoId=String(node?.videoId||api.videoId||'');if(!videoId||videoId===String(trackVideoId||''))return;
    this.videoIds.add(videoId);const stats=robustViewStats(node),families=topicFamily(node);
    for(const k of videoKeyRows(node)){
      const row=this.row(k.key,k.display);row._observedVideoIds=row._observedVideoIds||new Set();row._videoLevelIds=row._videoLevelIds||new Set();row._transitionPairs=row._transitionPairs||new Set();
      row.videoIds.add(videoId);for(const family of families)row.topicFamilies.add(family);row.surfaces.add(surface);row.sourceTypes.add(k.source);
      if(k.videoLevel&&!row._videoLevelIds.has(videoId)){row._videoLevelIds.add(videoId);row.videoLevelCount++;}
      if(row._observedVideoIds.has(videoId))continue;row._observedVideoIds.add(videoId);row.occurrences++;row.views.push(stats.views);row.viewsPerHour.push(stats.viewsPerHour);
      if(row.provenance.length<20)row.provenance.push({videoId,title:clean(api.title||node?.title).slice(0,140),surface,reason,source:k.source,videoLevel:k.videoLevel});
    }
  }
  addObservedEdge(source,candidate,{surface='related',rank=null,reason='observe',trackVideoId=null}={}){
    const sourceId=String(source?.videoId||source?.youtubeApi?.videoId||''),candidateId=String(candidate?.videoId||candidate?.youtubeApi?.videoId||'');if(!sourceId||!candidateId||candidateId===String(trackVideoId||''))return;
    const a=new Map(videoKeyRows(source).filter(x=>x.videoLevel).map(x=>[x.key,x])),b=new Map(videoKeyRows(candidate).filter(x=>x.videoLevel).map(x=>[x.key,x])),shared=[];
    for(const [key,row] of a)if(b.has(key)&&meaningfulKey(key))shared.push(row.display||b.get(key)?.display||key);if(!shared.length)return;
    const distance=topicDistance(source,candidate),crossTopic=distance>=0.35,sourceFamily=topicFamily(source).sort().join(','),candidateFamily=topicFamily(candidate).sort().join(','),transition=`${sourceFamily}->${candidateFamily}`;
    for(const display of uniq(shared)){const key=fold(display),edgeKey=`${sourceId}->${candidateId}|${surface}|${key}`;if(this.edgeKeySet.has(edgeKey))continue;this.edgeKeySet.add(edgeKey);const row=this.keys.get(key);if(row&&crossTopic){row.crossTopicEdges++;row._transitionPairs=row._transitionPairs||new Set();row._transitionPairs.add(transition);}}
    const pairKey=`${sourceId}->${candidateId}|${surface}`;if(!this.edgePairSet.has(pairKey)&&this.edges.length<1600){this.edgePairSet.add(pairKey);this.edges.push({sourceVideoId:sourceId,candidateVideoId:candidateId,surface,rank:Number(rank)||null,sharedKeys:uniq(shared).slice(0,24),topicDistance:Number(distance.toFixed(3)),crossTopic,sourceFamily,candidateFamily,reason});}
  }
  score(row){
    const videoCount=row.videoIds.size,topicDiversity=row.topicFamilies.size,transitions=row._transitionPairs?.size||0,views=median(row.views),vph=median(row.viewsPerHour),kind=queryKind({...row,sourceTypes:[...row.sourceTypes]}),sourceBonus=kind==='tag_bridge'?2.4:kind==='phrase_bridge'?1.4:kind==='topic_bridge'?1:kind==='generic_topic'?-2.5:-5;
    return Number((Math.log1p(videoCount)*1.2+Math.log1p(topicDiversity)*1.25+Math.log1p(row.crossTopicEdges)*1.8+Math.log1p(transitions)*2.3+Math.log1p(views)/7+Math.log1p(vph)/3+sourceBonus).toFixed(3));
  }
  ranked({limit=30}={}){return [...this.keys.values()].map(row=>{const base={key:row.display,normalizedKey:row.key,videoCount:row.videoIds.size,topicDiversity:row.topicFamilies.size,crossTopicEdges:row.crossTopicEdges,distinctTopicTransitions:row._transitionPairs?.size||0,medianViews:Math.round(median(row.views)),medianViewsPerHour:Number(median(row.viewsPerHour).toFixed(2)),surfaces:[...row.surfaces],sourceTypes:[...row.sourceTypes],videoLevelCount:row.videoLevelCount,provenance:row.provenance.slice(0,10)};const demandProxy=this.score(row),kind=queryKind(base),role=frontierRole(base),bridgeReliability=Number((Math.log1p(base.crossTopicEdges)+Math.log1p(base.distinctTopicTransitions)*1.8+Math.log1p(base.topicDiversity)).toFixed(3)),searchPriority=Number((demandProxy+bridgeReliability+(role==='cluster_deepening'?0.6:1.0)-(kind==='generic_topic'?2.5:0)).toFixed(3));return {...base,queryKind:kind,frontierRole:role,bridgeReliability,demandProxy,searchPriority,searchEligible:keySearchEligible({...base,queryKind:kind,frontierRole:role}),demandInterpretation:'deduped_observed_video_statistics_proxy_not_query_search_volume'};}).sort((a,b)=>b.searchPriority-a.searchPriority||b.distinctTopicTransitions-a.distinctTopicTransitions||b.videoCount-a.videoCount).slice(0,limit);}
  searchCandidates({limit=10,headQueries=[],targetTopic=null,targetTitle=null,trackVideoId=null}={}){
    const heads=new Set((headQueries||[]).map(fold)),tt=fold(targetTopic),title=fold(targetTitle),id=fold(trackVideoId);
    return this.ranked({limit:180}).filter(row=>row.searchEligible).filter(row=>{const k=fold(row.key);if(heads.has(k)||k===tt||k===id)return false;if(title&&(k===title||(k.length>=24&&title.includes(k))))return false;return true;}).slice(0,limit);
  }
  report(){const ranked=this.ranked({limit:50});return {uniqueObservedVideos:this.videoIds.size,keyCount:this.keys.size,uniqueObservedEdges:this.edgePairSet.size,topKeys:ranked,crossTopicEdges:this.edges.filter(x=>x.crossTopic).slice(0,400),frontierCandidates:ranked.filter(x=>x.searchEligible).slice(0,30),statsFixes:{deduplicatedEdges:true,deduplicatedKeyVideoObservations:true,viewsPerHourComputedFromPublishedAt:true}};}
}

class RobustKeyGraphRouteRunner extends KeyGraphRouteRunner{
  constructor(config,client=null,options={}){super(config,client,options);this.keyGraph=new ReliableObservedKeyGraph();this.targetObserved=false;this.searchSettleEvents=[];this.skippedBranches=[];this.frontierIterations=[];}
  async waitSearchResultsSettled(query,{beforeSignature='',reason='search_results',timeoutMs=null}={}){
    const deadline=Date.now()+Math.max(3000,Number(timeoutMs||this.config.searchResultSettleMs||12000)),required=Math.max(1,Math.min(4,Number(this.config.searchResultStableSamples||2)));let lastSignature='',stable=0,lastObs=null,lastSupport=null;
    while(Date.now()<deadline){lastObs=await this.observe(`${reason}_settle`);const rows=canonicalSearchRows(lastObs),signature=searchResultSignature(lastObs),changed=!beforeSignature||signature!==beforeSignature;lastSupport=searchQuerySupport(lastObs,query);if(lastObs.route?.pageType==='search'&&rows.length>0&&changed){stable=signature&&signature===lastSignature?stable+1:1;if(lastSupport.matches>0||stable>=required){const row={query,beforeSignature,afterSignature:signature,stableSamples:stable,requiredStableSamples:required,support:lastSupport,resultCount:rows.length};this.searchSettleEvents.push(row);this.log('search_results_settled',row);return lastObs;}}else stable=0;lastSignature=signature;await sleep(250);}
    throw new Error(`search_results_not_settled:${clean(query)}:before=${beforeSignature}:after=${lastSignature}:support=${lastSupport?.matches||0}`);
  }
  async openHeadSearch(query,{reason='head_search'}={}){
    let obs=await this.observe(`${reason}_initial`),sameQuery=obs.route?.pageType==='search'&&Boolean(this.activeHeadQuery)&&fold(this.activeHeadQuery)===fold(query);
    if(sameQuery){this.log('search_query_reused',{query,reason:'same_query_same_search_page_robust'});return this.waitSearchResultsSettled(query,{reason:`${reason}_reuse`});}
    if(this.activeHeadQuery&&fold(this.activeHeadQuery)===fold(query)&&obs.route?.pageType!=='home'){
      const restored=await this.restoreHeadSearch(query,{reason:`${reason}_history`});if(restored)return this.waitSearchResultsSettled(query,{reason:`${reason}_restored`});obs=await this.observe(`${reason}_fallback`);
    }
    if(!obs.controls?.searchInput?.actionRect){if(obs.route?.pageType!=='home')obs=await this.goHome(`${reason}_home`);if(!obs.controls?.searchInput?.actionRect)obs=await this.waitFor(o=>Boolean(o.controls?.searchInput?.actionRect),{timeoutMs:8000,reason:`${reason}_control`});}
    const beforeSignature=searchResultSignature(obs),intents=await replaceSearchQuery(this,obs.controls.searchInput,query);this.activeHeadQuery=query;this.log('search_query_replaced',{query,intentTypes:intents.map(x=>x.type),clearSequence:['Control+a','Backspace'],beforeSignature});
    return this.waitSearchResultsSettled(query,{beforeSignature,reason:`${reason}_results`});
  }
  async collectSearchSeeds(query){
    let obs=await this.openHeadSearch(query,{reason:`head_${fold(query).slice(0,24)}`});const seen=new Map();
    for(let pass=0;pass<=this.config.searchSeedScrolls;pass++){
      if(pass)obs=await this.observe(`head_seed_scan_${pass}`);for(const row of canonicalSearchRows(obs)){const id=String(row.videoId),old=seen.get(id);if(!old||Number(row.position||9999)<Number(old.position||9999))seen.set(id,row);}
      const selectable=[...seen.values()].filter(x=>String(x.videoId)!==String(this.config.trackVideoId)&&usableSeedCandidate(x)&&x.isRadio!==true&&String(x.path||'').startsWith('/watch'));if(selectable.length>=this.config.seedCount||pass>=this.config.searchSeedScrolls)break;const point=surfaceScrollPoint(obs,'search_results');await this.intent({type:'moveTo',x:point.x,y:point.y,role:point.scoped?'scroll_container':'page'});await this.intent({type:'scrollVertical',delta:this.config.searchScrollDelta});await sleep(this.config.searchSettleMs);
    }
    const rows=[...seen.values()].sort((a,b)=>Number(a.position||9999)-Number(b.position||9999)),targetHit=rows.find(x=>String(x.videoId)===String(this.config.trackVideoId))||null,watch=rows.filter(x=>String(x.videoId)!==String(this.config.trackVideoId)&&usableSeedCandidate(x)&&x.isRadio!==true&&String(x.path||'').startsWith('/watch')),seeds=watch.slice(0,this.config.seedCount),trackEvidence=queryEvidence(this.trackedVideoApi,query),compactSeeds=seeds.map(seed=>({candidate:compactNode(seed),headKeywordEvidence:queryEvidence(seed.youtubeApi||{},query),seedToTrackedFactors:publicFactorComparison(seed,targetNode(this.trackedVideoApi))})),searchTargetExposure={seen:Boolean(targetHit),surface:'search_results',rank:targetHit?Number(targetHit.position||0)||null:null,visible:targetHit?.visible===true,query,neverClicked:true};
    if(searchTargetExposure.seen)this.targetObserved=true;this.log('head_keyword_seed_pool',{query,observedSearchResults:rows.length,selectedSeedCount:seeds.length,targetSeen:searchTargetExposure.seen,targetRank:searchTargetExposure.rank,trackHeuristicRelevance:trackEvidence.heuristicScore});return {query,trackedVideoHeadKeywordEvidence:trackEvidence,seeds,compactSeeds,searchTargetExposure,resultSignature:searchResultSignature(obs)};
  }
  async exploreBranch(query,seed,branchMode){
    try{const branch=await super.exploreBranch(query,seed,branchMode);if(branch?.targetSeen)this.targetObserved=true;return {...branch,status:'completed'};}
    catch(error){if(!recoverableSeedError(error))throw error;const skip={query,seedVideoId:seed?.videoId||null,seed:compactNode(seed),branchMode,status:'skipped',skipReason:String(error?.message||error),hops:[],targetSeen:false,searchRestored:false};this.skippedBranches.push(skip);this.log('branch_seed_skipped',{query,seedVideoId:skip.seedVideoId,branchMode,reason:skip.skipReason});const restored=await this.restoreHeadSearch(query,{reason:`branch_${branchMode}_skip_restore`}).catch(()=>null);skip.searchRestored=Boolean(restored);return skip;}
  }
  async maybeCheckpointHome(args={}){if(args?.branch?.status==='skipped')return null;const checkpoint=await super.maybeCheckpointHome(args);if(checkpoint?.scan?.targetExposure?.seen)this.targetObserved=true;return checkpoint;}
  async runPrimaryQueries(){
    for(const query of this.config.headQueries){if(Date.now()-this.startedAt>this.config.maxRuntimeSec*1000||this.targetObserved)break;const pool=await this.collectSearchSeeds(query),run={query,queryOrigin:'broad_head_keyword',trackedVideoHeadKeywordEvidence:pool.trackedVideoHeadKeywordEvidence,searchTargetExposure:pool.searchTargetExposure,resultSignature:pool.resultSignature,searchSeeds:pool.compactSeeds,branches:[],homeAfterQuery:null};if(!pool.searchTargetExposure.seen){for(const seed of pool.seeds){for(const branchMode of this.config.branchModes){if(Date.now()-this.startedAt>this.config.maxRuntimeSec*1000||this.targetObserved)break;const branch=await this.exploreBranch(query,seed,branchMode);run.branches.push(branch);await this.maybeCheckpointHome({query,branch,origin:'broad_head_branch'});}}}if(this.config.homeExplore!==false&&!this.targetObserved){run.homeAfterQuery=await this.scanHome(`after_${fold(query).slice(0,24)}`,{navigate:true});this.homeDiscovery.afterHeadQueries.push({query,scan:run.homeAfterQuery});this.lastHomeScan=run.homeAfterQuery;if(run.homeAfterQuery?.targetExposure?.seen)this.targetObserved=true;}this.headKeywordRuns.push(run);}
  }
  async runBridgeKeyQueries(){
    if(this.config.bridgeKeySearch===false||Number(this.config.bridgeKeySearchCount||0)<=0||this.targetObserved)return;const budget=Math.max(0,Number(this.config.bridgeKeySearchCount||2)),usedRoles=new Set(),usedKinds=new Set();
    for(let iteration=1;iteration<=budget&&!this.targetObserved&&Date.now()-this.startedAt<=this.config.maxRuntimeSec*1000;iteration++){
      const ranked=this.keyGraph.searchCandidates({limit:50,headQueries:[...this.config.headQueries,...this.expansionQueries],targetTopic:this.effectiveTargetTopic?.()||this.config.targetTopic,targetTitle:this.trackedVideoApi?.title||null,trackVideoId:this.config.trackVideoId}).map(row=>({...row,used:this.expansionQueries.has(fold(row.key))}));const keyRow=chooseFrontierKey(ranked,usedRoles,usedKinds);if(!keyRow)break;const query=clean(keyRow.key);this.expansionQueries.add(fold(query));usedRoles.add(keyRow.frontierRole);usedKinds.add(keyRow.queryKind);this.frontierIterations.push({iteration,query,keyEvidence:keyRow});this.log('bridge_key_frontier_selected',{iteration,query,frontierRole:keyRow.frontierRole,queryKind:keyRow.queryKind,searchPriority:keyRow.searchPriority,demandProxy:keyRow.demandProxy,distinctTopicTransitions:keyRow.distinctTopicTransitions});
      let pool;try{pool=await this.collectSearchSeeds(query);}catch(error){this.log('bridge_key_query_skipped',{query,reason:String(error?.message||error)});continue;}const run={query,queryOrigin:'observed_key_frontier',frontierIteration:iteration,keyEvidence:keyRow,trackedVideoHeadKeywordEvidence:pool.trackedVideoHeadKeywordEvidence,searchTargetExposure:pool.searchTargetExposure,resultSignature:pool.resultSignature,searchSeeds:pool.compactSeeds,branches:[],homeAfterQuery:null};
      if(!pool.searchTargetExposure.seen){const desired=Math.max(1,Number(this.config.bridgeKeySeedCount||1));let completed=0;for(const seed of pool.seeds){if(completed>=desired||this.targetObserved)break;const branch=await this.exploreBranch(query,seed,'source_bridge');run.branches.push(branch);if(branch.status!=='skipped'){completed++;await this.maybeCheckpointHome({query,branch,origin:'bridge_key_branch'});}}}
      if(this.config.homeExplore!==false&&!this.targetObserved){run.homeAfterQuery=await this.scanHome(`after_key_${fold(query).replace(/[^a-z0-9]+/g,'_').slice(0,24)}`,{navigate:true});this.lastHomeScan=run.homeAfterQuery;if(run.homeAfterQuery?.targetExposure?.seen)this.targetObserved=true;}
      this.bridgeKeyRuns.push(run);this.headKeywordRuns.push(run);this.log('bridge_key_search_complete',{query,frontierIteration:iteration,frontierRole:keyRow.frontierRole,queryKind:keyRow.queryKind,demandProxy:keyRow.demandProxy,searchPriority:keyRow.searchPriority,seedCount:run.searchSeeds.length,targetSeen:run.searchTargetExposure?.seen===true||run.branches.some(x=>x.targetSeen)||run.homeAfterQuery?.targetExposure?.seen===true});
    }
  }
  report(outcome,extra={}){
    const base=super.report(outcome,extra),searchHit=[...(this.headKeywordRuns||[])].find(run=>run?.searchTargetExposure?.seen),existing=base.appearanceConclusion;let appearance=existing;
    if(searchHit&&existing?.status!=='OBSERVED'){appearance={...existing,status:'OBSERVED',mechanism:'BROAD_SEARCH_RESULT',firstObserved:{kind:searchHit.queryOrigin==='broad_head_keyword'?'search':'derived_key_search',query:searchHit.query,surface:'search_results',rank:searchHit.searchTargetExposure.rank,directDomEvidence:true,sourceVideoId:null,branchMode:null,topicPath:[],neverClicked:true},observedExposureCount:1,allObservedExposures:[{query:searchHit.query,surface:'search_results',rank:searchHit.searchTargetExposure.rank,neverClicked:true}],conclusionVi:`Đã quan sát trực tiếp video đích xuất hiện trong Search của key "${searchHit.query}" ở vị trí ${searchHit.searchTargetExposure.rank}. Key này được lấy từ broad query hoặc từ Key Graph đã quan sát; video đích không được click và tiêu đề/id target không được dùng làm query.`,causalClaim:false};}
    return {...base,appearanceConclusion:appearance,topicRouteSummary:base.topicRouteSummary?{...base.topicRouteSummary,appearanceConclusion:appearance}:base.topicRouteSummary,robustDiscovery:{searchResultFreshnessGuard:true,staleResultSetRejected:true,recoverableSeedFailures:true,targetExcludedFromSeeds:true,stopAfterTargetObserved:true,keyEdgeDeduplication:true,viewsPerHourFixed:true,iterativeFrontierReplanning:true,frontierRoles:['cross_topic_bridge','cluster_deepening'],searchSettleEvents:this.searchSettleEvents,skippedBranches:this.skippedBranches,frontierIterations:this.frontierIterations},guardrails:{...base.guardrails,trackedVideoClicked:false,targetSearchResultNeverSelectedAsSeed:true,targetTitleUsedAsSearchQuery:false,targetMetadataUsedForPositiveSelection:false}};
  }
}

module.exports={ageHours,robustViewStats,searchResultSignature,searchQuerySupport,recoverableSeedError,queryKind,frontierRole,keySearchEligible,chooseFrontierKey,ReliableObservedKeyGraph,RobustKeyGraphRouteRunner};
