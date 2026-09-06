'use strict';
const assert = require('node:assert/strict');
const {isDurationOnly,stripDurationNoise,youtubeRoute,chooseSemanticTitle,rectIntersects} = require('../src/youtube_semantic_observer');
const {youtubeAuthObservation}=require('../src/youtube_auth_observer');

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

function visibleNode({text='',attrs={}}={}){return {textContent:text,getAttribute(name){return attrs[name]??null;},getBoundingClientRect(){return {x:10,y:10,width:100,height:30};},querySelectorAll(){return [];}};}
function authDoc(map={}){return {querySelector(selector){return map[selector]||null;}};}
const shell=visibleNode(),masthead=visibleNode(),search=visibleNode(),signIn=visibleNode(),avatar=visibleNode();
const signedOutDoc=authDoc({'ytd-app':shell,'ytd-masthead':masthead,'input#search':search,'a[href*="accounts.google.com/ServiceLogin"]':signIn});
const signedOut=youtubeAuthObservation({documentRef:signedOutDoc,windowRef:{innerWidth:1000,innerHeight:700},fallbackState:'unknown'});
assert.equal(signedOut.state,'signed_out');
assert.ok(signedOut.signedOutSignals.includes('service_login'));
assert.equal(signedOut.readiness.uiHydrated,true);
assert.equal(signedOut.privacy,'signals_only_no_account_identity');
const signedInDoc=authDoc({'ytd-app':shell,'ytd-masthead':masthead,'button#avatar-btn':avatar});
const signedIn=youtubeAuthObservation({documentRef:signedInDoc,windowRef:{innerWidth:1000,innerHeight:700},fallbackState:'unknown'});
assert.equal(signedIn.state,'signed_in');
assert.ok(signedIn.signedInSignals.includes('avatar_button'));
const conflictDoc=authDoc({'ytd-app':shell,'ytd-masthead':masthead,'button#avatar-btn':avatar,'a[href*="accounts.google.com/ServiceLogin"]':signIn});
const conflict=youtubeAuthObservation({documentRef:conflictDoc,windowRef:{innerWidth:1000,innerHeight:700},fallbackState:'unknown'});
assert.equal(conflict.conflict,true);
assert.equal(conflict.state,'signed_in','conflicting auth evidence must fail safe as signed_in');

console.log('youtube_semantic_observer_contract: PASS');