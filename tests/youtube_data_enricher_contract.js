'use strict';

const assert=require('node:assert/strict');
const {YouTubeDataEnricher,parseChannelKeywords,topicLabel}=require('../research/youtube_data_enricher');
const {explainBridge}=require('../research/topic_bridge_analysis');

function response(body){return {ok:true,status:200,async json(){return body;},async text(){return JSON.stringify(body);}};}

(async()=>{
  assert.deepEqual(parseChannelKeywords('music "gaming channel" roblox'),['music','gaming channel','roblox']);
  assert.equal(topicLabel('https://en.wikipedia.org/wiki/Music'),'Music');

  const calls=[];
  const fakeFetch=async url=>{
    const u=new URL(String(url));calls.push({path:u.pathname,ids:u.searchParams.get('id'),key:u.searchParams.get('key')});
    if(u.pathname.endsWith('/videos'))return response({items:[
      {id:'music1',snippet:{title:'Nhạc Remix',description:'playlist chill',channelId:'ch1',channelTitle:'Music Channel',tags:['nhạc','remix'],categoryId:'10'},contentDetails:{duration:'PT3M'},topicDetails:{topicCategories:['https://en.wikipedia.org/wiki/Music']},statistics:{viewCount:'1000'}},
      {id:'game1',snippet:{title:'ROBLOX Giant Escape',description:'Roblox gameplay speed challenge',channelId:'ch2',channelTitle:'Game Channel',tags:['roblox','gameplay','challenge'],categoryId:'20'},contentDetails:{duration:'PT12M'},topicDetails:{topicCategories:['https://en.wikipedia.org/wiki/Video_game']},statistics:{viewCount:'2000'}}
    ]});
    if(u.pathname.endsWith('/channels'))return response({items:[
      {id:'ch1',snippet:{title:'Music Channel'},brandingSettings:{channel:{keywords:'music remix'}},topicDetails:{topicCategories:['https://en.wikipedia.org/wiki/Music']}},
      {id:'ch2',snippet:{title:'Game Channel'},brandingSettings:{channel:{keywords:'roblox gaming'}},topicDetails:{topicCategories:['https://en.wikipedia.org/wiki/Video_game']}}
    ]});
    throw new Error(`unexpected:${u.pathname}`);
  };

  const enricher=new YouTubeDataEnricher({apiKey:'secret-test-key',fetchImpl:fakeFetch});
  const obs={route:{videoId:'music1'},currentVideo:{videoId:'music1',title:'Nhạc Remix',semanticTitle:true,metadata:[]},surfaces:[{surface:'related',items:[{videoId:'game1',surface:'related',position:12,title:'ROBLOX Giant Escape',semanticTitle:true,metadata:[],isRadio:false}]}]};
  const enriched=await enricher.enrichObservation(obs);
  assert.equal(enriched.currentVideo.youtubeApi.categoryId,'10');
  assert.equal(enriched.surfaces[0].items[0].youtubeApi.categoryId,'20');
  assert.ok(enriched.surfaces[0].items[0].youtubeApi.tags.includes('roblox'));
  assert.ok(enriched.surfaces[0].items[0].metadata.some(x=>/roblox/i.test(x)),'strong API evidence should enter scoring metadata');
  assert.equal(enricher.stats().videoCalls,1);
  assert.equal(enricher.stats().channelCalls,1);
  assert.equal(JSON.stringify(enricher.stats()).includes('secret-test-key'),false,'stats must never expose API key');

  const edge=explainBridge(enriched.currentVideo,enriched.surfaces[0].items[0],'gaming');
  assert.equal(edge.categoryShift,true);
  assert.equal(edge.targetTopicScore.targetScore>=0.6,true);
  assert.equal(edge.opaqueRecommendationSignalLikely,true);
  assert.ok(edge.signals.some(x=>x.type==='observed_recommendation_edge'));
  assert.ok(edge.signals.some(x=>x.type==='long_tail_related'));

  const before=calls.length;await enricher.enrichObservation(obs);assert.equal(calls.length,before,'cached IDs must not trigger more API calls');
  console.log('youtube_data_enricher_contract: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
