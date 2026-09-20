'use strict';

const {
  AutonomousYouTubeBrain,
  flattenCandidates,
  routeType,
  currentVideoId,
  contextKey
}=require('./brain');
const {inspectQuery}=require('./query_firewall');
const {candidateInteractionState}=require('./world_model');

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
function inputSelectionState(control={}){
  const selection=control?.selection||{},valueLength=Number(control?.valueFingerprint?.length||selection.valueLength||0);
  return {active:control?.active===true,selectionAvailable:selection.available===true,collapsed:selection.collapsed!==false,fullSelection:selection.fullSelection===true,start:Number.isInteger(selection.start)?selection.start:null,end:Number.isInteger(selection.end)?selection.end:null,valueLength,selectedLength:Number(selection.selectedLength||0)||0};
}
function hasFullInputSelection(control={}){const state=inputSelectionState(control);return state.selectionAvailable&&state.fullSelection&&state.valueLength>0;}
function searchControlEvidence(control={}){return {active:control?.active===true,valueFingerprint:control?.valueFingerprint||null,selection:inputSelectionState(control)};}
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
function tabSummary(tab){return {id:Number(tab?.id),active:tab?.active===true,windowId:Number.isInteger(Number(tab?.windowId))?Number(tab.windowId):null,siteKey:String(tab?.siteKey||''),title:String(tab?.title||'').slice(0,180),navigationToken:tab?.navigationToken||null,navigationEpoch:Number(tab?.navigationEpoch||0),status:tab?.status||null,urlScheme:tab?.urlScheme||null};}
function tabIds(tabs){return new Set((tabs||[]).map(t=>Number(t.id)).filter(Number.isInteger));}
function tabOwnershipConflict(error){
  const message=String(error?.message||error||''),m=message.match(/^tab_already_owned:([^:]+):(\d+):(.+)$/);
  return m?{browserInstanceId:m[1],tabId:Number(m[2]),ownerTaskId:m[3],message}:null;
}
function staleDiscoveryOwner(task,conflict){
  if(!task||!conflict)return false;
  const ws=task.workspace||{},tabs=(ws.tabIds||[]).map(Number),capability=String(task.capability||task.goal?.capability||'');
  return task.state==='RECOVERY_REQUIRED'&&capability==='youtube.content_discovery'&&String(ws.browserInstanceId||'')===String(conflict.browserInstanceId)&&tabs.includes(Number(conflict.tabId));
}

class AutonomousYouTubeBrainV2 extends AutonomousYouTubeBrain{
  constructor(config,deps={}){
    super(config,deps);
    this.stopRequested=false;
    this.actionRetries=Math.max(2,Math.min(6,Number(config.actionRetries||3)));
    this.verifyTimeoutMs=Math.max(1800,Math.min(15000,Number(config.verifyTimeoutMs||5500)));
    this.browserWaitSec=Math.max(5,Math.min(300,Number(config.browserWaitSec||120)));
    this.autonomyMode='open_discovery';
    this.workspaceGeneration=0;this.initialTabIds=new Set();this.knownTabs=new Map();this.tabBranches=new Map();this.branchVisitCount=0;
    this.tabRecovery={discovered:0,removed:0,unexpectedSideEffects:0,closedSideEffects:0,youtubeBranches:0,expectedOpenedInNewTab:0,switches:0,recoveryFailures:0,workspaceRotations:0};
  }
  requestStop(reason='user_stop'){
    if(this.stopRequested)return;
    this.stopRequested=true;this.status='STOPPING';this.ledger('stop_requested',{reason});
  }
  limitReached(){if(this.stopRequested)return 'user_stop';return super.limitReached();}

  async currentBrowser(){
    const status=await this.body.status();const browser=(status.browsers||[]).find(b=>String(b.browserInstanceId)===String(this.browser?.browserInstanceId));
    if(!browser)throw new Error('selected_browser_disappeared');this.browser=browser;return browser;
  }
  async browserTabs(){return (await this.currentBrowser()).tabs||[];}
  async observeTab(tabId){
    const observation=await this.body.observe({browserInstanceId:this.browser.browserInstanceId,tabId:Number(tabId)});const semantic=observation?.content?.semantic;
    return {observation,semantic:semantic?.available&&semantic.platform==='youtube'?semantic:null};
  }
  async observe(reason='observe'){
    if(!this.task)return super.observe(reason);
    const observation=await this.body.observe({taskId:this.task.taskId,tabId:Number(this.tabId)});const semantic=observation?.content?.semantic;
    if(!semantic?.available||semantic.platform!=='youtube')return {observation,semantic:null,reason};
    return {observation,semantic,reason};
  }
  async bodyStep(step){
    this.bodyActions++;const result=await this.body.step(this.task.taskId,step,{tabId:Number(this.tabId)});
    this.ledger('body_step',{tabId:Number(this.tabId),kind:step.kind,action:step.kind==='motor'?step.intent?.type:step.action,completed:result?.execution?.completed??null,dispatched:result?.execution?.dispatched??null,error:result?.execution?.error||null});return result;
  }

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
        if(tab){
          this.browser=browser;this.tabId=Number(tab.id);this.initialTabIds=tabIds(tabs);this.knownTabs=new Map(tabs.map(t=>[Number(t.id),tabSummary(t)]));
          this.ledger('browser_selected',{browserInstanceId:browser.browserInstanceId,tabId:this.tabId,siteKey:tab.siteKey||null,eligible:browser.environment?.eligible??null,selectionPolicy:'online_non_quarantined',visibleTabs:tabs.map(tabSummary)});return;
        }
      }
      this.ledger('browser_waiting',{remainingMs:Math.max(0,deadline-Date.now()),browsers:lastSummary});await sleep(1000);
    }
    throw new Error(`no_ready_body_browser_after_wait:${JSON.stringify(lastSummary)}`);
  }

  async startWorkspaceTask(tabList,{reason='initial',preferredTabId=this.tabId}={}){
    const live=await this.browserTabs(),liveIds=tabIds(live),ids=[...new Set((tabList||[]).map(Number).filter(id=>Number.isInteger(id)&&liveIds.has(id)))];
    if(!ids.length)throw new Error('dynamic_workspace_no_live_tabs');let primary=ids.includes(Number(preferredTabId))?Number(preferredTabId):ids[0];
    if(this.task){await this.body.finishTask(this.task.taskId,'COMPLETED',{status:'WORKSPACE_ROTATED',reason,nextTabIds:ids}).catch(()=>{});}
    this.workspaceGeneration++;
    const spec={taskId:`task-${this.runId}-w${this.workspaceGeneration}`,browserInstanceId:this.browser.browserInstanceId,primaryTabId:primary,tabIds:ids,workspaceMode:'DYNAMIC',capability:'youtube.content_discovery',policyClass:'SAFE_AUTO',internalOnly:true,goal:{capability:'youtube.content_discovery',targetVideoId:this.config.target,mode:'autonomous_trial_error',workspaceMode:'dynamic'}};
    let task;
    try{task=await this.body.createTask(spec);}
    catch(error){
      const conflict=tabOwnershipConflict(error);if(!conflict)throw error;
      const owner=await this.body.getTask(conflict.ownerTaskId).catch(()=>null);
      if(!staleDiscoveryOwner(owner,conflict))throw error;
      this.ledger('stale_workspace_owner_recovery',{ownerTaskId:conflict.ownerTaskId,ownerState:owner.state,browserInstanceId:conflict.browserInstanceId,tabId:conflict.tabId,action:'cancel_recovery_required_owner'});
      await this.body.finishTask(conflict.ownerTaskId,'CANCELLED',`superseded_by:${spec.taskId}`);
      task=await this.body.createTask(spec);
    }
    if(task.state!=='READY'&&task.state!=='RUNNING')throw new Error(`autodiscovery_task_not_ready:${task.state}`);this.task=task.state==='RUNNING'?task:await this.body.startTask(task.taskId);this.tabId=primary;this.tabRecovery.workspaceRotations++;
    this.ledger('task_workspace_started',{taskId:this.task.taskId,reason,workspaceMode:'DYNAMIC',primaryTabId:primary,tabIds:ids});return this.task;
  }
  async createTask(){return this.startWorkspaceTask([this.tabId],{reason:'initial_workspace',preferredTabId:this.tabId});}
  async ensureWorkspaceTabs(extraTabIds,{reason='expand_workspace',preferredTabId=this.tabId}={}){
    const owned=new Set((this.task?.workspace?.tabIds||[]).map(Number)),needed=[...new Set((extraTabIds||[]).map(Number).filter(Number.isInteger))];
    if(needed.every(id=>owned.has(id)))return this.task;
    return this.startWorkspaceTask([...owned,...needed],{reason,preferredTabId});
  }
  async switchToTab(tabId,{reason='brain_switch'}={}){
    const id=Number(tabId);await this.ensureWorkspaceTabs([id],{reason:`adopt_for_switch:${reason}`,preferredTabId:this.tabId});
    const result=await this.body.switchTab(this.task.taskId,id);const deadline=Date.now()+this.verifyTimeoutMs;let active=false;
    while(Date.now()<deadline){const browser=await this.currentBrowser();if(Number(browser.activeTabId)===id){active=true;break;}await sleep(120);}
    if(active){this.tabId=id;this.tabRecovery.switches++;}this.ledger('tab_switch_verify',{tabId:id,reason,active,completed:result?.execution?.completed??null});return active;
  }
  async closeTab(tabId,{reason='unexpected_side_effect',fallbackTabId=null}={}){
    const id=Number(tabId);await this.ensureWorkspaceTabs([id],{reason:`adopt_for_close:${reason}`,preferredTabId:this.tabId});
    const result=await this.body.browserUi(this.task.taskId,'closetab',null,{tabId:id});const deadline=Date.now()+this.verifyTimeoutMs;let closed=false;
    while(Date.now()<deadline){const tabs=await this.browserTabs();if(!tabs.some(t=>Number(t.id)===id)){closed=true;break;}await sleep(120);}
    if(closed){this.tabRecovery.closedSideEffects++;this.tabBranches.delete(id);const tabs=await this.browserTabs();this.knownTabs=new Map(tabs.map(t=>[Number(t.id),tabSummary(t)]));if(Number(this.tabId)===id){const fallback=tabs.find(t=>Number(t.id)===Number(fallbackTabId))||tabs.find(t=>t.active&&String(t.siteKey||'').includes('youtube.com'))||tabs.find(t=>String(t.siteKey||'').includes('youtube.com'))||tabs[0];if(fallback)this.tabId=Number(fallback.id);}}
    this.ledger('tab_close_verify',{tabId:id,reason,closed,completed:result?.execution?.completed??null});return closed;
  }
  async inspectTab(tab){
    const state=await this.observeTab(tab.id).catch(()=>({semantic:null,observation:null}));const semantic=state.semantic;
    return {tab:tabSummary(tab),youtube:Boolean(semantic),currentVideoId:semantic?currentVideoId(semantic):null,pageType:semantic?routeType(semantic):'other',semantic};
  }
  async reconcileTabEffects(beforeTabs,{reason='action',expectedVideoId=null,sourceTabId=this.tabId}={}){
    await sleep(220);let afterTabs=await this.browserTabs();const beforeIds=tabIds(beforeTabs),afterIds=tabIds(afterTabs),created=afterTabs.filter(t=>!beforeIds.has(Number(t.id))),removed=(beforeTabs||[]).filter(t=>!afterIds.has(Number(t.id)));
    this.tabRecovery.discovered+=created.length;this.tabRecovery.removed+=removed.length;
    const inspected=[];for(const tab of created)inspected.push(await this.inspectTab(tab));
    this.ledger('tab_topology_change',{reason,sourceTabId:Number(sourceTabId),expectedVideoId:expectedVideoId||null,created:inspected.map(x=>({...x.tab,youtube:x.youtube,currentVideoId:x.currentVideoId,pageType:x.pageType})),removed:removed.map(tabSummary)});

    if(expectedVideoId){
      const candidates=[...inspected];const source=afterTabs.find(t=>Number(t.id)===Number(sourceTabId));if(source&&!candidates.some(x=>Number(x.tab.id)===Number(source.id)))candidates.push(await this.inspectTab(source));
      const match=candidates.find(x=>String(x.currentVideoId||'')===String(expectedVideoId));
      if(match){
        if(Number(match.tab.id)!==Number(sourceTabId)){this.tabRecovery.expectedOpenedInNewTab++;await this.ensureWorkspaceTabs([match.tab.id],{reason:'expected_video_opened_new_tab',preferredTabId:sourceTabId});await this.switchToTab(match.tab.id,{reason:'expected_video_found'});}
        this.knownTabs=new Map((await this.browserTabs()).map(t=>[Number(t.id),tabSummary(t)]));return {expectedFound:true,tabId:Number(match.tab.id),semantic:match.semantic,created:inspected};
      }
    }

    for(const row of inspected){
      if(row.youtube){this.tabBranches.set(Number(row.tab.id),{tabId:Number(row.tab.id),createdAt:Date.now(),reason,currentVideoId:row.currentVideoId,pageType:row.pageType,visited:false});this.tabRecovery.youtubeBranches++;continue;}
      this.tabRecovery.unexpectedSideEffects++;const closed=await this.closeTab(row.tab.id,{reason:`${reason}:goal_mismatch`,fallbackTabId:sourceTabId});if(closed){this.memory.addLesson('A newly opened tab did not match the YouTube discovery goal; BODY recovered by closing the side-effect and returning to the exploration workspace.',{reason,siteKey:row.tab.siteKey||null});this.memory.save();}else this.tabRecovery.recoveryFailures++;
    }

    afterTabs=await this.browserTabs();const sourceAlive=afterTabs.some(t=>Number(t.id)===Number(sourceTabId));if(sourceAlive&&Number((await this.currentBrowser()).activeTabId)!==Number(sourceTabId))await this.switchToTab(sourceTabId,{reason:`restore_source:${reason}`});
    this.knownTabs=new Map((await this.browserTabs()).map(t=>[Number(t.id),tabSummary(t)]));return {expectedFound:false,created:inspected};
  }
  async availableBranch(){
    const tabs=await this.browserTabs(),live=tabIds(tabs);for(const [id,row] of this.tabBranches){if(!live.has(id)){this.tabBranches.delete(id);continue;}if(!row.visited)return row;}return null;
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
          const beforeTabs=await this.browserTabs(),sourceTabId=this.tabId,p=randomPointInRect(skip.actionRect,{pad:5});
          await this.motor({type:'click',x:p.x,y:p.y,width:skip.actionRect.width,height:skip.actionRect.height,role:'button'});await this.reconcileTabEffects(beforeTabs,{reason:'ad_skip_click',sourceTabId});
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
    let state=await this.ensureYouTube();await this.handleAds();let input=state.semantic?.controls?.searchInput;
    if(!input?.actionRect||input.visible===false){await this.browserUi('address','https://www.youtube.com/');state=await this.waitForSemantic(s=>Boolean(s.controls?.searchInput?.actionRect),{timeoutMs:12000,reason:'search_input_ready'});input=state.semantic?.controls?.searchInput;}
    if(!input?.actionRect)return null;
    const p=randomPointInRect(input.actionRect,{pad:10});
    if(!input.active){
      const before=searchControlEvidence(input),beforeTabs=await this.browserTabs(),sourceTabId=this.tabId;
      await this.motor({type:'click',x:p.x,y:p.y,width:input.actionRect.width,height:input.actionRect.height,role:'textbox'});await this.reconcileTabEffects(beforeTabs,{reason:'search_focus_click',sourceTabId});
      const focused=await this.waitForSemantic(s=>s.controls?.searchInput?.active===true,{timeoutMs:1800,intervalMs:140,reason:'search_focus'});
      if(focused?.semantic)state=focused;else state=await this.observe('search_focus_after');input=state.semantic?.controls?.searchInput;
      this.ledger('search_edit_observed',{phase:'focus',before,after:searchControlEvidence(input),changed:before.active!==Boolean(input?.active)});
      if(!input?.active)return null;
    }else this.ledger('search_edit_observed',{phase:'focus_already_present',before:searchControlEvidence(input),after:searchControlEvidence(input),changed:false});
    if(sameFingerprint(input?.valueFingerprint,expected)){this.ledger('search_text_verify',{phase:'already_exact',ok:true,expectedFingerprint:expected,observedFingerprint:input.valueFingerprint,selection:inputSelectionState(input)});return state;}
    if(Number(input?.valueFingerprint?.length||0)>0&&!hasFullInputSelection(input)){
      const before=searchControlEvidence(input);
      await this.motor({type:'keyCombo',key:'Control+a'});
      const selected=await this.waitForSemantic(s=>{const c=s.controls?.searchInput;return Boolean(c?.active&&(sameFingerprint(c?.valueFingerprint,expected)||hasFullInputSelection(c)));},{timeoutMs:1800,intervalMs:140,reason:'verify_search_selection'});
      if(selected?.semantic)state=selected;else state=await this.observe('search_selection_after');input=state.semantic?.controls?.searchInput;
      const selectedOk=hasFullInputSelection(input)||sameFingerprint(input?.valueFingerprint,expected);this.ledger('search_edit_observed',{phase:'select_existing_text',before,after:searchControlEvidence(input),changed:JSON.stringify(before.selection)!==JSON.stringify(inputSelectionState(input)),selectionConfirmed:selectedOk});
      if(sameFingerprint(input?.valueFingerprint,expected))return state;if(!hasFullInputSelection(input))return null;
    }
    const beforeType=searchControlEvidence(input);
    await this.motor({type:'typeText',x:p.x,y:p.y,width:input.actionRect.width,height:input.actionRect.height,role:'textbox',text:query,preserveFocus:true});
    const typed=await this.waitForSemantic(s=>sameFingerprint(s.controls?.searchInput?.valueFingerprint,expected),{timeoutMs:Math.min(1800,Number(this.verifyTimeoutMs)||1800),intervalMs:140,reason:'verify_search_text'});
    if(typed?.semantic)state=typed;else state=await this.observe('search_text_after');input=state.semantic?.controls?.searchInput;
    const ok=Boolean(input&&sameFingerprint(input.valueFingerprint,expected));this.ledger('search_text_verify',{phase:'type_observed',ok,expectedFingerprint:expected,before:beforeType,after:searchControlEvidence(input),selection:inputSelectionState(input)});return ok?state:null;
  }

  async search(queryRow){
    const inspected=inspectQuery(queryRow.query,{targetVideoId:this.targetApi.videoId,targetTitle:this.targetApi.title});this.queryAudit.push({kind:queryRow.kind,source:queryRow.source,...inspected});if(!inspected.allowed)throw new Error(`query_firewall_blocked:${inspected.reason}`);
    const expected=fingerprintText(inspected.query),typed=await this.verifiedSearchField(inspected.query);if(!typed)throw new Error('search_field_not_verified_after_observed_edit');
    const beforeTabs=await this.browserTabs(),sourceTabId=this.tabId,beforeRoute=routeSignature(typed.semantic);await this.motor({type:'pressKey',key:'Enter'});await this.reconcileTabEffects(beforeTabs,{reason:'search_submit',sourceTabId});this.queryAttempts++;this.ledger('search_submitted',{query:inspected.query,kind:queryRow.kind,titleOverlap:inspected.titleOverlap,beforeRoute});
    const result=await this.waitForSemantic(s=>routeType(s)==='search'&&sameFingerprint(s.route?.searchQueryFingerprint,expected)&&flattenCandidates(s).some(x=>x.surface==='search_results'),{timeoutMs:15000,intervalMs:300,reason:'verify_search_results'}),after=result?.semantic?result:await this.observe('search_submit_after'),ok=Boolean(after?.semantic&&routeType(after.semantic)==='search'&&sameFingerprint(after.semantic.route?.searchQueryFingerprint,expected));
    this.ledger('search_submit_verify',{ok,beforeRoute,afterRoute:routeSignature(after?.semantic),routeFingerprint:after?.semantic?.route?.searchQueryFingerprint||null,searchInput:searchControlEvidence(after?.semantic?.controls?.searchInput||{})});if(ok)return after;throw new Error('search_submit_not_verified_after_observed_action');
  }

  async clickCandidate(candidate){
    await this.handleAds({waitForSkippable:true,maxWaitMs:3500});
    const state=await this.observe(`candidate_click_prepare_${candidate.videoId}`),observed=findCandidate(state.semantic,candidate)||null,interaction=candidateInteractionState(observed||{});
    const evidence=observed?{videoId:observed.videoId,surface:observed.surface,representationCount:interaction.representationCount,selectedRepresentation:interaction.index,reason:interaction.reason,actionPoint:interaction.actionPoint,assessments:interaction.assessments}:{videoId:String(candidate.videoId||''),surface:candidate.surface||null,missing:true};
    if(!observed||!interaction.actionable||!interaction.actionPoint){this.ledger('candidate_click_blocked',{videoId:candidate.videoId,surface:candidate.surface,evidence});return {ok:false,reason:'candidate_not_safely_actionable',actionability:evidence};}
    const beforeTabs=await this.browserTabs(),sourceTabId=this.tabId,beforeSig=routeSignature(state.semantic),p=interaction.actionPoint,r=interaction.visibleRect||interaction.actionRect||{width:12,height:12};
    const result=await this.motor({type:'click',x:Number(p.x),y:Number(p.y),width:Math.max(8,Number(r.width||12)),height:Math.max(8,Number(r.height||12)),role:'link'});
    const tabOutcome=await this.reconcileTabEffects(beforeTabs,{reason:'candidate_click',expectedVideoId:candidate.videoId,sourceTabId});
    if(tabOutcome.expectedFound){this.ledger('candidate_click_verify',{attempt:1,videoId:candidate.videoId,ok:true,arrival:'tab_workspace',tabId:tabOutcome.tabId,dispatched:result?.execution?.dispatched??null,completed:result?.execution?.completed??null});return {ok:true,result,semantic:tabOutcome.semantic,attempt:1,tabId:tabOutcome.tabId,actionability:evidence};}
    const arrived=await this.waitForSemantic(s=>currentVideoId(s)===String(candidate.videoId)||routeSignature(s)!==beforeSig,{timeoutMs:this.verifyTimeoutMs,intervalMs:280,reason:'verify_candidate_click'}),ok=currentVideoId(arrived?.semantic)===String(candidate.videoId);
    this.ledger('candidate_click_verify',{attempt:1,videoId:candidate.videoId,ok,arrival:'current_tab',dispatched:result?.execution?.dispatched??null,completed:result?.execution?.completed??null});return ok?{ok:true,result,semantic:arrived.semantic,attempt:1,tabId:this.tabId,actionability:evidence}:{ok:false,reason:'candidate_click_no_expected_state_change',result,actionability:evidence};
  }

  async verifiedBack(){
    for(let attempt=1;attempt<=this.actionRetries;attempt++){
      const before=await this.observe('back_before'),sig=routeSignature(before.semantic),beforeTabs=await this.browserTabs(),sourceTabId=this.tabId;const result=await this.browserUi('back');await this.reconcileTabEffects(beforeTabs,{reason:'back',sourceTabId});
      const after=await this.waitForSemantic(s=>routeSignature(s)!==sig,{timeoutMs:this.verifyTimeoutMs,intervalMs:250,reason:'verify_back'});const ok=Boolean(after?.semantic&&routeSignature(after.semantic)!==sig);this.ledger('back_verify',{attempt,ok,completed:result?.execution?.completed??null});if(ok)return {ok:true,state:after};
    }
    return {ok:false};
  }

  async goHome(){
    for(let attempt=1;attempt<=this.actionRetries;attempt++){
      const state=await this.observe('home_prepare'),home=state.semantic?.controls?.homeLink,beforeTabs=await this.browserTabs(),sourceTabId=this.tabId;
      if(home?.visible&&home.actionRect){const p=randomPointInRect(home.actionRect,{pad:5});await this.motor({type:'click',x:p.x,y:p.y,width:home.actionRect.width,height:home.actionRect.height,role:'link'});}else await this.browserUi('address','https://www.youtube.com/');
      await this.reconcileTabEffects(beforeTabs,{reason:'home_navigation',sourceTabId});const after=await this.waitForSemantic(s=>routeType(s)==='home',{timeoutMs:this.verifyTimeoutMs,intervalMs:300,reason:'verify_home'});const ok=routeType(after?.semantic)==='home';this.ledger('home_verify',{attempt,ok});if(ok)return {ok:true,state:after};
    }
    return {ok:false};
  }

  async dwellWithAdHandling(videoId,seconds){
    const end=Date.now()+Math.max(0,seconds)*1000;while(Date.now()<end&&!this.stopRequested){await this.handleAds({waitForSkippable:true,maxWaitMs:1800});await sleep(Math.min(1200,Math.max(120,end-Date.now())));}this.ledger('dwell_completed',{videoId,seconds,interrupted:this.stopRequested});
  }

  strategyCandidates(snapshot){
    const base=super.strategyCandidates(snapshot),options=[...base.options];if(base.rows.length)options.push('explore_any');if([...this.tabBranches.values()].some(x=>!x.visited))options.push('tab_branch');options.push('new_query');if(snapshot.pageType!=='home')options.push('home_reset','backtrack');
    const unique=[...new Set(options)];unique.sort((a,b)=>this.memory.ucb(b,base.context)-this.memory.ucb(a,base.context));return {...base,options:unique};
  }

  async act(snapshotInfo){
    let snapshot=snapshotInfo.snapshot;await this.handleAds({waitForSkippable:true,maxWaitMs:2500});
    if(snapshot.currentVideoId===String(this.config.target)){this.targetOpened=true;if(!this.targetDiscovery)this.targetDiscovery={at:Date.now(),surface:'current_video',method:'current_video',rank:null,fromVideoId:null,fromTopic:snapshot.currentTopic,strategy:'arrival',opened:true,openedAt:Date.now()};if(!this.config.continueAfterFound)return {stop:true,targetOpened:true,targetSeen:true};this.visitedVideos.add(snapshot.currentVideoId);this.ledger('continue_after_target',{videoId:snapshot.currentVideoId});}
    if(snapshotInfo.targetCandidate&&!this.targetOpened){const opened=await this.maybeOpenTarget(snapshotInfo,'target_priority');return {strategy:'target_priority',success:opened,targetSeen:true,targetOpened:opened,dwellSec:0,action:'click_target'};}

    const decision=this.strategyCandidates(snapshot),context=decision.context;let strategy=null,selected=null,success=false,action=null,dwellSec=0,query=null;const options=[...decision.options];
    for(let planAttempt=1;planAttempt<=Math.min(5,Math.max(1,options.length));planAttempt++){
      strategy=options[(planAttempt-1)%options.length];selected=null;query=null;action=strategy;
      if(strategy==='new_query'){
        const q=this.nextQuery();query=q.query;try{await this.search(q);success=true;action='search';}catch(error){success=false;this.ledger('action_retry',{planAttempt,strategy,error:String(error?.message||error)});}
      }else if(strategy==='backtrack'){
        const r=await this.verifiedBack();success=r.ok;action='back';
      }else if(strategy==='home_reset'){
        const r=await this.goHome();success=r.ok;action='home';
      }else if(strategy==='tab_branch'){
        const branch=await this.availableBranch();if(!branch){success=false;action='branch_missing';}
        else{success=await this.switchToTab(branch.tabId,{reason:'explore_discovered_branch'});branch.visited=success;if(success){this.branchVisitCount++;action='switch_branch';}}
      }else{
        selected=this.chooseCandidate(strategy,decision.rows,snapshot);if(!selected){success=false;action='no_candidate';}
        else{const clicked=await this.clickCandidate(selected);success=clicked.ok;if(success){this.visitedVideos.add(selected.videoId);dwellSec=this.dwellSeconds();this.ledger('dwell',{videoId:selected.videoId,seconds:dwellSec,mode:dwellSec<=8?'quick':dwellSec<=30?'medium':'long',tabId:this.tabId});await this.dwellWithAdHandling(selected.videoId,dwellSec);}else this.failedVideos.add(selected.videoId);}
      }
      this.ledger('action_outcome',{planAttempt,strategy,action,success,tabId:this.tabId});if(success||this.stopRequested)break;
    }

    const afterState=await this.waitForSemantic(()=>true,{timeoutMs:12000,reason:'after_action'});if(!afterState?.semantic)throw new Error('semantic_observation_lost_after_action');const after=await this.enrichedSnapshot(afterState,`after_${action||'unknown'}`);const targetOpened=this.targetOpened?true:await this.maybeOpenTarget(after,strategy||'replan');
    const reward=this.reward({newVideos:after.newVideos,newTopics:after.newTopics,newTransitions:after.newTransitions,proximityGain:after.proximityGain,targetSeen:Boolean(after.targetCandidate),targetOpened,success});
    this.memory.recordStrategy(strategy||'unknown',{context,reward,success,newTopics:after.newTopics,newTransitions:after.newTransitions,targetSeen:Boolean(after.targetCandidate)||targetOpened});if(query)this.memory.recordQuery(query,{reward,targetSeen:Boolean(after.targetCandidate)||targetOpened,resultCount:after.snapshot.candidates.length});this.memory.save();this.stagnation=reward<=1?this.stagnation+1:0;
    this.batchPath.push({step:this.stepNo,strategy:strategy||'unknown',sourceVideoId:snapshot.currentVideoId,sourceTopic:snapshot.currentTopic,pageType:snapshot.pageType,action,selectedVideoId:selected?.videoId||null,selectedTitle:selected?.youtubeApi?.title||selected?.title||null,selectedTopic:selected?.classification?.primary||null,surface:selected?.surface||null,rank:selected?.position??null,query,dwellSec,reward,success,targetSeen:Boolean(after.targetCandidate),targetOpened,verification:'state_change_and_tab_topology_required',autonomyMode:this.autonomyMode,activeTabId:this.tabId});
    return {strategy,success,reward,targetSeen:Boolean(after.targetCandidate),targetOpened,after};
  }

  reportObject(status){
    const report=super.reportObject(status);report.schemaVersion=3;report.autonomy={mode:this.autonomyMode,actionRetries:this.actionRetries,verification:'every navigation/search/scroll/click must produce observable state change; new tabs are inspected as outcomes',adHandling:'detect_skip_retry',scrollPolicy:'randomized_safe_points',tabPolicy:'dynamic_workspace_goal_based_recovery'};
    report.tabWorkspace={activeTabId:this.tabId,initialTabIds:[...this.initialTabIds],knownTabs:[...this.knownTabs.values()],branches:[...this.tabBranches.values()],branchVisits:this.branchVisitCount,recovery:{...this.tabRecovery},taskGeneration:this.workspaceGeneration};return report;
  }
}

module.exports={AutonomousYouTubeBrainV2,fingerprintText,sameFingerprint,inputSelectionState,hasFullInputSelection,searchControlEvidence,routeSignature,randomScrollPoint,findCandidate,tabSummary,tabIds,tabOwnershipConflict,staleDiscoveryOwner};
