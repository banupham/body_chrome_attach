'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {classifyVideo,fold}=require('./topic_classifier');
const {formatKind,FORMAT}=require('./media_format');
const {atomicWrite}=require('./experience_memory');

const RELATION={RETURNING_TARGET:'RETURNING_TARGET',FAMILIAR_SOURCE:'FAMILIAR_SOURCE',FAMILIAR_TOPIC:'FAMILIAR_TOPIC',ADJACENT_TOPIC:'ADJACENT_TOPIC',NOVEL_TOPIC:'NOVEL_TOPIC',UNKNOWN:'UNKNOWN'};
const STOP=new Set(['the','and','for','with','from','this','that','video','official','youtube','channel','watch','full','new','best','top','cua','của','cho','voi','với','mot','một','nhung','những','cac','các','nay','này','hay','nhat','nhất','trong','tren','trên','khi','den','đến','va','và']);

function clean(value){return String(value??'').replace(/\s+/g,' ').trim();}
function accountKey(accountId){const raw=clean(accountId);if(!raw)return null;return crypto.createHash('sha256').update(raw,'utf8').digest('hex').slice(0,20);}
function accountDir(root,accountId){const key=accountKey(accountId);return key?path.join(root,'accounts',key):null;}
function tokens(value){return fold(value).split(/[^\p{L}\p{N}]+/u).filter(x=>x.length>=3&&!STOP.has(x));}
function uniq(values){return [...new Set((values||[]).filter(Boolean))];}
function inc(map,key,amount=1){const k=clean(key)||'unknown';map[k]=(map[k]||0)+Number(amount||0);}
function top(map,limit=8){return Object.entries(map||{}).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,limit).map(([key,count])=>({key,count}));}
function jaccard(a,b){const aa=new Set(a||[]),bb=new Set(b||[]);if(!aa.size||!bb.size)return 0;let hit=0;for(const x of aa)if(bb.has(x))hit++;return hit/(aa.size+bb.size-hit);}
function compactTerms(video){const values=[video?.title,...(video?.tags||[]),...(video?.topicLabels||[]),...(video?.keywords||[]).map(x=>x?.term||x),...(video?.channel?.keywords||[]),...(video?.channel?.topicLabels||[])];return uniq(values.flatMap(tokens)).slice(0,80);}
function compactHistoryItem(video,rank=0){const classification=classifyVideo(video||{});return {videoId:String(video?.videoId||''),rank:Number(rank)||0,topic:classification.primary||'unknown',topicConfidence:Number(classification.confidence||0),categoryId:String(video?.categoryId||''),channelId:String(video?.channelId||''),channelTitle:clean(video?.channelTitle||video?.channel?.title||'').slice(0,120)||null,language:clean(video?.defaultLanguage||video?.defaultAudioLanguage||'')||null,country:clean(video?.channel?.country||'')||null,mediaFormat:formatKind(video?.mediaFormat||FORMAT.UNKNOWN),terms:compactTerms(video)};}
function weightedShare(items,predicate){let total=0,hit=0;for(const item of items||[]){const rank=Math.max(1,Number(item.rank)||1),weight=rank<=20?2:rank<=60?1.4:1;total+=weight;if(predicate(item))hit+=weight;}return total?hit/total:0;}
function targetTerms(target){return compactTerms(target||{});}
function relationshipForTarget(profile,target){
  const items=profile?.items||[],targetId=String(target?.videoId||''),targetClass=classifyVideo(target||{}),topic=targetClass.primary||'unknown',categoryId=String(target?.categoryId||''),channelId=String(target?.channelId||''),terms=targetTerms(target);
  if(!items.length)return {kind:RELATION.UNKNOWN,confidence:0,reason:'no_account_history_sample',targetPreviouslyWatched:false,targetTopic:topic,topicShare:0,categoryShare:0,channelShare:0,maxTermSimilarity:0};
  const exact=items.some(x=>String(x.videoId)===targetId),topicShare=weightedShare(items,x=>x.topic===topic),categoryShare=categoryId?weightedShare(items,x=>x.categoryId===categoryId):0,channelShare=channelId?weightedShare(items,x=>x.channelId===channelId):0;
  let maxTermSimilarity=0;for(const item of items)maxTermSimilarity=Math.max(maxTermSimilarity,jaccard(item.terms,terms));
  let kind=RELATION.NOVEL_TOPIC,reason='low_overlap_with_sampled_history',confidence=Math.min(0.95,0.45+items.length/250);
  if(exact){kind=RELATION.RETURNING_TARGET;reason='target_video_present_in_sampled_history';confidence=Math.max(confidence,0.98);}
  else if(channelShare>=0.025){kind=RELATION.FAMILIAR_SOURCE;reason='target_channel_present_in_history';confidence=Math.max(confidence,Math.min(0.95,0.65+channelShare));}
  else if(topicShare>=0.1||maxTermSimilarity>=0.3){kind=RELATION.FAMILIAR_TOPIC;reason=topicShare>=0.1?'target_topic_common_in_history':'strong_target_term_overlap';confidence=Math.max(confidence,Math.min(0.92,0.58+Math.max(topicShare,maxTermSimilarity)));}
  else if(categoryShare>=0.12||maxTermSimilarity>=0.12){kind=RELATION.ADJACENT_TOPIC;reason=categoryShare>=0.12?'target_category_present_in_history':'partial_target_term_overlap';confidence=Math.max(confidence,Math.min(0.86,0.5+Math.max(categoryShare,maxTermSimilarity)));}
  return {kind,confidence:Number(confidence.toFixed(3)),reason,targetPreviouslyWatched:exact,targetTopic:topic,topicShare:Number(topicShare.toFixed(3)),categoryShare:Number(categoryShare.toFixed(3)),channelShare:Number(channelShare.toFixed(3)),maxTermSimilarity:Number(maxTermSimilarity.toFixed(3))};
}
function planForRelationship(relation){
  const kind=relation?.kind||RELATION.UNKNOWN;
  if(kind===RELATION.RETURNING_TARGET)return {mode:'exploit_personalized_return_path',surfaceBias:{home_feed:32,related:38,search_results:4,mix_queue:16},searchUtility:-12,homeUtility:24,reason:'target_was_previously_watched'};
  if(kind===RELATION.FAMILIAR_SOURCE)return {mode:'exploit_known_channel_neighborhood',surfaceBias:{home_feed:26,related:34,search_results:6,mix_queue:12},searchUtility:-4,homeUtility:18,reason:'target_source_is_familiar'};
  if(kind===RELATION.FAMILIAR_TOPIC)return {mode:'exploit_personalized_topic_graph',surfaceBias:{home_feed:22,related:28,search_results:8,mix_queue:10},searchUtility:2,homeUtility:14,reason:'target_topic_is_familiar'};
  if(kind===RELATION.ADJACENT_TOPIC)return {mode:'bridge_from_account_interests',surfaceBias:{home_feed:10,related:14,search_results:14,mix_queue:6},searchUtility:14,homeUtility:7,reason:'target_is_adjacent_to_history'};
  if(kind===RELATION.NOVEL_TOPIC)return {mode:'escape_personalization_and_search_broadly',surfaceBias:{home_feed:-6,related:2,search_results:22,mix_queue:0},searchUtility:30,homeUtility:-4,reason:'target_topic_is_novel_for_account'};
  return {mode:'account_context_unavailable',surfaceBias:{home_feed:0,related:0,search_results:0,mix_queue:0},searchUtility:0,homeUtility:0,reason:'insufficient_account_history'};
}
function buildAccountProfile({accountId,historyVideos=[],signedInState='unknown',source='youtube_history_visible'}={}){
  const items=[];const seen=new Set();let rank=0;
  for(const video of historyVideos||[]){const id=String(video?.videoId||'');if(!id||seen.has(id))continue;seen.add(id);items.push(compactHistoryItem(video,++rank));}
  const topicCounts={},categoryCounts={},channelCounts={},formatCounts={},languageCounts={},countryCounts={};
  for(const item of items){inc(topicCounts,item.topic);if(item.categoryId)inc(categoryCounts,item.categoryId);if(item.channelId)inc(channelCounts,item.channelId);inc(formatCounts,item.mediaFormat);if(item.language)inc(languageCounts,item.language);if(item.country)inc(countryCounts,item.country);}
  const confidence=Number(Math.min(1,items.length/80).toFixed(3));
  return {schemaVersion:1,accountKey:accountKey(accountId),source,signedInState,refreshedAt:new Date().toISOString(),historySampleCount:items.length,confidence,habits:{dominantTopics:top(topicCounts,10),topChannels:top(channelCounts,10),preferredFormats:top(formatCounts,4),languages:top(languageCounts,8),countries:top(countryCounts,8),categoryMix:top(categoryCounts,12),historyDiversityTopics:Object.keys(topicCounts).length},topicCounts,categoryCounts,channelCounts,formatCounts,languageCounts,countryCounts,items,limitations:['visible_history_sample_only','exact_watch_duration_unavailable','account_identity_is_external_binding_not_google_identity']};
}
function contextForTarget(profile,target){const relationship=relationshipForTarget(profile,target),plan=planForRelationship(relationship);return {available:Boolean(profile?.historySampleCount),accountKey:profile?.accountKey||null,profileRefreshedAt:profile?.refreshedAt||null,historySampleCount:Number(profile?.historySampleCount||0),profileConfidence:Number(profile?.confidence||0),habits:profile?.habits||null,relationship,plan};}

class AccountProfileStore{
  constructor(root,accountId){this.accountId=clean(accountId);this.root=accountDir(root,this.accountId);this.file=this.root?path.join(this.root,'profile.json'):null;}
  load(){if(!this.file)return null;try{const row=JSON.parse(fs.readFileSync(this.file,'utf8'));return row&&Number(row.schemaVersion)===1?row:null;}catch{return null;}}
  save(profile){if(!this.file)return null;fs.mkdirSync(this.root,{recursive:true});atomicWrite(this.file,profile);return this.file;}
  experienceFile(){return this.root?path.join(this.root,'experience-memory.json'):null;}
}

module.exports={RELATION,accountKey,accountDir,compactTerms,compactHistoryItem,buildAccountProfile,relationshipForTarget,planForRelationship,contextForTarget,AccountProfileStore};
