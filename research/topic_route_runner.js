'use strict';

const {
  HeadKeywordNextRunner,
  publicFactorComparison,
  compactNode,
  chooseNaturalNext
}=require('./head_keyword_next_runner');
const {semanticArrivalReady}=require('./topic_transition_runner');

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,Math.max(0,Number(ms)||0)));
const clean=value=>String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim();
const fold=value=>clean(value).toLowerCase().normalize('NFD').replace(/\p{M}+/gu,'').replace(/đ/g,'d');
const uniq=values=>[...new Set((values||[]).map(clean).filter(Boolean))];
const apiOf=node=>node?.youtubeApi||node||{};

const CATEGORY_NAMES={
  '1':'Film & Animation','2':'Autos & Vehicles','10':'Music','15':'Pets & Animals','17':'Sports','18':'Short Movies',
  '19':'Travel & Events','20':'Gaming','21':'Videoblogging','22':'People & Blogs','23':'Comedy','24':'Entertainment',
  '25':'News & Politics','26':'Howto & Style','27':'Education','28':'Science & Technology','29':'Nonprofits & Activism'
};
const STOP=new Set([
  'the','and','for','with','from','this','that','video','official','new','latest','today','youtube','channel','watch',
  'va','voi','cua','cho','nay','do','la','mot','nhung','cac','tai','tu','trong','tren','duoc','moi','hom','nay',
  'khong','nhu','ve','co','den','khi','sau','truoc','phai','dang','cach','gi','ra','vao','mot','neu'
]);

function tokenList(value){
  return fold(value).split(/[^\p{L}\p{N}+#._-]+/gu).map(x=>x.trim()).filter(x=>x.length>=2&&!STOP.has(x)&&!/^[\d._-]+$/.test(x));
}
function scoreTerm(map,term,score,source){
  const key=fold(term);if(!key||key.length<2||STOP.has(key)||!/\p{L}/u.test(key))return;
  const row=map.get(key)||{term:clean(term),score:0,sources:new Set()};row.score+=Number(score)||0;row.sources.add(source);map.set(key,row);
}
function topicTerms(node){
  const api=apiOf(node),scores=new Map();
  for(const label of uniq(api.topicLabels))scoreTerm(scores,label,14,'video_topic');
  for(const label of uniq(api.channel?.topicLabels))scoreTerm(scores,label,7,'channel_topic');
  for(const tag of uniq(api.tags)){
    scoreTerm(scores,tag,7,'tag');for(const token of tokenList(tag))scoreTerm(scores,token,2.5,'tag_token');
  }
  for(const row of api.keywords||[]){const term=row?.term||row;if(!term)continue;scoreTerm(scores,term,Math.min(8,Math.max(0.5,Number(row?.score)||1)),'derived_keyword');}
  for(const token of tokenList(api.title||node?.title))scoreTerm(scores,token,3,'title');
  for(const keyword of uniq(api.channel?.keywords).slice(0,30)){
    scoreTerm(scores,keyword,1.5,'channel_keyword');for(const token of tokenList(keyword))scoreTerm(scores,token,.5,'channel_keyword_token');
  }
  return [...scores.values()].map(row=>({...row,sources:[...row.sources]})).sort((a,b)=>b.score-a.score||a.term.localeCompare(b.term)).slice(0,24);
}
function classifyTopic(node){
  const api=apiOf(node),terms=topicTerms(node),videoLabels=uniq(api.topicLabels),channelLabels=uniq(api.channel?.topicLabels),categoryId=api.categoryId?String(api.categoryId):null,categoryName=categoryId?CATEGORY_NAMES[categoryId]||`YouTube category ${categoryId}`:null;
  const explicit=[...videoLabels,...channelLabels].filter(Boolean),primaryTopic=videoLabels[0]||terms[0]?.term||channelLabels[0]||categoryName||'unclassified';
  return {
    primaryTopic,
    categoryId,
    categoryName,
    videoTopicLabels:videoLabels,
    channelTopicLabels:channelLabels,
    dominantTerms:terms.slice(0,12),
    topicSignature:uniq([...explicit,...terms.slice(0,8).map(x=>x.term)]).slice(0,12),
    basis:'public_metadata_only',
    heuristicOnly:true
  };
}
function classifySurface(rows,{limit=40}={}){
  const topics=new Map(),terms=new Map(),categories=new Map(),sample=(rows||[]).slice(0,limit);
  for(const row of sample){
    const profile=classifyTopic(row),rankWeight=1/Math.sqrt(Math.max(1,Number(row.position)||1));
    for(const label of uniq([...profile.videoTopicLabels,...profile.channelTopicLabels]))topics.set(label,(topics.get(label)||0)+2*rankWeight);
    if(profile.categoryName)categories.set(profile.categoryName,(categories.get(profile.categoryName)||0)+rankWeight);
    for(const term of profile.dominantTerms.slice(0,8))terms.set(term.term,(terms.get(term.term)||0)+rankWeight*Math.min(6,Math.max(.5,term.score/4)));
  }
  const top=map=>[...map.entries()].map(([value,score])=>({value,score:Number(score.toFixed(3))})).sort((a,b)=>b.score-a.score||a.value.localeCompare(b.value));
  const dominantTopics=top(topics).slice(0,8),dominantTerms=top(terms).slice(0,12),categoryMix=top(categories).slice(0,8);
  return {sampleSize:sample.length,primaryDisplayedTopic:dominantTopics[0]?.value||dominantTerms[0]?.value||categoryMix[0]?.value||'unclassified',dominantTopics,dominantTerms,categoryMix,basis:'observed_surface_public_metadata',heuristicOnly:true};
}
function bridgeKeys(factors){
  return uniq([
    ...(factors?.sharedTags||[]),
    ...(factors?.sharedKeywords||[]),
    ...(factors?.sharedTopics||[]),
    ...(factors?.sharedChannelKeywords||[]),
    ...(factors?.sharedChannelTopics||[]),
    ...(factors?.sharedTitleTokens||[])
  ]).slice(0,30);
}
function transitionEvidence(source,candidate){
  const factors=publicFactorComparison(source,candidate),sourceProfile=classifyTopic(source),candidateProfile=classifyTopic(candidate),sourceTerms=new Set(sourceProfile.dominantTerms.map(x=>fold(x.term))),keys=bridgeKeys(factors),emergingTerms=candidateProfile.dominantTerms.map(x=>x.term).filter(x=>!sourceTerms.has(fold(x))).slice(0,10);
  const expansionScore=Number((factors.publicAffinityScore+Math.min(5,emergingTerms.length)*.35-(factors.sameChannel?1.5:0)).toFixed(3));
  return {sourceTopic:sourceProfile,candidateTopic:candidateProfile,bridgeKeys:keys,emergingTerms,publicFactors:factors,expansionScore,selectionEligible:keys.length>0,targetMetadataUsed:false};
}
function usable(row,visited){return Boolean(row?.videoId&&row?.semanticTitle!==false&&row?.isRadio!==true&&String(row.path||'').startsWith('/watch')&&!visited.has(String(row.videoId)));}
function chooseSourceBridge(rows,source,visited){
  const scored=(rows||[]).filter(row=>usable(row,visited)).map(row=>({row,evidence:transitionEvidence(source,row)})).filter(x=>x.evidence.selectionEligible).sort((a,b)=>b.evidence.expansionScore-a.evidence.expansionScore||Number(a.row.position||9999)-Number(b.row.position||9999));
  return scored[0]||null;
}
function topicMatchEvidence(node,targetTopic){
  const target=fold(targetTopic),profile=classifyTopic(node);if(!target)return {targetTopic:null,score:null,matched:[],evaluationOnly:true};
  const targetTokens=new Set(tokenList(target)),rows=[profile.primaryTopic,...profile.videoTopicLabels,...profile.channelTopicLabels,...profile.dominantTerms.map(x=>x.term),profile.categoryName].filter(Boolean),matched=[];
  for(const row of rows){const f=fold(row);if(f===target||f.includes(target)||target.includes(f)){matched.push(row);continue;}const tokens=tokenList(row);if(tokens.some(x=>targetTokens.has(x)))matched.push(row);}
  const exact=rows.some(row=>fold(row)===target),phrase=rows.some(row=>fold(row).includes(target)||target.includes(fold(row))),score=Math.min(1,(exact?.65:0)+(phrase?.25:0)+Math.min(.45,uniq(matched).length*.09));
  return {targetTopic:clean(targetTopic),score:Number(score.toFixed(3)),matched:uniq(matched).slice(0,12),profile,evaluationOnly:true,targetUsedForSelection:false};
}
function directionProfile(sourceProfile,surfaceProfile,targetTopic=null){
  const sourceTerms=new Set((sourceProfile?.dominantTerms||[]).map(x=>fold(x.term))),emerging=(surfaceProfile?.dominantTerms||[]).map(x=>x.value).filter(x=>!sourceTerms.has(fold(x))).slice(0,8),toward=surfaceProfile?.dominantTopics?.[0]?.value||emerging[0]||surfaceProfile?.primaryDisplayedTopic||'unclassified';
  return {currentTopic:sourceProfile?.primaryTopic||'unclassified',displayedTopic:surfaceProfile?.primaryDisplayedTopic||'unclassified',directionToward:toward,emergingTerms:emerging,targetTopic:targetTopic||null,heuristicOnly:true};
}
function observedExposureRows(runs,homeDiscovery,trackVideoId){
  const out=[];
  for(const run of runs||[]){
    const searchHit=(run.searchSeeds||[]).find(x=>String(x?.candidate?.videoId||'')===String(trackVideoId||''));
    if(searchHit)out.push({kind:'search',query:run.query,surface:'search_results',rank:searchHit.candidate.position||null,videoId:trackVideoId,directDomEvidence:true,seedVideoId:null,branchMode:null,depth:0,sourceVideoId:null,source:null,edgeFactors:null,topicPath:[]});
    for(const branch of run.branches||[])for(const hop of branch.hops||[])if(hop.targetExposure?.seen)out.push({kind:'related',query:run.query,surface:hop.targetExposure.surface,rank:hop.targetExposure.rank,videoId:trackVideoId,directDomEvidence:true,seedVideoId:branch.seedVideoId,branchMode:branch.branchMode,depth:hop.depth,sourceVideoId:hop.sourceVideoId,source:hop.source||null,edgeFactors:hop.targetExposure.edgeFactors||null,topicPath:branch.topicPath||[]});
    if(run.homeAfterQuery?.targetExposure?.seen)out.push({kind:'home_after_query',query:run.query,surface:'home_feed',rank:run.homeAfterQuery.targetExposure.rank,videoId:trackVideoId,directDomEvidence:true,seedVideoId:null,branchMode:null,depth:null,sourceVideoId:null,source:null,edgeFactors:null,topicPath:[]});
  }
  if(homeDiscovery?.baseline?.targetExposure?.seen)out.unshift({kind:'home_baseline',query:null,surface:'home_feed',rank:homeDiscovery.baseline.targetExposure.rank,videoId:trackVideoId,directDomEvidence:true,seedVideoId:null,branchMode:null,depth:null,sourceVideoId:null,source:null,edgeFactors:null,topicPath:[]});
  return out;
}
function buildAppearanceConclusion({runs,homeDiscovery,trackVideoId,trackedVideoApi,targetTopic}){
  const exposures=observedExposureRows(runs,homeDiscovery,trackVideoId),targetProfile=classifyTopic({videoId:trackVideoId,youtubeApi:trackedVideoApi}),routeReached=[];
  for(const run of runs||[])for(const branch of run.branches||[])for(const hop of branch.hops||[]){const evidence=hop.targetTopicEvaluation;if(evidence?.score>=.6)routeReached.push({query:run.query,seedVideoId:branch.seedVideoId,branchMode:branch.branchMode,depth:hop.depth,sourceVideoId:hop.sourceVideoId,score:evidence.score,matched:evidence.matched,currentTopic:hop.currentTopic?.primaryTopic||null,displayedTopic:hop.displayedTopic?.primaryDisplayedTopic||null});}
  if(exposures.length){
    const first=exposures[0],mechanism=first.surface==='search_results'?'BROAD_SEARCH_RESULT':first.surface==='home_feed'?'HOME_FEED':'RELATED_UP_NEXT',keys=bridgeKeys(first.edgeFactors),path=(first.topicPath||[]).map(x=>({videoId:x.videoId,title:x.title||null,topic:x.topic?.primaryTopic||null,via:x.via||null,bridgeKeys:x.bridgeKeys||[]}));
    return {status:'OBSERVED',mechanism,firstObserved:first,observedExposureCount:exposures.length,allObservedExposures:exposures,targetVideoTopic:targetProfile,targetTopic:targetTopic||targetProfile.primaryTopic,path,publicBridgeKeys:keys,conclusionVi:`Đã quan sát trực tiếp video đích xuất hiện trên ${first.surface}${first.rank?` ở vị trí ${first.rank}`:''}${first.sourceVideoId?` từ video nguồn ${first.sourceVideoId}`:''}. Đường đi được ghi nhận từ chủ đề rộng qua các video trung gian; các key/tag/topic dùng để chọn bước tiếp theo chỉ lấy từ metadata công khai của video đang xem và candidate, không lấy từ video đích.`,causalClaim:false,causalBoundary:'BODY can conclude the observed appearance path/surface/rank and public metadata bridges, but cannot claim YouTube internal causal weights.'};
  }
  if(routeReached.length)return {status:'TARGET_TOPIC_REACHED_TRACKED_VIDEO_NOT_OBSERVED',mechanism:null,observedExposureCount:0,targetVideoTopic:targetProfile,targetTopic:targetTopic||targetProfile.primaryTopic,targetTopicReached:routeReached,conclusionVi:'Đã đi tới vùng chủ đề đích theo phân loại metadata công khai, nhưng chưa quan sát thấy chính video đích trên Search/Related/Up Next/Home trong giới hạn lần chạy này.',causalClaim:false};
  return {status:'NOT_OBSERVED',mechanism:null,observedExposureCount:0,targetVideoTopic:targetProfile,targetTopic:targetTopic||targetProfile.primaryTopic,conclusionVi:'Chưa quan sát thấy video đích và cũng chưa có bằng chứng đủ mạnh rằng đường đi đã vào vùng chủ đề đích trong giới hạn lần chạy này. Báo cáo không suy diễn nguyên nhân xuất hiện khi chưa có DOM evidence.',causalClaim:false};
}

class TopicRouteRunner extends HeadKeywordNextRunner{
  effectiveTargetTopic(){return clean(this.config.targetTopic)||classifyTopic({youtubeApi:this.trackedVideoApi}).primaryTopic;}
  chooseNext(scan,branchMode,visited){
    const source=scan?.lastObs?.currentVideo||scan?.source||null;
    if(branchMode==='source_bridge'||branchMode==='metadata_bridge'){
      const choice=chooseSourceBridge(scan.rawRows,source,visited);return choice?{candidate:choice.row,selectionFactors:choice.evidence.publicFactors,transitionEvidence:choice.evidence,reason:'source_metadata_bridge_target_blind'}:null;
    }
    const candidate=chooseNaturalNext(scan.rawRows,visited);return candidate?{candidate,selectionFactors:publicFactorComparison(source,candidate),transitionEvidence:transitionEvidence(source,candidate),reason:'natural_top_related_non_radio_target_blind'}:null;
  }
  async exploreBranch(query,seed,branchMode){
    let obs=await this.openSeed(query,seed,branchMode),visited=new Set([String(seed.videoId)]),hops=[],topicPath=[{videoId:seed.videoId,title:seed.youtubeApi?.title||seed.title||null,topic:classifyTopic(seed),via:'broad_search_seed',bridgeKeys:[]}];
    for(let depth=1;depth<=this.config.maxHops;depth++){
      if(this.config.dwellSec>0){await sleep(this.config.dwellSec*1000);obs=await this.observe(`branch_${branchMode}_dwell_${depth}`);}
      const scan=await this.scanNextSurface(obs,{depth,branchMode,visited}),sourceRaw=scan.lastObs?.currentVideo||scan.source,sourceTopic=classifyTopic(sourceRaw),displayedTopic=classifySurface(scan.rawRows),targetTopic=this.effectiveTargetTopic(),targetTopicEvaluation=topicMatchEvidence(sourceRaw,targetTopic),direction=directionProfile(sourceTopic,displayedTopic,targetTopic),publicScan={depth:scan.depth,branchMode:scan.branchMode,sourceVideoId:scan.sourceVideoId,source:scan.source,currentTopic:sourceTopic,displayedTopic,direction,targetTopicEvaluation,sourceToTrackedFactors:scan.sourceToTrackedFactors,targetExposure:scan.targetExposure,candidates:scan.candidates,visited:scan.visited};
      hops.push(publicScan);if(scan.targetExposure.seen||depth>=this.config.maxHops)break;
      const next=this.chooseNext(scan,branchMode,visited);if(!next||String(next.candidate.videoId)===String(this.config.trackVideoId))break;
      const clicked=await this.clickCandidate(next.candidate,{reason:`next_hop:${branchMode}:${next.reason}`});if(!clicked)break;
      visited.add(String(next.candidate.videoId));publicScan.nextSelection={videoId:next.candidate.videoId,title:next.candidate.youtubeApi?.title||next.candidate.title||null,surface:next.candidate.surface,position:next.candidate.position,reason:next.reason,selectionFactors:next.selectionFactors,transitionEvidence:next.transitionEvidence,targetMetadataUsedForSelection:false};
      topicPath.push({videoId:next.candidate.videoId,title:next.candidate.youtubeApi?.title||next.candidate.title||null,topic:next.transitionEvidence?.candidateTopic||classifyTopic(next.candidate),via:next.reason,bridgeKeys:next.transitionEvidence?.bridgeKeys||[],emergingTerms:next.transitionEvidence?.emergingTerms||[]});
      obs=await this.waitFor(o=>semanticArrivalReady(o,next.candidate),{timeoutMs:12000,intervalMs:250,reason:`next_arrival_${branchMode}_${depth+1}`}).catch(async()=>this.observe(`next_arrival_timeout_${branchMode}_${depth+1}`));
    }
    const result={query,seedVideoId:seed.videoId,seed:compactNode(seed),seedTopic:classifyTopic(seed),branchMode,hops,topicPath,targetSeen:hops.some(x=>x.targetExposure?.seen),searchRestored:false,targetMetadataUsedForSelection:false};
    const restored=await this.restoreHeadSearch(query,{reason:`branch_${branchMode}_return_to_search`}).catch(error=>{this.log('search_restore_error',{query,branchMode,error:String(error?.message||error)});return null;});result.searchRestored=Boolean(restored);return result;
  }
  report(outcome,extra={}){
    const base=super.report(outcome,extra),targetTopic=this.effectiveTargetTopic(),appearanceConclusion=buildAppearanceConclusion({runs:this.headKeywordRuns,homeDiscovery:this.homeDiscovery,trackVideoId:this.config.trackVideoId,trackedVideoApi:this.trackedVideoApi,targetTopic}),topicRouteSummary={startBroadTopics:this.config.headQueries,targetTopic,targetVideoId:this.config.trackVideoId,selectionRule:'TARGET_BLIND_SOURCE_METADATA_ONLY',targetMetadataUsedForSelection:false,branchSummaries:this.headKeywordRuns.flatMap(run=>(run.branches||[]).map(branch=>({query:run.query,seedVideoId:branch.seedVideoId,branchMode:branch.branchMode,targetSeen:branch.targetSeen,topicPath:branch.topicPath||[],hopTopics:(branch.hops||[]).map(hop=>({depth:hop.depth,currentTopic:hop.currentTopic,displayedTopic:hop.displayedTopic,direction:hop.direction,targetTopicEvaluation:hop.targetTopicEvaluation}))}))),appearanceConclusion};
    return {...base,tool:'BODY Target-Blind Topic Route Discovery Lab',mode:'target_blind_topic_route_discovery',objective:'Discover an observable path from a broad starting topic toward another topic without directly searching the target topic/video. After the initial broad search, navigation decisions use only public keys/tags/topics/keywords present in the current video and observed candidates. Classify the current video topic, the displayed recommendation surface topic, the direction of topic drift, and conclude exactly where/how the tracked video was observed.',topicRouteSummary,appearanceConclusion,guardrails:{...base.guardrails,directTargetTopicSearch:false,targetVideoTitleUsedAsSearchQuery:false,targetMetadataUsedForSelection:false,targetEvaluationPostObservationOnly:true,bridgeSelectionSourceMetadataOnly:true,searchExpansionMustComeFromObservedMetadata:true},interpretationBoundary:'BODY concludes observable route, surface, rank, topic drift and public metadata bridges. It does not claim access to YouTube internal recommendation weights or causal ranking reasons.'};
  }
}

module.exports={CATEGORY_NAMES,topicTerms,classifyTopic,classifySurface,bridgeKeys,transitionEvidence,chooseSourceBridge,topicMatchEvidence,directionProfile,observedExposureRows,buildAppearanceConclusion,TopicRouteRunner};
