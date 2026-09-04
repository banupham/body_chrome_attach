'use strict';

const API_ROOT='https://www.googleapis.com/youtube/v3';
const STOPWORDS=new Set([
  'the','and','for','with','from','this','that','official','video','videos','youtube','channel','watch','full','new','best','top',
  'cua','của','cho','voi','với','mot','một','nhung','những','cac','các','nay','này','hay','nhat','nhất','trong','tren','trên','khi','den','đến','va','và'
]);

function uniq(values){return [...new Set((values||[]).map(x=>String(x||'').trim()).filter(Boolean))];}
function chunks(values,size=50){const out=[];for(let i=0;i<values.length;i+=size)out.push(values.slice(i,i+size));return out;}
function clean(value){return String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim();}
function normalized(value){return clean(value).toLowerCase();}
function topicLabel(url){
  const raw=String(url||'').trim();if(!raw)return null;
  try{const u=new URL(raw);return decodeURIComponent(u.pathname.split('/').filter(Boolean).at(-1)||'').replace(/_/g,' ')||null;}catch{return raw;}
}
function parseChannelKeywords(raw){
  const text=clean(raw);if(!text)return [];
  const out=[];const re=/"([^"]+)"|'([^']+)'|(\S+)/g;let m;
  while((m=re.exec(text)))out.push(clean(m[1]||m[2]||m[3]));
  return uniq(out);
}
function tokens(value){
  return normalized(value).split(/[^\p{L}\p{N}+#._-]+/gu).map(x=>x.replace(/^[._-]+|[._-]+$/g,'')).filter(x=>x.length>=3&&!STOPWORDS.has(x));
}
function addKeyword(scoreMap,term,weight,source){
  const key=normalized(term);if(!key||key.length<2)return;
  const row=scoreMap.get(key)||{term:clean(term),score:0,sources:new Set()};
  row.score+=Number(weight)||0;row.sources.add(source);if(clean(term).length>row.term.length)row.term=clean(term);scoreMap.set(key,row);
}
function deriveKeywords(video,channel,{limit=30}={}){
  const map=new Map();
  for(const tag of video.tags||[]){addKeyword(map,tag,5,'tag');for(const token of tokens(tag))addKeyword(map,token,2,'tag_token');}
  for(const label of video.topicLabels||[]){addKeyword(map,label,4.5,'video_topic');for(const token of tokens(label))addKeyword(map,token,2,'video_topic_token');}
  for(const token of tokens(video.title))addKeyword(map,token,2.5,'title');
  for(const token of tokens(String(video.descriptionExcerpt||'').slice(0,1600)))addKeyword(map,token,0.45,'description');
  for(const keyword of channel?.keywords||[]){addKeyword(map,keyword,1.2,'channel_keyword');}
  for(const label of channel?.topicLabels||[]){addKeyword(map,label,1.4,'channel_topic');}
  return [...map.values()].map(x=>({term:x.term,score:Number(x.score.toFixed(2)),sources:[...x.sources]}))
    .sort((a,b)=>b.score-a.score||b.term.length-a.term.length).slice(0,Math.max(1,Number(limit)||30));
}
function compactStatistics(raw={}){
  const out={};for(const key of ['viewCount','likeCount','commentCount','favoriteCount'])if(raw[key]!=null)out[key]=String(raw[key]);return out;
}
function compactChannelStatistics(raw={}){
  const out={};
  for(const key of ['viewCount','subscriberCount','videoCount'])if(raw[key]!=null)out[key]=String(raw[key]);
  if(raw.hiddenSubscriberCount!=null)out.hiddenSubscriberCount=Boolean(raw.hiddenSubscriberCount);
  return out;
}
function compactVideo(item){
  const s=item?.snippet||{},t=item?.topicDetails||{},c=item?.contentDetails||{};
  return {
    videoId:String(item?.id||''),title:clean(s.title),descriptionExcerpt:clean(s.description).slice(0,800),publishedAt:s.publishedAt||null,
    channelId:s.channelId||null,channelTitle:clean(s.channelTitle)||null,tags:uniq(s.tags).slice(0,80),categoryId:s.categoryId||null,
    defaultLanguage:s.defaultLanguage||null,defaultAudioLanguage:s.defaultAudioLanguage||null,duration:c.duration||null,caption:c.caption||null,
    topicIds:uniq(t.topicIds),relevantTopicIds:uniq(t.relevantTopicIds),topicCategories:uniq(t.topicCategories),topicLabels:uniq((t.topicCategories||[]).map(topicLabel)),
    statistics:compactStatistics(item?.statistics||{})
  };
}
function compactChannel(item){
  const s=item?.snippet||{},t=item?.topicDetails||{},b=item?.brandingSettings?.channel||{};
  return {
    channelId:String(item?.id||''),title:clean(s.title)||null,descriptionExcerpt:clean(s.description).slice(0,500),publishedAt:s.publishedAt||null,country:s.country||b.country||null,
    keywords:parseChannelKeywords(b.keywords).slice(0,80),topicIds:uniq(t.topicIds),topicCategories:uniq(t.topicCategories),topicLabels:uniq((t.topicCategories||[]).map(topicLabel)),
    statistics:compactChannelStatistics(item?.statistics||{})
  };
}
function scoringEvidence(api){
  if(!api)return [];
  const strongKeywords=(api.keywords||[]).filter(x=>(x.sources||[]).some(s=>['tag','tag_token','video_topic','video_topic_token','title'].includes(s))).slice(0,24).map(x=>x.term);
  return uniq([...(api.tags||[]).slice(0,30),...(api.topicLabels||[]),...strongKeywords]).slice(0,60);
}
function mergeApi(base,api){
  if(!base||!api)return base;
  const evidence=scoringEvidence(api);
  return {...base,youtubeApi:api,metadata:uniq([...(Array.isArray(base.metadata)?base.metadata:[]),...evidence.map(x=>`ytapi:${x}`)])};
}

class YouTubeDataEnricher {
  constructor({
    apiKey=process.env.YOUTUBE_DATA_API_KEY||process.env.YOUTUBE_API_KEY||'',
    enabled=null,required=null,fetchImpl=globalThis.fetch,timeoutMs=7000
  }={}){
    this.apiKey=String(apiKey||'').trim();
    const envEnabled=!['0','false','no','off'].includes(String(process.env.BODY_YOUTUBE_API_ENRICH||'1').toLowerCase());
    this.enabled=enabled==null?(Boolean(this.apiKey)&&envEnabled):Boolean(enabled);
    this.required=required==null?['1','true','yes','on'].includes(String(process.env.BODY_YOUTUBE_API_REQUIRED||'0').toLowerCase()):Boolean(required);
    this.fetchImpl=fetchImpl;this.timeoutMs=Math.max(500,Number(timeoutMs)||7000);
    this.videoCache=new Map();this.channelCache=new Map();
    this.metrics={apiCalls:0,videoCalls:0,channelCalls:0,videoIdsRequested:0,channelIdsRequested:0,cacheHits:0,errors:0,missingVideos:0,lastError:null};
  }
  stats(){return {enabled:this.enabled,keyPresent:Boolean(this.apiKey),required:this.required,...this.metrics,videoCacheSize:this.videoCache.size,channelCacheSize:this.channelCache.size};}
  async _get(resource,params){
    if(!this.enabled)return null;
    const url=new URL(`${API_ROOT}/${resource}`);for(const [k,v] of Object.entries({...params,key:this.apiKey}))if(v!=null&&v!=='')url.searchParams.set(k,String(v));
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),this.timeoutMs);
    this.metrics.apiCalls++;
    try{
      const response=await this.fetchImpl(url,{signal:controller.signal,headers:{accept:'application/json'}});
      if(!response?.ok){let detail='';try{detail=clean(await response.text()).slice(0,300);}catch{}throw new Error(`youtube_api_${resource}_${response?.status||'error'}${detail?`:${detail}`:''}`);}
      return await response.json();
    }finally{clearTimeout(timer);}
  }
  async _safeGet(resource,params){
    try{return await this._get(resource,params);}catch(error){this.metrics.errors++;this.metrics.lastError=String(error?.message||error).replace(this.apiKey,'[redacted]');if(this.required)throw error;return null;}
  }
  async _loadChannels(channelIds){
    const ids=uniq(channelIds).filter(id=>!this.channelCache.has(id));
    for(const batch of chunks(ids,50)){
      this.metrics.channelCalls++;this.metrics.channelIdsRequested+=batch.length;
      const data=await this._safeGet('channels',{part:'snippet,topicDetails,brandingSettings,statistics',id:batch.join(',')});
      if(!data)continue;
      const seen=new Set();for(const item of data.items||[]){const row=compactChannel(item);if(!row.channelId)continue;seen.add(row.channelId);this.channelCache.set(row.channelId,row);}
      for(const id of batch)if(!seen.has(id))this.channelCache.set(id,null);
    }
  }
  async enrichVideoIds(videoIds){
    const ids=uniq(videoIds);if(!this.enabled)return new Map();
    const missing=ids.filter(id=>!this.videoCache.has(id));this.metrics.cacheHits+=ids.length-missing.length;
    for(const batch of chunks(missing,50)){
      this.metrics.videoCalls++;this.metrics.videoIdsRequested+=batch.length;
      const data=await this._safeGet('videos',{part:'snippet,contentDetails,topicDetails,statistics',id:batch.join(',')});
      if(!data)continue;
      const seen=new Set();for(const item of data.items||[]){const row=compactVideo(item);if(!row.videoId)continue;seen.add(row.videoId);this.videoCache.set(row.videoId,row);}
      for(const id of batch)if(!seen.has(id)){this.metrics.missingVideos++;this.videoCache.set(id,null);}
    }
    const channelIds=ids.map(id=>this.videoCache.get(id)?.channelId).filter(Boolean);await this._loadChannels(channelIds);
    const out=new Map();for(const id of ids){const video=this.videoCache.get(id);if(!video)continue;const channel=video.channelId?this.channelCache.get(video.channelId)||null:null;const api={...video,channel,keywords:deriveKeywords(video,channel)};out.set(id,api);}
    return out;
  }
  async enrichObservation(obs){
    if(!obs||!this.enabled)return obs;
    const ids=[];if(obs.route?.videoId)ids.push(obs.route.videoId);if(obs.currentVideo?.videoId)ids.push(obs.currentVideo.videoId);
    for(const surface of obs.surfaces||[])for(const item of surface.items||[])if(item?.videoId)ids.push(item.videoId);
    const map=await this.enrichVideoIds(ids);
    const currentApi=map.get(String(obs.route?.videoId||obs.currentVideo?.videoId||''))||map.get(String(obs.currentVideo?.videoId||''))||null;
    return {...obs,currentVideo:mergeApi(obs.currentVideo,currentApi),surfaces:(obs.surfaces||[]).map(surface=>({...surface,items:(surface.items||[]).map(item=>mergeApi(item,map.get(String(item.videoId))||null))}))};
  }
}

module.exports={YouTubeDataEnricher,deriveKeywords,parseChannelKeywords,topicLabel,scoringEvidence,mergeApi,compactVideo,compactChannel};