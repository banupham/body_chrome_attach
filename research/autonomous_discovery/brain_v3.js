'use strict';

const {AutonomousYouTubeBrainV2,randomScrollPoint,fingerprintText,sameFingerprint,nativeTypingFocusEvidence}=require('./brain_v2');
const {flattenCandidates}=require('./brain');
const {classifyVideo,fold,uniq}=require('./topic_classifier');
const {adaptiveQueryPlan,expandFromEnvironment}=require('./adaptive_query_planner');
const {AutonomousAgentPlanner,actionMemoryId}=require('./agent_planner');
const {buildWorld,worldDelta,candidateEffectDelta,recommendationDelta,contextKey,assessRepresentation,nativeOcclusionAtPoint}=require('./world_model');
const {bodyCapabilityCatalog,isSupportedStep}=require('./body_capabilities');
const {FORMAT,formatKind}=require('./media_format');
const {ExperienceMemory}=require('./experience_memory');
const {AccountProfileStore,buildAccountProfile,contextForTarget}=require('./account_profile');

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,Math.max(0,Number(ms)||0)));
const randomInt=(a,b)=>Math.floor(a+Math.random()*(Math.max(a,b)-a+1));

function progressSignals({goalSuccess=false,success=false,proximityGain=0,targetCandidateBefore=false,targetCandidateAfter=false,recovery=null,recoveryTargetVideoId=null,targetVideoId=null}={}){
  const candidateActionabilityProgress=Boolean(success&&recovery?.improved===true);
  const recoveryIsTarget=Boolean(recoveryTargetVideoId!=null&&targetVideoId!=null&&String(recoveryTargetVideoId)===String(targetVideoId));
  const targetRecoveryProgress=Boolean(candidateActionabilityProgress&&recoveryIsTarget);
  const targetCandidateGained=Boolean(success&&targetCandidateAfter&&!targetCandidateBefore);
  const targetProximityImproved=Boolean(success&&Number(proximityGain||0)>=0.025);
  const targetProgress=Boolean(goalSuccess||targetRecoveryProgress||targetCandidateGained||targetProximityImproved);
  return {candidateActionabilityProgress,recoveryIsTarget,targetRecoveryProgress,targetCandidateGained,targetProximityImproved,targetProgress};
}
function candidateEffectValue(recovery){
  if(!recovery)return null;
  return Number((Number(recovery.scoreDelta||0)+Number(recovery.distanceImprovement||0)/40+(recovery.becameInViewport?12:0)+(recovery.becameActionable?36:0)-(recovery.regressed?20:0)).toFixed(3));
}
function affordanceMatchesDescriptor(row={},descriptor={}){
  if(descriptor.index!=null&&Number(row.index)===Number(descriptor.index))return true;
  const labelOk=!descriptor.label||String(row.label||'')===String(descriptor.label||''),roleOk=!descriptor.role||String(row.role||'')===String(descriptor.role||''),tagOk=!descriptor.tag||String(row.tag||'')===String(descriptor.tag||'');
  return labelOk&&roleOk&&tagOk;
}
function findSemanticAffordance(semantic={},descriptor=null,{activeEditableFallback=false}={}){
  const rows=Array.isArray(semantic?.affordances)?semantic.affordances:[];
  if(descriptor){const exact=rows.find(row=>affordanceMatchesDescriptor(row,descriptor));if(exact)return exact;}
  if(activeEditableFallback)return rows.find(row=>row?.active===true&&row?.editable===true)||null;
  return null;
}
function rawAffordanceInteraction(row={}){return assessRepresentation({visible:row.visible,visibleRect:row.visibleRect,hitTested:row.hitTested,hitSamples:row.hitSamples,evidence:row.evidence,actionRect:row.actionRect},0);}
function semanticTextVerification(row={},expectedText=''){const expected=fingerprintText(expectedText),actual=row?.state?.valueFingerprint||null;return {ok:Boolean(row?.active===true&&sameFingerprint(actual,expected)),active:row?.active===true,expected,actual,selection:row?.state?.selection||null};}
function rawBodySemanticEffect(action={},delta={}){const reasons=new Set(delta?.reasons||[]);if(action.capability==='motor.typeText')return action?.verification?.textVerified===true;for(const reason of ['video','page_type','media_format','scroll','tab_count','active_tab','affordance_count','selection','actionability'])if(reasons.has(reason))return true;return false;}

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
    const state=await this.observe(`position_candidate_${action.target?.videoId||'unknown'}_before`);if(!state.semantic)return {success:false,reason:'semantic_missing'};
    const delta=Number(action.delta);if(!Number.isFinite(delta)||Math.abs(delta)<1)return {success:false,reason:'position_delta_invalid'};
    const beforeY=Number(state.semantic.viewport?.scrollY||0),point=randomScrollPoint(state.semantic,'page'),beforeTabs=await this.browserTabs(),sourceTabId=this.tabId;
    await this.motor({type:'moveTo',x:point.x,y:point.y,role:'page'});
    const result=await this.motor({type:'scrollVertical',delta});
    await this.reconcileTabEffects(beforeTabs,{reason:`position_candidate:${action.target?.videoId||'unknown'}`,sourceTabId});
    const after=await this.waitForSemantic(s=>Math.abs(Number(s.viewport?.scrollY||0)-beforeY)>=2,{timeoutMs:this.verifyTimeoutMs,intervalMs:180,reason:'position_candidate_scroll_verify'});
    const executionSuccess=Boolean(after?.semantic&&Math.abs(Number(after.semantic.viewport?.scrollY||0)-beforeY)>=2);
    this.ledger('candidate_position_execution',{videoId:action.target?.videoId||null,delta,variant:action.positionVariant||null,beforeY,afterY:Number(after?.semantic?.viewport?.scrollY??beforeY),executionSuccess});
    return {success:executionSuccess,result,positionDelta:delta,positionVariant:action.positionVariant||null};
  }
  async executeVerifiedTextStep(action){
    const desired=String(action?.step?.intent?.text??'');if(!desired)return {success:false,reason:'text_value_required',verification:{textVerified:false}};
    let state=await this.observe('raw_text_prepare'),semantic=state?.semantic||{},target=findSemanticAffordance(semantic,action.affordance,{activeEditableFallback:!action.affordance});
    if(!target?.editable||!target?.actionRect)return {success:false,reason:'editable_target_not_observed',verification:{textVerified:false}};
    let interaction=rawAffordanceInteraction(target),occlusion=nativeOcclusionAtPoint(interaction.actionPoint,semantic?.viewport||{},state?.browserUi||{});
    if(interaction.actionable!==true||!interaction.actionPoint)return {success:false,reason:'editable_target_not_safely_actionable',verification:{textVerified:false,interaction}};
    if(occlusion.occluded)return {success:false,reason:'editable_target_native_occluded',verification:{textVerified:false,occlusion}};
    if(target.active!==true){
      const r=interaction.visibleRect||interaction.actionRect||target.actionRect,beforeTabs=await this.browserTabs(),sourceTabId=this.tabId;
      await this.motor({type:'click',x:Number(interaction.actionPoint.x),y:Number(interaction.actionPoint.y),width:Math.max(8,Number(r.width||12)),height:Math.max(8,Number(r.height||12)),role:'textbox'});
      await this.reconcileTabEffects(beforeTabs,{reason:'raw_text_focus',sourceTabId});
      const focused=await this.waitForSemantic(s=>{const row=findSemanticAffordance(s,action.affordance,{activeEditableFallback:!action.affordance});return row?.editable===true&&row?.active===true;},{timeoutMs:1800,intervalMs:140,reason:'verify_raw_text_focus'});
      state=focused?.semantic?focused:await this.observe('raw_text_focus_after');semantic=state?.semantic||{};target=findSemanticAffordance(semantic,action.affordance,{activeEditableFallback:!action.affordance});
      if(target?.active!==true)return {success:false,reason:'editable_focus_not_verified',verification:{textVerified:false}};
    }
    const nativeFocus=nativeTypingFocusEvidence(state);if(nativeFocus.known&&nativeFocus.ok===false)return {success:false,reason:nativeFocus.reason,verification:{textVerified:false,nativeFocus}};
    const current=target?.state?.valueFingerprint||null,expected=fingerprintText(desired);
    if(!sameFingerprint(current,expected)&&Number(current?.length||0)>0){
      await this.motor({type:'keyCombo',key:'Control+a'});
      const selected=await this.waitForSemantic(s=>{const row=findSemanticAffordance(s,action.affordance,{activeEditableFallback:!action.affordance});return row?.active===true&&row?.state?.selection?.fullSelection===true;},{timeoutMs:1600,intervalMs:120,reason:'verify_raw_text_selection'});
      if(selected?.semantic){state=selected;semantic=state.semantic;target=findSemanticAffordance(semantic,action.affordance,{activeEditableFallback:!action.affordance});}
      if(target?.state?.selection?.fullSelection!==true)return {success:false,reason:'editable_selection_not_verified',verification:{textVerified:false}};
    }
    if(!sameFingerprint(target?.state?.valueFingerprint,expected)){
      interaction=rawAffordanceInteraction(target);occlusion=nativeOcclusionAtPoint(interaction.actionPoint,semantic?.viewport||{},state?.browserUi||{});
      if(interaction.actionable!==true||!interaction.actionPoint||occlusion.occluded)return {success:false,reason:occlusion.occluded?'editable_target_native_occluded':'editable_target_not_safely_actionable',verification:{textVerified:false,interaction,occlusion}};
      const r=interaction.visibleRect||interaction.actionRect||target.actionRect;
      const result=await this.body.step(this.task.taskId,{kind:'motor',intent:{type:'typeText',x:Number(interaction.actionPoint.x),y:Number(interaction.actionPoint.y),width:Math.max(8,Number(r.width||300)),height:Math.max(8,Number(r.height||40)),role:'textbox',text:desired,preserveFocus:true}},{tabId:Number(this.tabId)});
      const typed=await this.waitForSemantic(s=>{const row=findSemanticAffordance(s,action.affordance,{activeEditableFallback:!action.affordance});return semanticTextVerification(row,desired).ok;},{timeoutMs:Math.min(2200,Number(this.verifyTimeoutMs)||2200),intervalMs:140,reason:'verify_raw_text_value'});
      const finalState=typed?.semantic?typed:await this.observe('raw_text_after'),finalRow=findSemanticAffordance(finalState?.semantic||{},action.affordance,{activeEditableFallback:!action.affordance}),verification=semanticTextVerification(finalRow,desired);
      return {success:verification.ok,reason:verification.ok?null:'editable_value_not_verified',result,verification:{textVerified:verification.ok,...verification,nativeFocus}};
    }
    const verification=semanticTextVerification(target,desired);return {success:verification.ok,reason:verification.ok?null:'editable_value_not_verified',result:null,verification:{textVerified:verification.ok,...verification,nativeFocus}};
  }
  async executeRawBodyStep(action){
    if(action?.capability==='motor.typeText')return this.executeVerifiedTextStep(action);
    const step=JSON.parse(JSON.stringify(action.step||{}));if(!isSupportedStep(step))return {success:false,reason:'unsupported_step'};
    if(step.kind==='browser_ui'&&step.action==='address')step.value='https://www.youtube.com/';
    if(step.kind==='browser_ui'&&step.action==='findtext')step.value=this.queryPlan?.plan?.[0]?.components?.[0]||this.queryPlan?.plan?.[0]?.query||'video';
    if(step.kind==='motor'&&['click','doubleClick','hover','moveTo','drag'].includes(String(step.intent?.type||''))&&action.affordance){
      const state=await this.observe('raw_pointer_prepare'),target=findSemanticAffordance(state?.semantic||{},action.affordance),interaction=rawAffordanceInteraction(target||{}),occlusion=nativeOcclusionAtPoint(interaction.actionPoint,state?.semantic?.viewport||{},state?.browserUi||{});
      if(!target||interaction.actionable!==true||!interaction.actionPoint)return {success:false,reason:'affordance_not_safely_actionable'};
      if(occlusion.occluded)return {success:false,reason:'affordance_native_occluded',verification:{occlusion}};
      const r=interaction.visibleRect||interaction.actionRect||target.actionRect;step.intent.x=Number(interaction.actionPoint.x);step.intent.y=Number(interaction.actionPoint.y);step.intent.width=Math.max(8,Number(r?.width||step.intent.width||12));step.intent.height=Math.max(8,Number(r?.height||step.intent.height||12));
    }
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
        const out=await this.positionCandidate(action);success=out.success;result=out.result;
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
    return {success,result,query,queryRepeated,selected,dwellSec,error,verification:result?.verification||null,durationMs:Date.now()-started};
  }
  rewardAgent({action,outcome,delta,afterInfo,recovery=null,recoveryIsTarget=false,targetProgress=false}){
    if(recovery){
      if(recoveryIsTarget){
        let value=0;if(recovery.improved)value+=18+Math.min(36,Math.max(0,Number(recovery.scoreDelta||0)));if(recovery.becameActionable)value+=72;if(recovery.regressed)value-=18;if(!recovery.improved&&!recovery.regressed)value-=6;if(outcome.error)value-=6;return Number(value.toFixed(3));
      }
      let value=0;if(recovery.improved)value+=2;if(recovery.regressed)value-=4;if(!recovery.improved&&!recovery.regressed)value-=2;if(targetProgress)value+=this.reward({newVideos:0,newTopics:0,newTransitions:0,proximityGain:Number(afterInfo?.proximityGain||0),targetSeen:Boolean(afterInfo?.targetCandidate),targetOpened:this.targetOpened,success:outcome.success});if(outcome.error)value-=4;return Number(value.toFixed(3));
    }
    let value=this.reward({newVideos:afterInfo.newVideos,newTopics:afterInfo.newTopics,newTransitions:afterInfo.newTransitions,proximityGain:afterInfo.proximityGain,targetSeen:Boolean(afterInfo.targetCandidate),targetOpened:this.targetOpened,success:outcome.success});if(delta.changed)value+=2;if(String(action.selection||'').startsWith('exploration')&&delta.changed)value+=1;if(!delta.changed&&outcome.success)value-=1.5;if(outcome.error)value-=4;return Number(value.toFixed(3));
  }
  async actAgent(state,snapshotInfo){
    const world=await this.worldFrom(state,snapshotInfo);if(world.currentIsTarget&&!this.config.continueAfterFound){this.markTargetOpened({surface:'current_video',method:'current_video',fromTopic:world.current.topic,strategy:'arrival'});return {stop:true,world};}
    const plan=this.agentPlanner.generate(world,{task:this.taskModel,queryPlan:this.queryPlan,dynamicQueries:this.dynamicQueries,usedQueries:this.usedQueries,stagnation:this.stagnation});const action=this.agentPlanner.choose(plan,{stagnation:this.stagnation});if(!action)throw new Error('agent_planner_no_action');this.plannerDecisionCount++;
    this.ledger('agent_plan',{decision:this.plannerDecisionCount,subgoal:plan.subgoal,context:plan.context,targetFormat:plan.targetFormat,currentFormat:world.current.mediaFormat,formatMismatch:world.formatMismatch,accountRelationship:plan.accountRelationship,accountPlanMode:plan.accountPlanMode,selected:{type:action.type,capability:action.capability,purpose:action.purpose,query:action.query||null,targetVideoId:action.target?.videoId||null,targetActionability:action.target?.actionability||null,recoveryTargetVideoId:action.recoveryTargetVideoId||null,targetMediaFormat:action.target?.mediaFormat||null,formatRelation:action.formatRelation||null,positionDelta:action.delta??null,positionVariant:action.positionVariant||null,tabId:action.tabId??null,utility:action.utility,selection:action.selection,epsilon:action.epsilon,routeFamily:action.routeFamily||null,routeFrontierAdjustment:Number(action.routeFrontierAdjustment||0),causalEffectBonus:Number(action.causalEffectBonus||0),effectLearningBonus:Number(action.effectLearningBonus||0)},alternatives:plan.actions.slice(0,8).map(a=>({type:a.type,capability:a.capability,purpose:a.purpose,query:a.query||null,targetVideoId:a.target?.videoId||null,targetActionability:a.target?.actionability||null,recoveryTargetVideoId:a.recoveryTargetVideoId||null,targetMediaFormat:a.target?.mediaFormat||null,formatRelation:a.formatRelation||null,positionDelta:a.delta??null,positionVariant:a.positionVariant||null,utility:a.utility,routeFamily:a.routeFamily||null,routeFrontierAdjustment:Number(a.routeFrontierAdjustment||0),causalEffectBonus:Number(a.causalEffectBonus||0),effectLearningBonus:Number(a.effectLearningBonus||0)}))});
    const outcome=await this.executeAgentAction(action,snapshotInfo,world);let afterState=await this.observe('agent_after_action');if(!afterState.semantic)afterState=await this.semanticRecovery();if(!afterState?.semantic)throw new Error('agent_semantic_recovery_failed');const afterInfo=await this.enrichedSnapshot(afterState,`agent_after_${action.type}`);const afterWorld=await this.worldFrom(afterState,afterInfo),delta=worldDelta(world,afterWorld),recommendations=recommendationDelta(world,afterWorld),recovery=action.recoveryTargetVideoId?candidateEffectDelta(world,afterWorld,action.recoveryTargetVideoId):null,goalSuccess=afterWorld.currentIsTarget===true;let success=outcome.success&&(delta.changed||(action.type==='preview_candidate'&&outcome.previewConfirmed===true)||action.type==='dwell'||action.capability?.startsWith('motor.moveTo')||action.capability?.startsWith('motor.hover'));if(action.type==='body_step'&&['motor.click','motor.doubleClick','motor.typeText','motor.keyCombo','motor.pressKey'].includes(String(action.capability||'')))success=outcome.success&&rawBodySemanticEffect({...action,verification:outcome.verification},delta);if(recovery)success=goalSuccess||(outcome.success&&recovery.improved);
    const progress=progressSignals({goalSuccess,success,proximityGain:afterInfo.proximityGain,targetCandidateBefore:Boolean(snapshotInfo.targetCandidate),targetCandidateAfter:Boolean(afterInfo.targetCandidate),recovery,recoveryTargetVideoId:action.recoveryTargetVideoId,targetVideoId:this.config.target}),{candidateActionabilityProgress,recoveryIsTarget,targetRecoveryProgress,targetCandidateGained,targetProximityImproved,targetProgress}=progress,candidateEffect=candidateEffectValue(recovery),reward=this.rewardAgent({action,outcome:{...outcome,success},delta,afterInfo,recovery,recoveryIsTarget,targetProgress}),memoryId=actionMemoryId(action),context=contextKey(world),effectId=action.effectId||action.routeFamily||memoryId,expectedEffectObserved=Boolean(goalSuccess||(recovery?recovery.improved:success&&delta.changed)),effectValue=goalSuccess?80:(candidateEffect??reward);
    this.memory.recordStrategy(memoryId,{context,reward,success,newTopics:afterInfo.newTopics,newTransitions:afterInfo.newTransitions,targetSeen:Boolean(afterInfo.targetCandidate)||this.targetOpened});this.memory.recordInteractionEffect?.(effectId,{context,success,recommendationShift:recommendations.recommendationShift,proximityGain:afterInfo.proximityGain,targetSeen:Boolean(afterInfo.targetCandidate)||afterWorld.currentIsTarget,exposureSeconds:Number(outcome.previewPlaybackDeltaSec??((outcome.hoverMs||0)/1000))||0});const learnedEffect=this.memory.recordActionEffect?.(memoryId,{context,executionSuccess:outcome.success===true,expectedEffectObserved,regressed:recovery?.regressed===true,targetProgress,goalSuccess,effectValue});if(outcome.query)this.memory.recordQuery(outcome.query,{reward,targetSeen:Boolean(afterInfo.targetCandidate)||this.targetOpened,resultCount:afterInfo.snapshot.candidates.length});if(!success)this.memory.addLesson(recovery?'A recovery action did not produce its expected candidate effect; lower this exact action variant in the same evidence context.':'An autonomous action failed to produce its expected environment change; planner should lower this action in the same context.',{memoryId,context,error:outcome.error,delta:delta.reasons,recovery,expectedEffectObserved});this.memory.save();this.stagnation=targetProgress?0:this.stagnation+1;
    const historyRow={step:this.stepNo,at:Date.now(),targetProgress,targetCandidateGained,targetProximityImproved,targetRecoveryProgress,candidateActionabilityProgress,recoveryIsTarget,goalSuccess,expectedEffectObserved,effectValue,candidateEffectValue:candidateEffect,memoryId,effectId,durationMs:outcome.durationMs??outcome.hoverMs??null,previewPlaybackDeltaSec:Number(outcome.previewPlaybackDeltaSec||0),queryRepeated:outcome.queryRepeated===true,actionKey:action.actionKey,type:action.type,capability:action.capability,purpose:action.purpose,subgoal:plan.subgoal.id,accountRelationship:plan.accountRelationship,accountPlanMode:plan.accountPlanMode,targetFormat:plan.targetFormat,currentFormatBefore:world.current.mediaFormat,currentFormatAfter:afterWorld.current.mediaFormat,formatMismatchBefore:world.formatMismatch,formatMismatchAfter:afterWorld.formatMismatch,videoId:outcome.selected?.videoId||action.recoveryTargetVideoId||afterWorld.current.videoId||null,topic:outcome.selected?.classification?.primary||afterWorld.current.topic,query:outcome.query,positionDelta:action.delta??null,positionVariant:action.positionVariant||null,tabId:this.tabId,success,reward,changed:delta.changed,changeReasons:delta.reasons,recoveryTargetVideoId:action.recoveryTargetVideoId||null,candidateEffectDelta:recovery,recommendationDelta:recommendations,error:outcome.error||outcome.reason||null,selection:action.selection,utility:action.utility,effectLearningBonus:Number(action.effectLearningBonus||0),learnedEffectAfter:learnedEffect||null,routeFamily:action.routeFamily||null,routeFrontierAdjustment:Number(action.routeFrontierAdjustment||0),causalEffectBonus:Number(action.causalEffectBonus||0)};this.agentHistory.push(historyRow);if(this.agentHistory.length>500)this.agentHistory.splice(0,this.agentHistory.length-500);this.batchPath.push(historyRow);this.ledger('agent_outcome',historyRow);
    if(afterWorld.currentIsTarget)this.markTargetOpened({surface:'agent_environment',method:'agent_environment',fromVideoId:world.current.videoId||null,fromTopic:world.current.topic,strategy:'agent_planner',title:this.targetApi?.title||null});
    return {success,reward,after:afterInfo,world:afterWorld,targetOpened:this.targetOpened,stop:this.targetOpened&&!this.config.continueAfterFound};
  }
  reportObject(status){const report=super.reportObject(status);report.schemaVersion=7;if(report.target)report.target.mediaFormat=this.targetApi?.mediaFormat||{kind:FORMAT.UNKNOWN};report.autonomy={...report.autonomy,mode:'FULL_BODY_AGENT',planner:'world_model_effect_learning_v7',fixedStrategyMenu:false,fullBodyCapabilityCatalog:this.capabilityCatalog,taskModel:this.taskModel,languageAwareQueryPlanner:this.queryPlan?.planner||null,targetLanguage:this.queryPlan?.targetLanguage||null,targetFormat:formatKind(this.targetApi?.mediaFormat),targetFormatPolicy:this.taskModel?.formatPolicy||null};report.account=this.accountContext?{accountKey:this.accountContext.accountKey,available:this.accountContext.available,profileRefreshedAt:this.accountContext.profileRefreshedAt,historySampleCount:this.accountContext.historySampleCount,profileConfidence:this.accountContext.profileConfidence,habits:this.accountContext.habits,relationship:this.accountContext.relationship,plan:this.accountContext.plan,profileActions:this.accountProfileActions,experienceMemoryFile:this.memory.file}:null;report.agent={plannerDecisions:this.plannerDecisionCount,history:this.agentHistory.slice(-250),usedQueries:[...this.usedQueries],dynamicQueries:this.dynamicQueries.slice(-50)};return report;}
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

module.exports={AutonomousYouTubeBrainV3,progressSignals,candidateEffectValue,affordanceMatchesDescriptor,findSemanticAffordance,rawAffordanceInteraction,semanticTextVerification,rawBodySemanticEffect};
