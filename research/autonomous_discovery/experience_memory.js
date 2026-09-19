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
    this.state=safeLoad(file,{schemaVersion:1,updatedAt:null,totalRuns:0,totalSteps:0,strategies:{},queries:{},transitions:{},topics:{},interactionEffects:{},lessons:[]});
    if(Number(this.state.schemaVersion)!==1)this.state={schemaVersion:1,updatedAt:null,totalRuns:0,totalSteps:0,strategies:{},queries:{},transitions:{},topics:{},interactionEffects:{},lessons:[]};
    this.state.interactionEffects=this.state.interactionEffects||{};
    this.state.actionEffectSchema='effect_model_v2';
    this.state.actionEffects=this.state.actionEffects||{};
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
    const k=key('effect_model_v2',context,id);return this.state.actionEffects[k]||(this.state.actionEffects[k]={schema:'effect_model_v2',id,context,attempts:0,executionSuccesses:0,environmentChanges:0,expectedEffectHits:0,targetProgressHits:0,goalSuccesses:0,regressions:0,effectDeltaSum:0,meanEffectDelta:0,lastObservedAt:null});
  }
  recordActionEffect(id,{context='global',executionSuccess=false,environmentChanged=false,expectedEffectObserved=false,targetProgress=false,goalSuccess=false,regressed=false,effectDelta=0}={}){
    const row=this.actionEffect(id,context),delta=Math.max(-2,Math.min(2,Number(effectDelta)||0));row.attempts++;if(executionSuccess)row.executionSuccesses++;if(environmentChanged)row.environmentChanges++;if(expectedEffectObserved)row.expectedEffectHits++;if(targetProgress)row.targetProgressHits++;if(goalSuccess)row.goalSuccesses++;if(regressed)row.regressions++;row.effectDeltaSum+=delta;row.meanEffectDelta=Number((row.effectDeltaSum/row.attempts).toFixed(4));row.lastObservedAt=nowIso();return clone(row);
  }
  actionEffectScore(id,context='global'){
    const row=this.state.actionEffects[key('effect_model_v2',context,id)];if(!row||!row.attempts)return 0;const n=row.attempts,expected=row.expectedEffectHits/n,progress=row.targetProgressHits/n,goal=row.goalSuccesses/n,regress=row.regressions/n,execution=row.executionSuccesses/n;
    return Number(Math.max(-80,Math.min(120,row.meanEffectDelta*34+(expected-0.5)*24+progress*34+goal*90-regress*56+(execution-0.5)*4)).toFixed(3));
  }
  addLesson(text,evidence={}){const row={at:nowIso(),text:String(text),evidence:clone(evidence)};this.state.lessons.push(row);if(this.state.lessons.length>200)this.state.lessons.splice(0,this.state.lessons.length-200);return row;}
  startRun(){this.state.totalRuns++;this.save();}
  save(){this.state.updatedAt=nowIso();atomicWrite(this.file,this.state);}
  summary(){
    const strategies=Object.values(this.state.strategies).sort((a,b)=>b.meanReward-a.meanReward||b.attempts-a.attempts).slice(0,30);
    const transitions=Object.values(this.state.transitions).sort((a,b)=>b.count-a.count).slice(0,60);
    const queries=Object.values(this.state.queries).sort((a,b)=>b.meanReward-a.meanReward||b.targetSeenCount-a.targetSeenCount).slice(0,30);
    const interactionEffects=Object.values(this.state.interactionEffects||{}).sort((a,b)=>(b.targetSeenCount-a.targetSeenCount)||(b.meanProximityGain-a.meanProximityGain)||(b.meanRecommendationShift-a.meanRecommendationShift)).slice(0,60),actionEffects=Object.values(this.state.actionEffects||{}).sort((a,b)=>(b.goalSuccesses-a.goalSuccesses)||(b.targetProgressHits-a.targetProgressHits)||(b.meanEffectDelta-a.meanEffectDelta)||b.attempts-a.attempts).slice(0,80);return {updatedAt:this.state.updatedAt,totalRuns:this.state.totalRuns,totalSteps:this.state.totalSteps,strategies,queries,transitions,topics:Object.values(this.state.topics).sort((a,b)=>b.observations-a.observations),interactionEffects,actionEffectSchema:this.state.actionEffectSchema,actionEffects,lessons:this.state.lessons.slice(-30)};
  }
}

module.exports={ExperienceMemory,atomicWrite,safeLoad};
