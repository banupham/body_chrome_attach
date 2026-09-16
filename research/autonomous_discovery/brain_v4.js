'use strict';

const {AutonomousYouTubeBrainV3}=require('./brain_v3');
const {randomScrollPoint}=require('./brain_v2');
const {flattenCandidates}=require('./brain');
const {buildAccountProfile,contextForTarget,ACCOUNT_STATE}=require('./account_profile');

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,Math.max(0,Number(ms)||0)));
const randomInt=(a,b)=>Math.floor(a+Math.random()*(Math.max(a,b)-a+1));
const coldState=state=>[ACCOUNT_STATE.NEW_ACCOUNT_EMPTY,ACCOUNT_STATE.COLD_START_WEAK].includes(state);

class AutonomousYouTubeBrainV4 extends AutonomousYouTubeBrainV3{
  constructor(config,deps={}){
    super(config,deps);this.autonomyMode='full_body_agent_account_cold_start';this.previewExposureCount=0;this.previewConfirmedCount=0;this.searchImpressionCount=0;this.searchImpressionIds=new Set();
  }
  async baselineHomeSample(){
    const state=await this.restoreHomeAfterAccountProfile().catch(()=>null);if(!state?.semantic)return {state:null,count:0,items:[]};const items=flattenCandidates(state.semantic).filter(x=>x.surface==='home_feed');return {state,count:items.length,items};
  }
  accountUnavailableContext({signedInState='unknown',historyStatus='unavailable',homeSampleCount=0,source='youtube_history_unavailable'}={}){
    const profile=buildAccountProfile({accountId:this.config.accountId,historyVideos:[],signedInState,historyStatus,homeSampleCount,source,rawHistoryObserved:0,excludedBrainGeneratedHistoryCount:0});return contextForTarget(profile,this.targetApi);
  }
  async profileAccountContext(){
    if(!this.accountProfileStore)return null;
    const cached=this.accountProfileStore.load(),startedActions=this.bodyActions,limit=120,generatedIds=this.accountProfileStore.brainGeneratedVideoIds();let preflight=await this.observe('account_profile_preflight');const initialSignedIn=preflight?.semantic?.signedInState||'unknown';
    this.ledger('account_profile_requested',{accountKey:this.accountProfileStore.root?this.accountProfileStore.root.split(/[\\/]/).pop():null,initialSignedInState:initialSignedIn,cached:Boolean(cached),historyLimit:limit,knownBrainGeneratedVideoIds:generatedIds.size});
    if(initialSignedIn==='signed_out'){
      const context=this.accountUnavailableContext({signedInState:'signed_out',historyStatus:'available',source:'logical_account_binding_signed_out'});this.accountProfileActions=this.bodyActions-startedActions;this.ledger('account_profile_unavailable',{reason:'logical_account_id_but_chrome_signed_out',accountState:context.accountState,usedCached:false});return context;
    }
    try{
      await this.body.browserUi(this.task.taskId,'address','https://www.youtube.com/feed/history',{tabId:Number(this.tabId)});
      let state=await this.waitForSemantic(s=>s?.route?.pageType==='feed'&&/^\/feed\/history/i.test(String(s?.route?.path||'')),{timeoutMs:15000,intervalMs:350,reason:'account_history_arrival'});
      if(!state?.semantic){const home=await this.baselineHomeSample(),context=this.accountUnavailableContext({signedInState:initialSignedIn,historyStatus:'unavailable',homeSampleCount:home.count});this.accountProfileActions=this.bodyActions-startedActions;this.ledger('account_profile_unavailable',{reason:'history_page_semantic_unavailable',accountState:context.accountState,homeSampleCount:home.count,usedCached:false});return context;}
      const seen=new Map();let noGrowth=0,lastSize=0,lastSignedIn=state.semantic?.signedInState||initialSignedIn;
      for(let round=0;round<18&&seen.size<limit;round++){
        const semantic=state.semantic,signed=semantic?.signedInState||lastSignedIn;lastSignedIn=signed;const history=flattenCandidates(semantic).filter(x=>x.surface==='history_feed');
        for(const row of history)if(row?.videoId&&!seen.has(String(row.videoId)))seen.set(String(row.videoId),{videoId:String(row.videoId),rank:seen.size+1});
        if(seen.size===lastSize)noGrowth++;else noGrowth=0;lastSize=seen.size;
        this.ledger('account_history_scan',{round:round+1,signedInState:signed,observed:history.length,unique:seen.size,noGrowth});
        if(signed==='signed_out'||noGrowth>=3||seen.size>=limit)break;
        const point=randomScrollPoint(semantic,'page');await this.motor({type:'moveTo',x:point.x,y:point.y,role:'page'});await this.motor({type:'scrollVertical',delta:randomInt(760,1120)});await sleep(650);state=await this.observe(`account_history_scan_${round+1}`);if(!state?.semantic)break;
      }
      if(lastSignedIn==='signed_out'){
        const context=this.accountUnavailableContext({signedInState:'signed_out',historyStatus:'available',source:'logical_account_binding_signed_out'});this.accountProfileActions=this.bodyActions-startedActions;this.ledger('account_profile_unavailable',{reason:'account_became_signed_out_during_history_scan',accountState:context.accountState,usedCached:false});return context;
      }
      const rawIds=[...seen.keys()].slice(0,limit),organicIds=rawIds.filter(id=>!generatedIds.has(String(id))),excluded=rawIds.length-organicIds.length;
      const map=await this.api.enrichVideoIds(organicIds,{required:false}),videos=organicIds.map(id=>map.get(id)).filter(Boolean),home=await this.baselineHomeSample();
      const profile=buildAccountProfile({accountId:this.config.accountId,historyVideos:videos,signedInState:lastSignedIn,historyStatus:'available',homeSampleCount:home.count,source:'youtube_history_visible_pre_task',rawHistoryObserved:rawIds.length,excludedBrainGeneratedHistoryCount:excluded});this.accountProfileStore.save(profile);const context=contextForTarget(profile,this.targetApi);this.accountProfileActions=this.bodyActions-startedActions;
      this.ledger('account_profiled',{accountKey:profile.accountKey,accountState:profile.accountState,historySampleCount:profile.historySampleCount,rawHistoryObserved:profile.baseline?.rawHistoryObserved||0,excludedBrainGeneratedHistoryCount:profile.baseline?.excludedBrainGeneratedHistoryCount||0,homeSampleCount:profile.homeSampleCount,profileConfidence:profile.confidence,dominantTopics:profile.habits?.dominantTopics||[],preferredFormats:profile.habits?.preferredFormats||[],relationship:context.relationship,plan:context.plan,profileFile:this.accountProfileStore.file,activityFile:this.accountProfileStore.activityFile(),accountProfileActions:this.accountProfileActions});return context;
    }catch(error){const home=await this.baselineHomeSample().catch(()=>({count:0})),context=this.accountUnavailableContext({signedInState:initialSignedIn,historyStatus:'unavailable',homeSampleCount:home.count,source:'account_profile_error'});this.accountProfileActions=this.bodyActions-startedActions;this.ledger('account_profile_error',{error:String(error?.message||error),accountState:context.accountState,usedCached:false,accountProfileActions:this.accountProfileActions});return context;}
  }
  recordBrainActivity(event){try{return this.accountProfileStore?.recordActivity(event)||null;}catch(error){this.ledger('brain_activity_record_error',{error:String(error?.message||error),type:event?.type||null});return null;}}
  recordSearchImpressions(afterInfo){
    const rows=(afterInfo?.snapshot?.candidates||[]).filter(row=>row.surface==='search_results'&&row.visible!==false).slice(0,50);let added=0;for(const row of rows){const id=String(row?.videoId||'');if(!id||this.searchImpressionIds.has(id))continue;this.searchImpressionIds.add(id);this.searchImpressionCount++;added++;this.recordBrainActivity({type:'SEARCH_IMPRESSION',videoId:id,surface:'search_results',targetMatch:String(id)===String(this.config.target)});}if(added)this.ledger('search_impressions_recorded',{added,total:this.searchImpressionCount,generatedByBrain:true});return added;
  }
  async previewCandidate(action,snapshotInfo){
    const selected=snapshotInfo.snapshot.candidates.find(c=>String(c.videoId)===String(action.target?.videoId))||null;if(!selected)return {success:false,result:null,query:null,selected:null,dwellSec:0,error:'planned_preview_candidate_not_in_snapshot',previewConfirmed:false};if(String(selected.videoId)===String(this.config.target))return {success:false,result:null,query:null,selected,dwellSec:0,error:'target_cannot_be_used_as_preview_seed',previewConfirmed:false};if(!selected.actionRect)return {success:false,result:null,query:null,selected,dwellSec:0,error:'preview_candidate_has_no_action_rect',previewConfirmed:false};
    const r=selected.actionRect,x=Number(r.centerX??(Number(r.x||0)+Number(r.width||0)/2)),y=Number(r.centerY??(Number(r.y||0)+Number(r.height||0)/2)),started=Date.now();let hoverResult=null,startState=null,progressState=null,error=null,confirmed=false;
    try{
      hoverResult=await this.motor({type:'hover',x,y,width:Number(r.width||12),height:Number(r.height||12),role:'link'});startState=await this.waitForSemantic(s=>Boolean(s?.preview?.active&&s?.preview?.playing&&String(s?.preview?.videoId||'')===String(selected.videoId)),{timeoutMs:4200,intervalMs:180,reason:'preview_start_verify'});if(!startState?.semantic?.preview?.active)throw new Error('hover_preview_did_not_start');const startTime=Number(startState.semantic.preview.currentTime||0),holdMs=randomInt(3200,7600),probeMs=Math.min(1700,Math.max(900,Math.floor(holdMs*0.35)));await sleep(probeMs);progressState=await this.observe('preview_progress_verify');const current=progressState?.semantic?.preview;confirmed=Boolean(current?.active&&current?.playing&&String(current?.videoId||'')===String(selected.videoId)&&Number(current.currentTime||0)>=startTime+0.45);if(!confirmed)throw new Error('hover_preview_playback_not_confirmed');if(holdMs>probeMs)await sleep(holdMs-probeMs);const actualHoverMs=Date.now()-started;this.previewExposureCount++;this.previewConfirmedCount++;const runtime=this.accountContext?.runtime;if(runtime){runtime.previewExposureCount=Number(runtime.previewExposureCount||0)+1;runtime.previewConfirmedCount=Number(runtime.previewConfirmedCount||0)+1;runtime.homeCheckDue=true;runtime.previewedVideoIds=[...new Set([...(runtime.previewedVideoIds||[]),String(selected.videoId)])];}this.recordBrainActivity({type:'PREVIEW_EXPOSURE',videoId:selected.videoId,surface:selected.surface,targetMatch:false,previewConfirmed:true,hoverMs:actualHoverMs});this.ledger('preview_exposure',{videoId:selected.videoId,surface:selected.surface,targetMatch:false,targetProximity:Number(selected.targetProximity||0),topic:selected.classification?.primary||'unknown',previewConfirmed:true,hoverMs:actualHoverMs,startCurrentTime:startTime,observedCurrentTime:Number(current.currentTime||0),generatedByBrain:true});return {success:true,result:hoverResult,query:null,selected,dwellSec:actualHoverMs/1000,error:null,previewConfirmed:true,hoverMs:actualHoverMs};
    }catch(e){error=String(e?.message||e);const actualHoverMs=Date.now()-started;this.ledger('preview_exposure',{videoId:selected.videoId,surface:selected.surface,targetMatch:false,targetProximity:Number(selected.targetProximity||0),topic:selected.classification?.primary||'unknown',previewConfirmed:false,hoverMs:actualHoverMs,error,generatedByBrain:true});return {success:false,result:hoverResult,query:null,selected,dwellSec:actualHoverMs/1000,error,previewConfirmed:false,hoverMs:actualHoverMs};}
  }
  async executeAgentAction(action,snapshotInfo,world){
    if(action.type==='preview_candidate')return this.previewCandidate(action,snapshotInfo,world);
    const out=await super.executeAgentAction(action,snapshotInfo,world);if(action.type==='search'&&out.success&&out.query)this.recordBrainActivity({type:'SEARCH_QUERY',query:out.query,surface:'search_results'});if(action.type==='click_candidate'&&out.success&&out.selected?.videoId)this.recordBrainActivity({type:'OPENED_VIDEO',videoId:out.selected.videoId,surface:out.selected.surface,targetMatch:String(out.selected.videoId)===String(this.config.target)});return out;
  }
  rewardAgent(args){let value=super.rewardAgent(args);if(args?.action?.type==='preview_candidate')value+=args?.outcome?.success?10:-5;return Number(value.toFixed(3));}
  async actAgent(state,snapshotInfo){
    const result=await super.actAgent(state,snapshotInfo),row=this.agentHistory.at(-1),runtime=this.accountContext?.runtime;if(row?.type==='search')this.recordSearchImpressions(result?.after);if(runtime&&coldState(this.accountContext?.accountState)&&row?.type==='home'&&result?.world){const homeRows=(result.world.candidates||[]).filter(c=>c.surface==='home_feed'),relevant=homeRows.filter(c=>Number(c.targetProximity||0)>=0.2),baseline=Number(this.accountContext?.homeSampleCount||0),seeded=homeRows.length>baseline||relevant.length>0;runtime.lastHomeCandidateCount=homeRows.length;runtime.lastHomeRelevantCount=relevant.length;runtime.lastHomeRelevantShare=homeRows.length?Number((relevant.length/homeRows.length).toFixed(3)):0;runtime.homeCheckDue=false;if(seeded)runtime.personalizationSeeded=true;this.ledger('cold_start_home_measurement',{accountState:this.accountContext.accountState,baselineHomeCandidateCount:baseline,currentHomeCandidateCount:homeRows.length,relevantHomeCandidateCount:relevant.length,relevantShare:runtime.lastHomeRelevantShare,previewConfirmedCount:runtime.previewConfirmedCount,personalizationSeeded:runtime.personalizationSeeded});}return result;
  }
  reportObject(status){const report=super.reportObject(status);report.schemaVersion=7;if(report.account){report.account.accountState=this.accountContext?.accountState||null;report.account.homeSampleCount=this.accountContext?.homeSampleCount||0;report.account.baseline=this.accountContext?.baseline||null;report.account.runtime=this.accountContext?.runtime||null;report.account.activityFile=this.accountProfileStore?.activityFile()||null;report.account.brainActivity={searchImpressionCount:this.searchImpressionCount,previewExposureCount:this.previewExposureCount,previewConfirmedCount:this.previewConfirmedCount};}report.autonomy={...report.autonomy,coldStartPreviewBootstrap:true,previewSuccessEvidence:'hover_preview_video_playback_progress',brainGeneratedActivityExcludedFromBaseline:true,activityClasses:['SEARCH_IMPRESSION','PREVIEW_EXPOSURE','OPENED_VIDEO']};return report;}
}

module.exports={AutonomousYouTubeBrainV4};
