'use strict';

const assert=require('node:assert/strict');
const {youtubeSemanticObservation}=require('../src/youtube_semantic_observer');

const rect={x:40,y:150,width:520,height:260,centerX:300,centerY:280};
const card={getBoundingClientRect:()=>rect,querySelectorAll:()=>[]};
const anchor={
  href:'https://www.youtube.com/watch?v=hist001abc',
  parentElement:card,
  getBoundingClientRect:()=>rect,
  getAttribute(name){if(name==='href')return '/watch?v=hist001abc';if(name==='title')return 'History Home Tour Orange County';return '';},
  closest(selector){if(String(selector).includes('promoted')||String(selector).includes('ad-slot')||String(selector).includes('playlist-panel'))return null;return card;}
};
const root={getBoundingClientRect:()=>({x:0,y:100,width:1000,height:650}),querySelectorAll:()=>[anchor]};
const documentRef={
  title:'History - YouTube',activeElement:null,documentElement:{scrollHeight:1600},body:{scrollHeight:1600},
  querySelector(selector){const s=String(selector);if(s.includes('accounts.google.com/ServiceLogin'))return null;if(s.includes('button#avatar-btn'))return {};if(s.includes('page-subtype="history"')||s==='ytd-browse #contents'||s==='ytd-section-list-renderer #contents')return root;return null;},
  querySelectorAll(){return [];}
};
const windowRef={innerWidth:1200,innerHeight:800,scrollX:0,scrollY:0,pageXOffset:0,pageYOffset:0};
const locationRef={href:'https://www.youtube.com/feed/history'};
const observation=youtubeSemanticObservation({documentRef,windowRef,locationRef,maxItems:20});
assert.equal(observation.available,true);
assert.equal(observation.route.pageType,'feed');
assert.equal(observation.signedInState,'signed_in');
const history=observation.surfaces.find(x=>x.surface==='history_feed');
assert.ok(history);
assert.equal(history.items.length,1);
assert.equal(history.items[0].videoId,'hist001abc');
assert.equal(history.items[0].title,'History Home Tour Orange County');
assert.equal(observation.privacy.accountIdentityCaptured,false);
assert.equal(observation.privacy.watchHistorySurfaceCaptured,true);
console.log('account_history_observer_contract: PASS');
