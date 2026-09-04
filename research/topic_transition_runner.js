'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { WebSocket } = require('ws');
const { chooseCandidate, choosePortfolioAction, scoreTopic, bestScores } = require('./topic_transition_policy');

const DEFAULT_URL = 'ws://127.0.0.1:8765';
const PROTOCOL_VERSION = 7;
const DEFAULT_TOKEN_PATH = path.join(__dirname, '..', 'daemon', 'profiles', '.auth', 'brain.token');

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0))); }
function nowIso() { return new Date().toISOString(); }
function id(prefix='exp') { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`; }
function clamp(v,a,b) { return Math.max(a, Math.min(b, v)); }
function asBool(v, fallback=false) { if (v == null) return fallback; return !['0','false','no','off'].includes(String(v).toLowerCase()); }

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    query:'nhạc', target:'gaming', policy:'portfolio', dwellSec:30, maxSteps:18, maxRuntimeSec:1200,
    targetThreshold:0.6, seedRank:1, browser:null, tab:null, homeEscapeAfter:2, longTailAfter:4,
    backtrackLimit:3, maxScrolls:8, candidateRetryLimit:5, output:null, url:DEFAULT_URL, tokenPath:DEFAULT_TOKEN_PATH, stopOnTarget:true
  };
  for (let i=0;i<argv.length;i++) {
    const raw=argv[i]; if (!raw.startsWith('--')) continue;
    const [k0,v0] = raw.slice(2).split('=',2); const k=k0.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
    let v=v0; if (v == null && argv[i+1] && !argv[i+1].startsWith('--')) v=argv[++i];
    if (['dwellSec','maxSteps','maxRuntimeSec','seedRank','homeEscapeAfter','longTailAfter','backtrackLimit','maxScrolls','candidateRetryLimit','targetThreshold'].includes(k)) out[k]=Number(v);
    else if (k==='tab') out.tab=Number(v);
    else if (k==='stopOnTarget') out.stopOnTarget=asBool(v,true);
    else if (k in out) out[k]=v;
  }
  if (!['natural_top1','directed_bridge','radio_avoidance','semantic_escape','long_tail_related','mix_next','portfolio'].includes(out.policy)) throw new Error(`unsupported_policy:${out.policy}`);
  return out;
}

function loadToken(file) {
  const env=String(process.env.BODY_BRAIN_TOKEN || '').trim(); if (env) return env;
  const text=fs.readFileSync(file,'utf8').trim(); if (!text) throw new Error(`brain_token_empty:${file}`); return text;
}

class BrainClient {
  constructor({url=DEFAULT_URL,tokenPath=DEFAULT_TOKEN_PATH,controllerId='topic-transition-lab',timeoutMs=70000,WebSocketImpl=WebSocket}={}) {
    this.url=url; this.tokenPath=tokenPath; this.controllerId=controllerId; this.timeoutMs=timeoutMs; this.WebSocketImpl=WebSocketImpl;
    this.ws=null; this.pending=new Map(); this.seq=0; this.closing=false;
  }
  openState(){return Number(this.WebSocketImpl.OPEN ?? WebSocket.OPEN ?? 1);}
  _rejectPending(requestId,error){const p=this.pending.get(String(requestId));if(!p)return false;clearTimeout(p.timer);this.pending.delete(String(requestId));p.reject(error instanceof Error?error:new Error(String(error)));return true;}
  _rejectAll(error){for(const requestId of [...this.pending.keys()])this._rejectPending(requestId,error);}
  async connect() {
    if (this.ws?.readyState===this.openState()) return;
    this.closing=false;
    const token=loadToken(this.tokenPath);
    await new Promise((resolve,reject)=>{
      const ws=this.ws=new this.WebSocketImpl(this.url); let settled=false;
      const failConnect=error=>{if(settled)return;settled=true;clearTimeout(timer);reject(error instanceof Error?error:new Error(String(error)));};
      const timer=setTimeout(()=>failConnect(new Error('brain_connect_timeout')),8000);
      ws.once('open',()=>{try{ws.send(JSON.stringify({type:'HELLO',role:'brain',protocolVersion:PROTOCOL_VERSION,token,controllerId:this.controllerId}));}catch(error){failConnect(error);}});
      ws.once('error',e=>failConnect(e));
      ws.on('message',raw=>{ let msg; try{msg=JSON.parse(String(raw));}catch{return;}
        if(msg.type==='HELLO_ACK'&&msg.authenticated===true&&!settled){settled=true;clearTimeout(timer);resolve();return;}
        if(msg.type==='AUTH_ERROR'&&!settled){failConnect(new Error(`brain_auth_failed:${msg.error||'unknown'}`));return;}
        this._onMessage(msg);
      });
      ws.on('close',()=>{
        const intentional=this.closing||this.ws!==ws;
        if(this.ws===ws)this.ws=null;
        const error=new Error(intentional?'brain_client_closed':'brain_disconnected');
        if(!settled)failConnect(error);
        this._rejectAll(error);
      });
    });
  }
  _onMessage(msg){const rid=String(msg?.requestId||'');if(!rid||!this.pending.has(rid))return;const p=this.pending.get(rid);clearTimeout(p.timer);this.pending.delete(rid);if(msg.ok===false||msg.type==='BRAIN_ERROR')p.reject(new Error(String(msg.error?.message||msg.error||'brain_request_failed')));else p.resolve(msg.result??msg);}
  async request(type,payload={}){
    await this.connect();
    const ws=this.ws;if(!ws||ws.readyState!==this.openState())throw new Error('brain_not_connected');
    const requestId=`research-${Date.now()}-${++this.seq}`;
    const result=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(requestId);reject(new Error(`brain_request_timeout:${type}`));},this.timeoutMs);this.pending.set(requestId,{resolve,reject,timer});});
    const frame=JSON.stringify({type,requestId,...payload});
    try{ws.send(frame,error=>{if(error)this._rejectPending(requestId,error);});}
    catch(error){const p=this.pending.get(requestId);if(p)clearTimeout(p.timer);this.pending.delete(requestId);throw error;}
    return result;
  }
  async close(){
    const ws=this.ws;this.closing=true;
    if(!ws){this._rejectAll(new Error('brain_client_closed'));this.closing=false;return;}
    if(this.ws===ws)this.ws=null;
    this._rejectAll(new Error('brain_client_closed'));
    await new Promise(resolve=>{
      if(Number(ws.readyState)===Number(this.WebSocketImpl.CLOSED ?? WebSocket.CLOSED ?? 3)){resolve();return;}
      ws.once('close',resolve);try{ws.close();}catch{}setTimeout(resolve,250);
    });
    this.closing=false;
  }
}

function surfaceItems(obs) { return (obs?.surfaces || []).flatMap(s => (s.items || []).map(x => ({...x, surface:x.surface||s.surface}))); }
function surfaceDescriptor(obs,surface) { return (obs?.surfaces||[]).find(s=>String(s.surface)===String(surface)) || null; }
function surfaceDiagnostics(obs){return (obs?.surfaces||[]).map(s=>({surface:s.surface,scrollRectAvailable:Boolean(s.scrollRect),...(s.diagnostics||{})}));}
function findCandidate(obs, candidate) {
  const videoId=typeof candidate==='object'?candidate?.videoId:candidate;
  const surface=typeof candidate==='object'?candidate?.surface:null;
  const matches=surfaceItems(obs).filter(x=>String(x.videoId)===String(videoId));
  return matches.find(x=>surface&&x.surface===surface&&x.visible&&x.actionRect) ||
    matches.find(x=>surface&&x.surface===surface&&x.actionRect) ||
    matches.find(x=>surface&&x.surface===surface) ||
    matches.find(x=>x.visible&&x.actionRect) ||
    matches.find(x=>x.actionRect) || matches[0] || null;
}
function surfaceScrollPoint(obs,surface) {
  const vw=Math.max(4,Number(obs?.viewport?.width||1000)),vh=Math.max(4,Number(obs?.viewport?.height||800));
  const r=surfaceDescriptor(obs,surface)?.scrollRect;
  if(r&&Number.isFinite(Number(r.centerX))&&Number.isFinite(Number(r.centerY)))return {x:clamp(Number(r.centerX),2,vw-2),y:clamp(Number(r.centerY),2,vh-2),scoped:true};
  return {x:clamp(vw*0.5,2,vw-2),y:clamp(vh*0.55,2,vh-2),scoped:false};
}
function rectIntent(type, descriptor, extra={}) { const r=descriptor?.actionRect; if(!r) throw new Error(`action_rect_required:${type}`); return {type,x:r.centerX,y:r.centerY,width:r.width,height:r.height,...extra}; }

class TopicTransitionRunner {
  constructor(config, client = new BrainClient({url:config.url,tokenPath:config.tokenPath})) {
    this.config=config; this.client=client; this.experimentId=id('topic'); this.taskId=`task-${this.experimentId}`;
    this.browser=null; this.tabId=null; this.startedAt=Date.now(); this.endedAt=null; this.visited=new Set(); this.rejected=new Set(); this.maxTarget=0; this.maxBridge=0;
    this.stagnationCount=0; this.stepsSinceHome=999; this.backtracks=0; this.homeReentries=0; this.events=[]; this.path=[]; this.checkpoints=[]; this.commandIds=[];this.taskFinalize=null;
  }
  log(type,payload={}) { const row={at:Date.now(),atIso:nowIso(),type,...payload}; this.events.push(row); console.log(`[${row.atIso}] ${type}`, payload.reason||payload.videoId||''); return row; }
  async req(type,payload={}){const started=Date.now();const result=await this.client.request(type,payload);this.log('body_request',{requestType:type,durationMs:Date.now()-started,requestSummary:this._requestSummary(type,payload),resultSummary:this._resultSummary(type,result)});return result;}
  _requestSummary(type,p){return {taskId:p.taskId||null,tabId:p.tabId??null,action:p.action||null,intentType:p.intent?.type||null};}
  _resultSummary(type,r){return {commandId:r?.commandId||r?.execution?.commandId||null,delivered:r?.execution?.execution?.delivered??r?.execution?.delivered??null,verified:r?.execution?.execution?.verified??r?.execution?.verified??null,behaviorSource:r?.behaviorSource??r?.execution?.behaviorSource??null,learnedGroup:r?.learnedGroup??r?.execution?.learnedGroup??null,learnedTemplateCount:r?.learnedTemplateCount??r?.execution?.learnedTemplateCount??0,type};}
  motorUsage(){const rows=this.events.filter(x=>x.type==='body_request'&&x.requestType==='INTENT_EXECUTE');const sources={},groups={};for(const row of rows){const s=String(row.resultSummary?.behaviorSource||'unknown');sources[s]=(sources[s]||0)+1;const g=row.resultSummary?.learnedGroup;if(g)groups[g]=(groups[g]||0)+1;}return {intentCount:rows.length,sources,learnedGroups:groups};}
  async selectBrowser() {
    const status=await this.req('BODY_STATUS');
    const rows=(status.browsers||[]).filter(b=>b.online&&b.environment?.eligible===true&&!['QUARANTINED','ERROR','OFFLINE'].includes(b.state));
    let browser=this.config.browser?rows.find(b=>b.browserInstanceId===this.config.browser):null;
    if(!browser) browser=rows.find(b=>(b.tabs||[]).some(t=>String(t.siteKey||'').includes('youtube.com'))) || rows[0];
    if(!browser) throw new Error('no_eligible_browser');
    const tab=Number.isInteger(this.config.tab)?(browser.tabs||[]).find(t=>Number(t.id)===this.config.tab):((browser.tabs||[]).find(t=>t.active&&String(t.siteKey||'').includes('youtube.com'))||(browser.tabs||[]).find(t=>String(t.siteKey||'').includes('youtube.com'))||(browser.tabs||[]).find(t=>t.active));
    if(!tab) throw new Error('youtube_tab_not_found');
    this.browser=browser;this.tabId=Number(tab.id);this.log('browser_selected',{browserInstanceId:browser.browserInstanceId,tabId:this.tabId,state:browser.state});
  }
  async createTask() {
    const task=await this.req('TASK_CREATE',{task:{taskId:this.taskId,browserInstanceId:this.browser.browserInstanceId,primaryTabId:this.tabId,tabIds:[this.tabId],capability:'youtube.content_discovery',policyClass:'SAFE_AUTO',internalOnly:true,goal:{capability:'youtube.content_discovery',experimentId:this.experimentId,startQuery:this.config.query,targetTopic:this.config.target,policy:this.config.policy}}});
    if(task.state==='READY') await this.req('TASK_START',{taskId:this.taskId});
    await this.req('TAB_SWITCH',{taskId:this.taskId,tabId:this.tabId});
  }
  async observe(reason='observe') {
    const tabs=await this.req('TABS_LIST',{extensionId:this.browser.extensionInstanceId});
    const tab=(tabs||[]).find(t=>Number(t.id)===this.tabId);
    if(!tab)throw new Error(`research_tab_missing:${this.tabId}`);
    if(tab.youtubeObservationError)throw new Error(`youtube_observation_error:${tab.youtubeObservationError}`);
    const obs=tab.youtubeObservation;
    if(!obs)throw new Error('youtube_observation_missing');
    const checkpoint={at:Date.now(),reason,route:obs.route,currentVideo:obs.currentVideo,signedInState:obs.signedInState,diagnostics:surfaceDiagnostics(obs),surfaces:obs.surfaces};
    this.checkpoints.push(checkpoint);this.log('observe',{reason,pageType:obs.route?.pageType,videoId:obs.route?.videoId,surfaces:checkpoint.diagnostics.map(x=>`${x.surface}:${x.extractedItems}/${x.candidateAnchors}`).join(',')});
    return obs;
  }
  async intent(intent) { const r=await this.req('INTENT_EXECUTE',{taskId:this.taskId,tabId:this.tabId,intent}); const commandId=r?.commandId||r?.execution?.commandId; if(commandId)this.commandIds.push(commandId); return r; }
  async browserCommand(action,value=null) { return this.req('BROWSER_COMMAND',{taskId:this.taskId,tabId:this.tabId,action,value}); }
  async waitFor(predicate,{timeoutMs=10000,intervalMs=350,reason='wait'}={}){const start=Date.now();let last=null;while(Date.now()-start<timeoutMs){last=await this.observe(reason);if(predicate(last))return last;await sleep(intervalMs);}throw new Error(`wait_timeout:${reason}:${last?.route?.pageType||'unknown'}`);}
  async goHome(reason='home_escape') {
    let obs=await this.observe(`${reason}_before`); if(obs.route?.pageType==='home')return obs;
    if(obs.controls?.homeLink?.actionRect){await this.intent(rectIntent('click',obs.controls.homeLink,{role:'link'}));}
    else {await this.browserCommand('address','https://www.youtube.com/');}
    this.homeReentries++;this.stepsSinceHome=0;
    return this.waitFor(o=>o.route?.pageType==='home'&&surfaceItems(o).some(x=>x.surface==='home_feed'),{timeoutMs:12000,reason:`${reason}_settle`}).catch(async()=>this.observe(`${reason}_timeout_snapshot`));
  }
  async initialSearch() {
    let obs=await this.observe('initial');
    if(obs.route?.pageType!=='home') obs=await this.goHome('initial_home');
    if(!obs.controls?.searchInput?.actionRect) obs=await this.waitFor(o=>Boolean(o.controls?.searchInput?.actionRect),{timeoutMs:8000,reason:'search_control'});
    await this.intent(rectIntent('click',obs.controls.searchInput,{role:'textbox'}));
    await this.intent({type:'keyCombo',key:'Control+a'});
    await this.intent(rectIntent('typeText',obs.controls.searchInput,{role:'textbox',text:this.config.query}));
    await this.intent({type:'pressKey',key:'Enter'});
    obs=await this.waitFor(o=>o.route?.pageType==='search'&&surfaceItems(o).filter(x=>x.surface==='search_results').length>0,{timeoutMs:12000,reason:'search_results'});
    const results=surfaceItems(obs).filter(x=>x.surface==='search_results');
    const preferred=results.filter(x=>x.isRadio!==true&&x.semanticTitle!==false&&x.title);
    const rankSeed=preferred.find(x=>Number(x.position)===Number(this.config.seedRank));
    const seedOrder=[rankSeed,...preferred,...results.filter(x=>x.isRadio!==true),...results].filter(Boolean).filter((x,i,a)=>a.findIndex(y=>y.videoId===x.videoId)===i);
    let seed=null;
    for(const candidate of seedOrder.slice(0,Math.max(1,this.config.candidateRetryLimit))){
      if(await this.clickCandidate(candidate,{reason:'search_seed'})){seed=candidate;break;}
      this.rejected.add(candidate.videoId);this.log('candidate_rejected',{reason:'search_seed_unactionable',videoId:candidate.videoId,surface:candidate.surface});
    }
    if(!seed)throw new Error('search_seed_unactionable');
    this.visited.add(seed.videoId);this.path.push(this.pathRow(1,seed,'search_seed'));
    return this.waitFor(o=>Boolean(o.route?.videoId===seed.videoId),{timeoutMs:10000,reason:'seed_arrival'});
  }
  pathRow(step,candidate,reason,topic=null){const rank=Number(candidate.position||0);return {at:Date.now(),step,fromVideoId:this.path.at(-1)?.selectedVideoId||null,selectedVideoId:candidate.videoId,surface:candidate.surface,position:candidate.position,rankBucket:rank<=3?'top3':rank<=10?'4-10':rank<=20?'11-20':'21+',title:candidate.title||null,reason,policy:this.config.policy,topic:topic||scoreTopic(candidate,this.config.target),isRadio:candidate.isRadio===true};}
  async clickCandidate(candidate,{reason='candidate'}={}) {
    let obs=await this.observe(`pre_click_${reason}`); let current=findCandidate(obs,candidate)||candidate;
    for(let i=0;i<this.config.maxScrolls && (!current?.visible||!current?.actionRect);i++){
      const point=surfaceScrollPoint(obs,candidate.surface);const rect=current?.actionRect;let delta=650;
      if(rect&&Number.isFinite(Number(rect.centerY)))delta=clamp(Number(rect.centerY)-point.y,-850,850);
      if(Math.abs(delta)<120)delta=delta>=0?300:-300;
      await this.intent({type:'moveTo',x:point.x,y:point.y,role:point.scoped?'scroll_container':'page'});
      await this.intent({type:'scrollVertical',delta});
      this.log('candidate_scroll',{reason,videoId:candidate.videoId,surface:candidate.surface,attempt:i+1,delta,scrollX:point.x,scrollY:point.y,scoped:point.scoped});
      await sleep(250);obs=await this.observe(`scroll_for_${candidate.videoId}`);current=findCandidate(obs,candidate)||current;
    }
    if(!current?.visible||!current?.actionRect){this.log('candidate_unactionable',{reason:'action_rect_unavailable_after_scroll',videoId:candidate.videoId,surface:candidate.surface,visible:current?.visible===true,hasActionRect:Boolean(current?.actionRect)});return false;}
    await this.intent(rectIntent('click',current,{role:'link'}));this.log('candidate_clicked',{reason,videoId:candidate.videoId,surface:current.surface||candidate.surface,position:current.position||candidate.position,title:current.title||candidate.title||null});return true;
  }
  updateProgress(rows) {
    const scores=bestScores(rows); const improved=scores.bestTargetScore>this.maxTarget+0.04||scores.bestBridgeScore>this.maxBridge+0.04;
    this.maxTarget=Math.max(this.maxTarget,scores.bestTargetScore); this.maxBridge=Math.max(this.maxBridge,scores.bestBridgeScore);
    this.stagnationCount=improved?0:this.stagnationCount+1;return {...scores,improved};
  }
  targetReached(obs) {
    const scored=scoreTopic(obs?.currentVideo||{},this.config.target);return {reached:scored.targetScore>=this.config.targetThreshold,score:scored};
  }
  async dwell(step) {
    const started=Date.now();this.log('dwell_start',{step,dwellSec:this.config.dwellSec});await sleep(this.config.dwellSec*1000);const obs=await this.observe(`dwell_complete_${step}`);return {obs,dwellMs:Date.now()-started};
  }
  async selectNext(obs, step) {
    let candidates=surfaceItems(obs); const excluded=new Set([...this.visited,...this.rejected]);let context={targetTopic:this.config.target,targetThreshold:this.config.targetThreshold,visited:excluded,policy:this.config.policy,radioPenalty:0.85,recentTitles:this.path.slice(-5).map(x=>x.title).filter(Boolean)};
    let decision=chooseCandidate(candidates,context); let progress=this.updateProgress(decision.rows);
    if(this.config.policy==='portfolio'){
      const action=choosePortfolioAction({rows:decision.rows,state:{stagnationCount:this.stagnationCount,stepsSinceHome:this.stepsSinceHome,homeEscapeAfter:this.config.homeEscapeAfter,longTailAfter:this.config.longTailAfter,targetThreshold:this.config.targetThreshold,pageType:obs.route?.pageType},selection:decision.candidate});
      if(action.type==='go_home'){
        obs=await this.goHome('portfolio_home_escape');candidates=surfaceItems(obs);decision=chooseCandidate(candidates,{...context,policy:'semantic_escape'});progress=this.updateProgress(decision.rows);decision.reason=`home_escape:${decision.reason}`;
      } else if(action.type==='long_tail') {
        decision=chooseCandidate(candidates,{...context,policy:'long_tail_related'});decision.reason=`long_tail:${decision.reason}`;
      } else if(action.type==='backtrack' && this.backtracks < this.config.backtrackLimit) {
        await this.browserCommand('back');this.backtracks++;await sleep(700);obs=await this.observe('portfolio_backtrack');candidates=surfaceItems(obs);decision=chooseCandidate(candidates,{...context,policy:'semantic_escape'});decision.reason=`backtrack:${decision.reason}`;
      }
    }
    this.log('selection_decision',{step,reason:decision.reason,bestTargetScore:progress.bestTargetScore,bestBridgeScore:progress.bestBridgeScore,semanticCandidateCount:progress.semanticCandidateCount,radioCandidateCount:progress.radioCandidateCount,crossTopicExposureRate:progress.crossTopicExposureRate,bestTrajectoryNovelty:progress.bestTrajectoryNovelty,stagnationCount:this.stagnationCount,selectedVideoId:decision.candidate?.videoId||null});
    return {obs,decision,progress};
  }
  async run() {
    try {
      await this.selectBrowser();await this.createTask();let obs=await this.initialSearch();
      for(let step=1;step<=this.config.maxSteps;step++){
        if(Date.now()-this.startedAt>this.config.maxRuntimeSec*1000) return this.complete('max_runtime',{step:step-1});
        const dwell=await this.dwell(step);obs=dwell.obs;const currentTarget=this.targetReached(obs);
        if(currentTarget.reached&&this.config.stopOnTarget)return this.complete('target_reached',{step,currentVideo:obs.currentVideo,target:currentTarget.score});
        let chosen=null;
        for(let attempt=1;attempt<=Math.max(1,this.config.candidateRetryLimit);attempt++){
          const selected=await this.selectNext(obs,step+1);obs=selected.obs;const candidate=selected.decision.candidate;
          if(!candidate)break;
          const clicked=await this.clickCandidate(candidate,{reason:selected.decision.reason});
          if(clicked){chosen={decision:selected.decision,candidate};break;}
          this.rejected.add(candidate.videoId);this.log('candidate_rejected',{reason:'unactionable_candidate',videoId:candidate.videoId,surface:candidate.surface,attempt});
          obs=await this.observe(`candidate_retry_${attempt}`);
        }
        if(!chosen){if(this.backtracks<this.config.backtrackLimit){await this.browserCommand('back');this.backtracks++;continue;}return this.complete('no_actionable_candidate',{step,rejectedCandidates:[...this.rejected]});}
        const {decision,candidate}=chosen;this.visited.add(candidate.videoId);this.path.push(this.pathRow(step+1,candidate,decision.reason,candidate.topic));this.stepsSinceHome++;
        obs=await this.waitFor(o=>o.route?.videoId===candidate.videoId,{timeoutMs:10000,reason:`arrival_${step+1}`}).catch(async()=>this.observe(`arrival_timeout_${step+1}`));
        const arrivalTarget=this.targetReached(obs);if(arrivalTarget.reached&&this.config.stopOnTarget)return this.complete('target_reached',{step:step+1,currentVideo:obs.currentVideo,target:arrivalTarget.score});
      }
      return this.complete('max_steps',{step:this.config.maxSteps});
    } catch(error) {
      this.log('runner_error',{error:String(error?.stack||error)});await this.req('TASK_FAIL',{taskId:this.taskId,error:String(error?.message||error)}).catch(finalizeError=>this.log('task_finalize_error',{operation:'TASK_FAIL',error:String(finalizeError?.message||finalizeError)}));this.endedAt=Date.now();const report=this.report('error',{error:String(error?.stack||error)});this.writeReport(report);throw error;
    } finally { await this.client.close().catch(()=>{}); }
  }
  async complete(outcome,extra={}) {
    this.endedAt=Date.now();
    const result={outcome,...extra,steps:this.path.length,durationMs:this.endedAt-this.startedAt,bestTargetScore:this.maxTarget,bestBridgeScore:this.maxBridge,homeReentries:this.homeReentries,backtracks:this.backtracks,rejectedCandidates:this.rejected.size,motorUsage:this.motorUsage()};
    try{const response=await this.req('TASK_COMPLETE',{taskId:this.taskId,result});this.taskFinalize={ok:true,operation:'TASK_COMPLETE',responseState:response?.state||null};}
    catch(error){this.taskFinalize={ok:false,operation:'TASK_COMPLETE',error:String(error?.message||error)};this.log('task_finalize_error',this.taskFinalize);}
    const completed={...result,taskFinalize:this.taskFinalize};
    this.log('runner_complete',completed);
    const report=this.report(outcome,{...extra,taskFinalize:this.taskFinalize});this.writeReport(report);return report;
  }
  report(outcome,extra={}) {return {schemaVersion:1,tool:'BODY Topic Transition Lab',experimentId:this.experimentId,taskId:this.taskId,config:this.config,browserInstanceId:this.browser?.browserInstanceId||null,tabId:this.tabId,startedAt:this.startedAt,endedAt:this.endedAt,outcome,result:{...extra,durationMs:(this.endedAt||Date.now())-this.startedAt,bestTargetScore:this.maxTarget,bestBridgeScore:this.maxBridge,homeReentries:this.homeReentries,backtracks:this.backtracks,rejectedCandidateCount:this.rejected.size,motorUsage:this.motorUsage(),taskFinalize:this.taskFinalize},path:this.path,rejectedCandidates:[...this.rejected],checkpoints:this.checkpoints,events:this.events,bodyCommandIds:this.commandIds,guardrails:{stealth:false,detectorEvasion:false,fingerprintSpoofing:false,proxyManipulation:false,engagementActions:false,searchOnlyAtStart:true,directTargetVideoNavigation:false}};}
  writeReport(report){const out=this.config.output||path.join(__dirname,'results',`${this.experimentId}.json`);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(`Report: ${out}`);}
}

async function main(){const config=parseArgs();const runner=new TopicTransitionRunner(config);await runner.run();}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={parseArgs,BrainClient,TopicTransitionRunner,surfaceItems,surfaceDescriptor,findCandidate,surfaceScrollPoint,main};