'use strict';
const assert=require('node:assert/strict');
const {searchResultSignature,searchQuerySupport,recoverableSeedError,queryKind,frontierRole,keySearchEligible,chooseFrontierKey,ReliableObservedKeyGraph,robustViewStats}=require('../research/robust_key_graph_route_runner');

function searchObs(rows){return {route:{pageType:'search'},surfaces:[{surface:'search_results',items:rows.map((x,i)=>({surface:'search_results',position:i+1,semanticTitle:true,path:`/watch?v=${x.videoId}`,isRadio:false,...x}))}]};}
const oldObs=searchObs([{videoId:'old1',title:'Bất động sản hôm nay',youtubeApi:{title:'Bất động sản hôm nay',keywords:[{term:'bất động sản',score:4}]}}]);
const newObs=searchObs([{videoId:'new1',title:'SOCIETY | NEW TOP 1',youtubeApi:{title:'SOCIETY | NEW TOP 1',keywords:[{term:'Society',score:5}]}}]);
assert.notEqual(searchResultSignature(oldObs),searchResultSignature(newObs));
assert.equal(searchQuerySupport(oldObs,'Society').matches,0);
assert.ok(searchQuerySupport(newObs,'Society').matches>0);
assert.equal(recoverableSeedError(new Error('head_seed_unactionable:abc')),true);
assert.equal(recoverableSeedError(new Error('other_error')),false);

const now=Date.now(),source={videoId:'src1',semanticTitle:true,path:'/watch?v=src1',surface:'related',youtubeApi:{videoId:'src1',title:'Bridge source',tags:['Lóng'],topicLabels:['Knowledge'],categoryId:'27',publishedAt:new Date(now-2*3600000).toISOString(),statistics:{viewCount:'2000'},keywords:[{term:'Lóng',score:7,sources:['tag']}]}},candidate={videoId:'dst1',semanticTitle:true,path:'/watch?v=dst1',surface:'related',youtubeApi:{videoId:'dst1',title:'Bridge to game',tags:['Lóng'],topicLabels:['Video game culture'],categoryId:'20',publishedAt:new Date(now-3600000).toISOString(),statistics:{viewCount:'5000'},keywords:[{term:'Lóng',score:7,sources:['tag']}]} };
const graph=new ReliableObservedKeyGraph();
graph.addNode(source,{surface:'current_video'});graph.addNode(source,{surface:'current_video'});graph.addNode(candidate,{surface:'related'});graph.addNode(candidate,{surface:'related'});graph.addObservedEdge(source,candidate,{surface:'related',rank:3});graph.addObservedEdge(source,candidate,{surface:'related',rank:3});
const longRow=graph.keys.get('long');
assert.ok(longRow,'normalized Lóng key should exist');
assert.equal(longRow.videoIds.size,2);
assert.equal(longRow.crossTopicEdges,1,'repeated observation must not inflate edge count');
assert.ok(robustViewStats(candidate,now).viewsPerHour>1000);
const ranked=graph.ranked({limit:20}).find(x=>x.normalizedKey==='long');
assert.equal(ranked.distinctTopicTransitions,1);
assert.ok(ranked.medianViewsPerHour>0);
assert.equal(ranked.queryKind,'tag_bridge');
assert.equal(ranked.searchEligible,true);

assert.equal(queryKind({key:'Society',sourceTypes:['video_topic']}),'generic_topic');
assert.equal(queryKind({key:'tin',sourceTypes:['derived_keyword']}),'token_fragment');
assert.equal(keySearchEligible({key:'tin',sourceTypes:['derived_keyword'],videoCount:10,videoLevelCount:10,crossTopicEdges:8,topicDiversity:5}),false);
assert.equal(frontierRole({crossTopicEdges:2,topicDiversity:3}),'cross_topic_bridge');
assert.equal(frontierRole({crossTopicEdges:0,topicDiversity:1}),'cluster_deepening');
const frontier=chooseFrontierKey([
  {key:'Society',queryKind:'generic_topic',frontierRole:'cross_topic_bridge',used:false},
  {key:'bất động sản',queryKind:'phrase_bridge',frontierRole:'cluster_deepening',used:false}
],new Set(),new Set());
assert.equal(frontier.key,'bất động sản');
console.log('robust_key_graph_contract: PASS');
