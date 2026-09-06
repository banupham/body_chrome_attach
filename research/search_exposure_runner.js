'use strict';

const {YouTubeEnrichedTopicTransitionRunner}=require('./youtube_enriched_runner');
const {surfaceItems,surfaceScrollPoint}=require('./topic_transition_runner');

const STOP=new Set(['video','official','youtube','channel','full','new','best','top','hay','moi','mới','nhat','nhất','cua','của','cho','voi','với','mot','một','nhung','những','cac','các','nay','này','va','và','the','and','for','with','from','this','that']);
const sleep=ms=>new Promise(r=>setTimeout(r,Math.max(0,Number(ms)||0)));
const clean=v=>String(v??'').normalize('NFKC').replace(/\s+/g,' ').trim();
const normalized=v=>clean(v).toLowerCase();
const folded=v=>normalized(v).normalize('NFD').replace(/\p{M}+/gu,'').replace(/đ/g,'d');
const numeric=v=>Number.isFinite(Number(v))?Number(v):null;

function normalizeVideoId(value){
  const raw=clean(value);if(!raw)return null;
  try{
    if(/^https?:\/\//i.test(raw)){
      const u=new URL(raw),host=u.hostname.toLowerCase();
      if(host==='youtu.be'||host.endsWith('.youtu.be')){const id=u.pathname.split('/').filter(Boolean)[0]||'';if(/^[A-Za-z0-9_-]{11}$/.test(id))return id;}
      const v=u.searchParams.get('v');if(v&&/^[A-Za-z0-9_-]{11}$/.test(v))return v;
      const parts=u.pathname.split('/').filter(Boolean),i=parts.findIndex(x=>['shorts','embed','live'].includes(x));
      if(i>=0&&/^[A-Za-z0-9_-]{11}$/.test(parts[i+1]||''))return parts[i+1];
    }
  }catch{}
  const first=raw.split(/[&#?\s]/,1)[0];if(/^[A-Za-z0-9_-]{11}$/.test(first))return first;
  const found=raw.match(/[A-Za-z0-9_-]{11}/);return found?found[0]:null;
}
function terms(value){return [...new Set(folded(value).split(/[^\p{L}\p{N}+#._-]+/gu).filter(x=>x.length>=2))];}
function discoveryTokens(value){return clean(value).split(/[^\p{L}\p{N}+#._-]+/gu).map(term=>({term,key:folded(term)})).filter(x=>x.key.length>=2&&!STOP.has(x.key));}
function ageHours(iso,at=Date.now()){const ts=Date.parse(String(iso||''));return Number.isFinite(ts)?Math.max(0,(Number(at)-ts)/3600000):null;}
function matchTerms(values,qTerms){const text=folded((values||[]).join(' '));return qTerms.filter(t=>text.includes(t));}
function queryEvidence(api,query){
  const q=folded(query),qTerms=terms(query),title=folded(api?.title),description=folded(api?.descriptionExcerpt),tags=(api?.tags||[]).map(folded),topics=(api?.topicLabels||[]).map(folded),channelKeywords=(api?.channel?.keywords||[]).map(folded);
  const titleTerms=matchTerms([title],qTerms),tagTerms=matchTerms(tags,qTerms),descriptionTerms=matchTerms([description],qTerms),topicTerms=matchTerms(topics,qTerms),channelKeywordTerms=matchTerms(channelKeywords,qTerms);
  const titlePhrase=Boolean(q&&title.includes(q)),tagPhrase=Boolean(q&&tags.some(x=>x.includes(q))),descriptionPhrase=Boolean(q&&description.includes(q)),coverage=qTerms.length?titleTerms.length/qTerms.length:0;
  const heuristicScore=Number((Number(titlePhrase)*4+coverage*3+Number(tagPhrase)*1.25+Math.min(1,tagTerms.length/Math.max(1,qTerms.length))*1.25+Number(descriptionPhrase)*0.75+Math.min(1,topicTerms.length)*0.5+Math.min(1,channelKeywordTerms.length/Math.max(1,qTerms.length))*0.35).toFixed(3));
  return {query:clean(query),queryTerms:qTerms,titlePhrase,tagPhrase,descriptionPhrase,titleTerms,tagTerms,descriptionTerms,topicTerms,channelKeywordTerms,heuristicScore,heuristicOnly:true};
}
function compactApi(api,at=Date.now()){
  if(!api)return null;const va=ageHours(api.publishedAt,at),ca=ageHours(api.channel?.publishedAt,at),views=numeric(api.statistics?.viewCount);
  return {videoId:api.videoId||null,title:api.title||null,publishedAt:api.publishedAt||null,videoAgeHours:va==null?null:Number(va.toFixed(4)),channelId:api.channelId||null,channelTitle:api.channelTitle||null,categoryId:api.categoryId||null,tags:(api.tags||[]).slice(0,40),topicLabels:api.topicLabels||[],keywords:(api.keywords||[]).slice(0,20),statistics:api.statistics||{},lifetimeViewsPerHour:va&&views!=null?Number((views/Math.max(va,1/60)).toFixed(2)):null,channel:api.channel?{channelId:api.channel.channelId||null,title:api.channel.title||null,publishedAt:api.channel.publishedAt||null,channelAgeHours:ca==null?null:Number(ca.toFixed(4)),country:api.channel.country||null,statistics:api.channel.statistics||{},keywords:(api.channel.keywords||[]).slice(0,30),topicLabels:api.channel.topicLabels||[]}:null};
}
function canonicalSearchRows(obs){
  const byId=new Map();for(const row of surfaceItems(obs).filter(x=>x?.videoId&&x.surface==='search_results'&&x.semanticTitle!==false)){const id=String(row.videoId),old=byId.get(id);if(!old||Number(row.position||9999)<Number(old.position||9999))byId.set(id,row);}
  return [...byId.values()].sort((a,b)=>Number(a.position||9999)-Number(b.position||9999));
}
function addScenario(plan,index,scenario){
  const query=clean(scenario.query),key=normalized(query);if(!key)return;
  if(index.has(key)){
    const row=plan[index.get(key)];row.roles=[...new Set([...(row.roles||[row.kind]),scenario.kind])];
    if(scenario.kind==='head_exact'){row.id=scenario.id;row.kind='head_exact';row.query=query;row.headQuery=clean(scenario.headQuery||query);row.source='head_keyword';}
    return;
  }
  index.set(key,plan.length);plan.push({...scenario,query,headQuery:scenario.headQuery?clean(scenario.headQuery):null,roles:[scenario.kind]});
}
function topTerms(api,limit=10){
  const out=[],seen=new Set(),push=term=>{term=clean(term);const key=folded(term);if(!term||term.length>60||key.length<2||STOP.has(key)||seen.has(key))return;seen.add(key);out.push(term);};
  for(const x of api?.keywords||[]){push(x?.term);if(out.length>=limit)return out;}for(const x of api?.tags||[]){push(x);if(out.length>=limit)return out;}return out;
}
function titlePhrase(api,n){return discoveryTokens(api?.title||'').slice(0,n).map(x=>x.term).join(' ');}
function capPlan(plan,limit){
  limit=Math.max(4,Number(limit)||28);if(plan.length<=limit)return plan;
  const mandatory=plan.filter(x=>x.kind==='head_exact'||x.kind==='indexing_exact_title'),others=plan.filter(x=>!mandatory.includes(x));
  return [...others.slice(0,Math.max(0,limit-mandatory.length)),...mandatory].slice(0,limit);
}
function buildScenarioPlan(api,config){
  const plan=[],index=new Map(),top=topTerms(api,10),heads=config.headQueries||[],year=new Date().getFullYear();
  (config.queries||[]).forEach((q,i)=>addScenario(plan,index,{id:`explicit_${i+1}`,kind:'explicit',query:q,source:'user'}));
  if(config.autoExplore!==false){
    addScenario(plan,index,{id:'index_exact_title',kind:'indexing_exact_title',query:api?.title,source:'video_title'});
    for(const n of [8,5,3])addScenario(plan,index,{id:`title_${n}`,kind:'indexing_title_phrase',query:titlePhrase(api,n),source:'video_title'});
    for(const n of [3,2,1])if(top.length>=n)addScenario(plan,index,{id:`semantic_${n}`,kind:'semantic_keywords',query:top.slice(0,n).join(' '),source:'youtube_api_keywords'});
    if(api?.tags?.[0])addScenario(plan,index,{id:'tag_primary',kind:'tag_probe',query:api.tags[0],source:'video_tag'});
    if(api?.channelTitle&&top[0])addScenario(plan,index,{id:'channel_topic',kind:'channel_topic_probe',query:`${api.channelTitle} ${top[0]}`,source:'channel_and_metadata'});
    for(let i=0;i<heads.length;i++){
      const head=clean(heads[i]),prefix=`head_${i+1}`;
      if(top[0])addScenario(plan,index,{id:`${prefix}_topic1`,kind:'head_plus_metadata',query:`${head} ${top[0]}`,headQuery:head,source:'head_plus_video_metadata'});
      if(top.length>=2)addScenario(plan,index,{id:`${prefix}_topic2`,kind:'head_plus_metadata',query:`${head} ${top[0]} ${top[1]}`,headQuery:head,source:'head_plus_video_metadata'});
      for(const [suffix,tail] of [['today','hôm nay'],['latest','mới nhất'],['year',String(year)]])addScenario(plan,index,{id:`${prefix}_${suffix}`,kind:'head_freshness',query:`${head} ${tail}`,headQuery:head,source:'freshness_probe'});
      const ascii=folded(head);if(ascii!==normalized(head))addScenario(plan,index,{id:`${prefix}_ascii`,kind:'head_spelling_variant',query:ascii,headQuery:head,source:'spelling_variant'});
      addScenario(plan,index,{id:`${prefix}_exact`,kind:'head_exact',query:head,headQuery:head,source:'head_keyword'});
    }
  }
  return capPlan(plan,config.maxAutoQueries);
}
function deriveCompetitorScenarios(scan,{limit=3,existingQueries=[]}={}){
  if(!scan?.isHeadQuery||!scan.headQuery||limit<=0)return [];
  const excluded=new Set(terms(scan.headQuery)),counts=new Map(),existing=new Set(existingQueries.map(folded));
  for(const c of scan.competitors||[]){const local=new Set();for(const t of discoveryTokens(c.title||'')){if(excluded.has(t.key)||local.has(t.key))continue;local.add(t.key);const row=counts.get(t.key)||{term:t.term,count:0};row.count++;counts.set(t.key,row);}}
  const ranked=[...counts.values()].sort((a,b)=>b.count-a.count||b.term.length-a.term.length),out=[];
  for(const row of ranked){if(row.count<2&&out.length)break;const query=clean(`${scan.headQuery} ${row.term}`),key=folded(query);if(existing.has(key))continue;existing.add(key);out.push({id:`competitor_${out.length+1}`,kind:'competitor_neighborhood',query,headQuery:scan.headQuery,source:'top_search_result_titles',roles:['competitor_neighborhood'],evidence:{term:row.term,competitorCount:row.count}});if(out.length>=limit)break;}
  return out;
}

class SearchExposureRunner extends YouTubeEnrichedTopicTransitionRunner{
  constructor(config,client=null,options={}){super(config,client,options);this.searchScans=[];this.environmentCondition=null;this.pristineEvidence=null;this.trackedVideoApi=null;this.trackedVideoHistory=[];this.scenarioPlan=[];}
  captureEnvironmentCondition(){const e=this.browser?.environment||{};this.environmentCondition={browserInstanceId:this.browser?.browserInstanceId||null,extensionInstanceId:this.browser?.extensionInstanceId||null,publicIp:e.publicIp||null,environmentSignature:e.environmentSignature||null,status:e.status||null,eligible:e.eligible===true,reasons:Array.isArray(e.reasons)?e.reasons:[]};}
  async validatePristineBrowser(){
    const obs=await this.observe('pristine_preflight'),tabs=this.browser?.tabs||[],yt=tabs.filter(x=>String(x.siteKey||'').includes('youtube.com')),pass=obs?.signedInState==='signed_out'&&tabs.length<=2&&yt.length===1;
    this.pristineEvidence={requested:this.config.requirePristine!==false,pass,signedInState:obs?.signedInState||null,tabCount:tabs.length,youtubeTabCount:yt.length,pageType:obs?.route?.pageType||null,limitations:'BODY verifies signed-out state and a minimal tab set. The dedicated launcher supplies the new user-data-dir.'};
    this.log('pristine_browser_check',this.pristineEvidence);if(this.config.requirePristine!==false&&!pass)throw new Error(`pristine_browser_required:signedIn=${this.pristineEvidence.signedInState}:tabs=${tabs.length}:youtubeTabs=${yt.length}`);return obs;
  }
  async refreshTrackedVideo(){
    if(!this.youtubeEnricher.enabled)throw new Error('youtube_data_api_required_for_search_exposure');const id=String(this.config.trackVideoId||'');if(!id)throw new Error('track_video_id_required');
    const old=this.youtubeEnricher.videoCache.get(id),channelId=old?.channelId||this.trackedVideoApi?.channelId||null;this.youtubeEnricher.videoCache.delete(id);if(channelId)this.youtubeEnricher.channelCache.delete(String(channelId));
    const api=(await this.youtubeEnricher.enrichVideoIds([id])).get(id)||null;if(!api)throw new Error(`tracked_video_not_public_or_api_missing:${id}`);this.trackedVideoApi=api;
    const at=Date.now(),row={at,atIso:new Date(at).toISOString(),api:compactApi(api,at)};this.trackedVideoHistory.push(row);this.log('tracked_video_metadata',{videoId:id,title:api.title||null,videoAgeHours:row.api.videoAgeHours,channelAgeHours:row.api.channel?.channelAgeHours??null,viewCount:row.api.statistics?.viewCount||null,subscriberCount:row.api.channel?.statistics?.subscriberCount||null,channelVideoCount:row.api.channel?.statistics?.videoCount||null});return api;
  }
  async openSearch(query,{sampleIndex=0,scenarioIndex=0}={}){
    let obs=await this.observe(`search_${sampleIndex}_${scenarioIndex}_initial`);if(obs.route?.pageType!=='home')obs=await this.goHome(`search_${sampleIndex}_${scenarioIndex}_home`);
    if(!obs.controls?.searchInput?.actionRect)obs=await this.waitFor(o=>Boolean(o.controls?.searchInput?.actionRect),{timeoutMs:8000,reason:`search_${scenarioIndex}_control`});const r=obs.controls.searchInput.actionRect;
    await this.intent({type:'click',x:r.centerX,y:r.centerY,width:r.width,height:r.height,role:'textbox'});await this.intent({type:'keyCombo',key:'Control+a'});await this.intent({type:'typeText',x:r.centerX,y:r.centerY,width:r.width,height:r.height,role:'textbox',text:String(query)});await this.intent({type:'pressKey',key:'Enter'});
    return this.waitFor(o=>o.route?.pageType==='search'&&canonicalSearchRows(o).length>0,{timeoutMs:12000,intervalMs:300,reason:`search_${scenarioIndex}_results`});
  }
  async scanScenario(scenario,{sampleIndex=0,scenarioIndex=0}={}){
    await this.refreshTrackedVideo();let obs=await this.openSearch(scenario.query,{sampleIndex,scenarioIndex});const seen=new Map();let target=null,previousMax=0,stagnant=0,scrolls=0;
    for(let pass=0;pass<=this.config.maxSearchScrolls;pass++){
      if(pass)obs=await this.observe(`search_${sampleIndex}_${scenarioIndex}_scan_${pass}`);const rows=canonicalSearchRows(obs);
      for(const row of rows){const id=String(row.videoId),old=seen.get(id);if(!old||Number(row.position||9999)<Number(old.position||9999))seen.set(id,row);}const hit=rows.find(x=>String(x.videoId)===String(this.config.trackVideoId));if(hit&&!target)target={...hit,firstSeenPass:pass};
      const maxRank=rows.reduce((m,x)=>Math.max(m,Number(x.position||0)),0);if(maxRank>=this.config.maxSearchRank||pass>=this.config.maxSearchScrolls)break;if(maxRank<=previousMax)stagnant++;else stagnant=0;previousMax=Math.max(previousMax,maxRank);if(stagnant>=2)break;
      const p=surfaceScrollPoint(obs,'search_results');await this.intent({type:'moveTo',x:p.x,y:p.y,role:p.scoped?'scroll_container':'page'});await this.intent({type:'scrollVertical',delta:this.config.searchScrollDelta});scrolls++;await sleep(this.config.searchSettleMs);
    }
    obs=await this.observe(`search_${sampleIndex}_${scenarioIndex}_final`);for(const row of canonicalSearchRows(obs)){const id=String(row.videoId),old=seen.get(id);if(!old||Number(row.position||9999)<Number(old.position||9999))seen.set(id,row);}
    const all=[...seen.values()].sort((a,b)=>Number(a.position||9999)-Number(b.position||9999)),finalHit=all.find(x=>String(x.videoId)===String(this.config.trackVideoId));if(finalHit)target={...finalHit,firstSeenPass:target?.firstSeenPass??null};
    const at=Date.now(),competitors=all.slice(0,this.config.competitorSampleLimit).map(row=>({rank:Number(row.position||0)||null,videoId:String(row.videoId),title:row.youtubeApi?.title||row.title||null,channelTitle:row.youtubeApi?.channelTitle||row.channel||null,categoryId:row.youtubeApi?.categoryId||null,publishedAt:row.youtubeApi?.publishedAt||null,videoAgeHours:ageHours(row.youtubeApi?.publishedAt,at),viewCount:numeric(row.youtubeApi?.statistics?.viewCount),queryEvidence:queryEvidence(row.youtubeApi,scenario.query)}));
    const result={sampleIndex,scenarioIndex,scenarioId:scenario.id,kind:scenario.kind,roles:scenario.roles||[scenario.kind],source:scenario.source,headQuery:scenario.headQuery||null,scenarioEvidence:scenario.evidence||null,query:scenario.query,isHeadQuery:scenario.kind==='head_exact',at,atIso:new Date(at).toISOString(),trackedVideoId:String(this.config.trackVideoId),seen:Boolean(target),rank:target?Number(target.position||0)||null:null,firstSeenPass:target?.firstSeenPass??null,scannedUniqueVideos:all.length,maxObservedRank:all.reduce((m,x)=>Math.max(m,Number(x.position||0)),0),scrolls,queryEvidence:queryEvidence(this.trackedVideoApi,scenario.query),trackedVideo:compactApi(this.trackedVideoApi,at),competitors};
    this.searchScans.push(result);this.log('search_exposure_snapshot',{scenarioId:scenario.id,kind:scenario.kind,query:scenario.query,sampleIndex,seen:result.seen,rank:result.rank,maxObservedRank:result.maxObservedRank});return result;
  }
  summary(){
    const byScenario={},byQuery={},headKeywords={};for(const s of this.searchScans){(byScenario[s.scenarioId]||(byScenario[s.scenarioId]=[])).push({sampleIndex:s.sampleIndex,seen:s.seen,rank:s.rank,maxObservedRank:s.maxObservedRank,query:s.query,kind:s.kind,heuristicRelevance:s.queryEvidence.heuristicScore});(byQuery[s.query]||(byQuery[s.query]=[])).push({sampleIndex:s.sampleIndex,seen:s.seen,rank:s.rank,maxObservedRank:s.maxObservedRank});if(s.isHeadQuery){const r=headKeywords[s.headQuery]||(headKeywords[s.headQuery]={query:s.headQuery,appearances:0,bestRank:null,samples:[]});r.samples.push({sampleIndex:s.sampleIndex,seen:s.seen,rank:s.rank,maxObservedRank:s.maxObservedRank});if(s.seen){r.appearances++;r.bestRank=r.bestRank==null?s.rank:Math.min(r.bestRank,s.rank);}}}
    const exact=this.searchScans.filter(x=>x.roles?.includes('indexing_exact_title'));return {mode:'new_channel_search_exposure',trackVideoId:this.config.trackVideoId,headQueries:this.config.headQueries,scenarioCount:this.scenarioPlan.length,samples:this.config.samples,maxSearchRank:this.config.maxSearchRank,indexingBaseline:{tested:Boolean(exact.length),seen:exact.some(x=>x.seen),bestRank:exact.filter(x=>x.seen).reduce((m,x)=>m==null?x.rank:Math.min(m,x.rank),null)},headKeywords,byScenario,byQuery,interpretationBoundary:'Observed Search rank is evidence from this signed-out clean-profile session. BODY heuristic relevance is not a YouTube score. No synthetic engagement is created.'};
  }
  async run(){
    try{
      await this.selectBrowser();this.captureEnvironmentCondition();await this.validatePristineBrowser();await this.createTask();const api=await this.refreshTrackedVideo();this.scenarioPlan=buildScenarioPlan(api,this.config);if(!this.scenarioPlan.length)throw new Error('search_scenario_plan_empty');this.log('search_scenario_plan',{count:this.scenarioPlan.length,queries:this.scenarioPlan.map(x=>x.query)});
      for(let sampleIndex=0;sampleIndex<this.config.samples;sampleIndex++){
        const base=this.scenarioPlan.length;for(let i=0;i<base;i++)await this.scanScenario(this.scenarioPlan[i],{sampleIndex,scenarioIndex:i});
        if(sampleIndex===0&&this.config.competitorExpansion!==false){const existing=this.scenarioPlan.map(x=>x.query);for(const scan of this.searchScans.filter(x=>x.sampleIndex===0&&x.isHeadQuery)){for(const sc of deriveCompetitorScenarios(scan,{limit:this.config.competitorExpansionLimit,existingQueries:existing})){existing.push(sc.query);this.scenarioPlan.push(sc);await this.scanScenario(sc,{sampleIndex,scenarioIndex:this.scenarioPlan.length-1});}}}
        if(sampleIndex<this.config.samples-1)await sleep(this.config.sampleIntervalSec*1000);
      }
      return this.complete('search_exposure_complete',{step:0,searchExposure:this.summary()});
    }catch(error){this.log('runner_error',{error:String(error?.stack||error)});if(this.taskId)await this.req('TASK_FAIL',{taskId:this.taskId,error:String(error?.message||error)}).catch(()=>{});this.endedAt=Date.now();this.writeReport(this.report('error',{error:String(error?.stack||error),searchExposure:this.summary()}));throw error;}
    finally{await this.client.close().catch(()=>{});}
  }
  report(outcome,extra={}){const report=super.report(outcome,extra);return {...report,environmentCondition:this.environmentCondition,pristineEvidence:this.pristineEvidence,trackedVideoHistory:this.trackedVideoHistory,scenarioPlan:this.scenarioPlan,searchScans:this.searchScans,searchExposure:extra.searchExposure||this.summary(),guardrails:{...report.guardrails,observeSearchOnly:true,syntheticEngagement:false,trackedVideoClicked:false,cleanProfileRecommended:true}};}
}

module.exports={SearchExposureRunner,queryEvidence,compactApi,canonicalSearchRows,ageHours,normalizeVideoId,buildScenarioPlan,deriveCompetitorScenarios,folded,discoveryTokens};
