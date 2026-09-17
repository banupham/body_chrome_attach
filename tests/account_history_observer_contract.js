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

const previewRect={x:80,y:190,width:360,height:202,centerX:260,centerY:291};
const previewAnchor={href:'https://www.youtube.com/watch?v=preview12345',getAttribute(name){if(name==='href')return '/watch?v=preview12345';if(name==='title')return 'Orange County preview card';return '';},getBoundingClientRect:()=>previewRect,closest(){return previewCard;}};
const previewCard={getBoundingClientRect:()=>previewRect,querySelector(selector){return String(selector).includes('/watch')?previewAnchor:null;},querySelectorAll:()=>[]};
const previewVideo={paused:false,ended:false,readyState:4,currentTime:2.4,duration:45,muted:true,volume:0,getBoundingClientRect:()=>previewRect,parentElement:previewCard,closest(selector){const s=String(selector);if(s.includes('#movie_player')||s.includes('html5-video-player')||s.includes('ytd-player'))return null;if(s.includes('ytd-')||s.includes('yt-lockup')||s.includes('ytm-shorts'))return previewCard;return null;}};
const searchRoot={getBoundingClientRect:()=>({x:0,y:120,width:1000,height:650}),querySelectorAll(selector){return String(selector).includes('a[href')?[previewAnchor]:[];}};
const previewDocument={
  title:'Search - YouTube',activeElement:null,documentElement:{scrollHeight:1400},body:{scrollHeight:1400},
  querySelector(selector){const s=String(selector);if(s.includes('accounts.google.com/ServiceLogin'))return null;if(s.includes('button#avatar-btn'))return {};if(s==='ytd-search #contents'||s==='ytd-search')return searchRoot;return null;},
  querySelectorAll(selector){return String(selector)==='video'?[previewVideo]:[];}
};
const previewObservation=youtubeSemanticObservation({documentRef:previewDocument,windowRef,locationRef:{href:'https://www.youtube.com/results?search_query=orange+county'},maxItems:20});
assert.equal(previewObservation.route.pageType,'search');
assert.equal(previewObservation.preview.active,true);
assert.equal(previewObservation.preview.playing,true);
assert.equal(previewObservation.preview.videoId,'preview12345');
assert.equal(previewObservation.preview.surface,'search_results');
assert.ok(previewObservation.preview.currentTime>=2.4);
assert.equal(previewObservation.privacy.hoverPreviewPlaybackCaptured,true);

console.log('account_history_observer_contract: PASS');
