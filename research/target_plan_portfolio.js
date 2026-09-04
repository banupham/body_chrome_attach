'use strict';

const {RobustKeyGraphRouteRunner,robustViewStats,searchResultSignature,searchQuerySupport}=require('./robust_key_graph_route_runner');
const {canonicalSearchRows,compactNode,publicFactorComparison,chooseNaturalNext,summarizeRuns}=require('./head_keyword_next_runner');
const {usableSeedCandidate}=require('./topic_transition_runner');
const {topicDistance}=require('./key_graph_route_runner');

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,Math.max(0,Number(ms)||0)));
const clean=value=>String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim();
const fold=value=>clean(value).toLowerCase().normalize('NFD').replace(/\p{M}+/gu,'').replace(/đ/g,'d');
const uniq=values=>[...new Set((values||[]).map(clean).filter(Boolean))];
const STOP=new Set(['the','and','for','with','from','this','that','video','youtube','channel','official','moi','nay','cho','voi','cua','tai','trong','tren','mot','nhung','cac','duoc','khong','la','co','den','khi','sau','truoc','phai']);
const GENERIC_TOPICS=new Set(['knowledge','society','lifestyle (sociology)','entertainment','hobby','people & blogs']);

const DOMAIN_RULES=Object.freeze([
  {id:'real_estate',query:'bất động sản',synonym:'nhà đất',categoryIds:['22','27'],patterns:['bất động sản','bat dong san','nhà đất','nha dat','bán nhà','ban nha','bán đất','ban dat','đất nền','dat nen','chung cư','chung cu','căn hộ','can ho','sổ hồng','so hong','môi giới','moi gioi','khu dân cư','khu dan cu']},
  {id:'gaming',query:'gaming',synonym:'game',categoryIds:['20'],patterns:['gaming','video game','gameplay','minecraft','liên quân','lien quan','geometry dash','esports']},
  {id:'finance',query:'tài chính',synonym:'đầu tư',categoryIds:[],patterns:['tài chính','tai chinh','đầu tư','dau tu','chứng khoán','chung khoan','lãi suất','lai suat','ngân hàng','ngan hang']},
  {id:'music',query:'nhạc',synonym:'âm nhạc',categoryIds:['10'],patterns:['music','âm nhạc','am nhac','bài hát','bai hat','ca sĩ','ca si']},
  {id:'news',query:'tin tức',synonym:'thời sự',categoryIds:['25'],patterns:['tin tức','tin tuc','thời sự','thoi su','news','chính trị','chinh tri']},
  {id:'sports',query:'thể thao',synonym:'bóng đá',categoryIds:['17'],patterns:['thể thao','the thao','bóng đá','bong da','football','soccer']},
  {id:'technology',query:'công nghệ',synonym:'technology',categoryIds:['28'],patterns:['công nghệ','cong nghe','technology','phần mềm','phan mem','ai ','trí tuệ nhân tạo']},
  {id:'education',query:'giáo dục',synonym:'học tập',categoryIds:['27'],patterns:['giáo dục','giao duc','học tập','hoc tap','bài học','bai hoc']},
  {id:'travel',query:'du lịch',synonym:'travel',categoryIds:['19'],patterns:['du lịch','du lich','travel','tour','khách sạn','khach san']},
  {id:'auto',query:'ô tô',synonym:'xe',categoryIds:['2'],patterns:['ô tô','o to','xe hơi','xe hoi','automotive','car review']}
]);

function tokens(value){return fold(value).split(/[^\p{L}\p{N}]+/gu).filter(x=>x.length>=2&&!STOP.has(x)&&!/^[\d.,x-]+$/u.test(x));}
function apiOf(node){return node?.youtubeApi||node||{};}
function keywordTerms(api){return uniq((api?.keywords||[]).map(x=>x?.term||x));}
function metadataText(api){return fold([api?.title,...(api?.tags||[]),...keywordTerms(api),...(api?.topicLabels||[]),...(api?.channel?.keywords||[]),...(api?.channel?.topicLabels||[])].join(' | '));}
function inferDomains(api){
  const text=metadataText(api),category=String(api?.categoryId||''),rows=[];
  for(const rule of DOMAIN_RULES){let score=rule.categoryIds.includes(category)?2:0;for(const pattern of rule.patterns)if(text.includes(fold(pattern)))score++;if(score>0)rows.push({...rule,score});}
  return rows.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
}
function phraseTokens(value){return [...new Set(tokens(value))];}
function channelTokenStats(api){
  const keywords=uniq(api?.channel?.keywords||[]),counts=new Map();
  for(const phrase of keywords)for(const token of phraseTokens(phrase))counts.set(token,(counts.get(token)||0)+1);
  return [...counts.entries()].map(([token,count])=>({token,count})).sort((a,b)=>b.count-a.count||a.token.localeCompare(b.token));
}
function channelCentroidQuery(api){
  const stats=channelTokenStats(api),top=stats.filter(x=>x.count>=2).slice(0,3).map(x=>x.token);if(top.length<2)return null;
  const phrases=uniq(api?.channel?.keywords||[]).map(phrase=>({phrase,folded:fold(phrase),tokens:phraseTokens(phrase)}));
  const anchor=phrases.find(row=>top.every(t=>row.tokens.includes(t)))||phrases.find(row=>top.slice(0,2).every(t=>row.tokens.includes(t)));
  if(anchor){const ordered=anchor.tokens.filter(t=>top.includes(t));if(ordered.length>=2)return ordered.slice(0,3).join(' ');}
  return top.join(' ');
}
function representativeChannelPhrase(api,exclude=[]){
  const excluded=new Set(exclude.map(fold)),stats=new Map(channelTokenStats(api).map(x=>[x.token,x.count]));
  const rows=[];for(const phrase of uniq(api?.channel?.keywords||[])){const ts=tokens(phrase);if(ts.length<2||ts.length>5||excluded.has(fold(phrase))||/\d/u.test(phrase))continue;const score=ts.reduce((s,t)=>s+(stats.get(t)||0),0);rows.push({phrase:clean(phrase),score});}
  return rows.sort((a,b)=>b.score-a.score||a.phrase.length-b.phrase.length)[0]?.phrase||null;
}
function specificTopicQuery(api){const topics=uniq([...(api?.topicLabels||[]),...(api?.channel?.topicLabels||[])]).filter(x=>!GENERIC_TOPICS.has(fold(x)));return topics[0]||null;}
function forbiddenDirectQuery(query,api,videoId){
  const q=fold(query),title=fold(api?.title||''),id=fold(videoId);if(!q||q===id||q===title)return true;
  const qt=tokens(query),tt=new Set(tokens(api?.title||'')),overlap=qt.filter(x=>tt.has(x)).length/Math.max(1,qt.length);
  return qt.length>=5&&title.includes(q)&&overlap>=0.8;
}
function makePlan(id,query,traversal,source,priority,extra={}){return {id,query:clean(query),traversal,querySource:source,priority,directTargetTitleSearch:false,targetIdSearch:false,...extra};}
function buildTargetPlanPortfolio(api,{trackVideoId=null,budget=6}={}){
  const domains=inferDomains(api),plans=[],top=domains[0]||null,centroid=channelCentroidQuery(api),representative=representativeChannelPhrase(api,[centroid]),topic=specificTopicQuery(api);
  if(top){plans.push(makePlan(`domain_cluster_${top.id}`,top.query,'cluster_deepening','target_domain_inference',100,{metadataUsage:'broad_profile'}));plans.push(makePlan(`domain_cross_${top.id}`,top.query,'cross_topic','target_domain_inference',88,{metadataUsage:'broad_profile'}));if(top.synonym&&fold(top.synonym)!==fold(top.query))plans.push(makePlan(`domain_synonym_${top.id}`,top.synonym,'cluster_deepening','target_domain_synonym',94,{metadataUsage:'broad_profile'}));}
  if(centroid)plans.push(makePlan('channel_centroid_cluster',centroid,'cluster_deepening','target_channel_keyword_centroid',98,{metadataUsage:'channel_profile'}));
  if(representative)plans.push(makePlan('channel_phrase_natural',representative,'natural','target_channel_keyword_phrase',84,{metadataUsage:'channel_profile'}));
  if(topic)plans.push(makePlan('topic_profile_cross',topic,'cross_topic','target_topic_profile',72,{metadataUsage:'topic_profile'}));
  if(!plans.length){const fallback=api?.categoryId==='20'?'gaming':api?.categoryId==='10'?'nhạc':api?.categoryId==='17'?'thể thao':'đời sống';plans.push(makePlan('category_fallback_cluster',fallback,'cluster_deepening','target_category_fallback',50,{metadataUsage:'category_only'}));plans.push(makePlan('category_fallback_natural',fallback,'natural','target_category_fallback',45,{metadataUsage:'category_only'}));}
  const seen=new Set(),safe=[];for(const plan of plans.sort((a,b)=>b.priority-a.priority)){const key=`${fold(plan.query)}|${plan.traversal}`;if(seen.has(key)||forbiddenDirectQuery(plan.query,api,trackVideoId))continue;seen.add(key);safe.push(plan);}
  return safe.slice(0,Math.max(1,Math.min(10,Number(budget)||6)));
}

function buildTargetFingerprint(api){
  const domains=inferDomains(api).slice(0,3).map(x=>x.id),channelStats=channelTokenStats(api).slice(0,14),titleTokens=tokens(api?.title||'').slice(0,18),topics=uniq([...(api?.topicLabels||[]),...(api?.channel?.topicLabels||[])]).map(fold);
  return {videoId:api?.videoId||null,categoryId:String(api?.categoryId||''),domains,channelTokens:channelStats,titleTokens,topics,country:String(api?.channel?.country||'').toUpperCase(),evaluationOnly:true};
}
function scoreTargetProximity(node,fingerprint){
  const api=apiOf(node),blobTokens=new Set(tokens([api?.title,...(api?.tags||[]),...keywordTerms(api),...(api?.channel?.keywords||[])].join(' | '))),nodeDomains=new Set(inferDomains(api).map(x=>x.id));
  const totalWeight=fingerprint.channelTokens.reduce((s,x)=>s+x.count,0)||1,channelOverlap=fingerprint.channelTokens.reduce((s,x)=>s+(blobTokens.has(x.token)?x.count:0),0)/totalWeight;
  const titleSet=new Set(fingerprint.titleTokens),nodeTitle=new Set(tokens(api?.title||node?.title||''));let titleOverlap=0;for(const t of titleSet)if(nodeTitle.has(t))titleOverlap++;titleOverlap/=Math.max(1,titleSet.size);
  const domainOverlap=fingerprint.domains.some(x=>nodeDomains.has(x))?1:0,nodeTopics=new Set(uniq([...(api?.topicLabels||[]),...(api?.channel?.topicLabels||[])]).map(fold));let topicOverlap=0;for(const t of fingerprint.topics)if(nodeTopics.has(t))topicOverlap++;topicOverlap/=Math.max(1,fingerprint.topics.length);
  const category=String(api?.categoryId||'')===fingerprint.categoryId&&fingerprint.categoryId?1:0,country=String(api?.channel?.country||'').toUpperCase()===fingerprint.country&&fingerprint.country?1:0;
  const score=Math.min(1,domainOverlap*.3+channelOverlap*.35+titleOverlap*.2+topicOverlap*.08+category*.05+country*.02);
  return {score:Number(score.toFixed(3)),domainOverlap:Boolean(domainOverlap),channelTokenOverlap:Number(channelOverlap.toFixed(3)),titleTokenOverlap:Number(titleOverlap.toFixed(3)),topicOverlap:Number(topicOverlap.toFixed(3)),sameCategory:Boolean(category),sameCountry:Boolean(country),evaluationOnly:true};
}

function usableRouteCandidate(row,visited,targetId){return Boolean(row?.videoId&&String(row.videoId)!==String(targetId||'')&&row.semanticTitle!==false&&row.isRadio!==true&&String(row.path||'').startsWith('/watch')&&!visited.has(String(row.videoId)));}
function chooseClusterDeepening(rows,source,visited,targetId){
  const scored=[];for(const row of rows||[]){if(!usableRouteCandidate(row,visited,targetId))continue;const f=publicFactorComparison(source,row),distance=topicDistance(source,row),stats=robustViewStats(row),videoAffinity=(f.sharedTags?.length||0)*4+(f.sharedKeywords?.length||0)*2.2+(f.sharedTopics?.length||0)*4+Math.min(4,f.sharedTitleTokens?.length||0)*.45+Number(f.sameCategory)*1.4+Number(f.sameLanguage)*.3,channelAffinity=Math.min(3,(f.sharedChannelKeywords?.length||0)*.25+(f.sharedChannelTopics?.length||0)*.45+Number(f.sameChannel)*1.2),score=videoAffinity+channelAffinity+(1-distance)*4+Math.min(2.5,Math.log10(1+stats.viewsPerHour))*.55-Number(row.position||99)*.025;scored.push({row,factors:f,score:Number(score.toFixed(3)),topicDistance:Number(distance.toFixed(3))});}
  return scored.sort((a,b)=>b.score-a.score||Number(a.row.position||9999)-Number(b.row.position||9999))[0]||null;
}

function planObservedNodes(run){const out=[];for(const s of run?.searchSeeds||[])if(s?.candidate)out.push({node:s.candidate,where:'search',depth:0});for(const branch of run?.branches||[]){if(branch?.seed)out.push({node:branch.seed,where:'seed',depth:0});for(const hop of branch?.hops||[]){if(hop?.source)out.push({node:hop.source,where:'source',depth:Number(hop.depth||0)});for(const c of hop?.candidates||[])if(c?.candidate)out.push({node:c.candidate,where:'related',depth:Number(hop.depth||0)});}}for(const c of run?.homeAfterPlan?.candidates||[])if(c?.candidate)out.push({node:c.candidate,where:'home',depth:null});return out;}
function closestObserved(run,fingerprint){let best=null;for(const row of planObservedNodes(run)){const evidence=scoreTargetProximity(row.node,fingerprint),candidate={videoId:row.node?.videoId||null,title:row.node?.title||null,where:row.where,depth:row.depth,proximity:evidence};if(!best||candidate.proximity.score>best.proximity.score)best=candidate;}return best;}
function branchTargetRoute(branch){for(const hop of branch?.hops||[]){if(hop?.targetExposure?.seen){const depth=Number(hop.depth||1),nodes=[{type:'search_seed',videoId:branch.seedVideoId,title:branch.seed?.title||null}];for(const prior of (branch.hops||[]).filter(x=>Number(x.depth||0)<depth)){if(prior.nextSelection)nodes.push({type:'clicked_related',videoId:prior.nextSelection.videoId,title:prior.nextSelection.title||null,bridge:prior.nextSelection.reason||null});}nodes.push({type:'target_exposure',videoId:null,surface:hop.targetExposure.surface,rank:hop.targetExposure.rank,sourceVideoId:hop.sourceVideoId});return {found:true,routeType:'related',graphEdgeCount:depth+1,videoClicks:depth,relatedDepth:depth,surface:hop.targetExposure.surface,rank:hop.targetExposure.rank,sourceVideoId:hop.sourceVideoId,nodes};}}return null;}
function evaluatePlanRun(run,fingerprint,{elapsedMs=0,commandCount=0}={}){
  let best=null;if(run?.searchTargetExposure?.seen)best={found:true,routeType:'search',graphEdgeCount:1,videoClicks:0,relatedDepth:0,surface:'search_results',rank:run.searchTargetExposure.rank,sourceVideoId:null,nodes:[{type:'target_exposure',surface:'search_results',rank:run.searchTargetExposure.rank}]};
  for(const branch of run?.branches||[]){const candidate=branchTargetRoute(branch);if(candidate&&(!best||candidate.graphEdgeCount<best.graphEdgeCount||(candidate.graphEdgeCount===best.graphEdgeCount&&Number(candidate.rank||9999)<Number(best.rank||9999))))best=candidate;}
  if(!best&&run?.homeAfterPlan?.targetExposure?.seen)best={found:true,routeType:'home',graphEdgeCount:null,videoClicks:null,relatedDepth:null,surface:'home_feed',rank:run.homeAfterPlan.targetExposure.rank,sourceVideoId:null,nodes:[{type:'home_session_target_exposure',rank:run.homeAfterPlan.targetExposure.rank}],attribution:'session_aggregate'};
  const closest=closestObserved(run,fingerprint);return {found:Boolean(best),bestRoute:best,closestObserved:closest,elapsedMs,commandCount};
}
function comparePlanResults(results){
  const scored=(results||[]).map(row=>{const route=row.evaluation?.bestRoute,found=row.evaluation?.found===true,pathCost=found?(route.graphEdgeCount??(100+Number(route.rank||99))):Infinity,proximity=Number(row.evaluation?.closestObserved?.proximity?.score||0);return {...row,_pathCost:pathCost,_proximity:proximity};});
  scored.sort((a,b)=>Number(b.evaluation?.found)-Number(a.evaluation?.found)||a._pathCost-b._pathCost||Number(a.evaluation?.bestRoute?.rank||9999)-Number(b.evaluation?.bestRoute?.rank||9999)||a.evaluation.elapsedMs-b.evaluation.elapsedMs||b._proximity-a._proximity);
  return {rankedPlans:scored.map((x,i)=>({rank:i+1,planId:x.plan.id,query:x.plan.query,traversal:x.plan.traversal,found:x.evaluation.found,bestRoute:x.evaluation.bestRoute,closestObserved:x.evaluation.closestObserved,elapsedMs:x.evaluation.elapsedMs,commandCount:x.evaluation.commandCount})),shortestFoundPlan:scored.find(x=>x.evaluation.found)?.plan?.id||null,closestUnfoundPlan:scored.find(x=>!x.evaluation.found)?.plan?.id||null,comparisonMode:'shared_session_operational',orderEffectRisk:true,validationRecommendation:'Re-run the top plans one at a time with --plan-only on separate pristine Chrome sessions to confirm the shortest route.'};
}

class TargetPlanPortfolioRunner extends RobustKeyGraphRouteRunner{
  constructor(config,client=null,options={}){super(config,client,options);this.planPortfolio=[];this.planResults=[];this.activePlan=null;this.targetFingerprint=null;this.anyTargetObserved=false;}
  async createTask(){const task=await this.req('TASK_CREATE',{task:{taskId:this.taskId,browserInstanceId:this.browser.browserInstanceId,primaryTabId:this.tabId,tabIds:[this.tabId],capability:'youtube.content_discovery',policyClass:'SAFE_AUTO',internalOnly:true,goal:{capability:'youtube.content_discovery',experimentId:this.experimentId,mode:'target_plan_portfolio',trackVideoId:this.config.trackVideoId,directTargetTitleSearch:false}}});if(task.state==='READY')await this.req('TASK_START',{taskId:this.taskId});await this.req('TAB_SWITCH',{taskId:this.taskId,tabId:this.tabId});}
  async waitSearchResultsSettled(query,{beforeSignature='',reason='search_results',timeoutMs=null}={}){
    const deadline=Date.now()+Math.max(3000,Number(timeoutMs||this.config.searchResultSettleMs||12000)),required=Math.max(1,Math.min(4,Number(this.config.searchResultStableSamples||2)));let lastSignature='',stable=0,lastObs=null,lastSupport=null,lastRouteQuery='';
    while(Date.now()<deadline){lastObs=await this.observe(`${reason}_strict_settle`);const rows=canonicalSearchRows(lastObs),signature=searchResultSignature(lastObs),changed=!beforeSignature||signature!==beforeSignature;lastSupport=searchQuerySupport(lastObs,query);lastRouteQuery=clean(lastObs?.route?.searchQuery||'');const routeMatches=fold(lastRouteQuery)===fold(query);if(lastObs.route?.pageType==='search'&&rows.length>0&&changed&&routeMatches){stable=signature&&signature===lastSignature?stable+1:1;if(stable>=required){const row={query,routeSearchQuery:lastRouteQuery,beforeSignature,afterSignature:signature,stableSamples:stable,requiredStableSamples:required,support:lastSupport,resultCount:rows.length,strictRouteQueryMatch:true};this.searchSettleEvents.push(row);this.log('search_results_settled_strict',row);return lastObs;}}else stable=0;lastSignature=signature;await sleep(250);}
    if(!lastRouteQuery)throw new Error(`search_route_query_unavailable_reload_extension:${clean(query)}`);
    throw new Error(`search_results_not_settled_strict:${clean(query)}:route=${lastRouteQuery}:before=${beforeSignature}:after=${lastSignature}:support=${lastSupport?.matches||0}`);
  }
  chooseNext(scan,branchMode,visited){
    if(this.activePlan?.traversal==='natural'){const candidate=chooseNaturalNext(scan.rawRows,visited);return candidate?{candidate,selectionFactors:publicFactorComparison(scan?.lastObs?.currentVideo||scan?.source,candidate),reason:'plan_natural_top_related'}:null;}
    if(this.activePlan?.traversal==='cluster_deepening'){const choice=chooseClusterDeepening(scan.rawRows,scan?.lastObs?.currentVideo||scan?.source,visited,this.config.trackVideoId);return choice?{candidate:choice.row,selectionFactors:choice.factors,transitionEvidence:{clusterDeepening:{score:choice.score,topicDistance:choice.topicDistance,targetMetadataUsed:false}},reason:'plan_source_cluster_deepening'}:null;}
    return super.chooseNext(scan,branchMode,visited);
  }
  async executePlan(plan){
    const old={seedCount:this.config.seedCount,maxHops:this.config.maxHops,homeObserveOnTopicShift:this.config.homeObserveOnTopicShift},started=Date.now(),commandStart=this.bodyCommandIds.length;this.activePlan=plan;this.targetObserved=false;this.config.seedCount=Math.max(2,Math.min(8,Number(this.config.planSeedCount||2)+2));this.config.maxHops=Math.max(1,Math.min(6,Number(this.config.planMaxHops||4)));this.config.homeObserveOnTopicShift=this.config.planHomeCheckpoints!==false;
    const run={planId:plan.id,plan,query:plan.query,queryOrigin:'target_profile_plan',searchSeeds:[],branches:[],homeAfterPlan:null,status:'running'};
    try{
      const pool=await this.collectSearchSeeds(plan.query);run.trackedVideoHeadKeywordEvidence=pool.trackedVideoHeadKeywordEvidence;run.searchTargetExposure=pool.searchTargetExposure;run.resultSignature=pool.resultSignature;run.searchSeeds=pool.compactSeeds;if(pool.searchTargetExposure?.seen)this.targetObserved=true;
      if(!this.targetObserved){const desired=Math.max(1,Math.min(4,Number(this.config.planSeedCount||2))),completedTarget=desired;let completed=0;for(const seed of pool.seeds){if(completed>=completedTarget||this.targetObserved)break;const branch=await this.exploreBranch(plan.query,seed,'source_bridge');run.branches.push(branch);if(branch.status!=='skipped'){completed++;if(this.config.planHomeCheckpoints!==false)await this.maybeCheckpointHome({query:plan.query,branch,origin:`plan_${plan.id}`});}}}
      if(this.config.homeExplore!==false&&!this.targetObserved){run.homeAfterPlan=await this.scanHome(`plan_${fold(plan.id).replace(/[^a-z0-9]+/g,'_').slice(0,28)}`,{navigate:true});if(run.homeAfterPlan?.targetExposure?.seen)this.targetObserved=true;}
      run.status='completed';
    }catch(error){run.status='failed';run.error=String(error?.message||error);this.log('target_plan_failed',{planId:plan.id,query:plan.query,reason:run.error});}
    finally{this.config.seedCount=old.seedCount;this.config.maxHops=old.maxHops;this.config.homeObserveOnTopicShift=old.homeObserveOnTopicShift;this.activePlan=null;}
    const evaluation=evaluatePlanRun(run,this.targetFingerprint,{elapsedMs:Date.now()-started,commandCount:this.bodyCommandIds.length-commandStart});const result={plan,run,evaluation};this.planResults.push(result);this.headKeywordRuns.push(run);if(evaluation.found)this.anyTargetObserved=true;this.log('target_plan_complete',{planId:plan.id,query:plan.query,traversal:plan.traversal,found:evaluation.found,routeType:evaluation.bestRoute?.routeType||null,graphEdgeCount:evaluation.bestRoute?.graphEdgeCount??null,closestScore:evaluation.closestObserved?.proximity?.score||0,elapsedMs:evaluation.elapsedMs});return result;
  }
  async run(){
    try{
      await this.selectBrowser();await this.createTask();this.captureEnvironment();await this.validatePristine();await this.loadTrackedVideo();this.targetFingerprint=buildTargetFingerprint(this.trackedVideoApi);this.planPortfolio=buildTargetPlanPortfolio(this.trackedVideoApi,{trackVideoId:this.config.trackVideoId,budget:this.config.planBudget||6});if(this.config.planOnly){const wanted=fold(this.config.planOnly);this.planPortfolio=this.planPortfolio.filter(p=>fold(p.id)===wanted||fold(p.query)===wanted);if(!this.planPortfolio.length)throw new Error(`target_plan_not_found:${this.config.planOnly}`);}this.log('target_plan_portfolio_created',{targetVideoId:this.config.trackVideoId,planCount:this.planPortfolio.length,plans:this.planPortfolio.map(p=>({id:p.id,query:p.query,traversal:p.traversal,source:p.querySource}))});
      if(this.config.homeExplore!==false)this.homeDiscovery.baseline=await this.scanHome('target_portfolio_baseline',{navigate:false});
      for(const plan of this.planPortfolio){if(Date.now()-this.startedAt>this.config.maxRuntimeSec*1000)break;await this.executePlan(plan);if(this.config.stopAfterFirstTarget===true&&this.anyTargetObserved)break;}
      await this.loadTrackedVideo({refresh:true});const comparison=comparePlanResults(this.planResults),factorSummary=summarizeRuns(this.headKeywordRuns);return this.complete('target_plan_portfolio_complete',{mode:'target_profile_multi_plan_discovery',targetFingerprint:this.targetFingerprint,planPortfolio:this.planPortfolio,planResults:this.planResults,portfolioComparison:comparison,headKeywordRuns:this.headKeywordRuns,homeDiscovery:this.homeDiscovery,factorSummary});
    }catch(error){this.log('runner_error',{error:String(error?.stack||error)});await this.req('TASK_FAIL',{taskId:this.taskId,error:String(error?.message||error)}).catch(()=>{});this.endedAt=Date.now();const report=this.report('error',{error:String(error?.stack||error),targetFingerprint:this.targetFingerprint,planPortfolio:this.planPortfolio,planResults:this.planResults,portfolioComparison:comparePlanResults(this.planResults)});this.writeReport(report);throw error;}finally{await this.client.close().catch(()=>{});}
  }
  report(outcome,extra={}){const base=super.report(outcome,extra),comparison=extra.portfolioComparison||comparePlanResults(this.planResults),found=comparison.rankedPlans?.find(x=>x.found)||null,appearance=found?{status:'OBSERVED',mechanism:String(found.bestRoute?.routeType||'unknown').toUpperCase(),firstObserved:{planId:found.planId,query:found.query,surface:found.bestRoute?.surface||null,rank:found.bestRoute?.rank||null,graphEdgeCount:found.bestRoute?.graphEdgeCount??null,videoClicks:found.bestRoute?.videoClicks??null},observedExposureCount:comparison.rankedPlans.filter(x=>x.found).length,conclusionVi:`Đã quan sát thấy video đích bằng kế hoạch ${found.planId}, query không phải tiêu đề target. Đường quan sát ngắn nhất trong session này có ${found.bestRoute?.graphEdgeCount??'không quy thuộc trực tiếp'} cạnh graph.`,causalClaim:false}: {status:'NOT_OBSERVED',mechanism:null,observedExposureCount:0,closestPlan:comparison.rankedPlans?.[0]||null,conclusionVi:'Chưa quan sát thấy video đích. Portfolio được xếp theo độ gần target để chọn kế hoạch ưu tiên cho lần pristine tiếp theo.',causalClaim:false};return {...base,tool:'BODY Target Video Multi-Plan Portfolio Lab',mode:'target_profile_multi_plan_discovery',objective:'Input is one public YouTube video ID. Build several non-title discovery plans from public target metadata, execute different traversal strategies, observe Search/Related/Home, and rank the shortest observed route to the target. The exact target title and video ID are never used as search queries and the target is never clicked.',targetFingerprint:this.targetFingerprint,planPortfolio:this.planPortfolio,planResults:this.planResults,portfolioComparison:comparison,appearanceConclusion:appearance,comparisonPolicy:{primaryMetric:'graphEdgeCount',secondaryMetrics:['videoClicks','targetRank','elapsedMs','commandCount'],sharedSessionOrderEffect:true,isolatedValidation:'Use --plan-only on a fresh Chrome for top plans.'},targetPlanPolicy:{input:'single_video_id',targetMetadataUsedToGenerateNonTitlePlans:true,directTargetTitleSearch:false,directTargetIdSearch:false,targetClicked:false,querySources:['broad_domain_inference','domain_synonym','channel_keyword_centroid','channel_keyword_phrase','topic_profile'],traversalStrategies:['cluster_deepening','cross_topic','natural']},guardrails:{...base.guardrails,targetMetadataUsedForPositiveSelection:true,targetTitleUsedAsSearchQuery:false,trackedVideoClicked:false,directTargetVideoNavigation:false,cdpGatewayModified:false}};}
}

module.exports={DOMAIN_RULES,tokens,inferDomains,channelTokenStats,channelCentroidQuery,representativeChannelPhrase,specificTopicQuery,forbiddenDirectQuery,buildTargetPlanPortfolio,buildTargetFingerprint,scoreTargetProximity,chooseClusterDeepening,evaluatePlanRun,comparePlanResults,TargetPlanPortfolioRunner};
