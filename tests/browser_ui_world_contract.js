'use strict';

const assert=require('node:assert/strict');
const {buildWorld,worldDelta}=require('../research/autonomous_discovery/world_model');

const semantic={route:{pageType:'home',path:'/'},viewport:{width:1000,height:700,scrollX:0,scrollY:0},controls:{},advertising:{},affordances:[]};
const browser={tabs:[{id:1,active:true,windowId:7,siteKey:'youtube.com',title:'YouTube',navigationToken:'n1'}]};
function observation(signature,focused='Address and search bar'){return {browserUi:{available:true,observed:true,reason:null,confidence:'title_match',source:'windows_uia_read_only',observedAt:100,signature,window:{name:'YouTube - Google Chrome'},focusedControl:{controlType:'Edit',name:focused},addressBar:{controlType:'Edit',name:'Address and search bar'},tabs:[],controls:[]},content:{page:{}},control:{},environment:{online:true,eligible:true,status:'ELIGIBLE',browserState:'ACTIVE'},bodyState:{activeTabId:1,pointer:null}};}
const before=buildWorld({observation:observation('ui-1'),semantic,browser,tabId:1,target:{}});const after=buildWorld({observation:observation('ui-2','Customize and control Google Chrome'),semantic,browser,tabId:1,target:{}});
assert.equal(before.browserUi.observed,true);assert.equal(before.browserUi.source,'windows_uia_read_only');assert.equal(before.browserUi.addressBar.name,'Address and search bar');assert.ok(worldDelta(before,after).reasons.includes('browser_ui'));


const ownedRep={visible:true,visibleRect:{x:100,y:500,width:200,height:100},hitTested:true,hitSamples:[{x:200,y:550,owned:true,blocker:null}],actionRect:{x:100,y:500,width:200,height:100},evidence:{geometryKnown:true,rectIntersectsViewport:true,rectFullyInViewport:true}};
const occludedObservation=observation('ui-occ');
occludedObservation.browserUi.native={
  targetWindowHandle:100,
  targetWindowForeground:false,
  contentRect:{x:0,y:100,width:1000,height:700},
  focusedElement:{controlType:'Edit',name:'Search',processId:10,state:{focused:true}},
  foregroundWindow:{handle:200,processId:20,processName:'TextInputHost',rect:{x:0,y:450,width:1000,height:350}},
  topLevelOccluders:[{handle:200,processId:20,processName:'TextInputHost',rect:{x:0,y:450,width:1000,height:350},contentIntersection:{x:0,y:450,width:1000,height:350},zOrder:1}]
};
const occludedSemantic={...semantic,affordances:[{index:1,tag:'input',role:'textbox',type:'text',editable:true,disabled:false,label:'Search',active:false,actionRect:{x:100,y:500,width:200,height:100},visible:true,visibleRect:{x:100,y:500,width:200,height:100},hitTested:true,hitSamples:[{x:200,y:550,owned:true,blocker:null}],evidence:{geometryKnown:true,rectIntersectsViewport:true,rectFullyInViewport:true},state:{}}]};
const occludedSnapshot={pageType:'home',currentTopic:'unknown',candidates:[{videoId:'neighbor1',surface:'home_feed',position:1,targetMatch:false,targetProximity:0.5,representations:[ownedRep],mediaFormat:{kind:'LONG_FORM'}}]};
const occluded=buildWorld({observation:occludedObservation,semantic:occludedSemantic,snapshot:occludedSnapshot,browser,tabId:1,target:{videoId:'target1',mediaFormat:{kind:'LONG_FORM'}}});
assert.equal(occluded.browserUi.native.topLevelOccluders.length,1);
assert.equal(occluded.candidates[0].actionable,false);
assert.equal(occluded.candidates[0].reason,'native_top_level_occlusion');
assert.equal(occluded.affordances[0].interaction.actionable,false);
assert.equal(occluded.affordances[0].interaction.reason,'native_top_level_occlusion');

console.log('browser_ui_world_contract: PASS (native Chrome UI facts reach Brain world model without policy/action changes)');
