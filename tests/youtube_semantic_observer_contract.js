'use strict';
const assert = require('node:assert/strict');
const {isDurationOnly,stripDurationNoise,youtubeRoute,chooseSemanticTitle,rectIntersects} = require('../src/youtube_semantic_observer');

assert.equal(isDurationOnly('1:31:49'), true);
assert.equal(isDurationOnly('1:31:49 Đang phát'), true);
assert.equal(isDurationOnly('ĐẾN KHI NÀO - Những Bản Hits Nhạc Trẻ Chill'), false);
assert.equal(stripDurationNoise('1:31:49 1:31:49 Đang phát ĐẾN KHI NÀO - Chill'), 'ĐẾN KHI NÀO - Chill');

const route=youtubeRoute({href:'https://www.youtube.com/watch?v=abc123&list=RDabc123&start_radio=1&si=secret'});
assert.equal(route.pageType,'watch_radio');
assert.equal(route.videoId,'abc123');
assert.equal(route.isRadio,true);
assert.match(route.path,/v=abc123/);
assert.doesNotMatch(route.path,/si=/);

const titleNode={
  getAttribute(name){return name==='title'?'PLAYLIST BALLAD ĐƯỢC NGHE NHIỀU NHẤT 2026':null;},
  textContent:'1:31:49'
};
const card={querySelectorAll(selector){return selector==='#video-title'?[titleNode]:[];}};
const anchor={getAttribute(name){return name==='aria-label'?'1:31:49':null;},parentElement:null};
const title=chooseSemanticTitle(card,anchor);
assert.equal(title.title,'PLAYLIST BALLAD ĐƯỢC NGHE NHIỀU NHẤT 2026');
assert.equal(title.semantic,true);
assert.equal(rectIntersects({x:10,y:10,width:30,height:30},{x:20,y:20,width:50,height:50}),true);
assert.equal(rectIntersects({x:10,y:10,width:5,height:5},{x:20,y:20,width:50,height:50}),false);
console.log('youtube_semantic_observer_contract: PASS');
