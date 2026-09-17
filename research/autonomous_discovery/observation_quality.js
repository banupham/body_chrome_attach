'use strict';

function observationQuality(observation){
  const freshness=observation?.freshness;
  if(!freshness)return {usable:true,reason:'legacy_observation'};
  if(freshness.liveRefreshAttempted===true&&freshness.liveRefreshSucceeded!==true)return {usable:false,reason:'live_refresh_failed'};
  const age=freshness.semanticAgeMs;
  if(age!=null&&(!Number.isFinite(Number(age))||Number(age)>2000))return {usable:false,reason:'semantic_stale'};
  return {usable:true,reason:'fresh'};
}
module.exports={observationQuality};
