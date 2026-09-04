'use strict';
const assert=require('node:assert/strict');
const {scoreTopic,chooseCandidate,isRadioCandidate,choosePortfolioAction}=require('../research/topic_transition_policy');
const {findCandidate,surfaceScrollPoint}=require('../research/topic_transition_runner');

const gaming={videoId:'g1',surface:'related',position:8,title:'VALORANT Gameplay Highlight',semanticTitle:true,path:'/watch?v=g1'};
const music={videoId:'m1',surface:'related',position:1,title:'Nhạc Remix TikTok 2026',semanticTitle:true,listId:'RDm1',isRadio:true,path:'/watch?v=m1&list=RDm1&start_radio=1'};
const bridge={videoId:'b1',surface:'related',position:12,title:'Gaming Music - Valorant Montage',semanticTitle:true,path:'/watch?v=b1'};
assert.ok(scoreTopic(gaming,'gaming').targetScore>=0.6);
assert.ok(scoreTopic(bridge,'gaming').bridgeScore>0);
assert.equal(isRadioCandidate(music),true);

let d=chooseCandidate([music,bridge,gaming],{policy:'directed_bridge',targetTopic:'gaming',targetThreshold:0.6,visited:new Set()});
assert.equal(d.candidate.videoId,'g1');
assert.equal(d.reason,'target_candidate');

d=chooseCandidate([music,{videoId:'x',surface:'home_feed',position:4,title:'Funny science documentary',semanticTitle:true,path:'/watch?v=x'}],{policy:'semantic_escape',targetTopic:'gaming',visited:new Set()});
assert.equal(d.candidate.videoId,'x');

const action=choosePortfolioAction({rows:d.rows,state:{stagnationCount:3,stepsSinceHome:5,homeEscapeAfter:2,pageType:'watch'},selection:d.candidate});
assert.equal(action.type,'go_home');

const observation={
  viewport:{width:1200,height:800},
  surfaces:[
    {surface:'mix_queue',scrollRect:{x:820,y:100,width:360,height:500,centerX:1000,centerY:350},items:[{videoId:'same',surface:'mix_queue',visible:false,actionRect:null}]},
    {surface:'related',items:[{videoId:'same',surface:'related',visible:true,actionRect:{x:830,y:200,width:300,height:80,centerX:980,centerY:240}}]}
  ]
};
assert.equal(findCandidate(observation,{videoId:'same',surface:'mix_queue'}).surface,'mix_queue','rebind must preserve the selected surface before falling back');
assert.deepEqual(surfaceScrollPoint(observation,'mix_queue'),{x:1000,y:350,scoped:true});
assert.equal(findCandidate({viewport:observation.viewport,surfaces:[observation.surfaces[1]]},{videoId:'same',surface:'mix_queue'}).surface,'related','rebind may fall back only when selected surface disappeared');
console.log('topic_transition_policy_contract: PASS');
