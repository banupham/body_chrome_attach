'use strict';

const assert=require('node:assert/strict');
const {buildAccountProfile,relationshipForTarget,planForRelationship,RELATION}=require('../research/autonomous_discovery/account_profile');

function video(id,{title='video',topicLabels=[],tags=[],categoryId='22',channelId='channel-a',channelTitle='Channel A',language='vi',country='VN',format='LONG_FORM'}={}){
  return {videoId:id,title,tags,topicLabels,categoryId,channelId,channelTitle,defaultLanguage:language,mediaFormat:{kind:format},keywords:tags.map(term=>({term,sources:['tag']})),channel:{channelId,title:channelTitle,country,keywords:tags,topicLabels}};
}

const history=[];
for(let i=0;i<30;i++)history.push(video(`estate-${i}`,{title:`Mua nhà Orange County ${i}`,tags:['mua nhà orange county','real estate','california'],channelId:i<8?'mike':'other-estate',channelTitle:i<8?'Mike Tran':'Estate Channel'}));
for(let i=0;i<8;i++)history.push(video(`food-${i}`,{title:`Vietnamese food ${i}`,tags:['food','cooking'],categoryId:'26',channelId:'food-channel'}));
const profile=buildAccountProfile({accountId:'acct-demo-001',historyVideos:history,signedInState:'signed_in'});
assert.equal(profile.historySampleCount,38);
assert.ok(profile.accountKey&&!profile.accountKey.includes('acct-demo-001'));
assert.equal(profile.signedInState,'signed_in');
assert.ok(profile.habits.dominantTopics.length>0);

const familiarTarget=video('target-new',{title:'Người Việt mua nhà Orange County',tags:['mua nhà orange county','california'],channelId:'mike',channelTitle:'Mike Tran'});
const familiar=relationshipForTarget(profile,familiarTarget);
assert.equal(familiar.kind,RELATION.FAMILIAR_SOURCE);
assert.ok(planForRelationship(familiar).surfaceBias.related>planForRelationship(familiar).surfaceBias.search_results);

const exactTarget=history[2];
const returning=relationshipForTarget(profile,exactTarget);
assert.equal(returning.kind,RELATION.RETURNING_TARGET);
assert.equal(returning.targetPreviouslyWatched,true);
assert.ok(planForRelationship(returning).homeUtility>0);

const novelTarget=video('gaming-target',{title:'Competitive Valorant championship',tags:['valorant','esports','gaming'],categoryId:'20',channelId:'gaming-channel',language:'en',country:'US'});
const novel=relationshipForTarget(profile,novelTarget);
assert.equal(novel.kind,RELATION.NOVEL_TOPIC);
assert.ok(planForRelationship(novel).searchUtility>planForRelationship(familiar).searchUtility);

console.log('account_profile_contract: PASS');
