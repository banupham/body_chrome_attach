'use strict';

const {AutonomousYouTubeBrainV2,randomScrollPoint}=require('./brain_v2');
const {flattenCandidates}=require('./brain');
const {classifyVideo,fold,uniq}=require('./topic_classifier');
const {adaptiveQueryPlan,expandFromEnvironment}=require('./adaptive_query_planner');
const {AutonomousAgentPlanner,actionMemoryId}=require('./agent_planner');
const {buildWorld,worldDelta,actionabilityDelta,recommendationDelta,contextKey}=require('./world_model');
const {bodyCapabilityCatalog,isSupportedStep}=require('./body_capabilities');
const {FORMAT,formatKind}=require('./media_format');
const {ExperienceMemory}=require('./experience_memory');
const {AccountProfileStore,buildAccountProfile,contextForTarget}=require('./account_profile');

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,Math.max(0,Number(ms)||0)));
const randomInt=(a,b)=>Math.floor(a+Math.random()*(Math.max(a,b)-a+1));

class AutonomousYouTubeBrainV3 extends AutonomousYouTubeBrainV2{
  constructor(config,deps={}){
    super(config,deps);this.autonomyMode='full_body_agent';this.agentHistory=[];this.usedQueries=new Set();this.accountProfileStore=config.accountId?new AccountProfileStore(this.root,config.accountId):null;this.accountContext=null;this.accountProfileActions=0;if(this.accountProfileStore?.experienceFile())this.memory=new ExperienceMemory(this.accountProfileStore.experienceFile());this.agentPlanner=new AutonomousAgentPlanner({memory:this.memory,explorationBase:Number(config.explorationRate??0.18)});this.taskModel=null;this.capabilityCatalog=bodyCapabilityCatalog();this.plannerDecisionCount=0;
  }
  buildFingerprint(){
    const classification=classifyVideo(this.targetApi||{});return {videoId:this.targetApi?.videoId||null,categoryId:String(this.targetApi?.categoryId||''),primaryTopic:classification.primary,topics:uniq([...(this.targetApi?.topicLabels||[]),...(this.targetApi?.channel?.topicLabels||[])]),tags:uniq(this.targetApi?.tags||[]),keywords:uniq((this.targetApi?.keywords||[]).filter(row=>!(row?.sources||[]).includes('description')).map(row=>row?.term||row)),country:this.targetApi?.channel?.country||null,language:this.queryPlan?.targetLanguage||this.targetApi?.defaultLanguage||this.targetApi?.defaultAudioLanguage||null,mediaFormat:formatKind(this.targetApi?.mediaFormat)};
  }
  deriveEnvironmentQueries(snapshot){
    if(snapshot.pageType!=='search'||!this.queryPlan||!this.targetApi)return;const titles=snapshot.candidates.map(row=>row.youtubeApi?.title||row.title||'').filter(Boolean);const expansion=expandFromEnvironment(titles,this.queryPlan,this.targetApi,{limit:8});let added=0;
    for(const row of expansion){const key=fold(row.query);if(this.queryPlan.plan.some(x=>fold(x.query)===key)||this.dynamicQueries.some(x=>fold(x.query)===key))continue;this.dynamicQueries.push(row);added++;}
    if(added)this.ledger('query_plan_expanded',{source:'environment_target_anchored',added,totalDynamic:this.dynamicQueries.length,queries:expansion.slice(0,added).map(row=>({query:row.query,components:row.components,provenance:row.provenance}))});
  }
  async enrichedSnapshot(state,reason){
    const info=await super.enrichedSnapshot(state,reason),id=info?.snapshot?.currentVideoId;
    if(id){const map=await this.api.enrichVideoIds([String(id)],{required:false}),row=map.get(String(id));info.snapshot.currentMediaFormat=row?.mediaFormat||null;}
    else info.snapshot.currentMediaFormat=null;
    return info;
  }
  async semanticRecovery(){
    const tabs=await this.browserTabs();for(const tab of tabs){const inspected=await this.inspectTab(tab).catch(()=>null);if(inspected?.youtube){if(Number(tab.id)!==Number(this.tabId))await this.switchToTab(tab.id,{reason:'semantic_recovery'});return this.observe('semantic_recovered');}}
    await this.ensureWorkspaceTabs([this.tabId],{reason:'semantic_recovery_address'}).catch(()=>{});await this.body.browserUi(this.task.taskId,'address','https://www.youtube.com/',{tabId:Number(this.tabId)});return this.waitForSemantic(()=>true,{timeoutMs:12000,reason:'semantic_recovery_home'});
  }
  async restoreHomeAfterAccountProfile(){
    await this.body.browserUi(this.task.taskId,'address','https://www.youtube.com/',{tabId:Number(this.tabId)});const state=await this.waitForSemantic(s=>s?.route?.pageType==='home',{timeoutMs:12000,intervalMs:300,reason:'account_profile_restore_home'});this.ledger('account_profile_workspace_restored',{pageType:state?.semantic?.route?.pageType||null});return state;
  }
  async profileAccountContext(){
    if(!this.accountProfileStore)return null;
    const cached=this.accountProfileStore.load(),startedActions=this.bodyActions,limit=120;let preflight=await this.observe('account_profile_preflight');const initialSignedIn=preflight?.semantic?.signedInState||'unknown';
    this.ledger('account_profile_requested',{accountKey:this.accountProfileStore.root?this.accountProfileStore.root.split(/[\\/]/).pop():null,initialSignedInState:initialSignedIn,cached:Boolean(cached),historyLimit:limit});
    try{
      await this.body.browserUi(this.task.taskId,'address','https://www.youtube.com/feed/history',{tabId:Number(this.tabId)});
      let state=await this.waitForSemantic(s=>s?.route?.pageType==='feed'&&/^\/feed\/history/i.test(String(s?.route?.path||'')),{timeoutMs:15000,intervalMs:350,reason:'account_history_arrival'});
      if(!state?.semantic){const context=cached?contextForTarget(cached,this.targetApi):null;this.ledger('account_profile_unavailable',{reason:'history_page_semantic_unavailable',usedCached:Boolean(context)});await this.restoreHomeAfterAccountProfile().catch(()=>{});this.accountProfileActions=this.bodyActions-startedActions;return context;}
      const seen=new Map();let noGrowth=0,lastSize=0;
      for(let round=0;round<18&&seen.size<limit;round++){
        const semantic=state.semantic,signed=semantic?.signedInState||'unknown',history=flattenCandidates(semantic).filter(x=>x.surface==='history_feed');
        for(const row of history)if(row?.videoId&&!seen.has(String(row.videoId)))seen.set(String(row.videoId),{videoId:String(row.videoId),rank:seen.size+1});
        if(seen.size===lastSize)noGrowth++;else noGrowth=0;lastSize=seen.size;
        this.ledger('account_history_scan',{round:round+1,signedInState:signed,observed:history.length,unique:seen.size,noGrowth});
        if(signed==='signed_out'||noGrowth>=3||seen.size>=limit)break;
        const point=randomScrollPoint(semantic,'page');await this.motor({type:'moveTo',x:point.x,y:point.y,role:'page'});await this.motor({type:'scrollVertical',delta:randomInt(760,1120)});await sleep(650);state=await this.observe(`account_history_scan_${round+1}`);if(!state?.semantic)break;
      }
      if(!seen.size){const context=cached?contextForTarget(cached,this.targetApi):null;this.ledger('account_profile_unavailable',{reason:initialSignedIn==='signed_out'?'account_signed_out_or_history_disabled':'no_visible_history_items',usedCached:Boolean(context)});await this.restoreHomeAfterAccountProfile().catch(()=>{});this.accountProfileActions=this.bodyActions-startedActions;return context;}
      const ids=[...seen.keys()].slice(0,limit),map=await this.api.enrichVideoIds(ids,{required:false}),videos=ids.map(id=>map.get(id)).filter(Boolean),profile=buildAccountProfile({accountId:this.config.accountId,historyVideos:videos,signedInState:state?.semantic?.signedInState||initialSignedIn,source:'youtube_history_visible'});this.accountProfileStore.save(profile);const context=contextForTarget(profile,this.targetApi);this.accountProfileActions=this.bodyActions-startedActions;
      this.ledger('account_profiled',{accountKey:profile.accountKey,historySampleCount:profile.historySampleCount,profileConfidence:profile.confidence,dominantTopics:profile.habits?.dominantTopics||[],preferredFormats:profile.habits?.preferredFormats||[],relationship:context.relationship,plan:context.plan,profileFile:this.accountProfileStore.file,accountProfileActions:this.accountProfileActions});
      await this.restoreHomeAfterAccountProfile();return context;
    }catch(error){const context=cached?contextForTarget(cached,this.targetApi):null;this.accountProfileActions=this.bodyActions-startedActions;this.ledger('account_profile_error',{error:String(error?.message||error),usedCached:Boolean(context),accountProfileActions:this.accountProfileActions});await this.restoreHomeAfterAccountProfile().catch(()=>{});return context;}
  }
  async worldFrom(state,snapshotInfo){const browser=await this.currentBrowser();return buildWorld({observation:state.observation,semantic:state.semantic,snapshot:snapshotInfo.snapshot,browser,tabId:this.tabId,target:{videoId:this.config.target,mediaFormat:this.targetApi?.mediaFormat},history:this.agentHistory});}
  async genericScroll(direction='down'){
    const state=await this.observe(`agent_scroll_${direction}_before`);if(!state.semantic)return {success:false,reason:'semantic_missing'};const beforeY=Number(state.semantic.viewport?.scrollY||0),beforeCount=flattenCandidates(state.semantic).length,point=randomScrollPoint(state.semantic,'page');let delta=randomInt(420,820);if(direction==='up')delta=-delta;delta+=randomInt(-80,80);
    const beforeTabs=await this.browserTabs(),sourceTabId=this.tabId;await this.motor({type:'moveTo',x:point.x,y:point.y,role:'page'});const result=await this.motor({type:'scrollVertical',delta});await this.reconcileTabEffects(beforeTabs,{reason:`agent_scroll_${direction}`,sourceTabId});
    const after=await this.waitForSemantic(s=>Math.abs(Number(s.viewport?.scrollY||0)-beforeY)>=2||flattenCandidates(s).length!==beforeCount,{timeoutMs:this.verifyTimeoutMs,intervalMs:220,reason:'agent_scroll_verify'});const success=Boolean(after?.semantic&&(Math.abs(Number(after.semantic.viewport?.scrollY||0)-beforeY)>=2||flattenCandidates(after.semantic).length!==beforeCount));this.ledger('agent_scroll_outcome',{direction,delta,x:point.x,y:point.y,success});return {success,result};
  }
  async positionCandidate(action){
    const delta=Number(action?.delta);if(!Number.isFinite(delta)||Math.abs(delta)<1)return {success:false,reason:'candidate_position_delta_invalid'};
    const state=await this.observe('candidate_position_before');if(!state.semantic)return {success:false,reason:'semantic_missing'};
    const beforeY=Number(state.semantic.viewport?.scrollY||0),point=randomScrollPoint(state.semantic,'page');
    await this.motor({type:'moveTo',x:point.x,y:point.y,role:'page'});
    const result=await this.motor({type:'scrollVertical',delta});
    this.ledger('candidate_position_dispatched',{videoId:action.target?.videoId||null,delta,variant:action.positionVariant||null,effectContext:action.effectContext||null,beforeScrollY:beforeY,x:point.x,y:point.y});
    return {success:true,result,requestedDelta:delta};
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
  markTargetOpened(meta={}){
    this.targetOpened=true;const now=Date.now();if(this.targetDiscovery)Object.assign(this.targetDiscovery,{opened:true,openedAt:this.targetDiscovery.openedAt||now,strategy:meta.strategy||this.targetDiscovery.strategy||'agent_planner',surface:meta.surface||this.targetDiscovery.surface||'agent_environment',method:meta.method||this.targetDiscovery.method||meta.surface||'agent_environment',rank:meta.rank??this.targetDiscovery.rank??null,fromVideoId:meta.fromVideoId??this.targetDiscovery.fromVideoId??null,fromTopic:meta.fromTopic??this.targetDiscovery.fromTopic??'unknown',title:meta.title||this.targetDiscovery.title||this.targetApi?.title||null});else this.targetDiscovery={at:now,surface:meta.surface||'agent_environment',method:meta.method||meta.surface||'agent_environment',rank:meta.rank??null,fromVideoId:meta.fromVideoId??null,fromTopic:meta.fromTopic??'unknown',strategy:meta.strategy||'agent_planner',opened:true,openedAt:now,title:meta.title||this.targetApi?.title||null};return this.targetDiscovery;
  }
  async executeAgentAction(action,snapshotInfo,world){
    const started=Date.now();let success=false,result=null,query=null,selected=null,dwellSec=0,error=null,queryRepeated=false;
    try{
      if(action.type==='click_candidate'){
        selected=snapshotInfo.snapshot.candidates.find(c=>String(c.videoId)===String(action.target?.videoId))||null;if(!selected)throw new Error('planned_candidate_not_in_snapshot');const clicked=await this.clickCandidate(selected);success=clicked.ok;result=clicked.result||null;if(!success)error=clicked.reason||'candidate_click_failed';if(success){this.visitedVideos.add(selected.videoId);if(String(selected.videoId)===String(this.config.target))this.markTargetOpened({surface:selected.surface,method:selected.surface,rank:selected.position??null,fromVideoId:world.current.videoId||null,fromTopic:world.current.topic,strategy:'agent_planner',title:selected.youtubeApi?.title||selected.title||null});}
      }else if(action.type==='search'){
        query=action.query;queryRepeated=this.usedQueries.has(fold(query));await this.search(action.queryRow);this.usedQueries.add(fold(query));success=true;
      }else if(action.type==='reobserve'){
        await sleep(randomInt(260,720));success=true;
      }else if(action.type==='dwell'){
        dwellSec=this.dwellSeconds();await this.dwellWithAdHandling(world.current.videoId,dwellSec);success=true;
      }else if(action.type==='position_candidate'){
        const out=await this.positionCandidate(action);success=out.success;result=out.result;if(!success)error=out.reason||'candidate_position_failed';
      }else if(action.type==='scroll'){
        const out=await this.genericScroll(action.direction);success=out.success;result=out.result;
      }else if(action.type==='home'){
        const out=await this.goHome();success=out.ok;
      }else if(action.type==='tab_switch'){
        success=await this.switchToTab(action.tabId,{reason:'agent_planner'});
      }else if(action.type==='topic_filter'){
        const out=await this.executeRawBodyStep(action);success=out.success;result=out.result;
      }else if(action.type==='body_step'){
        const out=await this.executeRawBodyStep(action);success=out.success;result=out.result;
      }else throw new Error(`agent_action_unknown:${action.type}`);
    }catch(e){error=String(e?.message||e);success=false;}
    return {success,result,query,queryRepeated,selected,dwellSec,error,durationMs:Date.now()-started};
  }
  rewardAgent({action,outcome,delta,afterInfo,recovery=null}){
    if(recovery){
      let value=0;
      if(recovery.goalReached)value+=160;
      if(recovery.improved)value+=18+Math.min(36,Math.max(0,Number(recovery.scoreDelta||0)))+Math.max(0,Number(recovery.effectDelta||0))*24;
      if(recovery.becameActionable)value+=72;
      if(recovery.regressed)value-=28+Math.max(0,-Number(recovery.effectDelta||0))*24;
      if(!recovery.improved&&!recovery.regressed&&!recovery.goalReached)value-=8;
      if(outcome.error)value-=6;
      return Number(value.toFixed(3));
    }
    let value=this.reward({newVideos:afterInfo.newVideos,newTopics:afterInfo.newTopics,newTransitions:afterInfo.newTransitions,proximityGain:afterInfo.proximityGain,targetSeen:Boolean(afterInfo.targetCandidate),targetOpened:this.targetOpened,success:outcome.success});if(delta.changed)value+=2;if(String(action.selection||'').startsWith('exploration')&&delta.changed)value+=1;if(!delta.changed&&outcome.success)value-=1.5;if(outcome.error)value-=4;return Number(value.toFixed(3));
  }
  async actAgent(state,snapshotInfo){
    const world=await this.worldFrom(state,snapshotInfo);if(world.currentIsTarget&&!this.config.continueAfterFound){this.markTargetOpened({surface:'current_video',method:'current_video',fromTopic:world.current.topic,strategy:'arrival'});return {stop:true,world};}
    const plan=this.agentPlanner.generate(world,{task:this.taskModel,queryPlan:this.queryPlan,dynamicQueries:this.dynamicQueries,usedQueries:this.usedQueries,stagnation:this.stagnation});const action=this.agentPlanner.choose(plan,{stagnation:this.stagnation});if(!action)throw new Error('agent_planner_no_action');this.plannerDecisionCount++;
    this.ledger('agent_plan',{decision:this.plannerDecisionCount,subgoal:plan.subgoal,context:plan.context,targetFormat:plan.targetFormat,currentFormat:world.current.mediaFormat,formatMismatch:world.formatMismatch,accountRelationship:plan.accountRelationship,accountPlanMode:plan.accountPlanMode,selected:{type:action.type,capability:action.capability,purpose:action.purpose,query:action.query||null,targetVideoId:action.target?.videoId||null,targetActionability:action.target?.actionability||null,recoveryTargetVideoId:action.recoveryTargetVideoId||null,targetMediaFormat:action.target?.mediaFormat||null,formatRelation:action.formatRelation||null,tabId:action.tabId??null,delta:action.delta??null,positionVariant:action.positionVariant||null,effectContext:action.effectContext||null,learnedEffectBonus:Number(action.learnedEffectBonus||0),utility:action.utility,selection:action.selection,epsilon:action.epsilon,routeFamily:action.routeFamily||null,routeFrontierAdjustment:Number(action.routeFrontierAdjustment||0),causalEffectBonus:Number(action.causalEffectBonus||0)},alternatives:plan.actions.slice(0,8).map(a=>({type:a.type,capability:a.capability,purpose:a.purpose,query:a.query||null,targetVideoId:a.target?.videoId||null,targetActionability:a.target?.actionability||null,recoveryTargetVideoId:a.recoveryTargetVideoId||null,targetMediaFormat:a.target?.mediaFormat||null,formatRelation:a.formatRelation||null,delta:a.delta??null,positionVariant:a.positionVariant||null,effectContext:a.effectContext||null,learnedEffectBonus:Number(a.learnedEffectBonus||0),utility:a.utility,routeFamily:a.routeFamily||null,routeFrontierAdjustment:Number(a.routeFrontierAdjustment||0),causalEffectBonus:Number(a.causalEffectBonus||0)}))});
    const outcome=await this.executeAgentAction(action,snapshotInfo,world);let afterState=await this.observe('agent_after_action');if(!afterState.semantic)afterState=await this.semanticRecovery();if(!afterState?.semantic)throw new Error('agent_semantic_recovery_failed');const afterInfo=await this.enrichedSnapshot(afterState,`agent_after_${action.type}`);const afterWorld=await this.worldFrom(afterState,afterInfo),delta=worldDelta(world,afterWorld),recommendations=recommendationDelta(world,afterWorld),recovery=action.recoveryTargetVideoId?actionabilityDelta(world,afterWorld,action.recoveryTargetVideoId):null,goalSuccess=afterWorld.currentIsTarget===true;let success=outcome.success&&(delta.changed||(action.type==='preview_candidate'&&outcome.previewConfirmed===true)||action.type==='dwell'||action.capability?.startsWith('motor.moveTo')||action.capability?.startsWith('motor.hover'));if(recovery)success=outcome.success&&(recovery.improved||goalSuccess);
    const targetProgress=Boolean(goalSuccess||(success&&(Number(afterInfo.proximityGain||0)>=0.025||Boolean(afterInfo.targetCandidate&&!snapshotInfo.targetCandidate)||(afterWorld.currentIsTarget&&!world.currentIsTarget)))||(recovery?.improved===true)),reward=this.rewardAgent({action,outcome:{...outcome,success},delta,afterInfo,recovery}),memoryId=actionMemoryId(action),context=contextKey(world),effectId=action.effectId||action.routeFamily||memoryId,effectContext=action.effectContext||null,learnedEffectBefore=Number(action.learnedEffectBonus||0);this.memory.recordStrategy(memoryId,{context,reward,success,newTopics:afterInfo.newTopics,newTransitions:afterInfo.newTransitions,targetSeen:Boolean(afterInfo.targetCandidate)||this.targetOpened});this.memory.recordInteractionEffect?.(effectId,{context,success,recommendationShift:recommendations.recommendationShift,proximityGain:afterInfo.proximityGain,targetSeen:Boolean(afterInfo.targetCandidate)||afterWorld.currentIsTarget,exposureSeconds:Number(outcome.previewPlaybackDeltaSec??((outcome.hoverMs||0)/1000))||0});if(effectContext)this.memory.recordActionEffect?.(memoryId,{context:effectContext,executionSuccess:outcome.success===true,environmentChanged:delta.changed===true,expectedEffectObserved:recovery?.improved===true||goalSuccess,targetProgress,goalSuccess,regressed:recovery?.regressed===true,effectDelta:Number(recovery?.effectDelta||0)});const learnedEffectAfter=effectContext?Number(this.memory.actionEffectScore?.(memoryId,effectContext)||0):0;if(outcome.query)this.memory.recordQuery(outcome.query,{reward,targetSeen:Boolean(afterInfo.targetCandidate)||this.targetOpened,resultCount:afterInfo.snapshot.candidates.length});if(!success)this.memory.addLesson(recovery?'A Brain recovery hypothesis did not improve its expected candidate effect; lower this hypothesis in the same evidence context.':'An autonomous action failed to produce its expected environment change; planner should lower this action in the same context.',{memoryId,context,effectContext,error:outcome.error,delta:delta.reasons,recovery,learnedEffectBefore,learnedEffectAfter});this.memory.save();this.stagnation=targetProgress?0:this.stagnation+1;
    const historyRow={step:this.stepNo,at:Date.now(),targetProgress,memoryId,effectId,durationMs:outcome.durationMs??outcome.hoverMs??null,previewPlaybackDeltaSec:Number(outcome.previewPlaybackDeltaSec||0),queryRepeated:outcome.queryRepeated===true,actionKey:action.actionKey,type:action.type,capability:action.capability,purpose:action.purpose,subgoal:plan.subgoal.id,accountRelationship:plan.accountRelationship,accountPlanMode:plan.accountPlanMode,targetFormat:plan.targetFormat,currentFormatBefore:world.current.mediaFormat,currentFormatAfter:afterWorld.current.mediaFormat,formatMismatchBefore:world.formatMismatch,formatMismatchAfter:afterWorld.formatMismatch,videoId:outcome.selected?.videoId||action.recoveryTargetVideoId||afterWorld.current.videoId||null,topic:outcome.selected?.classification?.primary||afterWorld.current.topic,query:outcome.query,tabId:this.tabId,success,reward,changed:delta.changed,changeReasons:delta.reasons,recoveryTargetVideoId:action.recoveryTargetVideoId||null,actionabilityDelta:recovery,recommendationDelta:recommendations,error:outcome.error||outcome.reason||null,selection:action.selection,deltaRequested:action.delta??null,positionVariant:action.positionVariant||null,effectContext,expectedEffectObserved:Boolean(recovery?.improved||goalSuccess),effectRegressed:Boolean(recovery?.regressed),effectDelta:Number(recovery?.effectDelta||0),learnedEffectBefore,learnedEffectAfter,utility:action.utility,routeFamily:action.routeFamily||null,routeFrontierAdjustment:Number(action.routeFrontierAdjustment||0),causalEffectBonus:Number(action.causalEffectBonus||0)};this.agentHistory.push(historyRow);if(this.agentHistory.length>500)this.agentHistory.splice(0,this.agentHistory.length-500);this.batchPath.push(historyRow);this.ledger('agent_outcome',historyRow);
    if(afterWorld.currentIsTarget)this.markTargetOpened({surface:'agent_environment',method:'agent_environment',fromVideoId:world.current.videoId||null,fromTopic:world.current.topic,strategy:'agent_planner',title:this.targetApi?.title||null});
    return {success,reward,after:afterInfo,world:afterWorld,targetOpened:this.targetOpened,stop:this.targetOpened&&!this.config.continueAfterFound};
  }
  reportObject(status){const report=super.reportObject(status);report.schemaVersion=6;if(report.target)report.target.mediaFormat=this.targetApi?.mediaFormat||{kind:FORMAT.UNKNOWN};report.autonomy={...report.autonomy,mode:'FULL_BODY_AGENT',planner:'world_model_actionability_recovery_v6',fixedStrategyMenu:false,fullBodyCapabilityCatalog:this.capabilityCatalog,taskModel:this.taskModel,languageAwareQueryPlanner:this.queryPlan?.planner||null,targetLanguage:this.queryPlan?.targetLanguage||null,targetFormat:formatKind(this.targetApi?.mediaFormat),targetFormatPolicy:this.taskModel?.formatPolicy||null};report.account=this.accountContext?{accountKey:this.accountContext.accountKey,available:this.accountContext.available,profileRefreshedAt:this.accountContext.profileRefreshedAt,historySampleCount:this.accountContext.historySampleCount,profileConfidence:this.accountContext.profileConfidence,habits:this.accountContext.habits,relationship:this.accountContext.relationship,plan:this.accountContext.plan,profileActions:this.accountProfileActions,experienceMemoryFile:this.memory.file}:null;report.agent={plannerDecisions:this.plannerDecisionCount,history:this.agentHistory.slice(-250),usedQueries:[...this.usedQueries],dynamicQueries:this.dynamicQueries.slice(-50)};return report;}
  async run(){
    this.status='STARTING';this.memory.startRun();this.targetApi=await this.api.profileTarget(this.config.target);this.ledger('target_format_profiled',{videoId:this.targetApi.videoId,mediaFormat:this.targetApi.mediaFormat});this.queryPlan=adaptiveQueryPlan(this.targetApi,{maxQueries:this.config.maxQueries});this.queryPlan.fingerprint=this.buildFingerprint();this.queryAudit.push(...this.queryPlan.audit);
    await this.body.connect();await this.selectBrowser();await this.createTask();if(this.accountProfileStore){this.status='ACCOUNT_PROFILING';this.accountContext=await this.profileAccountContext();}
    this.taskModel=this.agentPlanner.inferTask(this.targetApi,this.queryPlan,this.accountContext);this.ledger('target_profiled',{videoId:this.targetApi.videoId,title:this.targetApi.title,categoryId:this.targetApi.categoryId,topics:this.targetApi.topicLabels,targetLanguage:this.queryPlan.targetLanguage,targetFormat:this.taskModel.targetFormat,targetFormatConfidence:this.taskModel.targetFormatConfidence,targetFormatEvidence:this.taskModel.targetFormatEvidence,formatPolicy:this.taskModel.formatPolicy,accountContext:this.accountContext?{accountKey:this.accountContext.accountKey,historySampleCount:this.accountContext.historySampleCount,relationship:this.accountContext.relationship,plan:this.accountContext.plan}:null,queryPlanner:this.queryPlan.planner,safeQueryCount:this.queryPlan.plan.length,plannedQueries:this.queryPlan.plan.map(row=>({query:row.query,components:row.components,provenance:row.provenance,specificity:row.specificity})),taskModel:{objective:this.taskModel.objective,targetFormat:this.taskModel.targetFormat,formatPolicy:this.taskModel.formatPolicy,accountRelationship:this.taskModel.accountContext?.relationship?.kind||null,accountPlanMode:this.taskModel.accountContext?.plan?.mode||null,constraints:this.taskModel.constraints,successEvidence:this.taskModel.successEvidence},capabilities:this.capabilityCatalog});this.status='RUNNING';
    try{
      while(true){const limit=this.limitReached();if(limit){this.status=String(limit).toUpperCase();break;}this.stepNo++;let state=await this.observe(`agent_step_${this.stepNo}_before`);if(!state.semantic)state=await this.semanticRecovery();if(!state?.semantic){this.stagnation++;await sleep(500);continue;}await this.handleAds({waitForSkippable:true,maxWaitMs:2500});const before=await this.enrichedSnapshot(state,`agent_step_${this.stepNo}_before`);const result=await this.actAgent(state,before);if(result.stop){this.status='TARGET_REACHED';break;}if(result.targetOpened)this.status='TARGET_REACHED';else this.status='RUNNING';this.writeBatch(this.status,false);}
      this.writeBatch(this.status,true);await this.body.finishTask(this.task.taskId,'COMPLETED',{status:this.status,targetVideoId:this.config.target,targetFormat:this.taskModel?.targetFormat||FORMAT.UNKNOWN,targetOpened:this.targetOpened,accountKey:this.accountContext?.accountKey||null,accountRelationship:this.accountContext?.relationship?.kind||null,steps:this.stepNo,planner:'v3'});return this.reportObject(this.status);
    }catch(error){this.status='ERROR';this.ledger('run_error',{error:String(error?.stack||error)});this.writeBatch(this.status,true);if(this.task)await this.body.finishTask(this.task.taskId,'FAILED',String(error?.message||error)).catch(()=>{});throw error;}finally{await this.body.close().catch(()=>{});}
  }
}

module.exports={AutonomousYouTubeBrainV3};
