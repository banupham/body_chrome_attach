'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {buildAccountProfile,relationshipForTarget,planForRelationship,RELATION,ACCOUNT_STATE,inferAccountState,AccountProfileStore}=require('../research/autonomous_discovery/account_profile');

function video(id,{title='video',topicLabels=[],tags=[],categoryId='22',channelId='channel-a',channelTitle='Channel A',language='vi',country='VN',format='LONG_FORM'}={}){
  return {videoId:id,title,tags,topicLabels,categoryId,channelId,channelTitle,defaultLanguage:language,mediaFormat:{kind:format},keywords:tags.map(term=>({term,sources:['tag']})),channel:{channelId,title:channelTitle,country,keywords:tags,topicLabels}};
}

const history=[];
for(let i=0;i<30;i++)history.push(video(`estate-${i}`,{title:`Mua nhà Orange County ${i}`,tags:['mua nhà orange county','real estate','california'],channelId:i<8?'mike':'other-estate',channelTitle:i<8?'Mike Tran':'Estate Channel'}));
for(let i=0;i<8;i++)history.push(video(`food-${i}`,{title:`Vietnamese food ${i}`,tags:['food','cooking'],categoryId:'26',channelId:'food-channel'}));
const profile=buildAccountProfile({accountId:'acct-demo-001',historyVideos:history,signedInState:'signed_in',homeSampleCount:24});
assert.equal(profile.historySampleCount,38);
assert.equal(profile.accountState,ACCOUNT_STATE.ESTABLISHED);
assert.ok(profile.accountKey&&!profile.accountKey.includes('acct-demo-001'));
assert.equal(profile.signedInState,'signed_in');
assert.ok(profile.habits.dominantTopics.length>0);

const familiarTarget=video('target-new',{title:'Người Việt mua nhà Orange County',tags:['mua nhà orange county','california'],channelId:'mike',channelTitle:'Mike Tran'});
const familiar=relationshipForTarget(profile,familiarTarget);
assert.equal(familiar.kind,RELATION.FAMILIAR_SOURCE);
assert.ok(planForRelationship(familiar,profile.accountState).surfaceBias.related>planForRelationship(familiar,profile.accountState).surfaceBias.search_results);

const exactTarget=history[2];
const returning=relationshipForTarget(profile,exactTarget);
assert.equal(returning.kind,RELATION.RETURNING_TARGET);
assert.equal(returning.targetPreviouslyWatched,true);
assert.ok(planForRelationship(returning,profile.accountState).homeUtility>0);

const novelTarget=video('gaming-target',{title:'Competitive Valorant championship',tags:['valorant','esports','gaming'],categoryId:'20',channelId:'gaming-channel',language:'en',country:'US'});
const novel=relationshipForTarget(profile,novelTarget);
assert.equal(novel.kind,RELATION.NOVEL_TOPIC);
assert.ok(planForRelationship(novel,profile.accountState).searchUtility>planForRelationship(familiar,profile.accountState).searchUtility);

const empty=buildAccountProfile({accountId:'new-account',historyVideos:[],signedInState:'signed_in',historyStatus:'available',homeSampleCount:0});
assert.equal(empty.accountState,ACCOUNT_STATE.NEW_ACCOUNT_EMPTY);
const noPrior=relationshipForTarget(empty,familiarTarget);
assert.equal(noPrior.kind,RELATION.NO_PRIOR_CONTEXT);
const emptyPlan=planForRelationship(noPrior,empty.accountState);
assert.equal(emptyPlan.mode,'bootstrap_personalization_from_zero');
assert.ok(emptyPlan.previewUtility>emptyPlan.homeUtility);
assert.ok(emptyPlan.searchUtility>0);

const weak=buildAccountProfile({accountId:'weak-account',historyVideos:[],signedInState:'signed_in',historyStatus:'available',homeSampleCount:5});
assert.equal(weak.accountState,ACCOUNT_STATE.COLD_START_WEAK);
assert.equal(planForRelationship(relationshipForTarget(weak,familiarTarget),weak.accountState).mode,'cold_start_search_preview_and_measure');
assert.equal(inferAccountState({hasAccountId:true,signedInState:'signed_in',historyStatus:'unavailable'}),ACCOUNT_STATE.HISTORY_UNAVAILABLE);
assert.equal(inferAccountState({hasAccountId:true,signedInState:'signed_out',historyStatus:'available'}),ACCOUNT_STATE.SIGNED_OUT_MISMATCH);
assert.equal(inferAccountState({hasAccountId:false}),ACCOUNT_STATE.ANONYMOUS);

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'body-account-profile-'));
try{
  const store=new AccountProfileStore(tmp,'acct-activity-test');
  store.recordActivity({type:'PREVIEW_EXPOSURE',videoId:'preview-001',surface:'search_results',previewConfirmed:true,hoverMs:4200});
  store.recordActivity({type:'OPENED_VIDEO',videoId:'opened-002',surface:'related'});
  store.recordActivity({type:'SEARCH_QUERY',query:'mua nha orange county'});
  const generated=store.brainGeneratedVideoIds();
  assert.equal(generated.has('preview-001'),true);
  assert.equal(generated.has('opened-002'),true);
  assert.equal(generated.size,2);
}finally{fs.rmSync(tmp,{recursive:true,force:true});}

console.log('account_profile_contract: PASS');
