'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {youtubeRoute,youtubeSemanticObservation}=require('../src/youtube_semantic_observer');

function rect(){return {x:10,y:10,width:120,height:30};}
const searchInput={tagName:'INPUT',getBoundingClientRect:rect};
const searchButton={tagName:'BUTTON',getBoundingClientRect:rect};
function resultNode(href){return {querySelector(){return {getAttribute(name){return name==='href'?href:null;},href};}};}
const documentRef={
  activeElement:searchInput,
  querySelector(selector){
    if(selector==='input#search')return searchInput;
    if(selector==='button#search-icon-legacy')return searchButton;
    return null;
  },
  querySelectorAll(selector){
    if(selector==='ytd-search ytd-video-renderer')return [resultNode('/watch?v=a'),resultNode('/watch?v=b')];
    return [];
  }
};
const windowRef={innerWidth:1280,innerHeight:720};
const locationRef={href:'https://www.youtube.com/results?search_query=private+query+must+not+persist'};
const route=youtubeRoute(locationRef);
assert.equal(route.supported,true);
assert.equal(route.pageType,'search');
assert.equal(route.searchQueryPresent,true);
assert.equal(Object.prototype.hasOwnProperty.call(route,'searchQuery'),false);

const observation=youtubeSemanticObservation({documentRef,windowRef,locationRef});
assert.equal(observation.available,true);
assert.equal(observation.platform,'youtube');
assert.equal(observation.controls.searchInput.active,true);
assert.equal(observation.surfaces[0].surface,'search_results');
assert.equal(observation.surfaces[0].itemCount,2);
assert.equal(observation.privacy.searchQueryCaptured,false);
assert.equal(observation.privacy.accountIdentityCaptured,false);
assert.equal(observation.privacy.textContentCaptured,false);
const serialized=JSON.stringify(observation);
assert.equal(serialized.includes('private query must not persist'),false);
assert.equal(serialized.includes('private+query+must+not+persist'),false);

const unsupported=youtubeSemanticObservation({documentRef,windowRef,locationRef:{href:'https://example.com/'}});
assert.equal(unsupported.available,false);

const observerSource=fs.readFileSync(path.join(__dirname,'..','src','youtube_semantic_observer.js'),'utf8');
const contentSource=fs.readFileSync(path.join(__dirname,'..','src','virtual_cursor_content.js'),'utf8');
for(const forbidden of ['.click(','.focus(','.scrollIntoView(','.dispatchEvent(','form.submit(','history.back(','history.forward(']){
  assert.equal(observerSource.includes(forbidden),false,`semantic observer action forbidden: ${forbidden}`);
}
assert.ok(contentSource.includes("message?.action === 'body.semanticObservation'"));
assert.ok(contentSource.includes('youtubeSemanticObservation'));
console.log('semantic_observer_contract: PASS');
