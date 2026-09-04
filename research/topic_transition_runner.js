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
    backtrackLimit:3, maxScrolls:8, output:null, url:DEFAULT_URL, tokenPath:DEFAULT_TOKEN_PATH, stopOnTarget:true
  };
  for (let i=0;i<argv.length;i++) {
    const raw=argv[i]; if (!raw.startsWith('--')) continue;
    const [k0,v0] = raw.slice(2).split('=',2); const k=k0.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
    let v=v0; if (v == null && argv[i+1] && !argv[i+1].startsWith('--')) v=argv[++i];
    if (['dwellSec','maxSteps','maxRuntimeSec','seedRank','homeEscapeAfter','longTailAfter','backtrackLimit','maxScrolls','targetThreshold'].includes(k)) out[k]=Number(v);
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
  constructor({url=DEFAULT_URL,tokenPath=DEFAULT_TOKEN_PATH,controllerId='topic-transition-lab',timeoutMs=70000}={}) {
    this.url=url; this.tokenPath=tokenPath; this.controllerId=controllerId; this.timeoutMs=timeoutMs; this.ws=null; this.pending=new Map(); this.seq=0;
  }
  async connect() {
    if (this.ws?.readyState===WebSocket.OPEN) return;
    const token=loadToken(this.tokenPath);
    await new Promise((resolve,reject)=>{
      const ws=this.ws=new WebSocket(this.url); let settled=false;
      const timer=setTimeout(()=>{ if(!settled){settled=true;reject(new Error('brain_connect_timeout'));}},8000);
      ws.once('open',()=>ws.send(JSON.stringify({type:'HELLO',role:'brain',protocolVersion:PROTOCOL_VERSION,token,controllerId:this.controllerId})));
      ws.once('error',e=>{if(!settled){settled=true;clearTimeout(timer);reject(e);}});
      ws.on('message',raw=>{ let msg; try{msg=JSON.parse(String(raw));}catch{return;}
        if(msg.type==='HELLO_ACK'&&msg.authenticated===true&&!settled){settled=true;clearTimeout(timer);resolve();return;}
        if(msg.type==='AUTH_ERROR'&&!settled){settled=true;clearTimeout(timer);reject(new Error(`brain_auth_failed:${msg.error||'unknown'}`));return;}
        this._onMessage(msg);
      });
      ws.on('close',()=>{const e=new Error('brain_disconnected');for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(e);}this.pending.clear();});
    });
  }
  _onMessage(msg){const rid=String(msg?.requestId||'');if(!rid||!this.pending.has(rid))return;const p=this.pending.get(rid);clearTimeout(p.timer);this.pending.delete(rid);if(msg.ok===false||msg.type==='BRAIN_ERROR')p.reject(new Error(String(msg.error?.message||msg.error||'brain_request_failed')));else p.resolve(msg.result??msg);}
  async request(type,payload={}){await this.connect();const requestId=`research-${Date.now()}-${++this.seq}`;const result=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(requestId);reject(new Error(`brain_request_timeout:${type}`));},this.timeoutMs);this.pending.set(requestId,{resolve,reject,timer});});this.ws.send(JSON.stringify({type,requestId,...payload}));return result;}
  async close(){if(!this.ws)return;const ws=this.ws;this.ws=null;await new Promise(resolve=>{ws.once('close',resolve);ws.close();setTimeout(resolve,250);});}
}

function surfaceItems(obs) { return (obs?.surfaces || []).flatMap(s => (s.items || []).map(x => ({...x, surface:x.surface||s.surface}))); }
function surfaceDiagnostics(obs){return (obs?.surfaces||[]).map(s=>({surface:s.surface,...(s.diagnostics||{})}));}
function findCandidate(obs, videoId) { return surfaceItems(obs).find(x => String(x.videoId)===String(videoId)) || null; }
function rectIntent(type, descriptor, extra={}) { const r=descriptor?.actionRect; if(!r) throw new Error(`action_rect_required:${type}`); return {type,x:r.centerX,y:r.centerY,width:r.width,height:r.height,...extra}; }

class TopicTransitionRunner {
  constructor(config, client = new BrainClient({url:config.url,tokenPath:config.tokenPath})) {
    this.config=config; this.client=client; this.experimentId=id('topic'); this.taskId=`task-${this.experimentId}`;
    this.browser=null; this.tabId=null; this.startedAt=Date.now(); this.endedAt=null; this.visited=new Set(); this.maxTarget=0; this.maxBridge=0;
    this.stagnationCount=0; this.stepsSinceHome=999; this.backtracks=0; this.homeReentries=0; this.events=[]; this.path=[]; this.checkpoints=[]; this.commandIds=[];
  }
  log(type,payload={}) { const row={at:Date.now(),atIso:nowIso(),type,...payload}; this.events.push(row); console.log(`[${row.atIso}] ${type}`, payload.reason||payload.videoId||''); return row; }
  async req(type,payload={}){const started=Date.now();const result=await this.client.request(type,payload);this.log('body_request',{requestType:type,durationMs:Date.now()-started,requestSummary:this._requestSummary(type,payload),resultSummary:this._resultSummary(type,result)});return result;}
  _requestSummary(type,p){return {taskId:p.taskId||null,tabId:p.tabId??null,action:p.action||null,intentType:p.intent?.type||null};}
  _resultSummary(type,r){return {commandId:r?.commandId||r?.execution?.commandId||null,delivered:r?.execution?.execution?.delivered??r?.execution?.delivered??null,verified:r?.execution?.execution?.verified??r?.execution?.verified??null,type};}
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
    const seed=results.find(x=>Number(x.position)===Number(this.config.seedRank))||results[0];
    if(!seed)throw new Error('search_seed_missing');
    await this.clickCandidate(seed,{reason:'search_seed'});this.visited.add(seed.videoId);this.path.push(this.pathRow(1,seed,'search_seed'));
    return this.waitFor(o=>Boolean(o.route?.videoId===seed.videoId),{timeoutMs:10000,reason:'seed_arrival'});
  }
  pathRow(step,candidate,reason,topic=null){const rank=Number(candidate.position||0);return {at:Date.now(),step,fromVideoId:this.path.at(-1)?.selectedVideoId||null,selectedVideoId:candidate.videoId,surface:candidate.surface,position:candidate.position,rankBucket:rank<=3?'top3':rank<=10?'4-10':rank<=20?'11-20':'21+',title:candidate.title||null,reason,policy:this.config.policy,topic:topic||scoreTopic(candidate,this.config.target),isRadio:candidate.isRadio===true};}
  async clickCandidate(candidate,{reason='candidate'}={}) {
    let obs=await this.observe(`pre_click_${reason}`); let current=findCandidate(obs,candidate.videoId)||candidate;
    for(let i=0;i<this.config.maxScrolls && (!current?.visible||!current?.actionRect);i++){
      const rect=current?.actionRect; const vh=Number(obs.viewport?.height||800); let delta=650;
      if(rect&&Number.isFinite(rect.centerY))delta=clamp(rect.centerY-vh*0.55,-850,850);
      if(Math.abs(delta)<120)delta=delta>=0?300:-300;
      await this.intent({type:'scrollVertical',delta}); await sleep(250);obs=await this.observe(`scroll_for_${candidate.videoId}`);current=findCandidate(obs,candidate.videoId)||current;
    }
    if(!current?.actionRect)throw new Error(`candidate_rect_missing:${candidate.videoId}`);
    await this.intent(rectIntent('click',current,{role:'link'}));this.log('candidate_clicked',{reason,videoId:candidate.videoId,surface:candidate.surface,position:candidate.position,title:candidate.title||null});
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
    let candidates=surfaceItems(obs); let context={targetTopic:this.config.target,targetThreshold:this.config.targetThreshold,visited:this.visited,policy:this.config.policy,radioPenalty:0.85,recentTitles:this.path.slice(-5).map(x=>x.title).filter(Boolean)};
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
        const {decision}=await this.selectNext(obs,step+1);const candidate=decision.candidate;
        if(!candidate){if(this.backtracks<this.config.backtrackLimit){await this.browserCommand('back');this.backtracks++;continue;}return this.complete('no_candidate',{step});}
        await this.clickCandidate(candidate,{reason:decision.reason});this.visited.add(candidate.videoId);this.path.push(this.pathRow(step+1,candidate,decision.reason,candidate.topic));this.stepsSinceHome++;
        obs=await this.waitFor(o=>o.route?.videoId===candidate.videoId,{timeoutMs:10000,reason:`arrival_${step+1}`}).catch(async()=>this.observe(`arrival_timeout_${step+1}`));
        const arrivalTarget=this.targetReached(obs);if(arrivalTarget.reached&&this.config.stopOnTarget)return this.complete('target_reached',{step:step+1,currentVideo:obs.currentVideo,target:arrivalTarget.score});
      }
      return this.complete('max_steps',{step:this.config.maxSteps});
    } catch(error) {
      this.log('runner_error',{error:String(error?.stack||error)});await this.req('TASK_FAIL',{taskId:this.taskId,error:String(error?.message||error)}).catch(()=>{});this.endedAt=Date.now();const report=this.report('error',{error:String(error?.stack||error)});this.writeReport(report);throw error;
    } finally { await this.client.close().catch(()=>{}); }
  }
  async complete(outcome,extra={}) {
    this.endedAt=Date.now();const result={outcome,...extra,steps:this.path.length,durationMs:this.endedAt-this.startedAt,bestTargetScore:this.maxTarget,bestBridgeScore:this.maxBridge,homeReentries:this.homeReentries,backtracks:this.backtracks};
    await this.req('TASK_COMPLETE',{taskId:this.taskId,result}).catch(()=>{});const report=this.report(outcome,extra);this.writeReport(report);this.log('runner_complete',result);return report;
  }
  report(outcome,extra={}) {return {schemaVersion:1,tool:'BODY Topic Transition Lab',experimentId:this.experimentId,taskId:this.taskId,config:this.config,browserInstanceId:this.browser?.browserInstanceId||null,tabId:this.tabId,startedAt:this.startedAt,endedAt:this.endedAt,outcome,result:{...extra,durationMs:(this.endedAt||Date.now())-this.startedAt,bestTargetScore:this.maxTarget,bestBridgeScore:this.maxBridge,homeReentries:this.homeReentries,backtracks:this.backtracks},path:this.path,checkpoints:this.checkpoints,events:this.events,bodyCommandIds:this.commandIds,guardrails:{stealth:false,detectorEvasion:false,fingerprintSpoofing:false,proxyManipulation:false,engagementActions:false,searchOnlyAtStart:true,directTargetVideoNavigation:false}};}
  writeReport(report){const out=this.config.output||path.join(__dirname,'results',`${this.experimentId}.json`);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(`Report: ${out}`);}
}

async function main(){const config=parseArgs();const runner=new TopicTransitionRunner(config);await runner.run();}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={parseArgs,BrainClient,TopicTransitionRunner,main};
