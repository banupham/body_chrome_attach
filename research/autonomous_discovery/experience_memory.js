'use strict';

const fs=require('node:fs');
const path=require('node:path');

function clone(v){return JSON.parse(JSON.stringify(v));}
function nowIso(){return new Date().toISOString();}
function safeLoad(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return clone(fallback);}}
function atomicWrite(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=`${file}.tmp-${process.pid}-${Date.now()}`;fs.writeFileSync(tmp,JSON.stringify(value,null,2));fs.renameSync(tmp,file);}
function key(...parts){return parts.map(x=>String(x??'unknown')).join('|');}

class ExperienceMemory{
  constructor(file){
    this.file=file;
    this.state=safeLoad(file,{schemaVersion:1,effectSchema:'candidate_effect_v2',updatedAt:null,totalRuns:0,totalSteps:0,strategies:{},queries:{},transitions:{},topics:{},interactionEffects:{},actionEffects:{},lessons:[]});
    if(Number(this.state.schemaVersion)!==1)this.state={schemaVersion:1,effectSchema:'candidate_effect_v2',updatedAt:null,totalRuns:0,totalSteps:0,strategies:{},queries:{},transitions:{},topics:{},interactionEffects:{},actionEffects:{},lessons:[]};
    this.state.interactionEffects=this.state.interactionEffects||{};this.state.actionEffects=this.state.actionEffects||{};this.state.effectSchema='candidate_effect_v2';
  }
  strategy(id,context='global'){
    const k=key(context,id);return this.state.strategies[k]||(this.state.strategies[k]={id,context,attempts:0,successes:0,rewardSum:0,meanReward:0,newTopicCount:0,newTransitionCount:0,targetSeenCount:0,lastUsedAt:null});
  }
  ucb(id,context='global',exploration=1.4){
    const row=this.strategy(id,context),total=Math.max(1,Object.values(this.state.strategies).filter(x=>x.context===context).reduce((s,x)=>s+x.attempts,0));
    if(row.attempts===0)return Number.POSITIVE_INFINITY;
    return row.meanReward+Number(exploration)*Math.sqrt(Math.log(total+1)/row.attempts);
  }
  recordStrategy(id,{context='global',reward=0,success=false,newTopics=0,newTransitions=0,targetSeen=false}={}){
    const row=this.strategy(id,context);row.attempts++;if(success)row.successes++;row.rewardSum+=Number(reward)||0;row.meanReward=Number((row.rewardSum/row.attempts).toFixed(4));row.newTopicCount+=Number(newTopics)||0;row.newTransitionCount+=Number(newTransitions)||0;if(targetSeen)row.targetSeenCount++;row.lastUsedAt=nowIso();this.state.totalSteps++;return clone(row);
  }
  recordQuery(query,{reward=0,targetSeen=false,resultCount=0}={}){
    const k=String(query||'').toLowerCase(),row=this.state.queries[k]||(this.state.queries[k]={query:String(query||''),attempts:0,rewardSum:0,meanReward:0,targetSeenCount:0,totalResults:0,lastUsedAt:null});
    row.attempts++;row.rewardSum+=Number(reward)||0;row.meanReward=Number((row.rewardSum/row.attempts).toFixed(4));if(targetSeen)row.targetSeenCount++;row.totalResults+=Number(resultCount)||0;row.lastUsedAt=nowIso();return clone(row);
  }
  recordTransition(fromTopic,toTopic,{surface='unknown',count=1}={}){
    const k=key(fromTopic,toTopic,surface),row=this.state.transitions[k]||(this.state.transitions[k]={fromTopic,toTopic,surface,count:0,lastSeenAt:null});row.count+=Math.max(1,Number(count)||1);row.lastSeenAt=nowIso();return clone(row);
  }
  recordTopic(topic,count=1){const k=String(topic||'unknown'),row=this.state.topics[k]||(this.state.topics[k]={topic:k,observations:0,lastSeenAt:null});row.observations+=Math.max(1,Number(count)||1);row.lastSeenAt=nowIso();return clone(row);}
  interactionEffect(id,context='global'){
    const k=key(context,id);return this.state.interactionEffects[k]||(this.state.interactionEffects[k]={id,context,observations:0,successfulExecutions:0,recommendationShiftSum:0,meanRecommendationShift:0,proximityGainSum:0,meanProximityGain:0,targetSeenCount:0,exposureSecondsSum:0,meanExposureSeconds:0,lastObservedAt:null});
  }
  recordInteractionEffect(id,{context='global',success=false,recommendationShift=0,proximityGain=0,targetSeen=false,exposureSeconds=0}={}){
    const row=this.interactionEffect(id,context),shift=Math.max(0,Math.min(1,Number(recommendationShift)||0)),gain=Math.max(0,Number(proximityGain)||0),exposure=Math.max(0,Number(exposureSeconds)||0);
    row.observations++;if(success)row.successfulExecutions++;row.recommendationShiftSum+=shift;row.meanRecommendationShift=Number((row.recommendationShiftSum/row.observations).toFixed(4));row.proximityGainSum+=gain;row.meanProximityGain=Number((row.proximityGainSum/row.observations).toFixed(4));if(targetSeen)row.targetSeenCount++;row.exposureSecondsSum+=exposure;row.meanExposureSeconds=Number((row.exposureSecondsSum/row.observations).toFixed(3));row.lastObservedAt=nowIso();return clone(row);
  }
  interactionEffectScore(id,context='global'){
    const row=this.state.interactionEffects[key(context,id)];if(!row||!row.observations)return 0;const successRate=row.successfulExecutions/row.observations,targetRate=row.targetSeenCount/row.observations;
    return Number(Math.max(-18,Math.min(36,row.meanRecommendationShift*18+row.meanProximityGain*90+targetRate*36+(successRate-0.5)*4)).toFixed(3));
  }
  actionEffect(id,context='global'){
    const k=key(this.state.effectSchema||'candidate_effect_v2',context,id);return this.state.actionEffects[k]||(this.state.actionEffects[k]={id,context,effectSchema:this.state.effectSchema||'candidate_effect_v2',observations:0,executionSuccesses:0,expectedEffectSuccesses:0,regressions:0,targetProgressCount:0,goalSuccessCount:0,effectValueSum:0,meanEffectValue:0,lastObservedAt:null});
  }
  recordActionEffect(id,{context='global',executionSuccess=false,expectedEffectObserved=false,regressed=false,targetProgress=false,goalSuccess=false,effectValue=0}={}){
    const row=this.actionEffect(id,context);row.observations++;if(executionSuccess)row.executionSuccesses++;if(expectedEffectObserved)row.expectedEffectSuccesses++;if(regressed)row.regressions++;if(targetProgress)row.targetProgressCount++;if(goalSuccess)row.goalSuccessCount++;row.effectValueSum+=Number(effectValue)||0;row.meanEffectValue=Number((row.effectValueSum/row.observations).toFixed(4));row.lastObservedAt=nowIso();return clone(row);
  }
  actionEffectScore(id,context='global'){
    const row=this.state.actionEffects[key(this.state.effectSchema||'candidate_effect_v2',context,id)];if(!row||!row.observations)return 0;
    const effectRate=row.expectedEffectSuccesses/row.observations,regressionRate=row.regressions/row.observations,targetRate=row.targetProgressCount/row.observations,goalRate=row.goalSuccessCount/row.observations;
    return Number(Math.max(-32,Math.min(52,row.meanEffectValue*0.8+(effectRate-0.5)*18-regressionRate*22+targetRate*28+goalRate*52)).toFixed(3));
  }
  addLesson(text,evidence={}){const row={at:nowIso(),text:String(text),evidence:clone(evidence)};this.state.lessons.push(row);if(this.state.lessons.length>200)this.state.lessons.splice(0,this.state.lessons.length-200);return row;}
  startRun(){this.state.totalRuns++;this.save();}
  save(){this.state.updatedAt=nowIso();atomicWrite(this.file,this.state);}
  summary(){
    const strategies=Object.values(this.state.strategies).sort((a,b)=>b.meanReward-a.meanReward||b.attempts-a.attempts).slice(0,30);
    const transitions=Object.values(this.state.transitions).sort((a,b)=>b.count-a.count).slice(0,60);
    const queries=Object.values(this.state.queries).sort((a,b)=>b.meanReward-a.meanReward||b.targetSeenCount-a.targetSeenCount).slice(0,30);
    const interactionEffects=Object.values(this.state.interactionEffects||{}).sort((a,b)=>(b.targetSeenCount-a.targetSeenCount)||(b.meanProximityGain-a.meanProximityGain)||(b.meanRecommendationShift-a.meanRecommendationShift)).slice(0,60),actionEffects=Object.values(this.state.actionEffects||{}).sort((a,b)=>(b.goalSuccessCount-a.goalSuccessCount)||(b.targetProgressCount-a.targetProgressCount)||(b.meanEffectValue-a.meanEffectValue)).slice(0,80);return {effectSchema:this.state.effectSchema,updatedAt:this.state.updatedAt,totalRuns:this.state.totalRuns,totalSteps:this.state.totalSteps,strategies,queries,transitions,topics:Object.values(this.state.topics).sort((a,b)=>b.observations-a.observations),interactionEffects,actionEffects,lessons:this.state.lessons.slice(-30)};
  }
}

module.exports={ExperienceMemory,atomicWrite,safeLoad};
