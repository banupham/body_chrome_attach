'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {classifyVideo}=require('../research/autonomous_discovery/topic_classifier');
const {inspectQuery,buildQueryPlan}=require('../research/autonomous_discovery/query_firewall');
const {ExperienceMemory}=require('../research/autonomous_discovery/experience_memory');
const {reportMarkdown}=require('../research/autonomous_discovery/reporter');
const {planningProximity}=require('../research/autonomous_discovery/brain');
const {youtubeSemanticObservation}=require('../src/youtube_semantic_observer');
const {parseArgs}=require('../research/autonomous_discovery/entry');

const target={videoId:'qXy0iyni-xk',title:'Khu dân cư mới Cầu Tràm 5x28m SHR đường rộng ô tô tránh nhau',categoryId:'22',tags:['bất động sản','nhà bình chánh','sổ hồng'],topicLabels:['Lifestyle (sociology)'],channel:{country:'VN',keywords:['nhà bình chánh','bán nhà chính chủ'],topicLabels:['Knowledge']},keywords:[{term:'bất động sản',sources:['tag']},{term:'nhà bình chánh',sources:['channel_keyword']}]};
assert.equal(inspectQuery('qXy0iyni-xk',{targetVideoId:target.videoId,targetTitle:target.title}).allowed,false);
assert.equal(inspectQuery('Khu dân cư mới Cầu Tràm 5x28m',{targetVideoId:target.videoId,targetTitle:target.title}).allowed,false);
assert.equal(inspectQuery('bất động sản',{targetVideoId:target.videoId,targetTitle:target.title}).allowed,true);
const plan=buildQueryPlan(target,{maxQueries:12});
assert.ok(plan.plan.length>=1);
assert.ok(plan.plan.every(x=>inspectQuery(x.query,{targetVideoId:target.videoId,targetTitle:target.title}).allowed));
assert.equal(plan.plan.some(x=>x.query.includes(target.videoId)),false);

const game=classifyVideo({title:'VALORANT Gameplay Highlights',youtubeApi:{categoryId:'20',tags:['gaming','esports'],topicLabels:['Video game culture']}});
assert.equal(game.primary,'gaming');
const estate=classifyVideo({title:'Bán nhà Bình Chánh sổ hồng riêng',youtubeApi:{categoryId:'22',tags:['nhà đất','bất động sản'],topicLabels:[]}});
assert.equal(estate.primary,'real_estate');
const proximity=planningProximity({classification:estate,youtubeApi:{categoryId:'22',tags:['bất động sản'],topicLabels:[],keywords:[{term:'nhà bình chánh'}],channel:{country:'VN'}}},plan.fingerprint);
assert.ok(proximity>0.2);

function makeAnchor(){
  const card={tagName:'YTD-VIDEO-RENDERER',querySelectorAll(){return [];},getBoundingClientRect(){return {x:100,y:150,width:420,height:100};}};
  return {href:'https://www.youtube.com/watch?v=abc123xyz',parentElement:null,getAttribute(name){if(name==='href')return '/watch?v=abc123xyz';if(name==='title')return 'Minecraft Gameplay Challenge';return null;},closest(){return card;},getBoundingClientRect(){return {x:110,y:160,width:300,height:70};}};
}
const anchor=makeAnchor();
const searchRoot={querySelectorAll(selector){return selector.includes('a[href')?[anchor]:[];},getBoundingClientRect(){return {x:0,y:100,width:900,height:600};}};
const searchInput={tagName:'INPUT',getBoundingClientRect(){return {x:200,y:20,width:400,height:40};}};
const documentRef={activeElement:searchInput,title:'YouTube',querySelector(selector){if(selector==='input#search')return searchInput;if(selector==='ytd-search #contents')return searchRoot;return null;},querySelectorAll(){return [];}};
const observation=youtubeSemanticObservation({documentRef,windowRef:{innerWidth:1200,innerHeight:800},locationRef:{href:'https://www.youtube.com/results?search_query=hidden'}});
assert.equal(observation.surfaces[0].items[0].videoId,'abc123xyz');
assert.equal(observation.surfaces[0].items[0].title,'Minecraft Gameplay Challenge');
assert.equal(observation.privacy.searchQueryCaptured,false);
assert.equal(JSON.stringify(observation).includes('search_query=hidden'),false);

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'body-autodiscovery-'));
const memory=new ExperienceMemory(path.join(dir,'memory.json'));memory.startRun();memory.recordStrategy('related_long_tail',{context:'watch|music',reward:8,success:true,newTopics:1,newTransitions:2});memory.recordTransition('music','gaming',{surface:'related'});memory.recordQuery('gaming',{reward:4,resultCount:20});memory.save();
const reloaded=new ExperienceMemory(path.join(dir,'memory.json'));assert.equal(reloaded.summary().strategies[0].attempts,1);assert.equal(reloaded.summary().transitions[0].toTopic,'gaming');
const md=reportMarkdown({runId:'run-test',status:'RUNNING',target:{videoId:target.videoId,title:target.title},startedAt:new Date(0).toISOString(),updatedAt:new Date(1).toISOString(),summary:{steps:1,uniqueVideosObserved:1,uniqueTopicsObserved:1,queryAttempts:1,bodyActions:3},targetDiscovery:{surface:'related',rank:8,fromVideoId:'source',fromTopic:'music',strategy:'related_long_tail',opened:false},path:[],snapshots:[],memory:reloaded.summary(),queryAudit:[]});
assert.match(md,/Found via: \*\*next_video\*\*/);
assert.match(md,/Learned experience/);
const parsed=parseArgs(['--target',target.videoId,'--unlimited','true','--report-every-steps','5']);assert.equal(parsed.unlimited,true);assert.equal(parsed.maxSteps,0);assert.equal(parsed.reportEverySteps,5);
fs.rmSync(dir,{recursive:true,force:true});
console.log('autonomous_discovery_contract: PASS');
