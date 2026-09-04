'use strict';
const assert=require('node:assert/strict');
const {scoreTopic,chooseCandidate,isRadioCandidate,choosePortfolioAction}=require('../research/topic_transition_policy');

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
console.log('topic_transition_policy_contract: PASS');
