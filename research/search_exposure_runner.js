'use strict';

const {YouTubeEnrichedTopicTransitionRunner}=require('./youtube_enriched_runner');
const {surfaceItems,surfaceScrollPoint}=require('./topic_transition_runner');

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,Math.max(0,Number(ms)||0)));}
function clean(value){return String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim();}
function normalized(value){return clean(value).toLowerCase();}
function folded(value){return normalized(value).normalize('NFD').replace(/\p{M}+/gu,'').replace(/đ/g,'d');}
function terms(value){return [...new Set(folded(value).split(/[^\p{L}\p{N}+#._-]+/gu).map(x=>x.trim()).filter(x=>x.length>=2))];}
function ageHours(iso,at=Date.now()){
  const ts=Date.parse(String(iso||''));if(!Number.isFinite(ts))return null;
  return Math.max(0,(Number(at)-ts)/3600000);
}
function numeric(value){const n=Number(value);return Number.isFinite(n)?n:null;}
function matchTerms(values,queryTerms){
  const text=folded((values||[]).join(' '));return queryTerms.filter(term=>text.includes(term));
}
function queryEvidence(api,query){
  const q=normalized(query),qFolded=folded(query),qTerms=terms(query);
  const title=normalized(api?.title),description=normalized(api?.descriptionExcerpt),tags=(api?.tags||[]).map(normalized),topics=(api?.topicLabels||[]).map(normalized),channelKeywords=(api?.channel?.keywords||[]).map(normalized);
  const titleTerms=matchTerms([title],qTerms),tagTerms=matchTerms(tags,qTerms),descriptionTerms=matchTerms([description],qTerms),topicTerms=matchTerms(topics,qTerms),channelTerms=matchTerms(channelKeywords,qTerms);
  const titlePhrase=Boolean(q&&(title.includes(q)||folded(title).includes(qFolded))),tagPhrase=Boolean(q&&tags.some(x=>x.includes(q)||folded(x).includes(qFolded))),descriptionPhrase=Boolean(q&&(description.includes(q)||folded(description).includes(qFolded)));
  const coverage=qTerms.length?titleTerms.length/qTerms.length:0;
  const heuristicScore=Number((Number(titlePhrase)*4+coverage*3+Number(tagPhrase)*1.25+Math.min(1,tagTerms.length/Math.max(1,qTerms.length))*1.25+Number(descriptionPhrase)*0.75+Math.min(1,topicTerms.length)*0.5+Math.min(1,channelTerms.length/Math.max(1,qTerms.length))*0.35).toFixed(3));
  return {query:clean(query),queryTerms:qTerms,titlePhrase,tagPhrase,descriptionPhrase,titleTerms,tagTerms,descriptionTerms,topicTerms,channelKeywordTerms:channelTerms,heuristicScore,heuristicOnly:true};
}
function compactApi(api,at=Date.now()){
  if(!api)return null;
  const videoAge=ageHours(api.publishedAt,at),channelAge=ageHours(api.channel?.publishedAt,at),viewCount=numeric(api.statistics?.viewCount);
  return {
    videoId:api.videoId||null,title:api.title||null,publishedAt:api.publishedAt||null,videoAgeHours:videoAge==null?null:Number(videoAge.toFixed(4)),channelId:api.channelId||null,channelTitle:api.channelTitle||null,
    categoryId:api.categoryId||null,tags:(api.tags||[]).slice(0,40),topicLabels:api.topicLabels||[],statistics:api.statistics||{},lifetimeViewsPerHour:videoAge&&viewCount!=null?Number((viewCount/Math.max(videoAge,1/60)).toFixed(2)):null,
    channel:api.channel?{channelId:api.channel.channelId||null,title:api.channel.title||null,publishedAt:api.channel.publishedAt||null,channelAgeHours:channelAge==null?null:Number(channelAge.toFixed(4)),country:api.channel.country||null,statistics:api.channel.statistics||{},keywords:(api.channel.keywords||[]).slice(0,30),topicLabels:api.channel.topicLabels||[]}:null
  };
}
function canonicalSearchRows(obs){
  const rows=surfaceItems(obs).filter(x=>x?.videoId&&x.surface==='search_results'&&x.semanticTitle!==false);
  const byId=new Map();
  for(const row of rows){const id=String(row.videoId);const current=byId.get(id);if(!current||Number(row.position||9999)<Number(current.position||9999))byId.set(id,row);}
  return [...byId.values()].sort((a,b)=>Number(a.position||9999)-Number(b.position||9999));
}

class SearchExposureRunner extends YouTubeEnrichedTopicTransitionRunner {
  constructor(config,client=null,options={}){
    super(config,client,options);
    this.searchScans=[];this.environmentCondition=null;this.trackedVideoApi=null;this.trackedVideoHistory=[];
  }
  captureEnvironmentCondition(){
    const env=this.browser?.environment||{};
    this.environmentCondition={browserInstanceId:this.browser?.browserInstanceId||null,extensionInstanceId:this.browser?.extensionInstanceId||null,publicIp:env.publicIp||null,environmentSignature:env.environmentSignature||null,status:env.status||null,eligible:env.eligible===true,reasons:Array.isArray(env.reasons)?env.reasons:[]};
    this.log('environment_condition',{browserInstanceId:this.environmentCondition.browserInstanceId,publicIp:this.environmentCondition.publicIp,status:this.environmentCondition.status,eligible:this.environmentCondition.eligible});
  }
  async refreshTrackedVideo(){
    if(!this.youtubeEnricher.enabled)throw new Error('youtube_data_api_required_for_search_exposure');
    const id=String(this.config.trackVideoId||'');if(!id)throw new Error('track_video_id_required');
    const existing=this.youtubeEnricher.videoCache.get(id);const channelId=existing?.channelId||this.trackedVideoApi?.channelId||null;
    this.youtubeEnricher.videoCache.delete(id);if(channelId)this.youtubeEnricher.channelCache.delete(String(channelId));
    const map=await this.youtubeEnricher.enrichVideoIds([id]);const api=map.get(id)||null;
    if(!api)throw new Error(`tracked_video_not_public_or_api_missing:${id}`);
    this.trackedVideoApi=api;const at=Date.now();const row={at,atIso:new Date(at).toISOString(),api:compactApi(api,at)};this.trackedVideoHistory.push(row);this.log('tracked_video_metadata',{videoId:id,videoAgeHours:row.api.videoAgeHours,channelAgeHours:row.api.channel?.channelAgeHours??null,viewCount:row.api.statistics?.viewCount||null});return api;
  }
  async openSearch(query,{sampleIndex=0,queryIndex=0}={}){
    let obs=await this.observe(`search_${sampleIndex}_${queryIndex}_initial`);
    if(obs.route?.pageType!=='home')obs=await this.goHome(`search_${sampleIndex}_${queryIndex}_home`);
    if(!obs.controls?.searchInput?.actionRect)obs=await this.waitFor(o=>Boolean(o.controls?.searchInput?.actionRect),{timeoutMs:8000,reason:`search_${sampleIndex}_${queryIndex}_control`});
    const r=obs.controls.searchInput.actionRect;
    await this.intent({type:'click',x:r.centerX,y:r.centerY,width:r.width,height:r.height,role:'textbox'});
    await this.intent({type:'keyCombo',key:'Control+a'});
    await this.intent({type:'typeText',x:r.centerX,y:r.centerY,width:r.width,height:r.height,role:'textbox',text:String(query)});
    await this.intent({type:'pressKey',key:'Enter'});
    return this.waitFor(o=>o.route?.pageType==='search'&&canonicalSearchRows(o).length>0,{timeoutMs:12000,intervalMs:300,reason:`search_${sampleIndex}_${queryIndex}_results`});
  }
  async scanQuery(query,{sampleIndex=0,queryIndex=0}={}){
    await this.refreshTrackedVideo();
    let obs=await this.openSearch(query,{sampleIndex,queryIndex});
    const seen=new Map();let target=null;let previousMaxRank=0;let stagnantScrolls=0;let scrolls=0;
    for(let pass=0;pass<=this.config.maxSearchScrolls;pass++){
      if(pass>0)obs=await this.observe(`search_${sampleIndex}_${queryIndex}_scan_${pass}`);
      const rows=canonicalSearchRows(obs);
      for(const row of rows){const id=String(row.videoId);const current=seen.get(id);if(!current||Number(row.position||9999)<Number(current.position||9999))seen.set(id,row);}
      const tracked=rows.find(x=>String(x.videoId)===String(this.config.trackVideoId));if(tracked&&!target)target={...tracked,firstSeenPass:pass};
      const maxRank=rows.reduce((m,x)=>Math.max(m,Number(x.position||0)),0);
      if(maxRank>=this.config.maxSearchRank)break;
      if(pass>=this.config.maxSearchScrolls)break;
      if(maxRank<=previousMaxRank)stagnantScrolls++;else stagnantScrolls=0;
      previousMaxRank=Math.max(previousMaxRank,maxRank);if(stagnantScrolls>=2)break;
      const point=surfaceScrollPoint(obs,'search_results');
      await this.intent({type:'moveTo',x:point.x,y:point.y,role:point.scoped?'scroll_container':'page'});
      await this.intent({type:'scrollVertical',delta:this.config.searchScrollDelta});scrolls++;
      this.log('search_scan_scroll',{query,sampleIndex,queryIndex,pass:pass+1,maxObservedRank:maxRank,scrollX:point.x,scrollY:point.y,delta:this.config.searchScrollDelta});
      await sleep(this.config.searchSettleMs);
    }
    obs=await this.observe(`search_${sampleIndex}_${queryIndex}_final`);
    for(const row of canonicalSearchRows(obs)){const id=String(row.videoId);const current=seen.get(id);if(!current||Number(row.position||9999)<Number(current.position||9999))seen.set(id,row);}
    const all=[...seen.values()].sort((a,b)=>Number(a.position||9999)-Number(b.position||9999));
    const finalTarget=all.find(x=>String(x.videoId)===String(this.config.trackVideoId));if(finalTarget)target={...finalTarget,firstSeenPass:target?.firstSeenPass??null};
    const at=Date.now(),trackApi=this.trackedVideoApi;
    const competitors=all.slice(0,this.config.competitorSampleLimit).map(row=>({rank:Number(row.position||0)||null,videoId:String(row.videoId),title:row.youtubeApi?.title||row.title||null,channelTitle:row.youtubeApi?.channelTitle||row.channel||null,categoryId:row.youtubeApi?.categoryId||null,publishedAt:row.youtubeApi?.publishedAt||null,videoAgeHours:ageHours(row.youtubeApi?.publishedAt,at),viewCount:numeric(row.youtubeApi?.statistics?.viewCount),queryEvidence:queryEvidence(row.youtubeApi,query)}));
    const result={
      sampleIndex,queryIndex,query:clean(query),isHeadQuery:folded(query)===folded(this.config.headQuery),at,atIso:new Date(at).toISOString(),trackedVideoId:String(this.config.trackVideoId),seen:Boolean(target),rank:target?Number(target.position||0)||null:null,surface:target?.surface||null,firstSeenPass:target?.firstSeenPass??null,
      scannedUniqueVideos:all.length,maxObservedRank:all.reduce((m,x)=>Math.max(m,Number(x.position||0)),0),scrolls,queryEvidence:queryEvidence(trackApi,query),trackedVideo:compactApi(trackApi,at),competitors
    };
    this.searchScans.push(result);this.log('search_exposure_snapshot',{query:result.query,sampleIndex,seen:result.seen,rank:result.rank,maxObservedRank:result.maxObservedRank,scrolls:result.scrolls,isHeadQuery:result.isHeadQuery});return result;
  }
  summary(){
    const byQuery={};
    for(const scan of this.searchScans){const key=scan.query;const list=byQuery[key]||(byQuery[key]=[]);list.push({sampleIndex:scan.sampleIndex,at:scan.at,seen:scan.seen,rank:scan.rank,maxObservedRank:scan.maxObservedRank,heuristicRelevance:scan.queryEvidence.heuristicScore});}
    const firstHead=this.searchScans.find(x=>x.isHeadQuery&&x.seen)||null;
    return {mode:'search_exposure',trackVideoId:this.config.trackVideoId,headQuery:this.config.headQuery,queries:this.config.queries,samples:this.config.samples,maxSearchRank:this.config.maxSearchRank,byQuery,headKeywordFirstSeen:firstHead?{at:firstHead.at,rank:firstHead.rank,sampleIndex:firstHead.sampleIndex}:null,interpretationBoundary:'DOM search rank is observed evidence. queryEvidence.heuristicScore is a research diagnostic only and is not a YouTube ranking score. The lab does not create views, clicks, likes, comments, subscribers, or other synthetic engagement.'};
  }
  async run(){
    try{
      await this.selectBrowser();this.captureEnvironmentCondition();await this.createTask();
      for(let sampleIndex=0;sampleIndex<this.config.samples;sampleIndex++){
        for(let queryIndex=0;queryIndex<this.config.queries.length;queryIndex++)await this.scanQuery(this.config.queries[queryIndex],{sampleIndex,queryIndex});
        if(sampleIndex<this.config.samples-1)await sleep(this.config.sampleIntervalSec*1000);
      }
      return this.complete('search_exposure_complete',{step:0,searchExposure:this.summary()});
    }catch(error){
      this.log('runner_error',{error:String(error?.stack||error)});await this.req('TASK_FAIL',{taskId:this.taskId,error:String(error?.message||error)}).catch(finalizeError=>this.log('task_finalize_error',{operation:'TASK_FAIL',error:String(finalizeError?.message||finalizeError)}));this.endedAt=Date.now();const report=this.report('error',{error:String(error?.stack||error),searchExposure:this.summary()});this.writeReport(report);throw error;
    }finally{await this.client.close().catch(()=>{});}
  }
  report(outcome,extra={}){
    const report=super.report(outcome,extra);
    return {...report,environmentCondition:this.environmentCondition,trackedVideoHistory:this.trackedVideoHistory,searchScans:this.searchScans,searchExposure:extra.searchExposure||this.summary(),guardrails:{...report.guardrails,observeSearchOnly:true,syntheticEngagement:false}};
  }
}

module.exports={SearchExposureRunner,queryEvidence,compactApi,canonicalSearchRows,ageHours,folded};