'use strict';

const {YouTubeEnrichedTopicTransitionRunner}=require('./youtube_enriched_runner');
const {surfaceItems,surfaceScrollPoint}=require('./topic_transition_runner');

const DISCOVERY_STOPWORDS=new Set([
  'video','official','youtube','channel','full','new','best','top','hay','moi','mới','nhat','nhất','cua','của','cho','voi','với','mot','một','nhung','những','cac','các','nay','này','va','và','the','and','for','with','from','this','that'
]);

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,Math.max(0,Number(ms)||0)));}
function clean(value){return String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim();}
function normalized(value){return clean(value).toLowerCase();}
function folded(value){return normalized(value).normalize('NFD').replace(/\p{M}+/gu,'').replace(/đ/g,'d');}
function normalizeVideoId(value){
  const raw=clean(value);
  if(!raw)return null;
  try{
    if(/^https?:\/\//i.test(raw)){
      const url=new URL(raw),host=url.hostname.toLowerCase();
      if(host==='youtu.be'||host.endsWith('.youtu.be')){
        const id=url.pathname.split('/').filter(Boolean)[0]||'';
        if(/^[A-Za-z0-9_-]{11}$/.test(id))return id;
      }
      const v=url.searchParams.get('v');
      if(v&&/^[A-Za-z0-9_-]{11}$/.test(v))return v;
      const parts=url.pathname.split('/').filter(Boolean),marker=parts.findIndex(x=>['shorts','embed','live'].includes(x));
      if(marker>=0&&/^[A-Za-z0-9_-]{11}$/.test(parts[marker+1]||''))return parts[marker+1];
    }
  }catch{}
  const first=raw.split(/[&#?\s]/,1)[0];
  if(/^[A-Za-z0-9_-]{11}$/.test(first))return first;
  const match=raw.match(/(?:^|[=\/])([A-Za-z0-9_-]{11})(?=$|[&#?\/])/);
  if(match)return match[1];
  const loose=raw.match(/[A-Za-z0-9_-]{11}/);
  return loose?loose[0]:null;
}
function terms(value){return [...new Set(folded(value).split(/[^\p{L}\p{N}+#._-]+/gu).map(x=>x.trim()).filter(x=>x.length>=2))];}
function discoveryTokens(value){
  const out=[];
  for(const token of clean(value).split(/[^\p{L}\p{N}+#._-]+/gu).map(x=>x.trim()).filter(Boolean)){
    const key=folded(token);
    if(key.length<2||DISCOVERY_STOPWORDS.has(key)||DISCOVERY_STOPWORDS.has(normalized(token)))continue;
    out.push({key,term:token});
  }
  return out;
}
function ageHours(iso,at=Date.now()){
  const ts=Date.parse(String(iso||''));if(!Number.isFinite(ts))return null;
  return Math.max(0,(Number(at)-ts)/3600000);
}
function numeric(value){const n=Number(value);return Number.isFinite(n)?n:null;}
function matchTerms(values,queryTerms){const text=folded((values||[]).join(' '));return queryTerms.filter(term=>text.includes(term));}
function queryEvidence(api,query){
  const q=folded(query),qTerms=terms(query);
  const title=folded(api?.title),description=folded(api?.descriptionExcerpt),tags=(api?.tags||[]).map(folded),topics=(api?.topicLabels||[]).map(folded),channelKeywords=(api?.channel?.keywords||[]).map(folded);
  const titleTerms=matchTerms([title],qTerms),tagTerms=matchTerms(tags,qTerms),descriptionTerms=matchTerms([description],qTerms),topicTerms=matchTerms(topics,qTerms),channelKeywordTerms=matchTerms(channelKeywords,qTerms);
  const titlePhrase=Boolean(q&&title.includes(q)),tagPhrase=Boolean(q&&tags.some(x=>x.includes(q))),descriptionPhrase=Boolean(q&&description.includes(q));
  const coverage=qTerms.length?titleTerms.length/qTerms.length:0;
  const heuristicScore=Number((Number(titlePhrase)*4+coverage*3+Number(tagPhrase)*1.25+Math.min(1,tagTerms.length/Math.max(1,qTerms.length))*1.25+Number(descriptionPhrase)*0.75+Math.min(1,topicTerms.length)*0.5+Math.min(1,channelKeywordTerms.length/Math.max(1,qTerms.length))*0.35).toFixed(3));
  return {query:clean(query),queryTerms:qTerms,titlePhrase,tagPhrase,descriptionPhrase,titleTerms,tagTerms,descriptionTerms,topicTerms,channelKeywordTerms,heuristicScore,heuristicOnly:true};
}
function compactApi(api,at=Date.now()){
  if(!api)return null;
  const videoAge=ageHours(api.publishedAt,at),channelAge=ageHours(api.channel?.publishedAt,at),viewCount=numeric(api.statistics?.viewCount);
  return {
    videoId:api.videoId||null,title:api.title||null,publishedAt:api.publishedAt||null,videoAgeHours:videoAge==null?null:Number(videoAge.toFixed(4)),channelId:api.channelId||null,channelTitle:api.channelTitle||null,
    categoryId:api.categoryId||null,tags:(api.tags||[]).slice(0,40),topicLabels:api.topicLabels||[],statistics:api.statistics||{},lifetimeViewsPerHour:videoAge&&viewCount!=null?Number((viewCount/Math.max(videoAge,1/60)).toFixed(2)):null,keywords:(api.keywords||[]).slice(0,20),
    channel:api.channel?{channelId:api.channel.channelId||null,title:api.channel.title||null,publishedAt:api.channel.publishedAt||null,channelAgeHours:channelAge==null?null:Number(channelAge.toFixed(4)),country:api.channel.country||null,statistics:api.channel.statistics||{},keywords:(api.channel.keywords||[]).slice(0,30),topicLabels:api.channel.topicLabels||[]}:null
  };
}
function canonicalSearchRows(obs){
  const rows=surfaceItems(obs).filter(x=>x?.videoId&&x.surface==='search_results'&&x.semanticTitle!==false),byId=new Map();
  for(const row of rows){const id=String(row.videoId),current=byId.get(id);if(!current||Number(row.position||9999)<Number(current.position||9999))byId.set(id,row);}
  return [...byId.values()].sort((a,b)=>Number(a.position||9999)-Number(b.position||9999));
}
function addScenario(plan,seen,{id,kind,query,headQuery=null,source='auto'}){
  const text=clean(query),key=folded(text);if(!text||!key||seen.has(key))return;
  seen.add(key);plan.push({id,kind,query:text,headQuery:headQuery?clean(headQuery):null,source});
}
function topDiscoveryTerms(api,limit=8){
  const out=[],seen=new Set();
  for(const row of api?.keywords||[]){const term=clean(row?.term),key=folded(term);if(!term||term.length>60||key.length<2||seen.has(key)||DISCOVERY_STOPWORDS.has(key))continue;seen.add(key);out.push(term);if(out.length>=limit)break;}
  for(const tag of api?.tags||[]){const term=clean(tag),key=folded(term);if(!term||term.length>60||key.length<2||seen.has(key)||DISCOVERY_STOPWORDS.has(key))continue;seen.add(key);out.push(term);if(out.length>=limit)break;}
  return out;
}
function titlePhrase(api,maxTokens=8){return discoveryTokens(api?.title||'').slice(0,maxTokens).map(x=>x.term).join(' ');}
function buildScenarioPlan(api,config){
  const plan=[],seen=new Set(),top=topDiscoveryTerms(api,8),headQueries=config.headQueries||[];
  for(let i=0;i<(config.queries||[]).length;i++)addScenario(plan,seen,{id:`explicit_${i+1}`,kind:'explicit',query:config.queries[i],source:'user'});
  if(config.autoExplore!==false){
    addScenario(plan,seen,{id:'index_exact_title',kind:'indexing_exact_title',query:api?.title,source:'video_title'});
    addScenario(plan,seen,{id:'index_title_phrase',kind:'indexing_title_phrase',query:titlePhrase(api,8),source:'video_title'});
    if(top.length>=3)addScenario(plan,seen,{id:'semantic_top3',kind:'semantic_keywords',query:top.slice(0,3).join(' '),source:'youtube_api_keywords'});
    if(top.length>=2)addScenario(plan,seen,{id:'semantic_top2',kind:'semantic_keywords',query:top.slice(0,2).join(' '),source:'youtube_api_keywords'});
    if(api?.tags?.[0])addScenario(plan,seen,{id:'tag_primary',kind:'tag_probe',query:api.tags[0],source:'video_tag'});
    if(api?.channelTitle&&top[0])addScenario(plan,seen,{id:'channel_plus_topic',kind:'channel_topic_probe',query:`${api.channelTitle} ${top[0]}`,source:'channel_and_metadata'});
    const year=new Date().getFullYear();
    for(let i=0;i<headQueries.length;i++){
      const head=clean(headQueries[i]),prefix=`head_${i+1}`;
      if(top.length>=2)addScenario(plan,seen,{id:`${prefix}_longtail`,kind:'head_plus_metadata',query:`${head} ${top[0]} ${top[1]}`,headQuery:head,source:'head_plus_video_metadata'});
      else if(top[0])addScenario(plan,seen,{id:`${prefix}_longtail`,kind:'head_plus_metadata',query:`${head} ${top[0]}`,headQuery:head,source:'head_plus_video_metadata'});
      addScenario(plan,seen,{id:`${prefix}_today`,kind:'head_freshness',query:`${head} hôm nay`,headQuery:head,source:'freshness_probe'});
      addScenario(plan,seen,{id:`${prefix}_latest`,kind:'head_freshness',query:`${head} mới nhất`,headQuery:head,source:'freshness_probe'});
      addScenario(plan,seen,{id:`${prefix}_year`,kind:'head_freshness',query:`${head} ${year}`,headQuery:head,source:'freshness_probe'});
      const ascii=folded(head);if(ascii!==normalized(head))addScenario(plan,seen,{id:`${prefix}_ascii`,kind:'head_spelling_variant',query:ascii,headQuery:head,source:'spelling_variant'});
      addScenario(plan,seen,{id:`${prefix}_exact`,kind:'head_exact',query:head,headQuery:head,source:'head_keyword'});
    }
  }
  return plan.slice(0,Math.max(4,Number(config.maxAutoQueries)||28));
}
function deriveCompetitorScenarios(scan,{limit=3,existingQueries=[]}={}){
  if(!scan?.headQuery||scan.kind!=='head_exact'||limit<=0)return [];
  const excluded=new Set(terms(scan.headQuery)),counts=new Map();
  for(const competitor of scan.competitors||[]){
    const local=new Set();
    for(const token of discoveryTokens(competitor.title||'')){
      if(excluded.has(token.key)||local.has(token.key))continue;
      local.add(token.key);const row=counts.get(token.key)||{term:token.term,count:0};row.count++;counts.set(token.key,row);
    }
  }
  const existing=new Set(existingQueries.map(folded)),ranked=[...counts.entries()].map(([key,row])=>({key,...row})).sort((a,b)=>b.count-a.count||b.term.length-a.term.length),out=[];
  for(const row of ranked){
    if(row.count<2&&out.length>0)break;
    const query=clean(`${scan.headQuery} ${row.term}`);if(existing.has(folded(query)))continue;
    existing.add(folded(query));out.push({id:`competitor_${folded(scan.headQuery).replace(/[^a-z0-9]+/g,'_')}_${out.length+1}`,kind:'competitor_neighborhood',query,headQuery:scan.headQuery,source:'top_search_result_titles',evidence:{term:row.term,competitorCount:row.count}});
    if(out.length>=limit)break;
  }
  return out;
}

class SearchExposureRunner extends YouTubeEnrichedTopicTransitionRunner {
  constructor(config,client=null,options={}){
    super(config,client,options);
    this.searchScans=[];this.environmentCondition=null;this.pristineEvidence=null;this.trackedVideoApi=null;this.trackedVideoHistory=[];this.scenarioPlan=[];
  }
  captureEnvironmentCondition(){
    const env=this.browser?.environment||{};
    this.environmentCondition={browserInstanceId:this.browser?.browserInstanceId||null,extensionInstanceId:this.browser?.extensionInstanceId||null,publicIp:env.publicIp||null,environmentSignature:env.environmentSignature||null,status:env.status||null,eligible:env.eligible===true,reasons:Array.isArray(env.reasons)?env.reasons:[]};
    this.log('environment_condition',{browserInstanceId:this.environmentCondition.browserInstanceId,publicIp:this.environmentCondition.publicIp,status:this.environmentCondition.status,eligible:this.environmentCondition.eligible});
  }
  async validatePristineBrowser(){
    const obs=await this.observe('pristine_preflight'),tabs=this.browser?.tabs||[],youtubeTabs=tabs.filter(tab=>String(tab.siteKey||'').includes('youtube.com'));
    const signedOut=obs?.signedInState==='signed_out',smallTabSet=tabs.length<=2,singleYoutubeTab=youtubeTabs.length===1,pass=signedOut&&smallTabSet&&singleYoutubeTab;
    this.pristineEvidence={requested:this.config.requirePristine!==false,pass,signedInState:obs?.signedInState||null,tabCount:tabs.length,youtubeTabCount:youtubeTabs.length,pageType:obs?.route?.pageType||null,limitations:'BODY verifies signed-out state and a minimal tab set, but does not inspect or erase arbitrary Chrome cookies/history. Use research/launch_pristine_search_chrome.cmd for a new user-data-dir.'};
    this.log('pristine_browser_check',{pass,signedInState:this.pristineEvidence.signedInState,tabCount:tabs.length,youtubeTabCount:youtubeTabs.length});
    if(this.config.requirePristine!==false&&!pass)throw new Error(`pristine_browser_required:signedIn=${this.pristineEvidence.signedInState}:tabs=${tabs.length}:youtubeTabs=${youtubeTabs.length}`);
    return obs;
  }
  async refreshTrackedVideo(){
    if(!this.youtubeEnricher.enabled)throw new Error('youtube_data_api_required_for_search_exposure');
    const id=String(this.config.trackVideoId||'');if(!id)throw new Error('track_video_id_required');
    const existing=this.youtubeEnricher.videoCache.get(id),channelId=existing?.channelId||this.trackedVideoApi?.channelId||null;
    this.youtubeEnricher.videoCache.delete(id);if(channelId)this.youtubeEnricher.channelCache.delete(String(channelId));
    const map=await this.youtubeEnricher.enrichVideoIds([id]),api=map.get(id)||null;if(!api)throw new Error(`tracked_video_not_public_or_api_missing:${id}`);
    this.trackedVideoApi=api;const at=Date.now(),row={at,atIso:new Date(at).toISOString(),api:compactApi(api,at)};this.trackedVideoHistory.push(row);
    this.log('tracked_video_metadata',{videoId:id,title:api.title||null,videoAgeHours:row.api.videoAgeHours,channelAgeHours:row.api.channel?.channelAgeHours??null,viewCount:row.api.statistics?.viewCount||null,subscriberCount:row.api.channel?.statistics?.subscriberCount||null,channelVideoCount:row.api.channel?.statistics?.videoCount||null});return api;
  }
  async openSearch(query,{sampleIndex=0,scenarioIndex=0}={}){
    let obs=await this.observe(`search_${sampleIndex}_${scenarioIndex}_initial`);if(obs.route?.pageType!=='home')obs=await this.goHome(`search_${sampleIndex}_${scenarioIndex}_home`);
    if(!obs.controls?.searchInput?.actionRect)obs=await this.waitFor(o=>Boolean(o.controls?.searchInput?.actionRect),{timeoutMs:8000,reason:`search_${sampleIndex}_${scenarioIndex}_control`});
    const r=obs.controls.searchInput.actionRect;
    await this.intent({type:'click',x:r.centerX,y:r.centerY,width:r.width,height:r.height,role:'textbox'});await this.intent({type:'keyCombo',key:'Control+a'});await this.intent({type:'typeText',x:r.centerX,y:r.centerY,width:r.width,height:r.height,role:'textbox',text:String(query)});await this.intent({type:'pressKey',key:'Enter'});
    return this.waitFor(o=>o.route?.pageType==='search'&&canonicalSearchRows(o).length>0,{timeoutMs:12000,intervalMs:300,reason:`search_${sampleIndex}_${scenarioIndex}_results`});
  }
  async scanScenario(scenario,{sampleIndex=0,scenarioIndex=0}={}){
    await this.refreshTrackedVideo();let obs=await this.openSearch(scenario.query,{sampleIndex,scenarioIndex});
    const seen=new Map();let target=null,previousMaxRank=0,stagnantScrolls=0,scrolls=0;
    for(let pass=0;pass<=this.config.maxSearchScrolls;pass++){
      if(pass>0)obs=await this.observe(`search_${sampleIndex}_${scenarioIndex}_scan_${pass}`);
      const rows=canonicalSearchRows(obs);for(const row of rows){const id=String(row.videoId),current=seen.get(id);if(!current||Number(row.position||9999)<Number(current.position||9999))seen.set(id,row);}
      const tracked=rows.find(x=>String(x.videoId)===String(this.config.trackVideoId));if(tracked&&!target)target={...tracked,firstSeenPass:pass};
      const maxRank=rows.reduce((m,x)=>Math.max(m,Number(x.position||0)),0);if(maxRank>=this.config.maxSearchRank||pass>=this.config.maxSearchScrolls)break;
      if(maxRank<=previousMaxRank)stagnantScrolls++;else stagnantScrolls=0;previousMaxRank=Math.max(previousMaxRank,maxRank);if(stagnantScrolls>=2)break;
      const point=surfaceScrollPoint(obs,'search_results');await this.intent({type:'moveTo',x:point.x,y:point.y,role:point.scoped?'scroll_container':'page'});await this.intent({type:'scrollVertical',delta:this.config.searchScrollDelta});scrolls++;
      this.log('search_scan_scroll',{query:scenario.query,scenarioId:scenario.id,sampleIndex,scenarioIndex,pass:pass+1,maxObservedRank:maxRank,scrollX:point.x,scrollY:point.y,delta:this.config.searchScrollDelta});await sleep(this.config.searchSettleMs);
    }
    obs=await this.observe(`search_${sampleIndex}_${scenarioIndex}_final`);for(const row of canonicalSearchRows(obs)){const id=String(row.videoId),current=seen.get(id);if(!current||Number(row.position||9999)<Number(current.position||9999))seen.set(id,row);}
    const all=[...seen.values()].sort((a,b)=>Number(a.position||9999)-Number(b.position||9999)),finalTarget=all.find(x=>String(x.videoId)===String(this.config.trackVideoId));if(finalTarget)target={...finalTarget,firstSeenPass:target?.firstSeenPass??null};
    const at=Date.now(),trackApi=this.trackedVideoApi,competitors=all.slice(0,this.config.competitorSampleLimit).map(row=>({rank:Number(row.position||0)||null,videoId:String(row.videoId),title:row.youtubeApi?.title||row.title||null,channelTitle:row.youtubeApi?.channelTitle||row.channel||null,categoryId:row.youtubeApi?.categoryId||null,publishedAt:row.youtubeApi?.publishedAt||null,videoAgeHours:ageHours(row.youtubeApi?.publishedAt,at),viewCount:numeric(row.youtubeApi?.statistics?.viewCount),queryEvidence:queryEvidence(row.youtubeApi,scenario.query)}));
    const result={sampleIndex,scenarioIndex,scenarioId:scenario.id,kind:scenario.kind,source:scenario.source,headQuery:scenario.headQuery||null,scenarioEvidence:scenario.evidence||null,query:clean(scenario.query),isHeadQuery:scenario.kind==='head_exact',at,atIso:new Date(at).toISOString(),trackedVideoId:String(this.config.trackVideoId),seen:Boolean(target),rank:target?Number(target.position||0)||null:null,surface:target?.surface||null,firstSeenPass:target?.firstSeenPass??null,scannedUniqueVideos:all.length,maxObservedRank:all.reduce((m,x)=>Math.max(m,Number(x.position||0)),0),scrolls,queryEvidence:queryEvidence(trackApi,scenario.query),trackedVideo:compactApi(trackApi,at),competitors};
    this.searchScans.push(result);this.log('search_exposure_snapshot',{scenarioId:scenario.id,kind:scenario.kind,query:result.query,sampleIndex,seen:result.seen,rank:result.rank,maxObservedRank:result.maxObservedRank,scrolls:result.scrolls,isHeadQuery:result.isHeadQuery});return result;
  }
  summary(){
    const byScenario={},byQuery={},headKeywords={};
    for(const scan of this.searchScans){
      (byScenario[scan.scenarioId]||(byScenario[scan.scenarioId]=[])).push({sampleIndex:scan.sampleIndex,at:scan.at,seen:scan.seen,rank:scan.rank,maxObservedRank:scan.maxObservedRank,query:scan.query,kind:scan.kind,heuristicRelevance:scan.queryEvidence.heuristicScore});
      (byQuery[scan.query]||(byQuery[scan.query]=[])).push({sampleIndex:scan.sampleIndex,seen:scan.seen,rank:scan.rank,maxObservedRank:scan.maxObservedRank});
      if(scan.isHeadQuery){const row=headKeywords[scan.headQuery]||(headKeywords[scan.headQuery]={query:scan.headQuery,appearances:0,bestRank:null,firstSeenAt:null,samples:[]});row.samples.push({sampleIndex:scan.sampleIndex,seen:scan.seen,rank:scan.rank,maxObservedRank:scan.maxObservedRank});if(scan.seen){row.appearances++;row.bestRank=row.bestRank==null?scan.rank:Math.min(row.bestRank,scan.rank);if(row.firstSeenAt==null)row.firstSeenAt=scan.at;}}
    }
    const exact=this.searchScans.filter(x=>x.kind==='indexing_exact_title'),exactSeen=exact.some(x=>x.seen);
    return {mode:'new_channel_search_exposure',trackVideoId:this.config.trackVideoId,headQueries:this.config.headQueries,scenarioCount:this.scenarioPlan.length,samples:this.config.samples,maxSearchRank:this.config.maxSearchRank,indexingBaseline:{tested:exact.length>0,seen:exactSeen,bestRank:exact.filter(x=>x.seen).reduce((m,x)=>m==null?x.rank:Math.min(m,x.rank),null)},headKeywords,byScenario,byQuery,interpretationBoundary:'Observed search rank is evidence from the clean/signed-out browser session. queryEvidence.heuristicScore is only a BODY research diagnostic, not a YouTube ranking score. The lab never creates synthetic views, clicks, likes, comments, subscribers, or watch-time.'};
  }
  async run(){
    try{
      await this.selectBrowser();this.captureEnvironmentCondition();await this.validatePristineBrowser();await this.createTask();const api=await this.refreshTrackedVideo();this.scenarioPlan=buildScenarioPlan(api,this.config);if(!this.scenarioPlan.length)throw new Error('search_scenario_plan_empty');
      this.log('search_scenario_plan',{count:this.scenarioPlan.length,queries:this.scenarioPlan.map(x=>x.query)});
      for(let sampleIndex=0;sampleIndex<this.config.samples;sampleIndex++){
        const baseCount=this.scenarioPlan.length;for(let scenarioIndex=0;scenarioIndex<baseCount;scenarioIndex++)await this.scanScenario(this.scenarioPlan[scenarioIndex],{sampleIndex,scenarioIndex});
        if(sampleIndex===0&&this.config.competitorExpansion!==false&&this.config.competitorExpansionLimit>0){
          const existing=this.scenarioPlan.map(x=>x.query),headScans=this.searchScans.filter(x=>x.sampleIndex===0&&x.kind==='head_exact'),seen=new Set(existing.map(folded));
          for(const scan of headScans){for(const scenario of deriveCompetitorScenarios(scan,{limit:this.config.competitorExpansionLimit,existingQueries:[...seen]})){if(seen.has(folded(scenario.query)))continue;seen.add(folded(scenario.query));this.scenarioPlan.push(scenario);await this.scanScenario(scenario,{sampleIndex,scenarioIndex:this.scenarioPlan.length-1});}}
        }
        if(sampleIndex<this.config.samples-1)await sleep(this.config.sampleIntervalSec*1000);
      }
      return this.complete('search_exposure_complete',{step:0,searchExposure:this.summary()});
    }catch(error){
      this.log('runner_error',{error:String(error?.stack||error)});await this.req('TASK_FAIL',{taskId:this.taskId,error:String(error?.message||error)}).catch(finalizeError=>this.log('task_finalize_error',{operation:'TASK_FAIL',error:String(finalizeError?.message||finalizeError)}));this.endedAt=Date.now();const report=this.report('error',{error:String(error?.stack||error),searchExposure:this.summary()});this.writeReport(report);throw error;
    }finally{await this.client.close().catch(()=>{});}
  }
  report(outcome,extra={}){
    const report=super.report(outcome,extra);return {...report,environmentCondition:this.environmentCondition,pristineEvidence:this.pristineEvidence,trackedVideoHistory:this.trackedVideoHistory,scenarioPlan:this.scenarioPlan,searchScans:this.searchScans,searchExposure:extra.searchExposure||this.summary(),guardrails:{...report.guardrails,observeSearchOnly:true,syntheticEngagement:false,trackedVideoClicked:false,cleanProfileRecommended:true}};
  }
}

module.exports={SearchExposureRunner,queryEvidence,compactApi,canonicalSearchRows,ageHours,normalizeVideoId,buildScenarioPlan,deriveCompetitorScenarios,folded,discoveryTokens};
