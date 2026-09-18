'use strict';

const {AutonomousYouTubeBrainV3}=require('./brain_v3');
const {flattenCandidates,currentVideoId}=require('./brain');
const {fold}=require('./topic_classifier');
const {queryTokens}=require('./query_firewall');
const {noOpStreak}=require('./agent_planner');

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,Math.max(0,Number(ms)||0)));
const randomInt=(a,b)=>Math.floor(a+Math.random()*(Math.max(a,b)-a+1));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
const GENERIC_SIGNAL_TOKENS=new Set(['nha','dat','ban','mua','dep','gia','moi','duong','rong','huong','khu','dan','cu','real','estate','property'].map(fold));

function safeContentRect(rect,viewport={},{topInset=105,bottomInset=24,sideInset=8,minVisibleRatio=0.42}={}){
  if(!rect)return null;
  const width=Math.max(320,Number(viewport.width||1000)),height=Math.max(240,Number(viewport.height||700)),x=Number(rect.x),y=Number(rect.y),w=Number(rect.width),h=Number(rect.height);
  if(![x,y,w,h].every(Number.isFinite)||w<=0||h<=0)return null;
  const x1=Math.max(sideInset,x),y1=Math.max(topInset,y),x2=Math.min(width-sideInset,x+w),y2=Math.min(height-bottomInset,y+h),visibleW=Math.max(0,x2-x1),visibleH=Math.max(0,y2-y1),ratio=(visibleW*visibleH)/(w*h);
  if(visibleW<32||visibleH<34||ratio<minVisibleRatio)return null;
  return {x:x1,y:y1,width:visibleW,height:visibleH,centerX:x1+visibleW/2,centerY:y1+visibleH/2,visibleRatio:Number(ratio.toFixed(3))};
}
function randomPointInRect(rect,{pad=8}={}){
  if(!rect)return null;
  const px=Math.min(Math.max(0,pad),Math.max(0,Number(rect.width||0)/4)),py=Math.min(Math.max(0,pad),Math.max(0,Number(rect.height||0)/4)),x1=Number(rect.x||0)+px,y1=Number(rect.y||0)+py,x2=Number(rect.x||0)+Math.max(px+1,Number(rect.width||0)-px),y2=Number(rect.y||0)+Math.max(py+1,Number(rect.height||0)-py);
  return {x:randomInt(Math.round(x1),Math.round(Math.max(x1+1,x2))),y:randomInt(Math.round(y1),Math.round(Math.max(y1+1,y2)))};
}
function semanticCandidate(semantic,candidate){const rows=flattenCandidates(semantic);return rows.find(x=>String(x.videoId)===String(candidate?.videoId)&&String(x.surface)===String(candidate?.surface))||rows.find(x=>String(x.videoId)===String(candidate?.videoId))||null;}
function normalizedTokenSet(values=[]){const out=new Set();for(const value of values)for(const token of queryTokens(value||''))out.add(fold(token));return out;}
function signalWeight(signal={}){const sources=signal.sources||[];if(sources.some(x=>String(x).includes('title')))return 1;if(sources.some(x=>String(x)==='tag'||String(x).startsWith('derived:tag')))return 0.95;if(sources.some(x=>String(x).includes('channel_keyword')))return 0.58;return 0.7;}
function signalEvidence(candidate,fingerprint={}){
  const api=candidate.youtubeApi||{},textValues=[api.title,candidate.title,...(api.tags||[]),...(api.keywords||[]).slice(0,30).map(x=>x?.term||x),api.channelTitle,api.channel?.title,...(api.channel?.keywords||[]).slice(0,30)],candidateTokens=normalizedTokenSet(textValues),hits=[];
  for(const signal of fingerprint.signals||[]){if(signal?.searchable===false)continue;const tokens=queryTokens(signal.term||'').map(fold).filter(Boolean);if(!tokens.length)continue;const distinctive=tokens.some(t=>/\d/.test(t)||!GENERIC_SIGNAL_TOKENS.has(t));if(!distinctive&&tokens.length<2)continue;let matched=0;for(const token of tokens)if(candidateTokens.has(token))matched++;const coverage=matched/tokens.length;if(coverage<0.6)continue;hits.push(signalWeight(signal)*Math.pow(coverage,1.6)*(1+Math.min(3,tokens.length)*0.12));}
  hits.sort((a,b)=>b-a);return Math.min(1,hits.slice(0,4).reduce((a,b)=>a+b,0)/2.35);
}
function specificPlanningProximity(candidate,fingerprint={}){
  const legacy=Number(candidate.legacyTargetProximity??candidate.targetProximity??0),specific=signalEvidence(candidate,fingerprint),api=candidate.youtubeApi||{};let score=legacy*0.25+specific*0.62;
  const targetCountry=String(fingerprint.country||''),candidateCountry=String(api.channel?.country||'');if(targetCountry&&candidateCountry)score+=targetCountry===candidateCountry?0.05:-0.07;
  const targetLanguage=String(fingerprint.language||''),candidateLanguage=String(api.defaultLanguage||api.defaultAudioLanguage||'');if(targetLanguage&&candidateLanguage)score+=candidateLanguage.split('-')[0].toLowerCase()===targetLanguage.split('-')[0].toLowerCase()?0.03:-0.10;
  if(candidate.classification?.primary&&candidate.classification.primary===fingerprint.primaryTopic)score+=0.03;
  return Number(clamp(score,0,1).toFixed(3));
}
function historyDiagnostics(history=[]){const rows=history||[],actionTypes={},purposes={};let success=0,fail=0,changed=0;for(const row of rows){actionTypes[row.type]=(actionTypes[row.type]||0)+1;purposes[row.purpose]=(purposes[row.purpose]||0)+1;if(row.success)success++;else fail++;if(row.changed)changed++;}return {window:rows.length,success,fail,changed,noOpStreak:noOpStreak(rows),actionTypes,purposes};}

class AutonomousYouTubeBrainV3Recovery extends AutonomousYouTubeBrainV3{
  constructor(config,deps={}){super(config,deps);this.bestSpecificProximity=0;this.candidateDeadline=null;}
  checkCandidateBudget(){
    if(this.candidateDeadline==null)return;
    if(this.stopRequested)throw new Error('candidate_action_stopped');
    if(Date.now()>=this.candidateDeadline)throw new Error('candidate_action_budget_exhausted');
  }
  async observe(reason){this.checkCandidateBudget();const value=await super.observe(reason);this.checkCandidateBudget();return value;}
  async observeTab(tabId){this.checkCandidateBudget();const value=await super.observeTab(tabId);this.checkCandidateBudget();return value;}
  async currentBrowser(){this.checkCandidateBudget();const value=await super.currentBrowser();this.checkCandidateBudget();return value;}
  async bodyStep(step){this.checkCandidateBudget();const value=await super.bodyStep(step);this.checkCandidateBudget();return value;}

  buildFingerprint(){const fp=super.buildFingerprint();return {...fp,signals:(this.queryPlan?.signals||[]).filter(row=>row?.searchable!==false).slice(0,48).map(row=>({term:row.term,score:row.score,sources:row.sources,searchable:row.searchable}))};}
  async enrichedSnapshot(state,reason){
    const info=await super.enrichedSnapshot(state,reason);let currentMax=0;
    for(const candidate of info.snapshot.candidates||[]){candidate.legacyTargetProximity=Number(candidate.targetProximity||0);candidate.targetProximity=specificPlanningProximity(candidate,this.queryPlan?.fingerprint||{});currentMax=Math.max(currentMax,candidate.targetProximity);}
    info.proximityGain=Math.max(0,currentMax-this.bestSpecificProximity);this.bestSpecificProximity=Math.max(this.bestSpecificProximity,currentMax);this.bestProximity=this.bestSpecificProximity;return info;
  }
  async prepareCandidateForSafeClick(candidate){
    this.checkCandidateBudget();
    const state=await this.observe(`safe_click_prepare_${candidate.videoId}`);if(!state.semantic)return null;
    const match=semanticCandidate(state.semantic,candidate);
    if(!match?.actionable||!match?.actionPoint)return {state,match,ready:false,reason:match?.reason||'candidate_not_safely_actionable'};
    return {state,match,ready:true,actionPoint:match.actionPoint,visibleRect:match.visibleRect||null};
  }
  async clickCandidateSafe(candidate){
    // Candidate click gets a cooperative deadline, but recovery is never hidden
    // inside the click. Any blocked candidate returns evidence to the planner.
    const started=Date.now();this.candidateDeadline=started+20000;
    try{
      const prepared=await this.prepareCandidateForSafeClick(candidate);
      if(!prepared?.ready){const reason=prepared?.reason||'candidate_not_safely_actionable';this.ledger('candidate_click_safe_verify',{videoId:candidate.videoId,ok:false,reason,durationMs:Date.now()-started,actionability:prepared?.match?{visible:prepared.match.visible===true,actionable:prepared.match.actionable===true,reason:prepared.match.reason||null,actionPoint:prepared.match.actionPoint||null,evidence:prepared.match.evidence||null}:null});return {ok:false,reason,actionability:prepared?.match||null};}
      // Reuse the canonical click path, which observes again and requires a
      // hit-tested actionPoint. It does not scroll or retry a blocked target.
      const result=await super.clickCandidate(candidate);
      this.ledger('candidate_click_safe_verify',{videoId:candidate.videoId,ok:result.ok===true,reason:result.reason||null,durationMs:Date.now()-started,actionability:result.actionability||null});
      return result;
    }catch(error){const reason=String(error?.message||error);this.ledger('candidate_click_safe_verify',{videoId:candidate.videoId,ok:false,reason,durationMs:Date.now()-started});return {ok:false,reason};}
    finally{this.candidateDeadline=null;}
  }
  async executeAgentAction(action,snapshotInfo,world){
    if(action.type!=='click_candidate')return super.executeAgentAction(action,snapshotInfo,world);
    const started=Date.now();let selected=null,success=false,result=null,error=null;
    try{selected=snapshotInfo.snapshot.candidates.find(c=>String(c.videoId)===String(action.target?.videoId))||null;if(!selected)throw new Error('planned_candidate_not_in_snapshot');const clicked=await this.clickCandidateSafe(selected);success=clicked.ok;result=clicked.result||null;error=success?null:(clicked.reason||'candidate_click_failed');if(success){this.visitedVideos.add(selected.videoId);if(String(selected.videoId)===String(this.config.target)){this.markTargetOpened({surface:selected.surface,method:selected.surface,rank:selected.position??null,fromVideoId:world.current.videoId||null,fromTopic:world.current.topic,strategy:'agent_planner',title:selected.youtubeApi?.title||selected.title||null});}}}catch(e){error=String(e?.message||e);}
    return {success,result,query:null,selected,dwellSec:0,error,durationMs:Date.now()-started};
  }
  rewardAgent(args){
    const {outcome,afterInfo,recovery}=args;
    if(!outcome.success)return outcome.error?-9:-5;
    let value=super.rewardAgent(args);
    const progress=Boolean(recovery?.improved)||Boolean(afterInfo.targetCandidate)||Number(afterInfo.proximityGain||0)>=0.025||outcome.previewConfirmed===true||Boolean(outcome.selected?.videoId&&String(outcome.selected.videoId)===String(this.config.target));
    if(!progress)value=Math.min(1,value);
    if(outcome.queryRepeated)value=Math.min(0,value);
    return Number(value.toFixed(3));
  }

  reportObject(status){const report=super.reportObject(status);report.schemaVersion=6;report.autonomy={...report.autonomy,revision:'evidence_driven_actionability_recovery_v2',safeCandidateClick:'observed_action_point_single_click_v3',candidateBudgetMs:20000,implicitCandidateScrolls:0};report.agent={...(report.agent||{}),diagnostics:historyDiagnostics(this.agentHistory.slice(-250))};return report;}
}

module.exports={AutonomousYouTubeBrainV3Recovery,safeContentRect,signalEvidence,specificPlanningProximity,historyDiagnostics};
