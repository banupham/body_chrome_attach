'use strict';

const {clean,fold,uniq,CATEGORY_TOPIC,classifyVideo}=require('./topic_classifier');
const {tokens}=require('./youtube_api');

const DOMAIN_QUERIES=Object.freeze({
  music:['nhạc','music'],gaming:['gaming','game'],sports:['thể thao','bóng đá'],news:['tin tức','thời sự'],technology:['công nghệ','technology'],education:['giáo dục','học tập'],travel:['du lịch','travel'],automotive:['ô tô','automotive'],entertainment:['giải trí','entertainment'],lifestyle:['đời sống','lifestyle'],real_estate:['bất động sản','nhà đất'],finance:['tài chính','đầu tư'],business:['kinh doanh','business'],health_fitness:['sức khỏe','fitness'],food:['ẩm thực','food'],science:['khoa học','science'],kids_family:['thiếu nhi','kids'],society:['xã hội','society']
});

function titleOverlap(query,title){
  const q=tokens(query),t=new Set(tokens(title));if(!q.length)return 0;
  return q.filter(x=>t.has(x)).length/q.length;
}
function nearTitle(query,title){
  const q=fold(query),t=fold(title);if(!q||!t)return false;
  if(q===t)return true;
  if(q.length>=12&&t.includes(q))return true;
  const overlap=titleOverlap(query,title);
  return tokens(query).length>=4&&overlap>=0.75;
}
function inspectQuery(query,{targetVideoId,targetTitle}={}){
  const text=clean(query),folded=fold(text),id=fold(targetVideoId||'');
  if(!text)return {allowed:false,reason:'empty_query',query:text,titleOverlap:0};
  if(id&&folded.includes(id))return {allowed:false,reason:'target_id_forbidden',query:text,titleOverlap:0};
  if(/(?:youtube\.com\/watch|youtu\.be\/)/i.test(text))return {allowed:false,reason:'youtube_target_url_forbidden',query:text,titleOverlap:titleOverlap(text,targetTitle)};
  const overlap=titleOverlap(text,targetTitle);
  if(nearTitle(text,targetTitle))return {allowed:false,reason:'near_exact_target_title_forbidden',query:text,titleOverlap:Number(overlap.toFixed(3))};
  return {allowed:true,reason:'safe_query',query:text,titleOverlap:Number(overlap.toFixed(3))};
}
function safeQueries(queries,target){
  const out=[],audit=[];
  for(const query of uniq(queries)){const row=inspectQuery(query,target);audit.push(row);if(row.allowed)out.push(row.query);}
  return {queries:out,audit};
}
function targetPlanningFingerprint(targetApi){
  const classification=classifyVideo(targetApi);
  const categoryTopic=CATEGORY_TOPIC[String(targetApi?.categoryId||'')]||classification.primary;
  const strongKeywords=(targetApi?.keywords||[]).filter(x=>(x.sources||[]).some(s=>['tag','tag_token','video_topic','video_topic_token','channel_topic','channel_keyword'].includes(s))).slice(0,24).map(x=>x.term);
  return {
    videoId:targetApi?.videoId||null,
    categoryId:String(targetApi?.categoryId||''),
    primaryTopic:classification.primary,
    categoryTopic,
    topics:uniq([...(targetApi?.topicLabels||[]),...(targetApi?.channel?.topicLabels||[])]).slice(0,16),
    tags:uniq(targetApi?.tags).slice(0,30),
    keywords:uniq(strongKeywords).slice(0,30),
    language:targetApi?.defaultLanguage||targetApi?.defaultAudioLanguage||null,
    country:targetApi?.channel?.country||null
  };
}
function buildQueryPlan(targetApi,{maxQueries=18}={}){
  const fp=targetPlanningFingerprint(targetApi),raw=[];
  for(const topic of uniq([fp.primaryTopic,fp.categoryTopic]))for(const q of DOMAIN_QUERIES[topic]||[])raw.push({kind:'domain',query:q,source:topic});
  for(const label of fp.topics.slice(0,6))raw.push({kind:'topic',query:label,source:'youtube_topic'});
  for(const term of fp.tags.slice(0,8))if(tokens(term).length<=4)raw.push({kind:'tag',query:term,source:'target_tag'});
  for(const term of fp.keywords.slice(0,10))if(tokens(term).length<=4)raw.push({kind:'keyword',query:term,source:'target_keyword'});
  const target={targetVideoId:targetApi.videoId,targetTitle:targetApi.title};
  const seen=new Set(),plan=[],audit=[];
  for(const row of raw){const inspected=inspectQuery(row.query,target);audit.push({...row,...inspected});const key=fold(row.query);if(!inspected.allowed||seen.has(key))continue;seen.add(key);plan.push({...row,query:inspected.query,titleOverlap:inspected.titleOverlap});if(plan.length>=Math.max(1,Number(maxQueries)||18))break;}
  if(!plan.length){for(const fallback of ['đời sống','entertainment']){const checked=inspectQuery(fallback,target);audit.push({kind:'fallback',query:fallback,source:'fallback',...checked});if(checked.allowed)plan.push({kind:'fallback',query:fallback,source:'fallback',titleOverlap:checked.titleOverlap});}}
  return {fingerprint:fp,plan,audit};
}

module.exports={DOMAIN_QUERIES,titleOverlap,nearTitle,inspectQuery,safeQueries,targetPlanningFingerprint,buildQueryPlan};
