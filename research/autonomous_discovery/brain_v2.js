'use strict';

const {
  AutonomousYouTubeBrain,
  flattenCandidates,
  routeType,
  currentVideoId,
  contextKey
}=require('./brain');
const {inspectQuery}=require('./query_firewall');

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,Math.max(0,Number(ms)||0)));
const bounded=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
const randomInt=(a,b)=>Math.floor(a+Math.random()*(Math.max(a,b)-a+1));

function fingerprintText(value){
  const text=String(value??'').replace(/\s+/g,' ').trim();
  let hash=2166136261;
  for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}
  return {length:text.length,fnv1a32:(hash>>>0).toString(16).padStart(8,'0')};
}
function sameFingerprint(a,b){return Boolean(a&&b&&Number(a.length)===Number(b.length)&&String(a.fnv1a32||'')===String(b.fnv1a32||''));}
function routeSignature(semantic){
  const route=semantic?.route||{};
  return `${route.pageType||'other'}|${route.videoId||''}|${route.listId||''}|${Number(semantic?.viewport?.scrollY||0)}`;
}
function findCandidate(semantic,candidate){
  const rows=flattenCandidates(semantic);
  return rows.find(x=>String(x.videoId)===String(candidate.videoId)&&String(x.surface)===String(candidate.surface))||rows.find(x=>String(x.videoId)===String(candidate.videoId))||null;
}
function surfaceState(semantic,surface){return (semantic?.surfaces||[]).find(x=>String(x.surface)===String(surface))||null;}
function randomPointInRect(rect,{pad=8}={}){
  if(!rect)return null;
  const x1=Number(rect.x||0)+Math.min(pad,Math.max(0,Number(rect.width||0)/4));
  const y1=Number(rect.y||0)+Math.min(pad,Math.max(0,Number(rect.height||0)/4));
  const x2=Number(rect.x||0)+Math.max(Number(rect.width||0)-pad,pad+1);
  const y2=Number(rect.y||0)+Math.max(Number(rect.height||0)-pad,pad+1);
  return {x:randomInt(Math.round(x1),Math.round(Math.max(x1+1,x2))),y:randomInt(Math.round(y1),Math.round(Math.max(y1+1,y2)))};
}
function randomScrollPoint(semantic,surface){
  const viewport=semantic?.viewport||{},width=Math.max(320,Number(viewport.width||1000)),height=Math.max(240,Number(viewport.height||700));
  const surfaceRect=surfaceState(semantic,surface)?.scrollRect||null;
  if(surfaceRect&&surfaceRect.width>40&&surfaceRect.height>40){
    const p=randomPointInRect(surfaceRect,{pad:18});
    return {x:bounded(p.x,20,width-20),y:bounded(p.y,80,height-20),source:'surface'};
  }
  const x=randomInt(Math.round(width*0.18),Math.round(width*0.82));
  const y=randomInt(Math.round(height*0.34),Math.round(height*0.78));
  return {x:bounded(x,20,width-20),y:bounded(y,90,height-20),source:'viewport_random'};
}

class AutonomousYouTubeBrainV2 extends AutonomousYouTubeBrain{
  constructor(config,deps={}){
    super(config,deps);
    this.stopRequested=false;
    this.actionRetries=Math.max(2,Math.min(6,Number(config.actionRetries||3)));
    this.verifyTimeoutMs=Math.max(1800,Math.min(15000,Number(config.verifyTimeoutMs||5500)));
    this.browserWaitSec=Math.max(5,Math.min(300,Number(config.browserWaitSec||120)));
    this.autonomyMode='open_discovery';
  }
  requestStop(reason='user_stop'){
    if(this.stopRequested)return;
    this.stopRequested=true;this.status='STOPPING';this.ledger('stop_requested',{reason});
  }
  limitReached(){if(this.stopRequested)return 'user_stop';return super.limitReached();}

  async selectBrowser(){
    const deadline=Date.now()+this.browserWaitSec*1000;let lastSummary=[];
    while(Date.now()<deadline){
      const status=await this.body.status();const all=Array.isArray(status.browsers)?status.browsers:[];
      lastSummary=all.map(b=>({browserInstanceId:b.browserInstanceId,online:b.online,state:b.state,eligible:b.environment?.eligible,tabCount:(b.tabs||[]).length}));
      const rows=all.filter(b=>b.online===true&&!['QUARANTINED','ERROR','OFFLINE'].includes(String(b.state||''))&&(b.tabs||[]).length>0);
      let browser=this.config.browser?rows.find(b=>String(b.browserInstanceId)===String(this.config.browser)):null;
      if(!browser)browser=rows.find(b=>(b.tabs||[]).some(t=>String(t.siteKey||'').includes('youtube.com')))||rows.find(b=>String(b.state||'').toUpperCase()==='READY')||rows[0];
      if(browser){
        const tabs=browser.tabs||[];let tab=this.config.tab!=null?tabs.find(t=>Number(t.id)===Number(this.config.tab)):null;
        if(!tab)tab=tabs.find(t=>t.active&&String(t.siteKey||'').includes('youtube.com'))||tabs.find(t=>String(t.siteKey||'').includes('youtube.com'))||tabs.find(t=>t.active)||tabs[0];
        if(tab){this.browser=browser;this.tabId=Number(tab.id);this.ledger('browser_selected',{browserInstanceId:browser.browserInstanceId,tabId:this.tabId,siteKey:tab.siteKey||null,eligible:browser.environment?.eligible??null,selectionPolicy:'online_non_quarantined'});return;}
      }
      this.ledger('browser_waiting',{remainingMs:Math.max(0,deadline-Date.now()),browsers:lastSummary});await sleep(1000);
    }
    throw new Error(`no_ready_body_browser_after_wait:${JSON.stringify(lastSummary)}`);
  }

  async handleAds({waitForSkippable=false,maxWaitMs=9000}={}){
    const deadline=Date.now()+Math.max(0,maxWaitMs);let sawAd=false;
    do{
      const state=await this.observe('ad_probe');const semantic=state.semantic;if(!semantic)return {handled:false,sawAd};
      const ad=semantic.advertising||{};if(!ad.playingAd)return {handled:sawAd,sawAd};
      sawAd=true;this.ledger('ad_detected',{skippable:ad.skippable===true,feedAdCount:Number(ad.feedAdCount||0)});
      const skip=ad.skipButton;
      if(skip?.available&&skip.visible&&skip.actionRect){
        for(let attempt=1;attempt<=this.actionRetries;attempt++){
          const p=randomPointInRect(skip.actionRect,{pad:5});
          await this.motor({type:'click',x:p.x,y:p.y,width:skip.actionRect.width,height:skip.actionRect.height,role:'button'});
          const after=await this.waitForSemantic(s=>!s.advertising?.playingAd||!s.advertising?.skipButton?.visible,{timeoutMs:this.verifyTimeoutMs,intervalMs:300,reason:'verify_ad_skip'});
          const changed=Boolean(after?.semantic&&(!after.semantic.advertising?.playingAd||!after.semantic.advertising?.skipButton?.visible));
          this.ledger('ad_skip_attempt',{attempt,changed});if(changed)return {handled:true,sawAd:true};
        }
        return {handled:false,sawAd:true};
      }
      if(!waitForSkippable)return {handled:false,sawAd:true};
      await sleep(700);
    }while(Date.now()<deadline&&!this.stopRequested);
    return {handled:false,sawAd};
  }

  async verifiedSearchField(query){
    const expected=fingerprintText(query);
    for(let attempt=1;attempt<=this.actionRetries;attempt++){
      let state=await this.ensureYouTube();await this.handleAds();let input=state.semantic?.controls?.searchInput;
      if(!input?.actionRect||input.visible===false){
        await this.browserUi('address','https://www.youtube.com/');
        state=await this.waitForSemantic(s=>Boolean(s.controls?.searchInput?.actionRect),{timeoutMs:12000,reason:'search_input_ready'});input=state?.semantic?.controls?.searchInput;
      }
      if(!input?.actionRect)continue;
      const p=randomPointInRect(input.actionRect,{pad:10});
      await this.motor({type:'click',x:p.x,y:p.y,width:input.actionRect.width,height:input.actionRect.height,role:'textbox'});
      await this.waitForSemantic(s=>s.controls?.searchInput?.active===true,{timeoutMs:1800,intervalMs:180,reason:'search_focus'});
      await this.motor({type:'keyCombo',key:'Control+a'});
      await this.motor({type:'pressKey',key:'Backspace'});
      await this.motor({type:'typeText',x:p.x,y:p.y,width:input.actionRect.width,height:input.actionRect.height,role:'textbox',text:query});
      const typed=await this.waitForSemantic(s=>sameFingerprint(s.controls?.searchInput?.valueFingerprint,expected),{timeoutMs:this.verifyTimeoutMs,intervalMs:220,reason:'verify_search_text'});
      const ok=Boolean(typed?.semantic&&sameFingerprint(typed.semantic.controls?.searchInput?.valueFingerprint,expected));
      this.ledger('search_text_verify',{attempt,ok,expectedFingerprint:expected,observedFingerprint:typed?.semantic?.controls?.searchInput?.valueFingerprint||null});
      if(ok)return typed;
    }
    return null;
  }

  async search(queryRow){
    const inspected=inspectQuery(queryRow.query,{targetVideoId:this.targetApi.videoId,targetTitle:this.targetApi.title});this.queryAudit.push({kind:queryRow.kind,source:queryRow.source,...inspected});if(!inspected.allowed)throw new Error(`query_firewall_blocked:${inspected.reason}`);
    const expected=fingerprintText(inspected.query);
    for(let submitAttempt=1;submitAttempt<=this.actionRetries;submitAttempt++){
      const typed=await this.verifiedSearchField(inspected.query);if(!typed)continue;
      await this.motor({type:'pressKey',key:'Enter'});this.queryAttempts++;this.ledger('search_submitted',{query:inspected.query,kind:queryRow.kind,titleOverlap:inspected.titleOverlap,submitAttempt});
      const result=await this.waitForSemantic(s=>routeType(s)==='search'&&sameFingerprint(s.route?.searchQueryFingerprint,expected)&&flattenCandidates(s).some(x=>x.surface==='search_results'),{timeoutMs:15000,intervalMs:350,reason:'verify_search_results'});
      const ok=Boolean(result?.semantic&&sameFingerprint(result.semantic.route?.searchQueryFingerprint,expected));this.ledger('search_submit_verify',{submitAttempt,ok,routeFingerprint:result?.semantic?.route?.searchQueryFingerprint||null});
      if(ok)return result;
      await this.browserUi('address','https://www.youtube.com/');await sleep(900);
    }
    throw new Error('search_query_not_applied_after_retries');
  }

  async scrollToCandidate(candidate,maxScrolls=10){
    for(let i=0;i<maxScrolls&&!this.stopRequested;i++){
      await this.handleAds();const beforeState=await this.observe(`rebind_${candidate.videoId}_${i}`);const semantic=beforeState.semantic;if(!semantic)return null;
      const match=findCandidate(semantic,candidate);if(match?.visible&&match.actionRect)return match;
      const point=randomScrollPoint(semantic,candidate.surface);const viewport=semantic.viewport||{width:1000,height:700};let delta=match?.actionRect&&Number.isFinite(Number(match.actionRect.centerY))?Number(match.actionRect.centerY)-point.y:randomInt(480,820);
      if(Math.abs(delta)<170)delta=delta>=0?randomInt(300,520):-randomInt(300,520);delta=bounded(delta,-900,900);delta+=randomInt(-90,90);
      const beforeY=Number(viewport.scrollY||0),beforeRectY=Number(match?.actionRect?.centerY||NaN);
      await this.motor({type:'moveTo',x:point.x,y:point.y,role:'page'});await this.motor({type:'scrollVertical',delta});
      const after=await this.waitForSemantic(s=>{
        const rebound=findCandidate(s,candidate),afterY=Number(s.viewport?.scrollY||0),afterRectY=Number(rebound?.actionRect?.centerY||NaN);
        return Boolean(rebound?.visible&&rebound?.actionRect)||Math.abs(afterY-beforeY)>=2||(Number.isFinite(beforeRectY)&&Number.isFinite(afterRectY)&&Math.abs(afterRectY-beforeRectY)>=4);
      },{timeoutMs:2500,intervalMs:200,reason:'verify_scroll'});
      const rebound=findCandidate(after?.semantic,candidate);const changed=Boolean(rebound?.visible&&rebound?.actionRect)||Math.abs(Number(after?.semantic?.viewport?.scrollY||0)-beforeY)>=2||(Number.isFinite(beforeRectY)&&Number.isFinite(Number(rebound?.actionRect?.centerY))&&Math.abs(Number(rebound.actionRect.centerY)-beforeRectY)>=4);
      this.ledger('scroll_verify',{attempt:i+1,videoId:candidate.videoId,surface:candidate.surface,mouseX:point.x,mouseY:point.y,pointSource:point.source,delta,changed});
      if(rebound?.visible&&rebound.actionRect)return rebound;if(!changed)await sleep(180);
    }
    return null;
  }

  async clickCandidate(candidate){
    await this.handleAds({waitForSkippable:true,maxWaitMs:3500});
    for(let attempt=1;attempt<=this.actionRetries;attempt++){
      const state=await this.observe(`candidate_click_prepare_${candidate.videoId}_${attempt}`);let actionable=findCandidate(state.semantic,candidate)||candidate;
      if(!actionable?.visible||!actionable?.actionRect)actionable=await this.scrollToCandidate(candidate);
      if(!actionable?.actionRect){this.ledger('candidate_click_verify',{attempt,videoId:candidate.videoId,ok:false,reason:'unactionable'});continue;}
      const beforeSig=routeSignature(state.semantic),p=randomPointInRect(actionable.actionRect,{pad:8});
      const result=await this.motor({type:'click',x:p.x,y:p.y,width:actionable.actionRect.width,height:actionable.actionRect.height,role:'link'});
      const arrived=await this.waitForSemantic(s=>currentVideoId(s)===String(candidate.videoId)||routeSignature(s)!==beforeSig,{timeoutMs:this.verifyTimeoutMs,intervalMs:280,reason:'verify_candidate_click'});
      const ok=currentVideoId(arrived?.semantic)===String(candidate.videoId);this.ledger('candidate_click_verify',{attempt,videoId:candidate.videoId,ok,dispatched:result?.execution?.dispatched??null,completed:result?.execution?.completed??null});
      if(ok)return {ok:true,result,semantic:arrived.semantic,attempt};
    }
    return {ok:false,reason:'candidate_click_no_state_change'};
  }

  async verifiedBack(){
    for(let attempt=1;attempt<=this.actionRetries;attempt++){
      const before=await this.observe('back_before'),sig=routeSignature(before.semantic);const result=await this.browserUi('back');
      const after=await this.waitForSemantic(s=>routeSignature(s)!==sig,{timeoutMs:this.verifyTimeoutMs,intervalMs:250,reason:'verify_back'});const ok=Boolean(after?.semantic&&routeSignature(after.semantic)!==sig);this.ledger('back_verify',{attempt,ok,completed:result?.execution?.completed??null});if(ok)return {ok:true,state:after};
    }
    return {ok:false};
  }

  async goHome(){
    for(let attempt=1;attempt<=this.actionRetries;attempt++){
      const state=await this.observe('home_prepare');const home=state.semantic?.controls?.homeLink;
      if(home?.visible&&home.actionRect){const p=randomPointInRect(home.actionRect,{pad:5});await this.motor({type:'click',x:p.x,y:p.y,width:home.actionRect.width,height:home.actionRect.height,role:'link'});}else await this.browserUi('address','https://www.youtube.com/');
      const after=await this.waitForSemantic(s=>routeType(s)==='home',{timeoutMs:this.verifyTimeoutMs,intervalMs:300,reason:'verify_home'});const ok=routeType(after?.semantic)==='home';this.ledger('home_verify',{attempt,ok});if(ok)return {ok:true,state:after};
    }
    return {ok:false};
  }

  async dwellWithAdHandling(videoId,seconds){
    const end=Date.now()+Math.max(0,seconds)*1000;while(Date.now()<end&&!this.stopRequested){await this.handleAds({waitForSkippable:true,maxWaitMs:1800});await sleep(Math.min(1200,Math.max(120,end-Date.now())));}this.ledger('dwell_completed',{videoId,seconds,interrupted:this.stopRequested});
  }

  strategyCandidates(snapshot){
    const base=super.strategyCandidates(snapshot),options=[...base.options];
    if(base.rows.length)options.push('explore_any');
    options.push('new_query');
    if(snapshot.pageType!=='home')options.push('home_reset','backtrack');
    const unique=[...new Set(options)];unique.sort((a,b)=>this.memory.ucb(b,base.context)-this.memory.ucb(a,base.context));return {...base,options:unique};
  }

  async act(snapshotInfo){
    let snapshot=snapshotInfo.snapshot;await this.handleAds({waitForSkippable:true,maxWaitMs:2500});
    if(snapshot.currentVideoId===String(this.config.target)){
      this.targetOpened=true;if(!this.targetDiscovery)this.targetDiscovery={at:Date.now(),surface:'current_video',method:'current_video',rank:null,fromVideoId:null,fromTopic:snapshot.currentTopic,strategy:'arrival',opened:true,openedAt:Date.now()};
      if(!this.config.continueAfterFound)return {stop:true,targetOpened:true,targetSeen:true};
      this.visitedVideos.add(snapshot.currentVideoId);this.ledger('continue_after_target',{videoId:snapshot.currentVideoId});
    }
    if(snapshotInfo.targetCandidate&&!this.targetOpened){const opened=await this.maybeOpenTarget(snapshotInfo,'target_priority');return {strategy:'target_priority',success:opened,targetSeen:true,targetOpened:opened,dwellSec:0,action:'click_target'};}

    const decision=this.strategyCandidates(snapshot),context=decision.context;let strategy=null,selected=null,success=false,action=null,dwellSec=0,query=null;
    const options=[...decision.options];
    for(let planAttempt=1;planAttempt<=Math.min(4,Math.max(1,options.length));planAttempt++){
      strategy=options[(planAttempt-1)%options.length];selected=null;query=null;action=strategy;
      if(strategy==='new_query'){
        const q=this.nextQuery();query=q.query;try{await this.search(q);success=true;action='search';}catch(error){success=false;this.ledger('action_retry',{planAttempt,strategy,error:String(error?.message||error)});}
      }else if(strategy==='backtrack'){
        const r=await this.verifiedBack();success=r.ok;action='back';
      }else if(strategy==='home_reset'){
        const r=await this.goHome();success=r.ok;action='home';
      }else{
        selected=this.chooseCandidate(strategy,decision.rows,snapshot);if(!selected){success=false;action='no_candidate';}
        else{const clicked=await this.clickCandidate(selected);success=clicked.ok;if(success){this.visitedVideos.add(selected.videoId);dwellSec=this.dwellSeconds();this.ledger('dwell',{videoId:selected.videoId,seconds:dwellSec,mode:dwellSec<=8?'quick':dwellSec<=30?'medium':'long'});await this.dwellWithAdHandling(selected.videoId,dwellSec);}else this.failedVideos.add(selected.videoId);}
      }
      this.ledger('action_outcome',{planAttempt,strategy,action,success});if(success||this.stopRequested)break;
    }

    const afterState=await this.waitForSemantic(()=>true,{timeoutMs:12000,reason:'after_action'});if(!afterState?.semantic)throw new Error('semantic_observation_lost_after_action');const after=await this.enrichedSnapshot(afterState,`after_${action||'unknown'}`);const targetOpened=this.targetOpened?true:await this.maybeOpenTarget(after,strategy||'replan');
    const reward=this.reward({newVideos:after.newVideos,newTopics:after.newTopics,newTransitions:after.newTransitions,proximityGain:after.proximityGain,targetSeen:Boolean(after.targetCandidate),targetOpened,success});
    this.memory.recordStrategy(strategy||'unknown',{context,reward,success,newTopics:after.newTopics,newTransitions:after.newTransitions,targetSeen:Boolean(after.targetCandidate)||targetOpened});if(query)this.memory.recordQuery(query,{reward,targetSeen:Boolean(after.targetCandidate)||targetOpened,resultCount:after.snapshot.candidates.length});this.memory.save();this.stagnation=reward<=1?this.stagnation+1:0;
    this.batchPath.push({step:this.stepNo,strategy:strategy||'unknown',sourceVideoId:snapshot.currentVideoId,sourceTopic:snapshot.currentTopic,pageType:snapshot.pageType,action,selectedVideoId:selected?.videoId||null,selectedTitle:selected?.youtubeApi?.title||selected?.title||null,selectedTopic:selected?.classification?.primary||null,surface:selected?.surface||null,rank:selected?.position??null,query,dwellSec,reward,success,targetSeen:Boolean(after.targetCandidate),targetOpened,verification:'state_change_required',autonomyMode:this.autonomyMode});
    return {strategy,success,reward,targetSeen:Boolean(after.targetCandidate),targetOpened,after};
  }

  reportObject(status){const report=super.reportObject(status);report.schemaVersion=2;report.autonomy={mode:this.autonomyMode,actionRetries:this.actionRetries,verification:'every navigation/search/scroll must produce observable state change',adHandling:'detect_skip_retry',scrollPolicy:'randomized_safe_points'};return report;}
}

module.exports={AutonomousYouTubeBrainV2,fingerprintText,sameFingerprint,routeSignature,randomScrollPoint,findCandidate};
