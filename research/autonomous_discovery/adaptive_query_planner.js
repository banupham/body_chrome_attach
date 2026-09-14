'use strict';

const {clean,fold,uniq}=require('./topic_classifier');
const {queryTokens,titleConcepts,inspectQuery}=require('./query_firewall');

const ENGLISH_KG_LABELS=new Set([
  'hobby','lifestyle','knowledge','entertainment','society','technology','sports','music','gaming','business',
  'real estate','property','education','travel','science','health','fitness','food','automotive','news','politics'
].map(fold));
const VI_HINTS=new Set(['nhà','đất','bất','động','sản','bán','mua','đẹp','việt','nam','vườn','căn','hộ','chung','cư','sổ','hồng','đường','phố','quê','xây','kiến','trúc','nội','thất','đời','sống'].map(fold));

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
function collectSignals(targetApi={}){
  const map=new Map();
  for(const tag of targetApi.tags||[]){addSignal(map,tag,10,'tag');for(const token of queryTokens(tag))addSignal(map,token,2.5,'tag_token');}
  for(const kw of targetApi.channel?.keywords||[])addSignal(map,kw,8,'channel_keyword');
  for(const row of targetApi.keywords||[]){
    const sources=Array.isArray(row?.sources)?row.sources:[];const term=row?.term||row;
    if(sources.includes('description'))continue;
    const semanticOnly=sources.some(x=>['video_topic','video_topic_token','channel_topic','topic','topic_token'].includes(String(x)));
    const weight=sources.includes('tag')?8:sources.includes('title')?6:sources.includes('channel_keyword')?7:semanticOnly?3:4;
    addSignal(map,term,weight,`derived:${sources.join('+')||'unknown'}`,{searchable:!semanticOnly});
  }
  for(const concept of titleConcepts(targetApi.title||''))addSignal(map,concept,6,'title_concept');
  for(const label of uniq([...(targetApi.topicLabels||[]),...(targetApi.channel?.topicLabels||[])]))addSignal(map,label,4,'semantic_topic',{searchable:false});
  return [...map.values()].map(row=>({term:row.term,score:Number(row.score.toFixed(2)),sources:[...row.sources],searchable:row.searchable,languages:[...row.languages]})).sort((a,b)=>b.score-a.score||queryTokens(b.term).length-queryTokens(a.term).length);
}
function sourceIsNative(row){return row.sources.some(x=>x==='tag'||x==='channel_keyword'||x==='title_concept'||x.startsWith('derived:tag')||x.includes('title'));}
function languageCompatible(row,targetLang){
  if(!row.searchable)return false;
  if(targetLang!=='vi')return true;
  if(sourceIsNative(row))return true;
  return !row.languages.includes('en');
}
function mergeTerms(...values){const out=[],seen=new Set();for(const value of values)for(const token of queryTokens(value)){const key=fold(token);if(!key||seen.has(key))continue;seen.add(key);out.push(token);}return out.slice(0,6).join(' ');}
function querySpecificity(query){const n=queryTokens(query).length;return n<=2?'broad':n<=4?'focused':'narrow';}
function adaptiveQueryPlan(targetApi,{maxQueries=24}={}){
  const language=targetLanguage(targetApi),signals=collectSignals(targetApi),target={targetVideoId:targetApi.videoId,targetTitle:targetApi.title};
  const searchable=signals.filter(row=>languageCompatible(row,language));const raw=[];
  for(const row of searchable){const count=queryTokens(row.term).length;if(count>=2&&count<=6)raw.push({query:row.term,components:[row.term],source:'target_metadata',provenance:row.sources,score:row.score,specificity:querySpecificity(row.term)});}
  const top=searchable.slice(0,18);
  for(let i=0;i<top.length;i++)for(let j=i+1;j<top.length;j++){
    const a=top[i],b=top[j];if(language==='vi'&&a.languages.includes('en')!==b.languages.includes('en')&&!sourceIsNative(a)&&!sourceIsNative(b))continue;
    const query=mergeTerms(a.term,b.term),count=queryTokens(query).length;if(count<2||count>6)continue;
    const diversity=a.sources.join('|')===b.sources.join('|')?0:1.5;
    raw.push({query,components:[a.term,b.term],source:'target_metadata_combination',provenance:uniq([...a.sources,...b.sources]),score:Number((a.score+b.score+diversity).toFixed(2)),specificity:querySpecificity(query)});
  }
  raw.sort((a,b)=>b.score-a.score||a.query.length-b.query.length);
  const seen=new Set(),plan=[],audit=[];
  for(const row of raw){const checked=inspectQuery(row.query,target),key=fold(checked.query);audit.push({...row,...checked,targetLanguage:language});if(!checked.allowed||!key||seen.has(key))continue;seen.add(key);plan.push({...row,query:checked.query,titleOverlap:checked.titleOverlap,targetLanguage:language});if(plan.length>=Math.max(3,Number(maxQueries)||24))break;}
  return {planner:'adaptive_target_metadata_v3',targetLanguage:language,signals,plan,audit,semanticTopics:uniq([...(targetApi.topicLabels||[]),...(targetApi.channel?.topicLabels||[])])};
}
function expandFromEnvironment(titles,plan,targetApi,{limit=8}={}){
  const target={targetVideoId:targetApi.videoId,targetTitle:targetApi.title},language=plan.targetLanguage,seedVocabulary=new Set(plan.signals.filter(x=>x.searchable).flatMap(x=>queryTokens(x.term).map(fold))),counts=new Map();
  for(const title of titles||[]){const terms=uniq(queryTokens(title));if(!terms.some(t=>seedVocabulary.has(fold(t))))continue;for(const term of terms){const k=fold(term);counts.set(k,(counts.get(k)||0)+1);}}
  const recurring=[...counts].filter(([,count])=>count>=2).sort((a,b)=>b[1]-a[1]).map(([term])=>term);const rows=[];
  for(const observed of recurring){
    for(const anchor of plan.signals.filter(x=>x.searchable).slice(0,12)){
      const query=mergeTerms(anchor.term,observed);if(queryTokens(query).length<2)continue;if(language==='vi'&&termLanguage(observed)==='en'&&!sourceIsNative(anchor))continue;
      const checked=inspectQuery(query,target);if(!checked.allowed)continue;rows.push({query:checked.query,components:[anchor.term,observed],source:'environment_target_anchored',provenance:[...anchor.sources,'observed_result'],score:Number((anchor.score+Math.min(5,counts.get(observed)||0)).toFixed(2)),specificity:querySpecificity(query),targetLanguage:language,titleOverlap:checked.titleOverlap});if(rows.length>=limit)return rows;
    }
  }
  return rows;
}

module.exports={ENGLISH_KG_LABELS,targetLanguage,termLanguage,collectSignals,adaptiveQueryPlan,expandFromEnvironment,languageCompatible,querySpecificity};
