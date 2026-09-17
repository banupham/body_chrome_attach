'use strict';

const assert=require('node:assert/strict');
const {buildWorld,worldDelta}=require('../research/autonomous_discovery/world_model');

const semantic={route:{pageType:'home',path:'/'},viewport:{width:1000,height:700,scrollX:0,scrollY:0},controls:{},advertising:{},affordances:[]};
const browser={tabs:[{id:1,active:true,windowId:7,siteKey:'youtube.com',title:'YouTube',navigationToken:'n1'}]};
function observation(signature,focused='Address and search bar'){return {browserUi:{available:true,observed:true,reason:null,confidence:'title_match',source:'windows_uia_read_only',observedAt:100,signature,window:{name:'YouTube - Google Chrome'},focusedControl:{controlType:'Edit',name:focused},addressBar:{controlType:'Edit',name:'Address and search bar'},tabs:[],controls:[]},content:{page:{}},control:{},environment:{online:true,eligible:true,status:'ELIGIBLE',browserState:'ACTIVE'},bodyState:{activeTabId:1,pointer:null}};}
const before=buildWorld({observation:observation('ui-1'),semantic,browser,tabId:1,target:{}});const after=buildWorld({observation:observation('ui-2','Customize and control Google Chrome'),semantic,browser,tabId:1,target:{}});
assert.equal(before.browserUi.observed,true);assert.equal(before.browserUi.source,'windows_uia_read_only');assert.equal(before.browserUi.addressBar.name,'Address and search bar');assert.ok(worldDelta(before,after).reasons.includes('browser_ui'));
console.log('browser_ui_world_contract: PASS (native Chrome UI facts reach Brain world model without policy/action changes)');
