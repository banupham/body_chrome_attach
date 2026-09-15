'use strict';

const {clean,uniq,topicLabel}=require('./topic_classifier');
const {classifyMediaFormat,playerAspect}=require('./media_format');

const API_ROOT='https://www.googleapis.com/youtube/v3';
const STOP=new Set(['the','and','for','with','from','this','that','official','video','youtube','channel','watch','full','new','best','top','cua','của','cho','voi','với','mot','một','nhung','những','cac','các','nay','này','hay','nhat','nhất','trong','tren','trên','khi','den','đến','va','và']);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,Math.max(0,Number(ms)||0)));
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
function compactPlayer(raw={}){const embedWidth=Number(raw?.embedWidth),embedHeight=Number(raw?.embedHeight),player={embedWidth:Number.isFinite(embedWidth)&&embedWidth>0?embedWidth:null,embedHeight:Number.isFinite(embedHeight)&&embedHeight>0?embedHeight:null};player.aspectRatio=playerAspect(player);return player;}
function compactVideo(item){
  const s=item?.snippet||{},t=item?.topicDetails||{},c=item?.contentDetails||{},player=compactPlayer(item?.player||{}),descriptionExcerpt=clean(s.description).slice(0,900);
  const mediaFormat=classifyMediaFormat({duration:c.duration||null,publishedAt:s.publishedAt||null,player,title:clean(s.title),descriptionExcerpt});
  return {videoId:String(item?.id||''),title:clean(s.title),descriptionExcerpt,publishedAt:s.publishedAt||null,channelId:s.channelId||null,channelTitle:clean(s.channelTitle)||null,tags:uniq(s.tags).slice(0,80),categoryId:s.categoryId||null,defaultLanguage:s.defaultLanguage||null,defaultAudioLanguage:s.defaultAudioLanguage||null,duration:c.duration||null,player,mediaFormat,topicIds:uniq(t.topicIds),relevantTopicIds:uniq(t.relevantTopicIds),topicCategories:uniq(t.topicCategories),topicLabels:uniq((t.topicCategories||[]).map(topicLabel)),statistics:compactStats(item?.statistics||{})};
}
function compactChannel(item){
  const s=item?.snippet||{},t=item?.topicDetails||{},b=item?.brandingSettings?.channel||{};
  return {channelId:String(item?.id||''),title:clean(s.title)||null,descriptionExcerpt:clean(s.description).slice(0,500),publishedAt:s.publishedAt||null,country:s.country||b.country||null,keywords:parseChannelKeywords(b.keywords).slice(0,80),topicIds:uniq(t.topicIds),topicCategories:uniq(t.topicCategories),topicLabels:uniq((t.topicCategories||[]).map(topicLabel)),statistics:compactStats(item?.statistics||{})};
}
function timeoutError(resource,timeoutMs,cause=null){const error=new Error(`youtube_api_${resource}_timeout_after_${timeoutMs}ms`);error.code='YOUTUBE_API_TIMEOUT';error.retryable=true;if(cause)error.cause=cause;return error;}
function httpError(resource,response,detail=''){const status=Number(response?.status||0),error=new Error(`youtube_api_${resource}_${status||'error'}${detail?`:${detail}`:''}`);error.code=`YOUTUBE_API_HTTP_${status||'ERROR'}`;error.status=status;error.retryable=status===408||status===429||status>=500;return error;}
function networkError(resource,cause){const error=new Error(`youtube_api_${resource}_network_error:${String(cause?.message||cause||'network_error')}`);error.code='YOUTUBE_API_NETWORK_ERROR';error.retryable=true;error.cause=cause;return error;}

class YouTubeApi {
  constructor({apiKey=process.env.YOUTUBE_DATA_API_KEY||process.env.YOUTUBE_API_KEY||'',fetchImpl=globalThis.fetch,required=true,timeoutMs=9000,maxRetries=2,retryBaseMs=300}={}){
    this.apiKey=String(apiKey||'').trim();this.fetchImpl=fetchImpl;this.required=required!==false;this.timeoutMs=Math.max(50,Number(timeoutMs)||9000);this.maxRetries=Math.max(0,Math.min(5,Number(maxRetries)||0));this.retryBaseMs=Math.max(0,Math.min(5000,Number(retryBaseMs)||0));this.videoCache=new Map();this.channelCache=new Map();this.metrics={apiCalls:0,videoCalls:0,channelCalls:0,cacheHits:0,errors:0,timeouts:0,retries:0,degradedCalls:0,lastError:null};
    if(this.required&&!this.apiKey)throw new Error('youtube_data_api_key_required');
    if(this.apiKey&&typeof this.fetchImpl!=='function')throw new Error('youtube_api_fetch_unavailable');
  }
  stats(){return {enabled:Boolean(this.apiKey),keyPresent:Boolean(this.apiKey),timeoutMs:this.timeoutMs,maxRetries:this.maxRetries,...this.metrics,videoCacheSize:this.videoCache.size,channelCacheSize:this.channelCache.size};}
  async _get(resource,params,{retries=this.maxRetries}={}){
    if(!this.apiKey)return null;
    const url=new URL(`${API_ROOT}/${resource}`);for(const [k,v] of Object.entries({...params,key:this.apiKey}))if(v!=null&&v!=='')url.searchParams.set(k,String(v));
    const retryLimit=Math.max(0,Math.min(5,Number(retries)||0));let lastError=null;
    for(let attempt=0;attempt<=retryLimit;attempt++){
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeoutMs);this.metrics.apiCalls++;
      try{
        const response=await this.fetchImpl(url,{signal:controller.signal,headers:{accept:'application/json'}});
        if(!response?.ok){let detail='';try{detail=clean(await response.text()).slice(0,180);}catch{}throw httpError(resource,response,detail);}
        return await response.json();
      }catch(rawError){
        let error=rawError;
        if(controller.signal.aborted||rawError?.name==='AbortError')error=timeoutError(resource,this.timeoutMs,rawError);
        else if(rawError?.retryable!==true&&(rawError instanceof TypeError||rawError?.code==='UND_ERR_CONNECT_TIMEOUT'||rawError?.code==='UND_ERR_SOCKET'))error=networkError(resource,rawError);
        lastError=error;
        if(attempt>=retryLimit||error?.retryable!==true)throw error;
        this.metrics.retries++;
        const backoff=this.retryBaseMs*Math.pow(2,attempt)+Math.floor(Math.random()*Math.max(25,this.retryBaseMs*0.25));
        await sleep(backoff);
      }finally{clearTimeout(timer);}
    }
    throw lastError||new Error(`youtube_api_${resource}_unknown_error`);
  }
  async _safe(resource,params,{required=false,retries=required?this.maxRetries:Math.min(1,this.maxRetries)}={}){
    try{return await this._get(resource,params,{retries});}
    catch(error){
      this.metrics.errors++;if(error?.code==='YOUTUBE_API_TIMEOUT')this.metrics.timeouts++;this.metrics.lastError=String(error?.message||error).replace(this.apiKey,'[redacted]');
      if(required)throw error;this.metrics.degradedCalls++;return null;
    }
  }
  async _loadChannels(ids,{required=false}={}){
    const missing=uniq(ids).filter(id=>id&&!this.channelCache.has(id));
    for(let i=0;i<missing.length;i+=50){const batch=missing.slice(i,i+50);if(!batch.length)continue;this.metrics.channelCalls++;const data=await this._safe('channels',{part:'snippet,topicDetails,brandingSettings,statistics',id:batch.join(',')},{required});if(!data)continue;const seen=new Set();for(const item of data.items||[]){const row=compactChannel(item);seen.add(row.channelId);this.channelCache.set(row.channelId,row);}for(const id of batch)if(!seen.has(id))this.channelCache.set(id,null);}
  }
  async enrichVideoIds(ids,{required=false}={}){
    const unique=uniq(ids);const missing=unique.filter(id=>!this.videoCache.has(id));this.metrics.cacheHits+=unique.length-missing.length;
    for(let i=0;i<missing.length;i+=50){const batch=missing.slice(i,i+50);if(!batch.length)continue;this.metrics.videoCalls++;const data=await this._safe('videos',{part:'snippet,contentDetails,player,topicDetails,statistics',id:batch.join(','),maxWidth:8192,maxHeight:8192},{required});if(!data)continue;const seen=new Set();for(const item of data.items||[]){const row=compactVideo(item);seen.add(row.videoId);this.videoCache.set(row.videoId,row);}for(const id of batch)if(!seen.has(id))this.videoCache.set(id,null);}
    await this._loadChannels(unique.map(id=>this.videoCache.get(id)?.channelId).filter(Boolean),{required:false});
    const out=new Map();for(const id of unique){const video=this.videoCache.get(id);if(!video)continue;const channel=video.channelId?this.channelCache.get(video.channelId)||null:null;out.set(id,{...video,channel,keywords:deriveKeywords(video,channel)});}return out;
  }
  async profileTarget(videoId){const map=await this.enrichVideoIds([String(videoId)],{required:true});const row=map.get(String(videoId));if(!row)throw new Error(`youtube_target_not_found:${videoId}`);return row;}
  async enrichCandidates(candidates){
    const map=await this.enrichVideoIds((candidates||[]).map(x=>x?.videoId).filter(Boolean),{required:false});
    return (candidates||[]).map(row=>({...row,youtubeApi:map.get(String(row.videoId))||null}));
  }
}

module.exports={YouTubeApi,tokens,parseChannelKeywords,deriveKeywords,compactPlayer,compactVideo,compactChannel,timeoutError,httpError,networkError};
