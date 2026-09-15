'use strict';

const {clean,fold,uniq,CATEGORY_TOPIC,classifyVideo}=require('./topic_classifier');
const {tokens}=require('./youtube_api');

// These are quality/noise filters, not search seeds. Query text must come from
// target metadata or from terms observed in a target-anchored neighborhood.
const QUERY_NOISE=new Set([
  'video','youtube','official','full','new','best','top','shorts','short',
  'phút','phut','minute','minutes','giờ','gio','hour','hours','ngày','ngay','day','days',
  'lượt','luot','view','views','xem','mới','moi','trước','truoc','ago'
].map(fold));

function queryTokens(value){return tokens(value).filter(token=>!QUERY_NOISE.has(fold(token))&&!/^\d+$/.test(token));}
function compactPhrase(value,maxTokens=6){return queryTokens(value).slice(0,Math.max(1,Number(maxTokens)||6)).join(' ').trim();}
function tokenKey(value){return fold(value);}
function tokenSet(value){return new Set(queryTokens(value).map(tokenKey));}
function mergeTerms(...values){
  const out=[],seen=new Set();
  for(const value of values)for(const token of queryTokens(value)){
    const key=tokenKey(token);if(!key||seen.has(key))continue;seen.add(key);out.push(token);
  }
  return out.slice(0,6).join(' ');
}
function sourceWeight(sources=[]){
  const set=new Set((sources||[]).map(String));
  if(set.has('tag'))return 8;
  if(set.has('video_topic'))return 7.5;
  if(set.has('channel_topic'))return 6.5;
  if(set.has('channel_keyword'))return 6;
  if(set.has('tag_token'))return 5;
  if(set.has('video_topic_token'))return 5;
  if(set.has('title'))return 3.5;
  return 2.5;
}
function addSignal(map,term,score,source){
  const phrase=compactPhrase(term);if(!phrase)return;
  const key=fold(phrase),existing=map.get(key)||{term:phrase,score:0,sources:new Set()};
  existing.score+=Number(score)||0;existing.sources.add(String(source||'unknown'));map.set(key,existing);
}
function titleConcepts(title){
  const list=queryTokens(title).slice(0,18),out=[];
  for(let i=0;i<list.length-1;i++)out.push(`${list[i]} ${list[i+1]}`);
  for(let i=0;i<list.length-2;i++)out.push(`${list[i]} ${list[i+1]} ${list[i+2]}`);
  return uniq(out).slice(0,24);
}
function buildTargetSignals(targetApi){
  const map=new Map();
  for(const tag of targetApi?.tags||[]){addSignal(map,tag,8,'tag');for(const token of queryTokens(tag))addSignal(map,token,2.2,'tag_token');}
  for(const label of uniq([...(targetApi?.topicLabels||[]),...(targetApi?.channel?.topicLabels||[])])){addSignal(map,label,7,'topic');for(const token of queryTokens(label))addSignal(map,token,2,'topic_token');}
  for(const row of targetApi?.keywords||[]){
    const sources=Array.isArray(row?.sources)?row.sources:[];
    if(sources.includes('description'))continue;
    addSignal(map,row?.term||row,sourceWeight(sources),sources.join('+')||'keyword');
  }
  for(const keyword of targetApi?.channel?.keywords||[])addSignal(map,keyword,5,'channel_keyword');
  for(const phrase of titleConcepts(targetApi?.title||''))addSignal(map,phrase,2.8,'title_concept');
  return [...map.values()].map(row=>({term:row.term,score:Number(row.score.toFixed(2)),sources:[...row.sources]})).sort((a,b)=>b.score-a.score||queryTokens(b.term).length-queryTokens(a.term).length||a.term.localeCompare(b.term));
}

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
  const signals=buildTargetSignals(targetApi);
  const planningOnly={
    ...targetApi,
    descriptionExcerpt:'',
    keywords:(targetApi?.keywords||[]).filter(x=>!(x.sources||[]).includes('description')),
    channel:targetApi?.channel?{...targetApi.channel,descriptionExcerpt:''}:null
  };
  const classification=classifyVideo(planningOnly);
  const categoryTopic=CATEGORY_TOPIC[String(targetApi?.categoryId||'')]||classification.primary;
  return {
    videoId:targetApi?.videoId||null,
    categoryId:String(targetApi?.categoryId||''),
    primaryTopic:classification.primary,
    categoryTopic,
    topics:uniq([...(targetApi?.topicLabels||[]),...(targetApi?.channel?.topicLabels||[])]).slice(0,16),
    tags:uniq(targetApi?.tags).slice(0,30),
    keywords:uniq((targetApi?.keywords||[]).filter(x=>!(x.sources||[]).includes('description')).map(x=>x?.term||x)).slice(0,40),
    titleConcepts:titleConcepts(targetApi?.title||''),
    querySignals:signals.slice(0,48),
    signalVocabulary:uniq(signals.flatMap(row=>queryTokens(row.term).map(tokenKey))).slice(0,120),
    language:targetApi?.defaultLanguage||targetApi?.defaultAudioLanguage||null,
    country:targetApi?.channel?.country||null,
    titleUsedAsConceptsOnly:true
  };
}
function buildQueryPlan(targetApi,{maxQueries=18}={}){
  const fp=targetPlanningFingerprint(targetApi),target={targetVideoId:targetApi.videoId,targetTitle:targetApi.title},raw=[];
  const signals=fp.querySignals.slice(0,20);
  for(const signal of signals){
    const count=queryTokens(signal.term).length;
    if(count>=2&&count<=5)raw.push({kind:'metadata_phrase',query:signal.term,source:'target_metadata',components:[signal.term],score:signal.score});
  }
  for(let i=0;i<Math.min(signals.length,14);i++)for(let j=i+1;j<Math.min(signals.length,14);j++){
    const a=signals[i],b=signals[j],aSet=tokenSet(a.term),bSet=tokenSet(b.term);
    let shared=0;for(const token of aSet)if(bSet.has(token))shared++;
    if(shared>=Math.min(aSet.size,bSet.size))continue;
    const query=mergeTerms(a.term,b.term),count=queryTokens(query).length;if(count<2||count>6)continue;
    raw.push({kind:'combined',query,source:'target_metadata_combination',components:[a.term,b.term],score:Number((a.score+b.score+(a.sources.join('|')===b.sources.join('|')?0:1.5)).toFixed(2))});
  }
  for(const concept of fp.titleConcepts.slice(0,12))raw.push({kind:'title_concept',query:concept,source:'target_title_concept',components:[concept],score:2.5});
  raw.sort((a,b)=>Number(b.score||0)-Number(a.score||0)||queryTokens(b.query).length-queryTokens(a.query).length);
  const seen=new Set(),plan=[],audit=[];
  for(const row of raw){
    const inspected=inspectQuery(row.query,target),key=fold(inspected.query);audit.push({...row,...inspected});
    if(!inspected.allowed||!key||seen.has(key))continue;
    seen.add(key);plan.push({...row,query:inspected.query,titleOverlap:inspected.titleOverlap});
    if(plan.length>=Math.max(1,Number(maxQueries)||18))break;
  }
  if(!plan.length){
    const titleTokens=queryTokens(targetApi?.title||'');
    for(let width=2;width<=3&&plan.length<Math.max(1,Number(maxQueries)||18);width++)for(let i=0;i+width<=titleTokens.length;i++){
      const query=titleTokens.slice(i,i+width).join(' '),checked=inspectQuery(query,target),key=fold(query);audit.push({kind:'target_derived_fallback',query,source:'target_title_concept',components:[query],score:1,...checked});
      if(checked.allowed&&!seen.has(key)){seen.add(key);plan.push({kind:'target_derived_fallback',query:checked.query,source:'target_title_concept',components:[query],score:1,titleOverlap:checked.titleOverlap});}
    }
  }
  return {fingerprint:fp,plan,audit,planner:'target_metadata_combinatorial_v2'};
}

function buildObservedQueryExpansion(titles,fingerprint,target,{existingQueries=[],limit=5}={}){
  const vocab=new Set((fingerprint?.signalVocabulary||[]).map(fold)),counts=new Map(),anchoredCounts=new Map();
  for(const title of titles||[]){
    const row=uniq(queryTokens(title)),anchors=row.filter(token=>vocab.has(fold(token)));if(!anchors.length)continue;
    for(const token of row){const key=fold(token);counts.set(key,(counts.get(key)||0)+1);if(!vocab.has(key))anchoredCounts.set(key,(anchoredCounts.get(key)||0)+1);}
  }
  const observed=[...counts.entries()].filter(([key,count])=>vocab.has(key)?count>=2:Number(anchoredCounts.get(key)||0)>=3).sort((a,b)=>b[1]-a[1]).map(([key])=>key);
  const anchors=(fingerprint?.querySignals||[]).filter(row=>queryTokens(row.term).length>=1).slice(0,10);
  const seen=new Set(existingQueries.map(fold)),plan=[],audit=[];
  for(const token of observed){
    const anchor=anchors.find(row=>!tokenSet(row.term).has(token))||anchors[0];if(!anchor)continue;
    const query=mergeTerms(anchor.term,token);if(queryTokens(query).length<2)continue;
    const checked=inspectQuery(query,target),key=fold(query);audit.push({kind:'environment_bridge',source:'observed_target_anchored_titles',anchor:anchor.term,observedToken:token,...checked});
    if(!checked.allowed||seen.has(key))continue;seen.add(key);plan.push({kind:'environment_bridge',source:'observed_target_anchored_titles',query:checked.query,anchor:anchor.term,observedToken:token,titleOverlap:checked.titleOverlap});
    if(plan.length>=Math.max(1,Number(limit)||5))break;
  }
  return {plan,audit};
}

module.exports={QUERY_NOISE,queryTokens,titleConcepts,buildTargetSignals,titleOverlap,nearTitle,inspectQuery,safeQueries,targetPlanningFingerprint,buildQueryPlan,buildObservedQueryExpansion};
