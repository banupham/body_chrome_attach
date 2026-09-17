'use strict';

const {clean,fold,uniq}=require('./topic_classifier');
const {queryTokens,titleConcepts,inspectQuery}=require('./query_firewall');

const ENGLISH_KG_LABELS=new Set([
  'hobby','lifestyle','knowledge','entertainment','society','technology','sports','music','gaming','business',
  'real estate','property','education','travel','science','health','fitness','food','automotive','news','politics'
].map(fold));
const VI_HINTS=new Set(['nhà','đất','bất','động','sản','bán','mua','đẹp','việt','nam','vườn','căn','hộ','chung','cư','sổ','hồng','đường','phố','quê','xây','kiến','trúc','nội','thất','đời','sống'].map(fold));
const GENERIC_VI=new Set(['nhà','đất','bán','mua','đẹp','giá','mới','đường','rộng','hướng','chính','chủ','mẫu','khu','dân','cư'].map(fold));

function targetLanguage(targetApi={}){
  const declared=String(targetApi.defaultLanguage||targetApi.defaultAudioLanguage||'').toLowerCase();
  if(declared)return declared.split('-')[0];
  const text=clean([targetApi.title,...(targetApi.tags||[]),...(targetApi.channel?.keywords||[])].join(' '));
  if(/[ăâđêôơưĂÂĐÊÔƠƯ]|[àáạảãèéẹẻẽìíịỉĩòóọỏõùúụủũỳýỵỷỹ]/i.test(text))return 'vi';
  const tokens=queryTokens(text).map(fold);if(tokens.some(token=>VI_HINTS.has(token)))return 'vi';
  return 'unknown';
}
function termLanguage(term){
  const text=clean(term);if(!text)return 'unknown';
  if(/[ăâđêôơưĂÂĐÊÔƠƯ]|[àáạảãèéẹẻẽìíịỉĩòóọỏõùúụủũỳýỵỷỹ]/i.test(text))return 'vi';
  const normalized=fold(text);if(ENGLISH_KG_LABELS.has(normalized))return 'en';
  const ts=queryTokens(text).map(fold);if(ts.some(token=>VI_HINTS.has(token)))return 'vi';
  return 'unknown';
}
function phrase(value,maxTokens=6){return queryTokens(value).slice(0,maxTokens).join(' ').trim();}
function addSignal(map,term,weight,source,{searchable=true}={}){
  const text=phrase(term);if(!text)return;const key=fold(text),row=map.get(key)||{term:text,score:0,sources:new Set(),searchable:false,languages:new Set()};
  row.score+=Number(weight)||0;row.sources.add(source);row.searchable=row.searchable||searchable;row.languages.add(termLanguage(text));map.set(key,row);
}
function distinctiveTitleConceptScore(concept){
  const tokens=queryTokens(concept),distinctive=tokens.filter(token=>/\d/.test(token)||token.length>=5||!GENERIC_VI.has(fold(token))).length;
  return 9+Math.min(7,distinctive*2);
}
function collectSignals(targetApi={}){
  const map=new Map();
  for(const tag of targetApi.tags||[]){addSignal(map,tag,11,'tag');for(const token of queryTokens(tag))addSignal(map,token,2.5,'tag_token');}
  for(const concept of titleConcepts(targetApi.title||''))addSignal(map,concept,distinctiveTitleConceptScore(concept),'title_concept');
  for(const row of targetApi.keywords||[]){
    const sources=Array.isArray(row?.sources)?row.sources:[],term=row?.term||row;if(sources.includes('description'))continue;
    const semanticOnly=sources.some(x=>['video_topic','video_topic_token','channel_topic','topic','topic_token'].includes(String(x)));
    const channelOnly=sources.length&&sources.every(x=>String(x).includes('channel_keyword'));
    if(channelOnly)continue;
    const weight=sources.includes('tag')?9:sources.includes('title')?8:sources.includes('channel_keyword')?4:semanticOnly?3:4;
    addSignal(map,term,weight,`derived:${sources.join('+')||'unknown'}`,{searchable:!semanticOnly});
  }
  for(const kw of targetApi.channel?.keywords||[])addSignal(map,kw,3.5,'channel_keyword');
  for(const label of uniq([...(targetApi.topicLabels||[]),...(targetApi.channel?.topicLabels||[])]))addSignal(map,label,3,'semantic_topic',{searchable:false});
  return [...map.values()].map(row=>({term:row.term,score:Number(row.score.toFixed(2)),sources:[...row.sources],searchable:row.searchable,languages:[...row.languages]})).sort((a,b)=>b.score-a.score||queryTokens(b.term).length-queryTokens(a.term).length);
}
function sourceIsNative(row){return row.sources.some(x=>x==='tag'||x==='title_concept'||x.startsWith('derived:tag')||x.includes('title'));}
function sourcePriority(row){if(row.sources.some(x=>x==='title_concept'||x.includes('title')))return 4;if(row.sources.some(x=>x==='tag'||x.startsWith('derived:tag')))return 3;if(row.sources.includes('channel_keyword'))return 1;return 2;}
function languageCompatible(row,targetLang){
  if(!row.searchable)return false;if(targetLang!=='vi')return true;if(sourceIsNative(row))return true;return !row.languages.includes('en');
}
function mergeTerms(...values){const out=[],seen=new Set();for(const value of values)for(const token of queryTokens(value)){const key=fold(token);if(!key||seen.has(key))continue;seen.add(key);out.push(token);}return out.slice(0,6).join(' ');}
function querySpecificity(query){const n=queryTokens(query).length;return n<=2?'broad':n<=4?'focused':'narrow';}
function queryQualityAdjustment(query,targetApi,provenance=[]){
  const targetTokens=new Set(queryTokens(targetApi.title||'').map(fold)),tokens=queryTokens(query),numericMismatch=tokens.filter(t=>/\d/.test(t)&&!targetTokens.has(fold(t))).length,generic=tokens.filter(t=>GENERIC_VI.has(fold(t))).length;
  let adjustment=-numericMismatch*7;if(tokens.length>=2&&generic===tokens.length)adjustment-=4;
  const native=provenance.some(x=>String(x).includes('title')||String(x).includes('tag'));if(native)adjustment+=4;
  const channelOnly=provenance.length&&provenance.every(x=>String(x).includes('channel_keyword'));if(channelOnly)adjustment-=5;
  return adjustment;
}
function adaptiveQueryPlan(targetApi,{maxQueries=24}={}){
  const language=targetLanguage(targetApi),signals=collectSignals(targetApi),target={targetVideoId:targetApi.videoId,targetTitle:targetApi.title};
  const searchable=signals.filter(row=>languageCompatible(row,language)),raw=[];
  for(const row of searchable){const count=queryTokens(row.term).length;if(count>=2&&count<=6){const score=row.score+queryQualityAdjustment(row.term,targetApi,row.sources);raw.push({query:row.term,components:[row.term],source:'target_metadata',provenance:row.sources,score:Number(score.toFixed(2)),specificity:querySpecificity(row.term),sourcePriority:sourcePriority(row)});}}
  const top=searchable.slice().sort((a,b)=>sourcePriority(b)-sourcePriority(a)||b.score-a.score).slice(0,20);
  for(let i=0;i<top.length;i++)for(let j=i+1;j<top.length;j++){
    const a=top[i],b=top[j];if(language==='vi'&&a.languages.includes('en')!==b.languages.includes('en')&&!sourceIsNative(a)&&!sourceIsNative(b))continue;
    const query=mergeTerms(a.term,b.term),count=queryTokens(query).length;if(count<2||count>6)continue;
    const provenance=uniq([...a.sources,...b.sources]),diversity=a.sources.join('|')===b.sources.join('|')?0:1.5,score=a.score+b.score+diversity+queryQualityAdjustment(query,targetApi,provenance);
    raw.push({query,components:[a.term,b.term],source:'target_metadata_combination',provenance,score:Number(score.toFixed(2)),specificity:querySpecificity(query),sourcePriority:Math.max(sourcePriority(a),sourcePriority(b))});
  }
  raw.sort((a,b)=>b.score-a.score||Number(b.sourcePriority||0)-Number(a.sourcePriority||0)||a.query.length-b.query.length);
  const seen=new Set(),plan=[],audit=[],sourceCounts={title:0,tag:0,channel:0,other:0};
  for(const row of raw){
    const checked=inspectQuery(row.query,target),key=fold(checked.query),family=row.provenance.some(x=>String(x).includes('title'))?'title':row.provenance.some(x=>String(x).includes('tag'))?'tag':row.provenance.some(x=>String(x).includes('channel_keyword'))?'channel':'other';
    audit.push({...row,...checked,targetLanguage:language});if(!checked.allowed||!key||seen.has(key))continue;
    if(family==='channel'&&sourceCounts.channel>=Math.max(4,Math.floor((Number(maxQueries)||24)*0.35))&&plan.some(x=>x.sourceFamily!=='channel'))continue;
    seen.add(key);sourceCounts[family]++;plan.push({...row,query:checked.query,titleOverlap:checked.titleOverlap,targetLanguage:language,sourceFamily:family});if(plan.length>=Math.max(3,Number(maxQueries)||24))break;
  }
  return {planner:'adaptive_target_metadata_v3',targetLanguage:language,signals,plan,audit,semanticTopics:uniq([...(targetApi.topicLabels||[]),...(targetApi.channel?.topicLabels||[])])};
}
function expandFromEnvironment(titles,plan,targetApi,{limit=8}={}){
  const target={targetVideoId:targetApi.videoId,targetTitle:targetApi.title},language=plan.targetLanguage,seedVocabulary=new Set(plan.signals.filter(x=>x.searchable).flatMap(x=>queryTokens(x.term).map(fold))),counts=new Map();
  for(const title of titles||[]){const terms=uniq(queryTokens(title));if(!terms.some(t=>seedVocabulary.has(fold(t))))continue;for(const term of terms){const k=fold(term);counts.set(k,(counts.get(k)||0)+1);}}
  const recurring=[...counts].filter(([,count])=>count>=2).sort((a,b)=>b[1]-a[1]).map(([term])=>term),anchors=plan.signals.filter(x=>x.searchable).sort((a,b)=>sourcePriority(b)-sourcePriority(a)||b.score-a.score).slice(0,14),rows=[],seen=new Set();
  for(const observed of recurring){
    for(const anchor of anchors){
      const query=mergeTerms(anchor.term,observed);if(queryTokens(query).length<2)continue;if(language==='vi'&&termLanguage(observed)==='en'&&!sourceIsNative(anchor))continue;
      const checked=inspectQuery(query,target),key=fold(checked.query);if(!checked.allowed||seen.has(key))continue;seen.add(key);
      rows.push({query:checked.query,components:[anchor.term,observed],source:'environment_target_anchored',provenance:[...anchor.sources,'observed_result'],score:Number((anchor.score+Math.min(5,counts.get(observed)||0)+queryQualityAdjustment(query,targetApi,[...anchor.sources,'observed_result'])).toFixed(2)),specificity:querySpecificity(query),targetLanguage:language,titleOverlap:checked.titleOverlap,sourceFamily:anchor.sources.some(x=>String(x).includes('title'))?'title_bridge':'environment_bridge'});if(rows.length>=limit)return rows;
    }
  }
  return rows;
}

module.exports={ENGLISH_KG_LABELS,targetLanguage,termLanguage,collectSignals,adaptiveQueryPlan,expandFromEnvironment,languageCompatible,querySpecificity,queryQualityAdjustment,sourcePriority};
