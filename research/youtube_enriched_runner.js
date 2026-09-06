'use strict';

const {TopicTransitionRunner}=require('./topic_transition_runner');
const {YouTubeDataEnricher}=require('./youtube_data_enricher');
const {explainBridge}=require('./topic_bridge_analysis');

function compactApi(api){
  if(!api)return null;
  return {
    videoId:api.videoId||null,title:api.title||null,publishedAt:api.publishedAt||null,channelId:api.channelId||null,channelTitle:api.channelTitle||null,
    categoryId:api.categoryId||null,tags:(api.tags||[]).slice(0,40),topicIds:api.topicIds||[],relevantTopicIds:api.relevantTopicIds||[],
    topicCategories:api.topicCategories||[],topicLabels:api.topicLabels||[],duration:api.duration||null,statistics:api.statistics||{},
    keywords:(api.keywords||[]).slice(0,24),channel:api.channel?{channelId:api.channel.channelId||null,title:api.channel.title||null,country:api.channel.country||null,keywords:(api.channel.keywords||[]).slice(0,30),topicCategories:api.channel.topicCategories||[],topicLabels:api.channel.topicLabels||[]}:null
  };
}

class YouTubeEnrichedTopicTransitionRunner extends TopicTransitionRunner {
  constructor(config,client=null,{enricher=null}={}){
    super(config,client||undefined);
    this.youtubeEnricher=enricher||new YouTubeDataEnricher();
    this.youtubeApiAnnounced=false;
  }
  announceApi(){
    if(this.youtubeApiAnnounced)return;this.youtubeApiAnnounced=true;
    const stats=this.youtubeEnricher.stats();
    this.log('youtube_api_enrichment',{enabled:stats.enabled,keyPresent:stats.keyPresent,required:stats.required,reason:stats.enabled?'youtube_data_api_v3':'missing_key_or_disabled'});
  }
  async observe(reason='observe'){
    this.announceApi();
    const raw=await super.observe(reason);
    let enriched=raw;
    try{enriched=await this.youtubeEnricher.enrichObservation(raw);}
    catch(error){this.log('youtube_api_error',{reason,error:String(error?.message||error)});throw error;}
    const checkpoint=this.checkpoints.at(-1);
    if(checkpoint){checkpoint.currentVideo=enriched.currentVideo;checkpoint.surfaces=enriched.surfaces;checkpoint.youtubeDataApi=this.youtubeEnricher.stats();}
    if(this.youtubeEnricher.enabled){
      const rows=(enriched.surfaces||[]).flatMap(s=>s.items||[]),apiRows=rows.filter(x=>x.youtubeApi);
      this.log('youtube_api_enriched',{reason,videoId:enriched.route?.videoId||null,candidateCount:rows.length,enrichedCandidateCount:apiRows.length,apiCalls:this.youtubeEnricher.metrics.apiCalls});
    }
    return enriched;
  }
  async selectNext(obs,step){
    const result=await super.selectNext(obs,step);
    const candidate=result?.decision?.candidate;
    if(candidate){
      candidate.bridgeAnalysis=explainBridge(result.obs?.currentVideo||obs?.currentVideo,candidate,this.config.target);
      this.log('bridge_analysis',{step,videoId:candidate.videoId,publicMetadataOverlapCount:candidate.bridgeAnalysis?.publicMetadataOverlapCount||0,opaqueRecommendationSignalLikely:candidate.bridgeAnalysis?.opaqueRecommendationSignalLikely===true});
    }
    return result;
  }
  pathRow(step,candidate,reason,topic=null){
    const row=super.pathRow(step,candidate,reason,topic);
    return {...row,youtubeApi:compactApi(candidate?.youtubeApi),bridgeAnalysis:candidate?.bridgeAnalysis||null};
  }
  report(outcome,extra={}){
    const report=super.report(outcome,extra);
    return {...report,youtubeDataApi:this.youtubeEnricher.stats(),bridgeEdges:(report.path||[]).filter(x=>x.bridgeAnalysis).map(x=>({step:x.step,fromVideoId:x.bridgeAnalysis.sourceVideoId,toVideoId:x.bridgeAnalysis.targetVideoId,surface:x.surface,position:x.position,analysis:x.bridgeAnalysis}))};
  }
}

module.exports={YouTubeEnrichedTopicTransitionRunner,compactApi};
