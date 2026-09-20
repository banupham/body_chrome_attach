'use strict';

const assert=require('node:assert/strict');
const {interactiveAffordances,candidateFromAnchor}=require('../src/youtube_semantic_observer');
const {buildWorld}=require('../research/autonomous_discovery/world_model');
const {AutonomousAgentPlanner}=require('../research/autonomous_discovery/agent_planner');
const {adaptiveQueryPlan}=require('../research/autonomous_discovery/adaptive_query_planner');
const {bodyCapabilityCatalog}=require('../research/autonomous_discovery/body_capabilities');
const {buildAccountProfile,contextForTarget,ACCOUNT_STATE,RELATION}=require('../research/autonomous_discovery/account_profile');
const {tabOwnershipConflict,staleDiscoveryOwner}=require('../research/autonomous_discovery/brain_v2');

function node({tag='BUTTON',label='',role='',href='',editable=false,x=20,y=20,width=120,height=40}={}){
  return {tagName:tag,textContent:label,href,parentElement:null,disabled:false,getBoundingClientRect(){return {x,y,width,height};},getAttribute(name){if(name==='aria-label')return label;if(name==='role')return role;if(name==='href')return href;if(name==='contenteditable')return editable?'true':null;return null;},closest(){return null;}};
}
const button=node({label:'Khám phá thêm',role:'button'}),input=node({tag:'INPUT',label:'Tìm kiếm',editable:true,x:100,y:80,width:300,height:44}),slider=node({tag:'DIV',label:'Tiến trình',role:'slider',x:100,y:160,width:500,height:25});
const documentRef={activeElement:input,querySelectorAll(selector){return selector.includes('button,a[href],input')?[button,input,slider]:[];}};
const affordances=interactiveAffordances(documentRef,{innerWidth:1000,innerHeight:700},{maxItems:20});
assert.equal(affordances.length,3);assert.equal(affordances[0].label,'Khám phá thêm');assert.equal(affordances[1].editable,true);assert.equal(affordances[2].role,'slider');assert.equal('value' in affordances[1],false);

const card={querySelectorAll(){return [];},getBoundingClientRect(){return {x:0,y:0,width:200,height:100};}};const anchor={href:'https://www.youtube.com/watch?v=abcXYZ123&list=RDabc',parentElement:null,getAttribute(name){if(name==='href')return '/watch?v=abcXYZ123&list=RDabc';if(name==='title')return 'Video test';return null;},closest(){return card;},getBoundingClientRect(){return {x:10,y:10,width:100,height:30};}};
const candidate=candidateFromAnchor(anchor,'related',1,{windowRef:{innerWidth:1000,innerHeight:700}});assert.equal(candidate.videoId,'abcXYZ123');assert.match(candidate.path,/\/watch\?v=abcXYZ123&list=RDabc|\/watch\?list=RDabc&v=abcXYZ123/);

const target={videoId:'targetXYZ1',title:'Nhà đẹp Bình Chánh Minh Ngọc',defaultLanguage:'vi',categoryId:'22',tags:['nhà đẹp','bình chánh','minh ngọc'],topicLabels:['Hobby'],channel:{country:'VN',keywords:['nhà bình chánh'],topicLabels:['Knowledge']},keywords:[{term:'nhà đẹp',sources:['tag']},{term:'bình chánh',sources:['tag']},{term:'Hobby',sources:['video_topic']}]};
const queryPlan=adaptiveQueryPlan(target,{maxQueries:20});assert.equal(queryPlan.plan.some(row=>/\bhobby\b/i.test(row.query)),false);
const world=buildWorld({observation:{environment:{online:true,eligible:true},bodyState:{activeTabId:1,pointer:{known:true,x:50,y:50}}},semantic:{route:{pageType:'watch',videoId:'source'},viewport:{width:1000,height:700,scrollY:0},controls:{},advertising:{playingAd:false},affordances},snapshot:{pageType:'watch',currentVideoId:'source',currentTopic:'real_estate',candidates:[]},browser:{tabs:[{id:1,active:true,siteKey:'youtube.com'}]},tabId:1,target:{videoId:target.videoId},history:[]});
const memory={ucb(){return 0;},state:{queries:{}}},planner=new AutonomousAgentPlanner({memory,explorationBase:0}),task=planner.inferTask(target,{...queryPlan,fingerprint:{primaryTopic:'real_estate'}}),plan=planner.generate(world,{task,queryPlan,dynamicQueries:[],usedQueries:new Set(),stagnation:0});
assert.ok(plan.actions.some(row=>row.capability==='motor.click'&&row.affordance?.label==='Khám phá thêm'));assert.ok(plan.actions.some(row=>row.capability==='motor.typeText'&&row.affordance?.editable!==false));assert.ok(plan.actions.some(row=>row.capability==='motor.drag'&&row.affordance?.role==='slider'));

const emptyProfile=buildAccountProfile({accountId:'brand-new-account',historyVideos:[],signedInState:'signed_in',homeSampleCount:0}),accountContext=contextForTarget(emptyProfile,target);assert.equal(accountContext.accountState,ACCOUNT_STATE.NEW_ACCOUNT_EMPTY);assert.equal(accountContext.relationship.kind,RELATION.NO_PRIOR_CONTEXT);
const coldTask=planner.inferTask(target,{...queryPlan,fingerprint:{primaryTopic:'real_estate'}},accountContext),searchCandidate={videoId:'neighbor001',surface:'search_results',position:2,targetMatch:false,targetProximity:0.64,visible:true,actionable:true,hitTested:true,actionPoint:{x:260,y:280},visibleRect:{x:80,y:180,width:360,height:200,centerX:260,centerY:280},actionRect:{x:80,y:180,width:360,height:200,centerX:260,centerY:280},evidence:{geometryKnown:true,rectIntersectsViewport:true,hitOwned:true},mediaFormat:{kind:'UNKNOWN'},topic:'real_estate',isRadio:false},searchWorld={currentIsTarget:false,formatMismatch:false,targetVisible:null,current:{pageType:'search',videoId:null,topic:'unknown',mediaFormat:{kind:'UNKNOWN'}},candidates:[searchCandidate],history:[],advertising:{playingAd:false},tabs:[{id:1,siteKey:'youtube.com'}],tabId:1,controls:{homeLink:{}},viewport:{width:1000,height:700},body:{pointer:{known:true,x:50,y:50}},environment:{online:true},affordances:[]};
let coldPlan=planner.generate(searchWorld,{task:coldTask,queryPlan,dynamicQueries:[],usedQueries:new Set(),stagnation:0});const previewAction=coldPlan.actions.find(row=>row.type==='preview_candidate'&&row.target?.videoId==='neighbor001'),clickAction=coldPlan.actions.find(row=>row.type==='click_candidate'&&row.target?.videoId==='neighbor001');assert.ok(previewAction);assert.ok(clickAction);assert.equal(previewAction.purpose,'test_preview_exposure_effect');assert.equal(coldPlan.subgoal.id,'follow_high_evidence_neighbor');assert.ok(Math.abs(previewAction.utility-clickAction.utility)<2);
coldTask.accountContext.runtime.homeCheckDue=true;coldPlan=planner.generate(searchWorld,{task:coldTask,queryPlan,dynamicQueries:[],usedQueries:new Set(),stagnation:0});const homeCheck=coldPlan.actions.find(row=>row.type==='home');assert.ok(homeCheck);assert.equal(homeCheck.purpose,'sample_home_environment');assert.equal(coldPlan.subgoal.id,'follow_high_evidence_neighbor');

const ownership=tabOwnershipConflict(new Error('tab_already_owned:browser-abc:42:task-yt-discovery-old-w1'));
assert.deepEqual(ownership,{browserInstanceId:'browser-abc',tabId:42,ownerTaskId:'task-yt-discovery-old-w1',message:'tab_already_owned:browser-abc:42:task-yt-discovery-old-w1'});
assert.equal(staleDiscoveryOwner({state:'RECOVERY_REQUIRED',capability:'youtube.content_discovery',workspace:{browserInstanceId:'browser-abc',tabIds:[42]}},ownership),true);
assert.equal(staleDiscoveryOwner({state:'RUNNING',capability:'youtube.content_discovery',workspace:{browserInstanceId:'browser-abc',tabIds:[42]}},ownership),false);
assert.equal(staleDiscoveryOwner({state:'RECOVERY_REQUIRED',capability:'youtube.search',workspace:{browserInstanceId:'browser-abc',tabIds:[42]}},ownership),false);

const catalog=bodyCapabilityCatalog();for(const required of ['click','doubleClick','moveTo','hover','drag','scrollVertical','scrollHorizontal','typeText','pressKey','keyCombo'])assert.ok(catalog.motor.includes(required));for(const required of ['back','forward','reload','newtab','closetab','newwindow','history','devtools','fullscreen','address','findtext'])assert.ok(catalog.browserUi.includes(required));assert.ok(catalog.tab.includes('tab_switch'));
console.log('autonomous_agent_v3_contract: PASS');
