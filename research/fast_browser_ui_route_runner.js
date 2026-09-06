'use strict';

const {TopicRouteRunner}=require('./topic_route_runner');
const {sameHeadSearch}=require('./head_keyword_next_runner');

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,Math.max(0,Number(ms)||0)));
function norm(value){return String(value||'').normalize('NFKC').toLowerCase().normalize('NFD').replace(/\p{M}+/gu,'').replace(/đ/g,'d').replace(/\s+/g,' ').trim();}
function youtubeTabs(tabs){return (Array.isArray(tabs)?tabs:[]).filter(x=>String(x?.siteKey||'').toLowerCase().includes('youtube.com'));}
function hydrationEvidence(obs){
  const diagnostics=(obs?.surfaces||[]).map(s=>s?.diagnostics||{}),controls=obs?.controls||{},pageType=obs?.route?.pageType||'unknown';
  const routeReady=pageType!=='unknown'&&pageType!=='other';
  const observerUiHydrated=obs?.readiness?.uiHydrated===true;
  const searchControlReady=Boolean(controls?.searchInput?.actionRect)||obs?.readiness?.search===true;
  const surfaceRootReady=diagnostics.some(x=>Boolean(x?.rootSelector))||obs?.readiness?.homeSurface===true;
  const candidateReady=(obs?.surfaces||[]).some(s=>Array.isArray(s?.items)&&s.items.length>0);
  const uiReady=routeReady&&(observerUiHydrated||searchControlReady||surfaceRootReady||candidateReady||String(obs?.signedInState||'unknown')!=='unknown');
  return {pageType,routeReady,observerUiHydrated,searchControlReady,surfaceRootReady,candidateReady,uiReady};
}
function pristineSnapshot(obs,tabs){
  const allTabs=Array.isArray(tabs)?tabs:[],yt=youtubeTabs(allTabs),signedInState=String(obs?.signedInState||'unknown'),readiness=hydrationEvidence(obs),authEvidence=obs?.signInEvidence?{conflict:obs.signInEvidence.conflict===true,signedInSignals:[...(obs.signInEvidence.signedInSignals||[])],signedOutSignals:[...(obs.signInEvidence.signedOutSignals||[])],privacy:obs.signInEvidence.privacy||null}:null;
  return {signedInState,tabCount:allTabs.length,youtubeTabCount:yt.length,shapeOk:allTabs.length<=2&&yt.length===1,readiness,authEvidence};
}
function pristineDecision(snapshot,{stableSignedOutSamples=0,requiredStableSamples=2,requested=true}={}){
  const required=Math.max(1,Number(requiredStableSamples)||2),signed=String(snapshot?.signedInState||'unknown');
  if(requested===false)return {status:'pass',reason:'pristine_not_required',stableSignedOutSamples:0};
  if(snapshot?.shapeOk!==true)return {status:'fail',reason:'tab_shape_invalid',stableSignedOutSamples:0};
  if(signed==='signed_in'||snapshot?.authEvidence?.conflict===true)return {status:'fail',reason:snapshot?.authEvidence?.conflict===true?'conflicting_auth_evidence':'signed_in_detected',stableSignedOutSamples:0};
  const nextStable=signed==='signed_out'&&snapshot?.readiness?.routeReady===true?Number(stableSignedOutSamples||0)+1:0;
  if(nextStable>=required)return {status:'pass',reason:'signed_out_stable',stableSignedOutSamples:nextStable};
  return {status:'pending',reason:signed==='unknown'?'signed_in_state_pending':'signed_out_not_yet_stable',stableSignedOutSamples:nextStable};
}

class FastBrowserUiRouteRunner extends TopicRouteRunner{
  async validatePristine(){
    const requested=this.config.requirePristine!==false;
    const timeoutMs=Math.max(2000,Math.min(30000,Number(this.config.pristineSettleMs)||12000));
    const pollMs=Math.max(100,Math.min(2000,Number(this.config.pristinePollMs)||400));
    const requiredStableSamples=Math.max(1,Math.min(5,Math.floor(Number(this.config.pristineStableSamples)||2)));
    const started=Date.now(),tabs=this.browser?.tabs||[];
    let attempts=0,stableSignedOutSamples=0,lastObs=null,lastSnapshot=null,lastDecision=null;
    while(true){
      attempts++;
      lastObs=await this.observe(`head_next_pristine_preflight_${attempts}`);
      lastSnapshot=pristineSnapshot(lastObs,tabs);
      lastDecision=pristineDecision(lastSnapshot,{stableSignedOutSamples,requiredStableSamples,requested});
      stableSignedOutSamples=lastDecision.stableSignedOutSamples;
      const waitedMs=Date.now()-started;
      if(lastDecision.status==='pass'){
        this.pristineEvidence={requested,pass:true,reason:lastDecision.reason,signedInState:lastSnapshot.signedInState,authEvidence:lastSnapshot.authEvidence,tabCount:lastSnapshot.tabCount,youtubeTabCount:lastSnapshot.youtubeTabCount,pageType:lastSnapshot.readiness.pageType,readiness:lastSnapshot.readiness,attempts,waitedMs,stableSignedOutSamples,requiredStableSignedOutSamples:requiredStableSamples};
        this.log('pristine_browser_check',this.pristineEvidence);
        return lastObs;
      }
      if(lastDecision.status==='fail'){
        this.pristineEvidence={requested,pass:false,reason:lastDecision.reason,signedInState:lastSnapshot.signedInState,authEvidence:lastSnapshot.authEvidence,tabCount:lastSnapshot.tabCount,youtubeTabCount:lastSnapshot.youtubeTabCount,pageType:lastSnapshot.readiness.pageType,readiness:lastSnapshot.readiness,attempts,waitedMs,stableSignedOutSamples,requiredStableSignedOutSamples:requiredStableSamples};
        this.log('pristine_browser_check',this.pristineEvidence);
        throw new Error(`pristine_browser_required:reason=${lastDecision.reason}:signedIn=${lastSnapshot.signedInState}:tabs=${lastSnapshot.tabCount}:youtubeTabs=${lastSnapshot.youtubeTabCount}`);
      }
      this.log('pristine_browser_wait',{reason:lastDecision.reason,attempt:attempts,waitedMs,signedInState:lastSnapshot.signedInState,authEvidence:lastSnapshot.authEvidence,stableSignedOutSamples,requiredStableSignedOutSamples:requiredStableSamples,readiness:lastSnapshot.readiness});
      if(waitedMs>=timeoutMs){
        this.pristineEvidence={requested,pass:false,reason:'signed_in_state_unresolved_after_settle',signedInState:lastSnapshot.signedInState,authEvidence:lastSnapshot.authEvidence,tabCount:lastSnapshot.tabCount,youtubeTabCount:lastSnapshot.youtubeTabCount,pageType:lastSnapshot.readiness.pageType,readiness:lastSnapshot.readiness,attempts,waitedMs,stableSignedOutSamples,requiredStableSignedOutSamples:requiredStableSamples};
        this.log('pristine_browser_check',this.pristineEvidence);
        throw new Error(`pristine_browser_required:reason=signed_in_state_unresolved_after_settle:signedIn=${lastSnapshot.signedInState}:tabs=${lastSnapshot.tabCount}:youtubeTabs=${lastSnapshot.youtubeTabCount}:waitedMs=${waitedMs}:uiReady=${lastSnapshot.readiness.uiReady}`);
      }
      await sleep(pollMs);
    }
  }

  async restoreHeadSearch(query,{reason='restore_head_search'}={}){
    let obs=await this.observe(`${reason}_initial`);
    if(sameHeadSearch(obs,query,this.activeHeadQuery)){
      this.log('search_query_reused',{query,reason:'already_on_same_head_search'});
      return obs;
    }
    if(!this.activeHeadQuery||norm(this.activeHeadQuery)!==norm(query)||obs.route?.pageType==='home')return null;

    const maxBack=Math.max(2,Number(this.config.maxHops||2)+3);
    for(let attempt=1;attempt<=maxBack;attempt++){
      const before={pageType:obs.route?.pageType||null,videoId:String(obs.route?.videoId||'')};
      const started=Date.now();
      const result=await this.browserCommand('back');
      this.log('browser_ui_fast_back',{
        query,
        attempt,
        durationMs:Date.now()-started,
        commandId:result?.commandId||result?.execution?.commandId||null,
        delivered:result?.delivered??result?.execution?.delivered??null,
        verified:result?.verified??result?.execution?.verified??null,
        transport:'BODY_BROWSER_UI',
        cdpGatewayModified:false
      });

      obs=await this.waitFor(o=>{
        const pageType=o.route?.pageType||null;
        const videoId=String(o.route?.videoId||'');
        return pageType==='search'||pageType==='home'||pageType!==before.pageType||videoId!==before.videoId;
      },{timeoutMs:2500,intervalMs:100,reason:`${reason}_browser_ui_back_${attempt}`}).catch(async()=>this.observe(`${reason}_browser_ui_back_timeout_${attempt}`));

      if(obs.route?.pageType==='search'){
        this.log('search_query_reused',{query,reason:'restored_from_history_browser_ui',backAttempts:attempt});
        return obs;
      }
      if(obs.route?.pageType==='home')break;
    }
    this.log('search_history_restore_failed',{query,reason,pageType:obs.route?.pageType||null,transport:'BODY_BROWSER_UI'});
    return null;
  }

  report(outcome,extra={}){
    const base=super.report(outcome,extra);
    return {...base,browserUiMode:{historyRestore:'BODY_BROWSER_UI',staticSettleSleep:false,routePollIntervalMs:100,cdpGatewayModified:false},pristinePreflight:{mode:'stable_signed_out_evidence',settleMs:Math.max(2000,Math.min(30000,Number(this.config.pristineSettleMs)||12000)),pollMs:Math.max(100,Math.min(2000,Number(this.config.pristinePollMs)||400)),requiredStableSamples:Math.max(1,Math.min(5,Math.floor(Number(this.config.pristineStableSamples)||2))),unknownMeansSignedOut:false,conflictingEvidenceFailsClosed:true},guardrails:{...base.guardrails,historyRestoreViaBodyBrowserUi:true,cdpGatewayModified:false}};
  }
}

module.exports={FastBrowserUiRouteRunner,norm,youtubeTabs,hydrationEvidence,pristineSnapshot,pristineDecision};