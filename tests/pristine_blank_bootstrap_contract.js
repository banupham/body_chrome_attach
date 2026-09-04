'use strict';

const assert=require('node:assert/strict');
const {isBlankTab,blankBrowserCandidates,chooseNewestBlankBrowser,youtubeTabOf}=require('../research/pristine_blank_bootstrap');

assert.equal(isBlankTab({siteKey:'__non_web__',urlScheme:'about:',title:''}),true);
assert.equal(isBlankTab({siteKey:'__non_web__',urlScheme:'chrome:',title:'New Tab'}),true);
assert.equal(isBlankTab({siteKey:'www.youtube.com',urlScheme:'https:',title:'YouTube'}),false);

const rows=[
  {browserInstanceId:'browser-old',extensionInstanceId:'ext-old',online:true,connectedAt:100,tabs:[{id:1,active:true,siteKey:'__non_web__',urlScheme:'about:',title:''}]},
  {browserInstanceId:'browser-web',extensionInstanceId:'ext-web',online:true,connectedAt:300,tabs:[{id:2,active:true,siteKey:'example.com',urlScheme:'https:',title:'Example'}]},
  {browserInstanceId:'browser-fresh',extensionInstanceId:'ext-fresh',online:true,connectedAt:400,tabs:[{id:3,active:true,siteKey:'__non_web__',urlScheme:'about:',title:''}]},
  {browserInstanceId:'browser-offline',extensionInstanceId:'ext-off',online:false,connectedAt:500,tabs:[{id:4,active:true,siteKey:'__non_web__',urlScheme:'about:',title:''}]}
];
assert.deepEqual(blankBrowserCandidates(rows).map(x=>x.browserInstanceId),['browser-fresh','browser-old']);
assert.equal(chooseNewestBlankBrowser(rows).browserInstanceId,'browser-fresh');
assert.equal(youtubeTabOf({tabs:[{id:5,active:false,siteKey:'www.youtube.com'},{id:6,active:true,siteKey:'www.youtube.com'}]}).id,6);

console.log('pristine_blank_bootstrap_contract: PASS');
