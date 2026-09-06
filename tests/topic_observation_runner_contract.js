'use strict';

const assert=require('node:assert/strict');
const {parseObservationArgs}=require('../research/topic_observation_entry');
const {TopicObservationRunner,candidateAgeHours,crossTopicEvidence,representativeCandidates}=require('../research/topic_observation_runner');

const parsed=parseObservationArgs(['--query','nhạc','--target','gaming','--seed-video-id','music1','--track-video-id','game1','--discovery-window-sec','180','--snapshot-interval-sec','30','--fresh-max-age-hours','6']);
assert.equal(parsed.observeOnly,true);
assert.equal(parsed.stopOnTarget,false);
assert.equal(parsed.seedVideoId,'music1');
assert.equal(parsed.trackVideoId,'game1');
assert.equal(parsed.discoveryWindowSec,180);
assert.equal(parsed.snapshotIntervalSec,30);
assert.equal(parsed.freshMaxAgeHours,6);
assert.throws(()=>parseObservationArgs(['--discovery-window-sec','0']),/invalid_discovery_window_sec/);
assert.throws(()=>parseObservationArgs(['--snapshot-interval-sec','0']),/invalid_snapshot_interval_sec/);

const now=Date.parse('2026-09-04T15:00:00Z');
assert.equal(Number(candidateAgeHours({publishedAt:'2026-09-04T13:00:00Z'},now).toFixed(2)),2);
assert.deepEqual(crossTopicEvidence({categoryId:'10',topicLabels:['Music']},{categoryId:'20',topicLabels:['Video game culture']}),{categoryShift:true,topicShift:true,crossTopic:true,sourceCategoryId:'10',targetCategoryId:'20'});
assert.deepEqual(crossTopicEvidence({categoryId:'10',topicLabels:['Music']},{categoryId:'10',topicLabels:['Music','Pop music']}),{categoryShift:false,topicShift:false,crossTopic:false,sourceCategoryId:'10',targetCategoryId:'10'});

const obsForDedup={surfaces:[
  {surface:'mix_queue',items:[{surface:'mix_queue',videoId:'x',position:1,title:'X',semanticTitle:true}]},
  {surface:'related',items:[{surface:'related',videoId:'x',position:6,title:'X',semanticTitle:true},{surface:'related',videoId:'y',position:2,title:'Y',semanticTitle:true}]}
]};
const reps=representativeCandidates(obsForDedup);
assert.equal(reps.length,2);
assert.equal(reps.find(x=>x.videoId==='x').surface,'related','related surface should be the representative edge when the same video also appears in mix_queue');

const runner=new TopicObservationRunner(parsed,{});
runner.discoveryStartedAt=now;
runner.sourceVideoId='music1';
function observation(viewCount,rank,at){
  return {
    route:{videoId:'music1'},
    currentVideo:{videoId:'music1',youtubeApi:{videoId:'music1',categoryId:'10',topicLabels:['Music'],publishedAt:'2026-09-04T01:00:00Z',statistics:{viewCount:'10000'}}},
    surfaces:[{surface:'related',items:[
      {surface:'related',videoId:'game1',position:rank,title:'Fresh game',semanticTitle:true,isRadio:false,visible:true,youtubeApi:{videoId:'game1',title:'Fresh game',channelTitle:'Gaming VN',categoryId:'20',topicLabels:['Video game culture'],publishedAt:'2026-09-04T13:00:00Z',statistics:{viewCount:String(viewCount)}}},
      {surface:'related',videoId:'music2',position:2,title:'More music',semanticTitle:true,isRadio:true,visible:true,youtubeApi:{videoId:'music2',title:'More music',channelTitle:'Music VN',categoryId:'10',topicLabels:['Music'],publishedAt:'2026-09-03T10:00:00Z',statistics:{viewCount:'50000'}}}
    ]}]
  };
}
runner.recordDiscoverySnapshot(observation(1000,6,now),{sampleIndex:0,observedAt:now,elapsedMs:0});
runner.recordDiscoverySnapshot(observation(1120,4,now+60000),{sampleIndex:1,observedAt:now+60000,elapsedMs:60000});
const summary=runner.discoverySummary();
assert.equal(summary.snapshotCount,2);
assert.equal(summary.uniqueCandidateCount,2);
assert.equal(summary.freshCrossTopicCandidateCount,1);
assert.equal(summary.targetCandidateCount,1);
assert.equal(summary.trackedCandidate.videoId,'game1');
assert.equal(summary.trackedCandidate.firstSeenRank,6);
assert.equal(summary.trackedCandidate.minRank,4);
assert.equal(summary.trackedCandidate.observedViewDelta,120);
assert.equal(summary.trackedCandidate.observedViewsPerMinute,120);
assert.equal(runner.trackedCandidateTimeline.length,2);
assert.equal(runner.trackedCandidateTimeline.every(x=>x.seen===true),true);
assert.equal(runner.discoverySnapshots[0].freshCrossTopicCandidateCount,1);
assert.equal(runner.discoverySnapshots[0].crossTopicCandidateCount,1);
assert.equal(runner.discoverySnapshots[0].candidateCount,2);

console.log('topic_observation_runner_contract: PASS');
