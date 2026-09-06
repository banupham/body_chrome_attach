'use strict';

const {scoreTopic,isRadioCandidate,normalize}=require('./topic_transition_policy');

function uniq(values){return [...new Set((values||[]).map(x=>String(x||'').trim()).filter(Boolean))];}
function termSet(values){return new Set(uniq(values).map(normalize).filter(Boolean));}
function intersection(a,b,limit=20){const aa=termSet(a),bb=termSet(b),out=[];for(const x of aa)if(bb.has(x)){out.push(x);if(out.length>=limit)break;}return out;}
function apiTerms(node){
  const api=node?.youtubeApi||{};
  return {
    tags:uniq(api.tags),
    keywords:uniq((api.keywords||[]).map(x=>x?.term||x)),
    topics:uniq(api.topicLabels),
    channelKeywords:uniq(api.channel?.keywords),
    channelTopics:uniq(api.channel?.topicLabels)
  };
}
function publicMetadataCoverage(node){
  const t=apiTerms(node);return {tagCount:t.tags.length,keywordCount:t.keywords.length,topicCount:t.topics.length,channelKeywordCount:t.channelKeywords.length,channelTopicCount:t.channelTopics.length};
}
function explainBridge(source,candidate,targetTopic='gaming'){
  if(!candidate)return null;
  const sourceScore=scoreTopic(source||{},targetTopic),targetScore=scoreTopic(candidate,targetTopic);
  const s=apiTerms(source),t=apiTerms(candidate);
  const sharedTags=intersection(s.tags,t.tags),sharedKeywords=intersection(s.keywords,t.keywords),sharedTopics=intersection(s.topics,t.topics),sharedChannelTopics=intersection(s.channelTopics,t.channelTopics);
  const sourceCategory=source?.youtubeApi?.categoryId||null,targetCategory=candidate?.youtubeApi?.categoryId||null;
  const categoryShift=Boolean(sourceCategory&&targetCategory&&sourceCategory!==targetCategory);
  const signals=[];
  if(candidate.surface)signals.push({type:'observed_recommendation_edge',surface:candidate.surface,rank:Number(candidate.position||0)||null});
  if(candidate.surface==='related'&&Number(candidate.position||0)>=5)signals.push({type:'long_tail_related',rank:Number(candidate.position)});
  if(!isRadioCandidate(candidate))signals.push({type:'non_radio_escape'});
  if(targetScore.targetScore>=0.6)signals.push({type:'target_topic_signal',score:targetScore.targetScore,matched:targetScore.matched});
  if(targetScore.bridgeScore>0)signals.push({type:'declared_bridge_signal',score:targetScore.bridgeScore,matched:targetScore.bridgeMatched});
  if(sharedTags.length)signals.push({type:'shared_tags',values:sharedTags});
  if(sharedKeywords.length)signals.push({type:'shared_keywords',values:sharedKeywords});
  if(sharedTopics.length)signals.push({type:'shared_video_topics',values:sharedTopics});
  if(sharedChannelTopics.length)signals.push({type:'shared_channel_topics',values:sharedChannelTopics});
  if(categoryShift)signals.push({type:'category_shift',from:sourceCategory,to:targetCategory});
  const publicOverlapCount=sharedTags.length+sharedKeywords.length+sharedTopics.length+sharedChannelTopics.length;
  const opaqueRecommendationSignalLikely=Boolean(candidate.surface&&publicOverlapCount===0&&categoryShift&&sourceScore.sourceTopicScore>=0.48&&targetScore.targetScore>=0.6);
  if(opaqueRecommendationSignalLikely)signals.push({type:'opaque_recommendation_signal_likely',note:'Observed recommendation edge is stronger than overlap in public metadata; co-watch/session/personalization/popularity signals are possible but are not exposed by YouTube Data API.'});
  return {
    sourceVideoId:source?.videoId||null,targetVideoId:candidate.videoId||null,targetTopic,
    sourceTopic:sourceScore,targetTopicScore:targetScore,
    sourceCategoryId:sourceCategory,targetCategoryId:targetCategory,categoryShift,
    sharedTags,sharedKeywords,sharedTopics,sharedChannelTopics,
    publicMetadataOverlapCount:publicOverlapCount,opaqueRecommendationSignalLikely,
    sourceMetadataCoverage:publicMetadataCoverage(source),targetMetadataCoverage:publicMetadataCoverage(candidate),signals,
    interpretationBoundary:'This explains observable metadata and the observed DOM recommendation edge. The YouTube Data API does not expose the recommender feature weights or the causal reason a candidate was ranked.'
  };
}

module.exports={explainBridge,apiTerms,publicMetadataCoverage,intersection};
