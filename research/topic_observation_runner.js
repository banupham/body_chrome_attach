'use strict';

const {YouTubeEnrichedTopicTransitionRunner}=require('./youtube_enriched_runner');
const {surfaceItems,usableSeedCandidate,isGenericActionTitle,semanticArrivalReady}=require('./topic_transition_runner');
const {scoreTopic}=require('./topic_transition_policy');

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,Math.max(0,Number(ms)||0)));}
function clampNumber(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
function rectIntent(type,descriptor,extra={}){const r=descriptor?.actionRect;if(!r)throw new Error(`action_rect_required:${type}`);return {type,x:r.centerX,y:r.centerY,width:r.width,height:r.height,...extra};}
function apiViewCount(api){const n=Number(api?.statistics?.viewCount);return Number.isFinite(n)?n:null;}
function candidateAgeHours(api,observedAt=Date.now()){
  const published=Date.parse(String(api?.publishedAt||''));
  if(!Number.isFinite(published))return null;
  return Math.max(0,(Number(observedAt)-published)/3600000);
}
function normalizedLabels(values){return new Set((values||[]).map(x=>String(x||'').trim().toLowerCase()).filter(Boolean));}
function labelsOverlap(a,b){const left=normalizedLabels(a),right=normalizedLabels(b);for(const value of left)if(right.has(value))return true;return false;}
function representativeCandidates(obs){
  const rows=surfaceItems(obs).filter(x=>x?.videoId&&x.semanticTitle!==false&&['related','mix_queue'].includes(String(x.surface||'')));
  const byId=new Map();
  for(const row of rows){
    const id=String(row.videoId);const current=byId.get(id);
    if(!current){byId.set(id,row);continue;}
    const rowSurface=row.surface==='related'?0:1,currentSurface=current.surface==='related'?0:1;
    const rowRank=clampNumber(row.position,9999),currentRank=clampNumber(current.position,9999);
    if(rowSurface<currentSurface||(rowSurface===currentSurface&&rowRank<currentRank))byId.set(id,row);
  }
  return [...byId.values()];
}
function crossTopicEvidence(sourceApi,targetApi){
  const sourceCategory=String(sourceApi?.categoryId||''),targetCategory=String(targetApi?.categoryId||'');
  const categoryShift=Boolean(sourceCategory&&targetCategory&&sourceCategory!==targetCategory);
  const sourceTopics=sourceApi?.topicLabels||[],targetTopics=targetApi?.topicLabels||[];
  const topicShift=Boolean(sourceTopics.length&&targetTopics.length&&!labelsOverlap(sourceTopics,targetTopics));
  return {categoryShift,topicShift,crossTopic:categoryShift||topicShift,sourceCategoryId:sourceCategory||null,targetCategoryId:targetCategory||null};
}

class TopicObservationRunner extends YouTubeEnrichedTopicTransitionRunner {
  constructor(config,client=null,options={}){
    super(config,client,options);
    this.discoverySnapshots=[];
    this.candidateTimeline=new Map();
    this.trackedCandidateTimeline=[];
    this.discoveryStartedAt=null;
    this.sourceVideoId=null;
    this.environmentCondition=null;
    this.lastDiscoveryVideoIds=[];
  }
  captureEnvironmentCondition(){
    const env=this.browser?.environment||{};
    this.environmentCondition={
      browserInstanceId:this.browser?.browserInstanceId||null,
      extensionInstanceId:this.browser?.extensionInstanceId||null,
      publicIp:env.publicIp||null,
      environmentSignature:env.environmentSignature||null,
      status:env.status||null,
      eligible:env.eligible===true,
      reasons:Array.isArray(env.reasons)?env.reasons:[]
    };
    this.log('environment_condition',{browserInstanceId:this.environmentCondition.browserInstanceId,publicIp:this.environmentCondition.publicIp,status:this.environmentCondition.status,eligible:this.environmentCondition.eligible});
    return this.environmentCondition;
  }
  async initialSearch(){
    let obs=await this.observe('initial');
    if(obs.route?.pageType!=='home')obs=await this.goHome('initial_home');
    if(!obs.controls?.searchInput?.actionRect)obs=await this.waitFor(o=>Boolean(o.controls?.searchInput?.actionRect),{timeoutMs:8000,reason:'search_control'});
    await this.intent(rectIntent('click',obs.controls.searchInput,{role:'textbox'}));
    await this.intent({type:'keyCombo',key:'Control+a'});
    await this.intent(rectIntent('typeText',obs.controls.searchInput,{role:'textbox',text:this.config.query}));
    await this.intent({type:'pressKey',key:'Enter'});
    obs=await this.waitFor(o=>o.route?.pageType==='search'&&surfaceItems(o).filter(x=>x.surface==='search_results').length>0,{timeoutMs:12000,reason:'search_results'});
    const results=surfaceItems(obs).filter(x=>x.surface==='search_results');
    const skipped=results.filter(x=>!usableSeedCandidate(x));
    for(const candidate of skipped)this.log('candidate_skipped',{reason:isGenericActionTitle(candidate?.title)?'generic_action_label':'non_semantic_search_result',videoId:candidate?.videoId||null,surface:candidate?.surface||'search_results',position:candidate?.position||null,title:candidate?.title||null});
    const usable=results.filter(usableSeedCandidate);
    if(!usable.length)throw new Error('search_results_no_usable_video_candidate');
    let seedOrder=[];
    if(this.config.seedVideoId){
      const exact=usable.find(x=>String(x.videoId)===String(this.config.seedVideoId));
      if(!exact)throw new Error(`seed_video_not_found_in_search_results:${this.config.seedVideoId}`);
      seedOrder=[exact];
      this.log('controlled_seed_resolved',{videoId:exact.videoId,position:exact.position,isRadio:exact.isRadio===true,title:exact.title||null});
    }else{
      const preferred=usable.filter(x=>x.isRadio!==true);
      const rankSeed=preferred.find(x=>Number(x.position)===Number(this.config.seedRank));
      seedOrder=[rankSeed,...preferred,...usable.filter(x=>x.isRadio!==true),...usable].filter(Boolean).filter((x,i,a)=>a.findIndex(y=>y.videoId===x.videoId)===i);
    }
    let seed=null;
    for(const candidate of seedOrder.slice(0,Math.max(1,this.config.candidateRetryLimit))){
      if(await this.clickCandidate(candidate,{reason:'search_seed'})){seed=candidate;break;}
      this.rejected.add(candidate.videoId);this.log('candidate_rejected',{reason:'search_seed_unactionable',videoId:candidate.videoId,surface:candidate.surface});
    }
    if(!seed)throw new Error('search_seed_unactionable');
    this.visited.add(seed.videoId);this.path.push(this.pathRow(1,seed,'search_seed'));
    return this.waitFor(o=>semanticArrivalReady(o,seed),{timeoutMs:10000,intervalMs:250,reason:'seed_arrival'});
  }
  invalidatePreviousVideoStats(){
    const ids=[...new Set([this.sourceVideoId,...this.lastDiscoveryVideoIds].filter(Boolean).map(String))];
    for(const videoId of ids)this.youtubeEnricher.videoCache.delete(videoId);
    if(ids.length)this.log('youtube_api_statistics_refresh',{videoCount:ids.length});
  }
  recordDiscoverySnapshot(obs,{sampleIndex=0,observedAt=Date.now(),elapsedMs=null}={}){
    const sourceApi=obs?.currentVideo?.youtubeApi||null;
    const candidates=representativeCandidates(obs);
    const elapsed=elapsedMs==null?(this.discoveryStartedAt==null?0:observedAt-this.discoveryStartedAt):elapsedMs;
    const rows=[];
    for(const candidate of candidates){
      const api=candidate.youtubeApi||null;
      const evidence=crossTopicEvidence(sourceApi,api);
      const ageHours=candidateAgeHours(api,observedAt);
      const viewCount=apiViewCount(api);
      const topic=scoreTopic(candidate,this.config.target);
      const sample={
        at:observedAt,elapsedSec:Number((elapsed/1000).toFixed(3)),surface:candidate.surface||null,rank:Number(candidate.position||0)||null,
        isRadio:candidate.isRadio===true,visible:candidate.visible===true,targetScore:topic.targetScore,bridgeScore:topic.bridgeScore,
        categoryId:api?.categoryId||null,topicLabels:api?.topicLabels||[],publishedAt:api?.publishedAt||null,
        ageHours:ageHours==null?null:Number(ageHours.toFixed(4)),viewCount,lifetimeViewsPerHour:ageHours&&viewCount!=null?Number((viewCount/Math.max(ageHours,1/60)).toFixed(2)):null,
        fresh:ageHours!=null&&ageHours<=this.config.freshMaxAgeHours,...evidence,viewDelta:null,observedViewsPerMinute:null
      };
      let timeline=this.candidateTimeline.get(String(candidate.videoId));
      if(!timeline){
        timeline={videoId:String(candidate.videoId),title:api?.title||candidate.title||null,channelTitle:api?.channelTitle||candidate.channel||null,firstSeenAt:observedAt,firstSeenElapsedSec:sample.elapsedSec,firstSeenSurface:sample.surface,firstSeenRank:sample.rank,minRank:sample.rank,lastRank:sample.rank,appearanceCount:0,samples:[]};
        this.candidateTimeline.set(String(candidate.videoId),timeline);
      }
      const previous=timeline.samples.at(-1)||null;
      if(previous&&viewCount!=null&&previous.viewCount!=null&&observedAt>previous.at){
        sample.viewDelta=viewCount-previous.viewCount;
        sample.observedViewsPerMinute=Number((sample.viewDelta/((observedAt-previous.at)/60000)).toFixed(2));
      }
      timeline.appearanceCount++;timeline.lastRank=sample.rank;
      if(sample.rank!=null)timeline.minRank=timeline.minRank==null?sample.rank:Math.min(timeline.minRank,sample.rank);
      timeline.samples.push(sample);rows.push({videoId:String(candidate.videoId),title:timeline.title,...sample});
    }
    this.lastDiscoveryVideoIds=candidates.map(x=>String(x.videoId));
    const fresh=rows.filter(x=>x.fresh),cross=rows.filter(x=>x.crossTopic),freshCross=rows.filter(x=>x.fresh&&x.crossTopic);
    const targetRows=rows.filter(x=>x.targetScore>=this.config.targetThreshold);
    const tracked=this.config.trackVideoId?rows.find(x=>x.videoId===String(this.config.trackVideoId))||null:null;
    if(this.config.trackVideoId)this.trackedCandidateTimeline.push(tracked?{sampleIndex,seen:true,...tracked}:{sampleIndex,seen:false,at:observedAt,elapsedSec:Number((elapsed/1000).toFixed(3)),videoId:String(this.config.trackVideoId)});
    const snapshot={
      sampleIndex,at:observedAt,atIso:new Date(observedAt).toISOString(),elapsedSec:Number((elapsed/1000).toFixed(3)),sourceVideoId:obs?.route?.videoId||obs?.currentVideo?.videoId||null,
      sourceCategoryId:sourceApi?.categoryId||null,sourceTopicLabels:sourceApi?.topicLabels||[],candidateCount:rows.length,radioCandidateCount:rows.filter(x=>x.isRadio).length,
      freshCandidateCount:fresh.length,crossTopicCandidateCount:cross.length,freshCrossTopicCandidateCount:freshCross.length,targetCandidateCount:targetRows.length,
      trackedCandidate:tracked?{videoId:tracked.videoId,rank:tracked.rank,viewCount:tracked.viewCount,ageHours:tracked.ageHours,targetScore:tracked.targetScore}:null
    };
    this.discoverySnapshots.push(snapshot);
    this.log('discovery_snapshot',{sampleIndex,elapsedSec:snapshot.elapsedSec,candidateCount:snapshot.candidateCount,freshCrossTopicCandidateCount:snapshot.freshCrossTopicCandidateCount,targetCandidateCount:snapshot.targetCandidateCount,trackedRank:snapshot.trackedCandidate?.rank||null});
    return snapshot;
  }
  timelineRows(){
    return [...this.candidateTimeline.values()].map(row=>{
      const first=row.samples[0]||{},last=row.samples.at(-1)||{};
      const dtMinutes=last.at>first.at?(last.at-first.at)/60000:0;
      const totalDelta=first.viewCount!=null&&last.viewCount!=null?last.viewCount-first.viewCount:null;
      const observedViewsPerMinute=dtMinutes>0&&totalDelta!=null?Number((totalDelta/dtMinutes).toFixed(2)):null;
      return {...row,lastSeenAt:last.at||row.firstSeenAt,lastSeenElapsedSec:last.elapsedSec??row.firstSeenElapsedSec,lastRank:last.rank??row.lastRank,categoryId:last.categoryId||first.categoryId||null,topicLabels:last.topicLabels||first.topicLabels||[],publishedAt:last.publishedAt||first.publishedAt||null,latestAgeHours:last.ageHours??null,freshEver:row.samples.some(x=>x.fresh),crossTopicEver:row.samples.some(x=>x.crossTopic),targetEver:row.samples.some(x=>x.targetScore>=this.config.targetThreshold),firstViewCount:first.viewCount??null,lastViewCount:last.viewCount??null,observedViewDelta:totalDelta,observedViewsPerMinute};
    }).sort((a,b)=>(a.firstSeenElapsedSec-b.firstSeenElapsedSec)||((a.minRank??9999)-(b.minRank??9999)));
  }
  discoverySummary(){
    const rows=this.timelineRows();
    const freshCross=rows.filter(x=>x.freshEver&&x.crossTopicEver).sort((a,b)=>(b.observedViewsPerMinute??-Infinity)-(a.observedViewsPerMinute??-Infinity)||(a.minRank??9999)-(b.minRank??9999));
    const tracked=this.config.trackVideoId?rows.find(x=>x.videoId===String(this.config.trackVideoId))||null:null;
    return {
      mode:'observe_only',windowSec:this.config.discoveryWindowSec,snapshotIntervalSec:this.config.snapshotIntervalSec,freshMaxAgeHours:this.config.freshMaxAgeHours,
      seedVideoId:this.sourceVideoId||this.config.seedVideoId||null,trackVideoId:this.config.trackVideoId||null,snapshotCount:this.discoverySnapshots.length,uniqueCandidateCount:rows.length,
      freshCandidateCount:rows.filter(x=>x.freshEver).length,crossTopicCandidateCount:rows.filter(x=>x.crossTopicEver).length,freshCrossTopicCandidateCount:freshCross.length,targetCandidateCount:rows.filter(x=>x.targetEver).length,
      trackedCandidate:tracked,freshCrossTopicCandidates:freshCross.slice(0,30)
    };
  }
  async runObservationWindow(seedObs){
    this.sourceVideoId=String(seedObs?.route?.videoId||seedObs?.currentVideo?.videoId||'');
    if(!this.sourceVideoId)throw new Error('observation_source_video_missing');
    this.discoveryStartedAt=Date.now();
    const windowMs=Math.max(1000,Number(this.config.discoveryWindowSec||180)*1000);
    const intervalMs=Math.max(1000,Number(this.config.snapshotIntervalSec||30)*1000);
    const deadline=this.discoveryStartedAt+windowMs;
    let nextAt=this.discoveryStartedAt;let sampleIndex=0;let obs=seedObs;
    this.log('observation_window_start',{videoId:this.sourceVideoId,windowSec:this.config.discoveryWindowSec,snapshotIntervalSec:this.config.snapshotIntervalSec,freshMaxAgeHours:this.config.freshMaxAgeHours,trackVideoId:this.config.trackVideoId||null});
    while(true){
      const waitMs=Math.max(0,nextAt-Date.now());if(waitMs)await sleep(waitMs);
      if(sampleIndex>0)this.invalidatePreviousVideoStats();
      obs=await this.observe(`discovery_snapshot_${sampleIndex}`);
      const routeVideoId=String(obs?.route?.videoId||'');
      if(routeVideoId!==this.sourceVideoId)throw new Error(`observation_source_changed:${this.sourceVideoId}:${routeVideoId||'none'}`);
      this.recordDiscoverySnapshot(obs,{sampleIndex,observedAt:Date.now(),elapsedMs:Date.now()-this.discoveryStartedAt});
      if(Date.now()>=deadline)break;
      sampleIndex++;
      nextAt=Math.min(deadline,this.discoveryStartedAt+sampleIndex*intervalMs);
    }
    const discovery=this.discoverySummary();
    return this.complete('observation_window_complete',{step:1,currentVideo:obs.currentVideo,discovery});
  }
  async run(){
    try{
      await this.selectBrowser();this.captureEnvironmentCondition();await this.createTask();const obs=await this.initialSearch();return await this.runObservationWindow(obs);
    }catch(error){
      this.log('runner_error',{error:String(error?.stack||error)});await this.req('TASK_FAIL',{taskId:this.taskId,error:String(error?.message||error)}).catch(finalizeError=>this.log('task_finalize_error',{operation:'TASK_FAIL',error:String(finalizeError?.message||finalizeError)}));this.endedAt=Date.now();const report=this.report('error',{error:String(error?.stack||error)});this.writeReport(report);throw error;
    }finally{await this.client.close().catch(()=>{});}
  }
  report(outcome,extra={}){
    const report=super.report(outcome,extra);
    return {...report,environmentCondition:this.environmentCondition,observationMode:{observeOnly:true,controlledSeed:Boolean(this.config.seedVideoId),noCandidateTraversal:true,windowSec:this.config.discoveryWindowSec,snapshotIntervalSec:this.config.snapshotIntervalSec,freshMaxAgeHours:this.config.freshMaxAgeHours,trackVideoId:this.config.trackVideoId||null},discovery:this.discoverySummary(),discoverySnapshots:this.discoverySnapshots,candidateTimeline:this.timelineRows(),trackedCandidateTimeline:this.trackedCandidateTimeline};
  }
}

module.exports={TopicObservationRunner,apiViewCount,candidateAgeHours,labelsOverlap,crossTopicEvidence,representativeCandidates};
