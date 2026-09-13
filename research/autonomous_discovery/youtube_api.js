'use strict';

const {clean,uniq,topicLabel}=require('./topic_classifier');

const API_ROOT='https://www.googleapis.com/youtube/v3';
const STOP=new Set(['the','and','for','with','from','this','that','official','video','youtube','channel','watch','full','new','best','top','cua','của','cho','voi','với','mot','một','nhung','những','cac','các','nay','này','hay','nhat','nhất','trong','tren','trên','khi','den','đến','va','và']);
function normalized(value){return clean(value).toLowerCase();}
function tokens(value){return normalized(value).split(/[^\p{L}\p{N}+#._-]+/gu).map(x=>x.replace(/^[._-]+|[._-]+$/g,'')).filter(x=>x.length>=3&&!STOP.has(x));}
function parseChannelKeywords(raw){
  const text=clean(raw);if(!text)return [];
  const out=[];const re=/"([^"]+)"|'([^']+)'|(\S+)/g;let m;
  while((m=re.exec(text)))out.push(clean(m[1]||m[2]||m[3]));
  return uniq(out);
}
function addKeyword(map,term,weight,source){
  const key=normalized(term);if(!key||key.length<2)return;
  const row=map.get(key)||{term:clean(term),score:0,sources:new Set()};
  row.score+=Number(weight)||0;row.sources.add(source);if(clean(term).length>row.term.length)row.term=clean(term);map.set(key,row);
}
function deriveKeywords(video,channel,{limit=40}={}){
  const map=new Map();
  for(const tag of video.tags||[]){addKeyword(map,tag,5,'tag');for(const token of tokens(tag))addKeyword(map,token,2,'tag_token');}
  for(const label of video.topicLabels||[]){addKeyword(map,label,4.5,'video_topic');for(const token of tokens(label))addKeyword(map,token,2,'video_topic_token');}
  for(const token of tokens(video.title))addKeyword(map,token,2.3,'title');
  for(const token of tokens(String(video.descriptionExcerpt||'').slice(0,1600)))addKeyword(map,token,0.35,'description');
  for(const keyword of channel?.keywords||[])addKeyword(map,keyword,1.2,'channel_keyword');
  for(const label of channel?.topicLabels||[])addKeyword(map,label,1.5,'channel_topic');
  return [...map.values()].map(x=>({term:x.term,score:Number(x.score.toFixed(2)),sources:[...x.sources]})).sort((a,b)=>b.score-a.score||b.term.length-a.term.length).slice(0,Math.max(1,Number(limit)||40));
}
function compactStats(raw={}){const out={};for(const k of ['viewCount','likeCount','commentCount'])if(raw[k]!=null)out[k]=String(raw[k]);return out;}
function compactVideo(item){
  const s=item?.snippet||{},t=item?.topicDetails||{},c=item?.contentDetails||{};
  return {videoId:String(item?.id||''),title:clean(s.title),descriptionExcerpt:clean(s.description).slice(0,900),publishedAt:s.publishedAt||null,channelId:s.channelId||null,channelTitle:clean(s.channelTitle)||null,tags:uniq(s.tags).slice(0,80),categoryId:s.categoryId||null,defaultLanguage:s.defaultLanguage||null,defaultAudioLanguage:s.defaultAudioLanguage||null,duration:c.duration||null,topicIds:uniq(t.topicIds),relevantTopicIds:uniq(t.relevantTopicIds),topicCategories:uniq(t.topicCategories),topicLabels:uniq((t.topicCategories||[]).map(topicLabel)),statistics:compactStats(item?.statistics||{})};
}
function compactChannel(item){
  const s=item?.snippet||{},t=item?.topicDetails||{},b=item?.brandingSettings?.channel||{};
  return {channelId:String(item?.id||''),title:clean(s.title)||null,descriptionExcerpt:clean(s.description).slice(0,500),publishedAt:s.publishedAt||null,country:s.country||b.country||null,keywords:parseChannelKeywords(b.keywords).slice(0,80),topicIds:uniq(t.topicIds),topicCategories:uniq(t.topicCategories),topicLabels:uniq((t.topicCategories||[]).map(topicLabel)),statistics:compactStats(item?.statistics||{})};
}

class YouTubeApi {
  constructor({apiKey=process.env.YOUTUBE_DATA_API_KEY||process.env.YOUTUBE_API_KEY||'',fetchImpl=globalThis.fetch,required=true,timeoutMs=9000}={}){
    this.apiKey=String(apiKey||'').trim();this.fetchImpl=fetchImpl;this.required=required!==false;this.timeoutMs=Math.max(1000,Number(timeoutMs)||9000);this.videoCache=new Map();this.channelCache=new Map();this.metrics={apiCalls:0,videoCalls:0,channelCalls:0,cacheHits:0,errors:0,lastError:null};
    if(this.required&&!this.apiKey)throw new Error('youtube_data_api_key_required');
    if(this.apiKey&&typeof this.fetchImpl!=='function')throw new Error('youtube_api_fetch_unavailable');
  }
  stats(){return {enabled:Boolean(this.apiKey),keyPresent:Boolean(this.apiKey),...this.metrics,videoCacheSize:this.videoCache.size,channelCacheSize:this.channelCache.size};}
  async _get(resource,params){
    if(!this.apiKey)return null;
    const url=new URL(`${API_ROOT}/${resource}`);for(const [k,v] of Object.entries({...params,key:this.apiKey}))if(v!=null&&v!=='')url.searchParams.set(k,String(v));
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeoutMs);this.metrics.apiCalls++;
    try{
      const response=await this.fetchImpl(url,{signal:controller.signal,headers:{accept:'application/json'}});
      if(!response?.ok){let detail='';try{detail=clean(await response.text()).slice(0,180);}catch{}throw new Error(`youtube_api_${resource}_${response?.status||'error'}${detail?`:${detail}`:''}`);}
      return await response.json();
    }finally{clearTimeout(timer);}
  }
  async _safe(resource,params){try{return await this._get(resource,params);}catch(error){this.metrics.errors++;this.metrics.lastError=String(error?.message||error).replace(this.apiKey,'[redacted]');if(this.required)throw error;return null;}}
  async _loadChannels(ids){
    const missing=uniq(ids).filter(id=>id&&!this.channelCache.has(id));
    for(let i=0;i<missing.length;i+=50){const batch=missing.slice(i,i+50);if(!batch.length)continue;this.metrics.channelCalls++;const data=await this._safe('channels',{part:'snippet,topicDetails,brandingSettings,statistics',id:batch.join(',')});if(!data)continue;const seen=new Set();for(const item of data.items||[]){const row=compactChannel(item);seen.add(row.channelId);this.channelCache.set(row.channelId,row);}for(const id of batch)if(!seen.has(id))this.channelCache.set(id,null);}
  }
  async enrichVideoIds(ids){
    const unique=uniq(ids);const missing=unique.filter(id=>!this.videoCache.has(id));this.metrics.cacheHits+=unique.length-missing.length;
    for(let i=0;i<missing.length;i+=50){const batch=missing.slice(i,i+50);if(!batch.length)continue;this.metrics.videoCalls++;const data=await this._safe('videos',{part:'snippet,contentDetails,topicDetails,statistics',id:batch.join(',')});if(!data)continue;const seen=new Set();for(const item of data.items||[]){const row=compactVideo(item);seen.add(row.videoId);this.videoCache.set(row.videoId,row);}for(const id of batch)if(!seen.has(id))this.videoCache.set(id,null);}
    await this._loadChannels(unique.map(id=>this.videoCache.get(id)?.channelId).filter(Boolean));
    const out=new Map();for(const id of unique){const video=this.videoCache.get(id);if(!video)continue;const channel=video.channelId?this.channelCache.get(video.channelId)||null:null;out.set(id,{...video,channel,keywords:deriveKeywords(video,channel)});}return out;
  }
  async profileTarget(videoId){const map=await this.enrichVideoIds([String(videoId)]);const row=map.get(String(videoId));if(!row)throw new Error(`youtube_target_not_found:${videoId}`);return row;}
  async enrichCandidates(candidates){
    const map=await this.enrichVideoIds((candidates||[]).map(x=>x?.videoId).filter(Boolean));
    return (candidates||[]).map(row=>({...row,youtubeApi:map.get(String(row.videoId))||null}));
  }
}

module.exports={YouTubeApi,tokens,parseChannelKeywords,deriveKeywords,compactVideo,compactChannel};
