'use strict';
const assert=require('node:assert/strict');
const {ObservedKeyGraph,videoKeyRows,topicDistance,chooseDiversifyingBridge,homeDelta}=require('../research/key_graph_route_runner');

const source={videoId:'source-bds',title:'Chợ truyền thống đã bị chợ online giết chết thế nào?',path:'/watch?v=source-bds',surface:'related',position:1,semanticTitle:true,isRadio:false,youtubeApi:{videoId:'source-bds',title:'Chợ truyền thống đã bị chợ online giết chết thế nào?',categoryId:'27',tags:['Lóng','Kiến thức'],topicLabels:['Business'],keywords:[{term:'Lóng',sources:['tag']},{term:'Business',sources:['video_topic']}],statistics:{viewCount:'321281'},channelId:'c1',channel:{topicLabels:['Knowledge','Entertainment'],statistics:{subscriberCount:'465000'}}},viewsPerHour:73.4};
const sameChannel={videoId:'same-loop',title:'Giải thích drama kinh doanh',path:'/watch?v=same-loop',surface:'related',position:1,semanticTitle:true,isRadio:false,youtubeApi:{videoId:'same-loop',title:'Giải thích drama kinh doanh',categoryId:'27',tags:['Lóng','Kiến thức','Loóng Kiến thức','kênh kiến thức'],topicLabels:['Business'],keywords:[{term:'Lóng',sources:['tag']},{term:'Kiến thức',sources:['tag']},{term:'Business',sources:['video_topic']}],statistics:{viewCount:'900000'},channelId:'c1',channel:{topicLabels:['Knowledge','Entertainment'],statistics:{subscriberCount:'465000'}}},viewsPerHour:800};
const gamingBridge={videoId:'gaming-bridge',title:'Tất cả các game hay nhất do người Việt Nam làm',path:'/watch?v=gaming-bridge',surface:'related',position:17,semanticTitle:true,isRadio:false,youtubeApi:{videoId:'gaming-bridge',title:'Tất cả các game hay nhất do người Việt Nam làm',categoryId:'27',tags:['Lóng','game vn','game do người việt làm'],topicLabels:['Role-playing video game','Video game culture'],keywords:[{term:'Lóng',sources:['tag']},{term:'game',sources:['tag_token','video_topic_token','title']}],statistics:{viewCount:'1102658'},channelId:'c2',channel:{topicLabels:['Entertainment'],statistics:{subscriberCount:'1230000'}}},viewsPerHour:1086};

assert.ok(videoKeyRows(source).some(x=>x.key==='long'&&x.videoLevel===true));
assert.ok(topicDistance(source,gamingBridge)>0.5);

const graph=new ObservedKeyGraph();
graph.addNode(source,{surface:'current_video'});graph.addNode(gamingBridge,{surface:'related'});graph.addObservedEdge(source,gamingBridge,{surface:'related',rank:17});
const longRow=graph.ranked({limit:20}).find(x=>x.normalizedKey==='long');
assert.ok(longRow,'shared Lóng key should be represented');
assert.equal(longRow.videoCount,2);
assert.ok(longRow.crossTopicEdges>=1);
assert.ok(longRow.demandProxy>0);
assert.equal(longRow.demandInterpretation,'observed_video_statistics_proxy_not_query_search_volume');

const candidates=graph.searchCandidates({limit:10,headQueries:['bds'],targetTopic:'gaming',targetTitle:'TARGET TITLE MUST NEVER BE SEARCHED',trackVideoId:'target-id'});
assert.ok(candidates.some(x=>x.normalizedKey==='long'),'observed cross-topic key can become an expansion query');
const protectedGraph=new ObservedKeyGraph();
for(const id of ['a','b'])protectedGraph.addNode({videoId:id,youtubeApi:{videoId:id,title:'x',categoryId:id==='a'?'22':'27',tags:['TARGET TITLE MUST NEVER BE SEARCHED'],topicLabels:[id==='a'?'Business':'Knowledge'],statistics:{viewCount:'1000'}},viewsPerHour:10},{surface:'related'});
protectedGraph.addObservedEdge({videoId:'a',youtubeApi:{videoId:'a',categoryId:'22',tags:['TARGET TITLE MUST NEVER BE SEARCHED'],topicLabels:['Business']}},{videoId:'b',youtubeApi:{videoId:'b',categoryId:'27',tags:['TARGET TITLE MUST NEVER BE SEARCHED'],topicLabels:['Knowledge']}},{surface:'related'});
assert.equal(protectedGraph.searchCandidates({limit:10,targetTitle:'TARGET TITLE MUST NEVER BE SEARCHED'}).some(x=>x.normalizedKey==='target title must never be searched'),false);

const choice=chooseDiversifyingBridge([sameChannel,gamingBridge],source,new Set(),graph);
assert.equal(choice.row.videoId,'gaming-bridge','cross-channel meaningful key bridge must beat same-channel metadata loop');
assert.equal(choice.sameChannel,false);
assert.ok(choice.keys.some(x=>/long|lóng/i.test(x)));

const delta=homeDelta({candidates:[{candidate:{videoId:'a'}},{candidate:{videoId:'b'}}]},{candidates:[{candidate:{videoId:'b'}},{candidate:{videoId:'c'}}],targetExposure:{seen:true,rank:4}});
assert.deepEqual(delta.addedVideoIds,['c']);assert.deepEqual(delta.removedVideoIds,['a']);assert.equal(delta.jaccard,0.333);assert.equal(delta.targetAppeared,true);assert.equal(delta.targetRank,4);

console.log('key_graph_route_contract: PASS');
