'use strict';

const {AutonomousYouTubeBrainV2,randomScrollPoint}=require('./brain_v2');
const {flattenCandidates,currentVideoId}=require('./brain');
const {classifyVideo,fold,uniq}=require('./topic_classifier');
const {adaptiveQueryPlan,expandFromEnvironment}=require('./adaptive_query_planner');
const {AutonomousAgentPlanner}=require('./agent_planner');
const {buildWorld,worldDelta,contextKey}=require('./world_model');
const {bodyCapabilityCatalog,isSupportedStep,publicStep}=require('./body_capabilities');

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,Math.max(0,Number(ms)||0)));
const randomInt=(a,b)=>Math.floor(a+Math.random()*(Math.max(a,b)-a+1));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));

class AutonomousYouTubeBrainV3 extends AutonomousYouTubeBrainV2{
  constructor(config,deps={}){
    super(config,deps);this.autonomyMode='full_body_agent';this.agentHistory=[];this.usedQueries=new Set();this.agentPlanner=new AutonomousAgentPlanner({memory:this.memory,explorationBase:Number(config.explorationRate??0.18)});this.taskModel=null;this.capabilityCatalog=bodyCapabilityCatalog();this.plannerDecisionCount=0;
  }
  buildFingerprint(){
    const classification=classifyVideo(this.targetApi||{});return {videoId:this.targetApi?.videoId||null,categoryId:String(this.targetApi?.categoryId||''),primaryTopic:classification.primary,topics:uniq([...(this.targetApi?.topicLabels||[]),...(this.targetApi?.channel?.topicLabels||[])]),tags:uniq(this.targetApi?.tags||[]),keywords:uniq((this.targetApi?.keywords||[]).filter(row=>!(row?.sources||[]).includes('description')).map(row=>row?.term||row)),country:this.targetApi?.channel?.country||null,language:this.queryPlan?.targetLanguage||this.targetApi?.defaultLanguage||this.targetApi?.defaultAudioLanguage||null};
  }
  deriveEnvironmentQueries(snapshot){
    if(snapshot.pageType!=='search'||!this.queryPlan||!this.targetApi)return;const titles=snapshot.candidates.map(row=>row.youtubeApi?.title||row.title||'').filter(Boolean);const expansion=expandFromEnvironment(titles,this.queryPlan,this.targetApi,{limit:8});let added=0;
    for(const row of expansion){const key=fold(row.query);if(this.queryPlan.plan.some(x=>fold(x.query)===key)||this.dynamicQueries.some(x=>fold(x.query)===key))continue;this.dynamicQueries.push(row);added++;}
    if(added)this.ledger('query_plan_expanded',{source:'environment_target_anchored',added,totalDynamic:this.dynamicQueries.length,queries:expansion.slice(0,added).map(row=>({query:row.query,components:row.components,provenance:row.provenance}))});
  }
  async semanticRecovery(){
    const tabs=await this.browserTabs();for(const tab of tabs){const inspected=await this.inspectTab(tab).catch(()=>null);if(inspected?.youtube){if(Number(tab.id)!==Number(this.tabId))await this.switchToTab(tab.id,{reason:'semantic_recovery'});return this.observe('semantic_recovered');}}
    await this.ensureWorkspaceTabs([this.tabId],{reason:'semantic_recovery_address'}).catch(()=>{});await this.body.browserUi(this.task.taskId,'address','https://www.youtube.com/',{tabId:Number(this.tabId)});return this.waitForSemantic(()=>true,{timeoutMs:12000,reason:'semantic_recovery_home'});
  }
  async worldFrom(state,snapshotInfo){const browser=await this.currentBrowser();return buildWorld({observation:state.observation,semantic:state.semantic,snapshot:snapshotInfo.snapshot,browser,tabId:this.tabId,target:{videoId:this.config.target},history:this.agentHistory});}
  async genericScroll(direction='down'){
    const state=await this.observe(`agent_scroll_${direction}_before`);if(!state.semantic)return {success:false,reason:'semantic_missing'};const beforeY=Number(state.semantic.viewport?.scrollY||0),beforeCount=flattenCandidates(state.semantic).length,point=randomScrollPoint(state.semantic,'page');let delta=randomInt(420,820);if(direction==='up')delta=-delta;delta+=randomInt(-80,80);
    const beforeTabs=await this.browserTabs(),sourceTabId=this.tabId;await this.motor({type:'moveTo',x:point.x,y:point.y,role:'page'});const result=await this.motor({type:'scrollVertical',delta});await this.reconcileTabEffects(beforeTabs,{reason:`agent_scroll_${direction}`,sourceTabId});
    const after=await this.waitForSemantic(s=>Math.abs(Number(s.viewport?.scrollY||0)-beforeY)>=2||flattenCandidates(s).length!==beforeCount,{timeoutMs:this.verifyTimeoutMs,intervalMs:220,reason:'agent_scroll_verify'});const success=Boolean(after?.semantic&&(Math.abs(Number(after.semantic.viewport?.scrollY||0)-beforeY)>=2||flattenCandidates(after.semantic).length!==beforeCount));this.ledger('agent_scroll_outcome',{direction,delta,x:point.x,y:point.y,success});return {success,result};
  }
  async executeRawBodyStep(action){
    const step=JSON.parse(JSON.stringify(action.step||{}));if(!isSupportedStep(step))return {success:false,reason:'unsupported_step'};
    if(step.kind==='browser_ui'&&step.action==='address')step.value='https://www.youtube.com/';
    if(step.kind==='browser_ui'&&step.action==='findtext')step.value=this.queryPlan?.plan?.[0]?.components?.[0]||this.queryPlan?.plan?.[0]?.query||'video';
    const beforeTabs=await this.browserTabs(),sourceTabId=this.tabId;let result;
    if(step.kind==='browser_ui')result=await this.body.browserUi(this.task.taskId,step.action,step.value??null,{tabId:Number(this.tabId)});
    else if(step.kind==='tab_switch'){const success=await this.switchToTab(step.targetTabId,{reason:'agent_raw_step'});return {success,result:null};}
    else result=await this.body.step(this.task.taskId,step,{tabId:Number(this.tabId)});
    await this.reconcileTabEffects(beforeTabs,{reason:`agent_raw:${action.capability}`,sourceTabId});return {success:result?.execution?.completed===true,result};
  }
  async executeAgentAction(action,snapshotInfo,world){
    const started=Date.now();let success=false,result=null,query=null,selected=null,dwellSec=0,error=null;
    try{
      if(action.type==='click_candidate'){
        selected=snapshotInfo.snapshot.candidates.find(c=>String(c.videoId)===String(action.target?.videoId))||null;if(!selected)throw new Error('planned_candidate_not_in_snapshot');const clicked=await this.clickCandidate(selected);success=clicked.ok;result=clicked.result||null;if(success){this.visitedVideos.add(selected.videoId);if(String(selected.videoId)===String(this.config.target)){this.targetOpened=true;this.targetDiscovery=this.targetDiscovery||{at:Date.now(),surface:selected.surface,method:selected.surface,rank:selected.position??null,fromVideoId:world.current.videoId||null,fromTopic:world.current.topic,strategy:'agent_planner',opened:true,openedAt:Date.now(),title:selected.youtubeApi?.title||selected.title||null};}}
      }else if(action.type==='search'){
        query=action.query;await this.search(action.queryRow);this.usedQueries.add(fold(query));success=true;
      }else if(action.type==='dwell'){
        dwellSec=this.dwellSeconds();await this.dwellWithAdHandling(world.current.videoId,dwellSec);success=true;
      }else if(action.type==='scroll'){
        const out=await this.genericScroll(action.direction);success=out.success;result=out.result;
      }else if(action.type==='home'){
        const out=await this.goHome();success=out.ok;
      }else if(action.type==='tab_switch'){
        success=await this.switchToTab(action.tabId,{reason:'agent_planner'});
      }else if(action.type==='body_step'){
        const out=await this.executeRawBodyStep(action);success=out.success;result=out.result;
      }else throw new Error(`agent_action_unknown:${action.type}`);
    }catch(e){error=String(e?.message||e);success=false;}
    return {success,result,query,selected,dwellSec,error,durationMs:Date.now()-started};
  }
  rewardAgent({action,outcome,delta,afterInfo}){
    let value=this.reward({newVideos:afterInfo.newVideos,newTopics:afterInfo.newTopics,newTransitions:afterInfo.newTransitions,proximityGain:afterInfo.proximityGain,targetSeen:Boolean(afterInfo.targetCandidate),targetOpened:this.targetOpened,success:outcome.success});if(delta.changed)value+=2;if(action.selection==='exploration'&&delta.changed)value+=1;if(!delta.changed&&outcome.success)value-=1.5;if(outcome.error)value-=4;return Number(value.toFixed(3));
  }
  async actAgent(state,snapshotInfo){
    const world=await this.worldFrom(state,snapshotInfo);if(world.currentIsTarget&&!this.config.continueAfterFound){this.targetOpened=true;return {stop:true,world};}
    const plan=this.agentPlanner.generate(world,{task:this.taskModel,queryPlan:this.queryPlan,dynamicQueries:this.dynamicQueries,usedQueries:this.usedQueries,stagnation:this.stagnation});const action=this.agentPlanner.choose(plan,{stagnation:this.stagnation});if(!action)throw new Error('agent_planner_no_action');this.plannerDecisionCount++;
    this.ledger('agent_plan',{decision:this.plannerDecisionCount,subgoal:plan.subgoal,context:plan.context,selected:{type:action.type,capability:action.capability,purpose:action.purpose,query:action.query||null,targetVideoId:action.target?.videoId||null,tabId:action.tabId??null,utility:action.utility,selection:action.selection,epsilon:action.epsilon},alternatives:plan.actions.slice(0,8).map(a=>({type:a.type,capability:a.capability,purpose:a.purpose,query:a.query||null,targetVideoId:a.target?.videoId||null,utility:a.utility}))});
    const outcome=await this.executeAgentAction(action,snapshotInfo,world);let afterState=await this.observe('agent_after_action');if(!afterState.semantic)afterState=await this.semanticRecovery();if(!afterState?.semantic)throw new Error('agent_semantic_recovery_failed');const afterInfo=await this.enrichedSnapshot(afterState,`agent_after_${action.type}`);const afterWorld=await this.worldFrom(afterState,afterInfo),delta=worldDelta(world,afterWorld);const success=outcome.success&&(delta.changed||action.type==='dwell'||action.capability?.startsWith('motor.moveTo')||action.capability?.startsWith('motor.hover'));
    const reward=this.rewardAgent({action,outcome:{...outcome,success},delta,afterInfo}),memoryId=`${action.capability||action.type}:${action.purpose||'general'}`,context=contextKey(world);this.memory.recordStrategy(memoryId,{context,reward,success,newTopics:afterInfo.newTopics,newTransitions:afterInfo.newTransitions,targetSeen:Boolean(afterInfo.targetCandidate)||this.targetOpened});if(outcome.query)this.memory.recordQuery(outcome.query,{reward,targetSeen:Boolean(afterInfo.targetCandidate)||this.targetOpened,resultCount:afterInfo.snapshot.candidates.length});if(!success)this.memory.addLesson('An autonomous action failed to produce its expected environment change; planner should lower this action in the same context.',{memoryId,context,error:outcome.error,delta:delta.reasons});this.memory.save();this.stagnation=reward<=1?this.stagnation+1:0;
    const historyRow={step:this.stepNo,at:Date.now(),actionKey:action.actionKey,type:action.type,capability:action.capability,purpose:action.purpose,subgoal:plan.subgoal.id,videoId:outcome.selected?.videoId||afterWorld.current.videoId||null,topic:outcome.selected?.classification?.primary||afterWorld.current.topic,query:outcome.query,tabId:this.tabId,success,reward,changed:delta.changed,changeReasons:delta.reasons,error:outcome.error,selection:action.selection,utility:action.utility};this.agentHistory.push(historyRow);if(this.agentHistory.length>500)this.agentHistory.splice(0,this.agentHistory.length-500);this.batchPath.push(historyRow);this.ledger('agent_outcome',historyRow);
    if(afterWorld.currentIsTarget){this.targetOpened=true;this.targetDiscovery=this.targetDiscovery||{at:Date.now(),surface:'agent_environment',method:'agent_environment',rank:null,fromVideoId:world.current.videoId||null,fromTopic:world.current.topic,strategy:'agent_planner',opened:true,openedAt:Date.now(),title:this.targetApi?.title||null};}
    return {success,reward,after:afterInfo,world:afterWorld,targetOpened:this.targetOpened,stop:this.targetOpened&&!this.config.continueAfterFound};
  }
  reportObject(status){const report=super.reportObject(status);report.schemaVersion=4;report.autonomy={...report.autonomy,mode:'FULL_BODY_AGENT',planner:'world_model_affordance_utility_experience_v3',fixedStrategyMenu:false,fullBodyCapabilityCatalog:this.capabilityCatalog,taskModel:this.taskModel,languageAwareQueryPlanner:this.queryPlan?.planner||null,targetLanguage:this.queryPlan?.targetLanguage||null};report.agent={plannerDecisions:this.plannerDecisionCount,history:this.agentHistory.slice(-250),usedQueries:[...this.usedQueries],dynamicQueries:this.dynamicQueries.slice(-50)};return report;}
  async run(){
    this.status='STARTING';this.memory.startRun();this.targetApi=await this.api.profileTarget(this.config.target);this.queryPlan=adaptiveQueryPlan(this.targetApi,{maxQueries:this.config.maxQueries});this.queryPlan.fingerprint=this.buildFingerprint();this.queryAudit.push(...this.queryPlan.audit);this.taskModel=this.agentPlanner.inferTask(this.targetApi,this.queryPlan);this.ledger('target_profiled',{videoId:this.targetApi.videoId,title:this.targetApi.title,categoryId:this.targetApi.categoryId,topics:this.targetApi.topicLabels,targetLanguage:this.queryPlan.targetLanguage,queryPlanner:this.queryPlan.planner,safeQueryCount:this.queryPlan.plan.length,plannedQueries:this.queryPlan.plan.map(row=>({query:row.query,components:row.components,provenance:row.provenance,specificity:row.specificity})),taskModel:{objective:this.taskModel.objective,constraints:this.taskModel.constraints,successEvidence:this.taskModel.successEvidence},capabilities:this.capabilityCatalog});
    await this.body.connect();await this.selectBrowser();await this.createTask();this.status='RUNNING';
    try{
      while(true){const limit=this.limitReached();if(limit){this.status=String(limit).toUpperCase();break;}this.stepNo++;let state=await this.observe(`agent_step_${this.stepNo}_before`);if(!state.semantic)state=await this.semanticRecovery();if(!state?.semantic){this.stagnation++;await sleep(500);continue;}await this.handleAds({waitForSkippable:true,maxWaitMs:2500});const before=await this.enrichedSnapshot(state,`agent_step_${this.stepNo}_before`);const result=await this.actAgent(state,before);if(result.stop){this.status='TARGET_REACHED';break;}if(result.targetOpened)this.status='TARGET_REACHED';else this.status='RUNNING';this.writeBatch(this.status,false);}
      this.writeBatch(this.status,true);await this.body.finishTask(this.task.taskId,'COMPLETED',{status:this.status,targetVideoId:this.config.target,targetOpened:this.targetOpened,steps:this.stepNo,planner:'v3'});return this.reportObject(this.status);
    }catch(error){this.status='ERROR';this.ledger('run_error',{error:String(error?.stack||error)});this.writeBatch(this.status,true);if(this.task)await this.body.finishTask(this.task.taskId,'FAILED',String(error?.message||error)).catch(()=>{});throw error;}finally{await this.body.close().catch(()=>{});}
  }
}

module.exports={AutonomousYouTubeBrainV3};
