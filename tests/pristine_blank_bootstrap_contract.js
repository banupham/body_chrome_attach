'use strict';

const assert=require('node:assert/strict');
const {isBlankTab,blankBrowserCandidates,chooseNewestBlankBrowser,youtubeTabOf,activeTabOf,shouldRetryAddressNavigation,semanticPristineSnapshot}=require('../research/pristine_blank_bootstrap');

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
assert.equal(activeTabOf({tabs:[{id:7,active:false},{id:8,active:true}]}).id,8);

const blank={online:true,tabs:[{id:9,active:true,siteKey:'__non_web__',urlScheme:'about:',title:'about:blank'}]};
const youtube={online:true,tabs:[{id:10,active:true,siteKey:'www.youtube.com',urlScheme:'https:',title:'YouTube'}]};
assert.equal(shouldRetryAddressNavigation({browser:blank,attempts:1,maxAttempts:3,lastAttemptAt:1000,now:3199,retryMs:2200}),false);
assert.equal(shouldRetryAddressNavigation({browser:blank,attempts:1,maxAttempts:3,lastAttemptAt:1000,now:3200,retryMs:2200}),true);
assert.equal(shouldRetryAddressNavigation({browser:blank,attempts:3,maxAttempts:3,lastAttemptAt:1000,now:5000,retryMs:2200}),false);
assert.equal(shouldRetryAddressNavigation({browser:youtube,attempts:1,maxAttempts:3,lastAttemptAt:1000,now:5000,retryMs:2200}),false);

const coldUnknown=semanticPristineSnapshot({youtubeObservation:{signedInState:'unknown',route:{pageType:'home'},controls:{searchInput:null},surfaces:[{diagnostics:{rootSelector:null},items:[]}]}});
assert.equal(coldUnknown.signedInState,'unknown');
assert.equal(coldUnknown.uiReady,false);
const coldHydrated=semanticPristineSnapshot({youtubeObservation:{signedInState:'signed_out',route:{pageType:'home'},controls:{searchInput:{actionRect:{x:1,y:1,width:10,height:10}}},surfaces:[{diagnostics:{rootSelector:'ytd-rich-grid-renderer'},items:[]}]}});
assert.equal(coldHydrated.signedInState,'signed_out');
assert.equal(coldHydrated.routeReady,true);
assert.equal(coldHydrated.uiReady,true);
const coldSignedIn=semanticPristineSnapshot({youtubeObservation:{signedInState:'signed_in',route:{pageType:'home'},controls:{},surfaces:[]}});
assert.equal(coldSignedIn.signedInState,'signed_in');

console.log('pristine_blank_bootstrap_contract: PASS');