'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {BodyBrainClient,defaultBodyRoot}=require('./body_client');
const {YouTubeApi}=require('./youtube_api');
const {classifyVideo,topicDistance,fold,uniq}=require('./topic_classifier');
const {buildQueryPlan,inspectQuery,buildObservedQueryExpansion}=require('./query_firewall');
const {ExperienceMemory}=require('./experience_memory');
const {Reporter}=require('./reporter');
const {sourceInfo}=require('./build_info');

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,Math.max(0,Number(ms)||0)));
const nowIso=()=>new Date().toISOString();
const bounded=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
const randomInt=(a,b)=>Math.floor(a+Math.random()*(Math.max(a,b)-a+1));
const runId=()=>`yt-discovery-${new Date().toISOString().replace(/[:.]/g,'-')}-${crypto.randomBytes(3).toString('hex')}`;
function localBrainRoot(){return String(process.env.BODY_BRAIN_DATA_DIR||'').trim()||path.join(path.dirname(defaultBodyRoot()),'brain','youtube-discovery');}
function flattenCandidates(semantic){return (semantic?.surfaces||[]).flatMap(surface=>(surface.items||[]).map(item=>({...item,surface:item.surface||surface.surface})));}
function currentDescriptor(semantic){return semantic?.currentVideo||null;}
function routeType(semantic){return String(semantic?.route?.pageType||'other');}
function currentVideoId(semantic){return String(semantic?.route?.videoId||semantic?.currentVideo?.videoId||'');}
function targetFoundMethod(surface){if(surface==='home_feed')return 'home';if(surface==='related')return 'next_video';if(surface==='mix_queue')return 'mix_queue';if(surface==='search_results')return 'search';return surface||'unknown';}
function overlap(a,b){const aa=new Set((a||[]).map(fold).filter(Boolean)),bb=new Set((b||[]).map(fold).filter(Boolean));if(!aa.size||!bb.size)return 0;let hit=0;for(const x of aa)if(bb.has(x))hit++;return hit/Math.max(aa.size,bb.size);}
function planningProximity(candidate,targetFingerprint){
  const api=candidate.youtubeApi||{},classification=candidate.classification||classifyVideo(candidate),scores=[];
  scores.push(classification.primary===targetFingerprint.primaryTopic?0.34:0);
  scores.push(String(api.categoryId||'')===String(targetFingerprint.categoryId||'')&&targetFingerprint.categoryId?0.19:0);
  scores.push(overlap(api.topicLabels,targetFingerprint.topics)*0.18);
  scores.push(overlap(api.tags,targetFingerprint.tags)*0.12);
  scores.push(overlap((api.keywords||[]).map(x=>x?.term||x),targetFingerprint.keywords)*0.12);
  scores.push(targetFingerprint.country&&api.channel?.country===targetFingerprint.country?0.03:0);
  scores.push(targetFingerprint.language&&(api.defaultLanguage===targetFingerprint.language||api.defaultAudioLanguage===targetFingerprint.language)?0.02:0);
  return Number(Math.min(1,scores.reduce((a,b)=>a+b,0)).toFixed(3));
}
function contextKey(pageType,topic){return `${String(pageType||'other')}|${String(topic||'unknown')}`;}

class AutonomousYouTubeBrain{
  constructor(config,{body=null,api=null}={}){
    this.config=config;this.sourceInfo=sourceInfo();this.runId=runId();this.body=body||new BodyBrainClient({controllerId:`youtube-autonomous-${this.runId}`});this.api=api||new YouTubeApi({required:true});
    this.root=config.root||localBrainRoot();this.sessionDir=path.join(this.root,'sessions');this.reportDir=path.join(this.root,'reports');this.memory=new ExperienceMemory(path.join(this.root,'memory.json'));this.reporter=new Reporter(this.reportDir,this.runId);
    fs.mkdirSync(this.sessionDir,{recursive:true});this.ledgerFile=path.join(this.sessionDir,`${this.runId}.jsonl`);
    this.startedAt=Date.now();this.lastBatchAt=this.startedAt;this.batchIndex=0;this.batchSnapshots=[];this.batchPath=[];this.bodyActions=0;this.queryAttempts=0;this.stepNo=0;this.stagnation=0;this.queryIndex=0;this.dynamicQueries=[];
    this.seenVideos=new Set();this.seenTopics=new Set();this.seenTransitions=new Set();this.seenEdges=new Set();this.visitedVideos=new Set();this.failedVideos=new Set();this.bestProximity=0;this.targetDiscovery=null;this.targetOpened=false;this.task=null;this.browser=null;this.tabId=null;this.targetApi=null;this.queryPlan=null;this.queryAudit=[];this.lastSnapshot=null;this.status='INITIALIZING';
  }
  ledger(type,payload={}){const {type:actionType,...data}=payload;const row={at:Date.now(),atIso:nowIso(),...data,type,...(actionType!=null?{actionType}:{})};fs.appendFileSync(this.ledgerFile,JSON.stringify(row)+'\n');return row;}
  async selectBrowser(){
    const status=await this.body.status();const rows=(status.browsers||[]).filter(b=>b.online===true&&b.environment?.eligible===true&&!['QUARANTINED','ERROR','OFFLINE'].includes(String(b.state||'')));
    let browser=this.config.browser?rows.find(b=>String(b.browserInstanceId)===String(this.config.browser)):null;
    if(!browser)browser=rows.find(b=>(b.tabs||[]).some(t=>String(t.siteKey||'').includes('youtube.com')))||rows[0];if(!browser)throw new Error('no_ready_body_browser');
    const tabs=browser.tabs||[];let tab=this.config.tab!=null?tabs.find(t=>Number(t.id)===Number(this.config.tab)):null;
    if(!tab)tab=tabs.find(t=>t.active&&String(t.siteKey||'').includes('youtube.com'))||tabs.find(t=>String(t.siteKey||'').includes('youtube.com'))||tabs.find(t=>t.active)||tabs[0];if(!tab)throw new Error('body_browser_has_no_tab');
    this.browser=browser;this.tabId=Number(tab.id);this.ledger('browser_selected',{browserInstanceId:browser.browserInstanceId,tabId:this.tabId,siteKey:tab.siteKey||null});
  }
  async createTask(){
    const task=await this.body.createTask({taskId:`task-${this.runId}`,browserInstanceId:this.browser.browserInstanceId,primaryTabId:this.tabId,tabIds:[this.tabId],capability:'youtube.content_discovery',policyClass:'SAFE_AUTO',internalOnly:true,goal:{capability:'youtube.content_discovery',targetVideoId:this.config.target,mode:'autonomous_trial_error'}});
    if(task.state!=='READY'&&task.state!=='RUNNING')throw new Error(`autodiscovery_task_not_ready:${task.state}`);this.task=task.state==='RUNNING'?task:await this.body.startTask(task.taskId);this.ledger('task_started',{taskId:this.task.taskId});
  }
  async observe(reason='observe'){
    const observation=await this.body.observe({taskId:this.task.taskId});const semantic=observation?.content?.semantic;
    if(!semantic?.available||semantic.platform!=='youtube')return {observation,semantic:null,reason};
    return {observation,semantic,reason};
  }
  async waitForSemantic(predicate,{timeoutMs=12000,intervalMs=450,reason='wait'}={}){
    const deadline=Date.now()+timeoutMs;let last=null;while(Date.now()<deadline){last=await this.observe(reason);if(last.semantic&&predicate(last.semantic))return last;await sleep(intervalMs);}return last;
  }
  async bodyStep(step){this.bodyActions++;const result=await this.body.step(this.task.taskId,step);this.ledger('body_step',{kind:step.kind,action:step.kind==='motor'?step.intent?.type:step.action,completed:result?.execution?.completed??null,dispatched:result?.execution?.dispatched??null,error:result?.execution?.error||null});return result;}
  async motor(intent){return this.bodyStep({kind:'motor',intent});}
  async browserUi(action,value=null){return this.bodyStep({kind:'browser_ui',action,value});}
  async ensureYouTube(){
    let state=await this.observe('ensure_youtube');if(state.semantic)return state;
    await this.browserUi('address','https://www.youtube.com/');await sleep(1800);state=await this.waitForSemantic(()=>true,{timeoutMs:15000,reason:'youtube_arrival'});if(!state?.semantic)throw new Error('youtube_semantic_observer_unavailable');return state;
  }
  async enrichedSnapshot(state,reason){
    const semantic=state.semantic;let raw=flattenCandidates(semantic);raw=raw.filter(x=>x?.videoId);
    const current=currentDescriptor(semantic);const ids=uniq([current?.videoId,...raw.map(x=>x.videoId)]).filter(Boolean);const apiMap=await this.api.enrichVideoIds(ids);
    const currentApi=current?.videoId?apiMap.get(String(current.videoId))||null:null;const currentNode=current?{...current,youtubeApi:currentApi}:null;const currentClass=currentNode?classifyVideo(currentNode):{primary:'unknown',confidence:0};
    const candidates=raw.map(row=>{const youtubeApi=apiMap.get(String(row.videoId))||null;const node={...row,youtubeApi};const classification=classifyVideo(node);return {...node,classification,targetMatch:String(row.videoId)===String(this.config.target),targetProximity:planningProximity({...node,classification},this.queryPlan.fingerprint)};});
    const index=(this.batchSnapshots.at(-1)?.index||0)+1;const snapshot={index,at:Date.now(),atIso:nowIso(),reason,pageType:routeType(semantic),currentVideoId:current?.videoId||null,currentTitle:currentApi?.title||current?.title||null,currentTopic:currentClass.primary,currentClassification:currentClass,candidates};
    let newVideos=0,newTopics=0,newTransitions=0,maxProximity=this.bestProximity;
    for(const c of candidates){if(!this.seenVideos.has(c.videoId)){this.seenVideos.add(c.videoId);newVideos++;}const topic=c.classification.primary;if(!this.seenTopics.has(topic)){this.seenTopics.add(topic);newTopics++;}this.memory.recordTopic(topic);maxProximity=Math.max(maxProximity,Number(c.targetProximity||0));const edge=`${snapshot.currentVideoId||snapshot.pageType}|${c.videoId}|${c.surface}`;if(!this.seenEdges.has(edge)){this.seenEdges.add(edge);const transition=`${snapshot.currentTopic}|${topic}|${c.surface}`;if(!this.seenTransitions.has(transition)){this.seenTransitions.add(transition);newTransitions++;}this.memory.recordTransition(snapshot.currentTopic,topic,{surface:c.surface});}}
    if(snapshot.currentVideoId){this.seenVideos.add(snapshot.currentVideoId);this.seenTopics.add(snapshot.currentTopic);this.memory.recordTopic(snapshot.currentTopic);}
    this.batchSnapshots.push(snapshot);this.lastSnapshot=snapshot;this.deriveEnvironmentQueries(snapshot);
    const targetCandidate=candidates.find(x=>x.targetMatch);if(targetCandidate&&!this.targetDiscovery){this.targetDiscovery={at:Date.now(),surface:targetCandidate.surface,method:targetFoundMethod(targetCandidate.surface),rank:targetCandidate.position??null,fromVideoId:snapshot.currentVideoId||null,fromTopic:snapshot.currentTopic,strategy:null,opened:false,title:targetCandidate.youtubeApi?.title||targetCandidate.title||null};this.ledger('target_discovered',this.targetDiscovery);}
    const proximityGain=Math.max(0,maxProximity-this.bestProximity);this.bestProximity=maxProximity;return {snapshot,newVideos,newTopics,newTransitions,proximityGain,targetCandidate};
  }
  deriveEnvironmentQueries(snapshot){
    if(snapshot.pageType!=='search'||!this.queryPlan?.fingerprint||!this.targetApi)return;
    const titles=snapshot.candidates.map(row=>row.youtubeApi?.title||row.title||'').filter(Boolean),existing=[...this.queryPlan.plan,...this.dynamicQueries].map(row=>row.query);
    const expansion=buildObservedQueryExpansion(titles,this.queryPlan.fingerprint,{targetVideoId:this.targetApi.videoId,targetTitle:this.targetApi.title},{existingQueries:existing,limit:5});this.queryAudit.push(...expansion.audit);
    let added=0;for(const row of expansion.plan){if(this.dynamicQueries.some(x=>fold(x.query)===fold(row.query))||this.queryPlan.plan.some(x=>fold(x.query)===fold(row.query)))continue;this.dynamicQueries.push(row);added++;}
    if(added)this.ledger('query_plan_expanded',{source:'observed_target_anchored_titles',added,totalDynamic:this.dynamicQueries.length,queries:expansion.plan.slice(0,added).map(row=>row.query)});
  }
  nextQuery(){
    const all=[...this.queryPlan.plan,...this.dynamicQueries];if(!all.length)throw new Error('no_safe_query_available');
    const untried=all.filter(row=>!this.memory.state.queries[fold(row.query)]?.attempts);const pool=untried.length?untried:all;pool.sort((a,b)=>{const aa=this.memory.state.queries[fold(a.query)],bb=this.memory.state.queries[fold(b.query)];return Number(bb?.meanReward||0)-Number(aa?.meanReward||0);});const row=pool[this.queryIndex%pool.length];this.queryIndex++;return row;
  }
  async search(queryRow){
    const inspected=inspectQuery(queryRow.query,{targetVideoId:this.targetApi.videoId,targetTitle:this.targetApi.title});this.queryAudit.push({kind:queryRow.kind,source:queryRow.source,...inspected});if(!inspected.allowed)throw new Error(`query_firewall_blocked:${inspected.reason}`);
    let state=await this.ensureYouTube();let semantic=state.semantic;let input=semantic.controls?.searchInput;
    if(!input?.actionRect||input.visible===false){await this.browserUi('address','https://www.youtube.com/');await sleep(1300);state=await this.waitForSemantic(s=>Boolean(s.controls?.searchInput?.actionRect),{reason:'search_input'});semantic=state.semantic;input=semantic.controls?.searchInput;}
    if(!input?.actionRect)throw new Error('youtube_search_input_unavailable');const r=input.actionRect;const centerX=Number(r.centerX??(r.x+r.width/2)),centerY=Number(r.centerY??(r.y+r.height/2));
    if(!input.active){await this.motor({type:'click',x:centerX,y:centerY,width:r.width,height:r.height,role:'textbox'});state=await this.waitForSemantic(s=>s.controls?.searchInput?.active===true,{timeoutMs:1800,intervalMs:140,reason:'legacy_search_focus'});input=state?.semantic?.controls?.searchInput||input;}
    const valueLength=Number(input?.valueFingerprint?.length||0),selection=input?.selection||{};if(valueLength>0&&selection.fullSelection!==true){await this.motor({type:'keyCombo',key:'Control+a'});state=await this.waitForSemantic(s=>s.controls?.searchInput?.selection?.fullSelection===true,{timeoutMs:1800,intervalMs:140,reason:'legacy_search_selection'});input=state?.semantic?.controls?.searchInput||input;if(input?.selection?.fullSelection!==true)throw new Error('search_selection_not_verified');}
    await this.motor({type:'typeText',x:centerX,y:centerY,width:r.width,height:r.height,role:'textbox',text:inspected.query,preserveFocus:true});state=await this.observe('legacy_search_text_after');this.ledger('search_edit_observed',{phase:'legacy_type',searchInput:state?.semantic?.controls?.searchInput||null});await this.motor({type:'pressKey',key:'Enter'});this.queryAttempts++;this.ledger('search_submitted',{query:inspected.query,kind:queryRow.kind,titleOverlap:inspected.titleOverlap});
    await sleep(1400);return this.waitForSemantic(s=>routeType(s)==='search'&&flattenCandidates(s).some(x=>x.surface==='search_results'),{timeoutMs:15000,reason:'search_results'});
  }
  strategyCandidates(snapshot){
    const rows=snapshot.candidates.filter(x=>!this.visitedVideos.has(x.videoId)&&!this.failedVideos.has(x.videoId)&&!x.targetMatch&&x.semanticTitle!==false&&x.actionRect);
    const page=snapshot.pageType,topic=snapshot.currentTopic,context=contextKey(page,topic);const options=[];
    if(page==='search'&&rows.some(x=>x.surface==='search_results'))options.push('search_result');
    if(page==='home'&&rows.some(x=>x.surface==='home_feed'))options.push('home_novelty');
    if(['watch','watch_radio','shorts'].includes(page)){
      if(rows.some(x=>x.surface==='related'&&Number(x.position)<=5))options.push('related_top');
      if(rows.some(x=>x.surface==='related'&&Number(x.position)>=6&&Number(x.position)<=30))options.push('related_long_tail');
      if(rows.some(x=>x.surface==='related'))options.push('semantic_bridge');
      if(rows.some(x=>x.surface==='mix_queue'))options.push('mix_queue');
    }
    if(this.stagnation>=3)options.push('new_query');if(this.stagnation>=5&&page!=='home')options.push('backtrack');if(!options.length)options.push('new_query');
    const unique=[...new Set(options)];unique.sort((a,b)=>this.memory.ucb(b,context)-this.memory.ucb(a,context));return {options:unique,context,rows};
  }
  chooseCandidate(strategy,rows,snapshot){
    let pool=rows;
    if(strategy==='search_result')pool=rows.filter(x=>x.surface==='search_results');
    else if(strategy==='home_novelty')pool=rows.filter(x=>x.surface==='home_feed');
    else if(strategy==='related_top')pool=rows.filter(x=>x.surface==='related'&&Number(x.position)<=5);
    else if(strategy==='related_long_tail')pool=rows.filter(x=>x.surface==='related'&&Number(x.position)>=6&&Number(x.position)<=30);
    else if(strategy==='semantic_bridge')pool=rows.filter(x=>x.surface==='related');
    else if(strategy==='mix_queue')pool=rows.filter(x=>x.surface==='mix_queue');
    const targetTopic=this.queryPlan.fingerprint.primaryTopic;return pool.map(row=>{const novelty=this.seenTopics.has(row.classification.primary)?0:1;const topicBridge=row.classification.primary===targetTopic?1:topicDistance(snapshot.currentTopic,row.classification.primary);const radioPenalty=row.isRadio?0.25:0;const rankBonus=1/Math.sqrt(Math.max(1,Number(row.position||50)));const score=row.targetProximity*5+novelty*1.7+topicBridge*0.7+rankBonus*0.2-radioPenalty;return {...row,decisionScore:Number(score.toFixed(3))};}).sort((a,b)=>b.decisionScore-a.decisionScore||Number(a.position||999)-Number(b.position||999))[0]||null;
  }
  async clickCandidate(candidate){
    const state=await this.observe(`candidate_click_prepare_${candidate.videoId}`),semantic=state.semantic,actionable=semantic?(flattenCandidates(semantic).find(x=>String(x.videoId)===String(candidate.videoId)&&String(x.surface)===String(candidate.surface))||flattenCandidates(semantic).find(x=>String(x.videoId)===String(candidate.videoId))):null;
    if(!actionable?.actionable||!actionable?.actionPoint)return {ok:false,reason:'candidate_not_safely_actionable',actionability:actionable?{visible:actionable.visible===true,actionable:actionable.actionable===true,reason:actionable.reason||null,actionPoint:actionable.actionPoint||null,evidence:actionable.evidence||null}:null};
    const p=actionable.actionPoint,r=actionable.visibleRect||actionable.actionRect||{width:12,height:12};const result=await this.motor({type:'click',x:Number(p.x),y:Number(p.y),width:Math.max(8,Number(r.width||12)),height:Math.max(8,Number(r.height||12)),role:'link'});const completed=result?.execution?.completed===true;return {ok:completed,result};
  }
  dwellSeconds(){
    const max=Math.max(4,Number(this.config.maxDwellSec||90)),r=Math.random();if(r<0.52)return randomInt(3,Math.min(8,max));if(r<0.87)return randomInt(Math.min(10,max),Math.min(30,max));return randomInt(Math.min(35,max),max);
  }
  reward(outcome){let value=0;value+=Math.min(5,outcome.newVideos)*0.5;value+=outcome.newTopics*5;value+=Math.min(4,outcome.newTransitions)*2.5;if(outcome.proximityGain>=0.05)value+=Math.min(10,outcome.proximityGain*22);if(outcome.targetSeen)value+=40;if(outcome.targetOpened)value+=100;if(outcome.success===false)value-=5;if(!outcome.targetSeen&&outcome.newVideos===0&&outcome.newTopics===0&&outcome.newTransitions===0&&outcome.proximityGain<0.02)value-=2;return Number(value.toFixed(3));
  }
  async maybeOpenTarget(snapshotInfo,strategy){
    const candidate=snapshotInfo.targetCandidate;if(!candidate)return false;if(!this.targetDiscovery)this.targetDiscovery={at:Date.now(),surface:candidate.surface,method:targetFoundMethod(candidate.surface),rank:candidate.position??null,fromVideoId:snapshotInfo.snapshot.currentVideoId||null,fromTopic:snapshotInfo.snapshot.currentTopic,strategy,opened:false,title:candidate.youtubeApi?.title||candidate.title||null};else if(!this.targetDiscovery.strategy)this.targetDiscovery.strategy=strategy;
    const clicked=await this.clickCandidate(candidate);if(!clicked.ok)return false;await sleep(1200);const arrived=await this.waitForSemantic(s=>currentVideoId(s)===String(this.config.target),{timeoutMs:12000,reason:'target_arrival'});if(currentVideoId(arrived?.semantic)===String(this.config.target)){this.targetOpened=true;this.targetDiscovery.opened=true;this.targetDiscovery.openedAt=Date.now();this.ledger('target_opened',this.targetDiscovery);return true;}return false;
  }
  async act(snapshotInfo){
    const snapshot=snapshotInfo.snapshot;if(snapshot.currentVideoId===String(this.config.target)){this.targetOpened=true;if(!this.targetDiscovery)this.targetDiscovery={at:Date.now(),surface:'current_video',method:'current_video',rank:null,fromVideoId:null,fromTopic:snapshot.currentTopic,strategy:'arrival',opened:true,openedAt:Date.now()};return {stop:true};}
    if(snapshotInfo.targetCandidate){const opened=await this.maybeOpenTarget(snapshotInfo,'target_priority');return {strategy:'target_priority',success:opened,targetSeen:true,targetOpened:opened,dwellSec:0,action:'click_target'};}
    const decision=this.strategyCandidates(snapshot),strategy=decision.options[0],context=decision.context;let selected=null,success=true,action=strategy,dwellSec=0,query=null;
    if(strategy==='new_query'){
      const q=this.nextQuery();query=q.query;await this.search(q);action='search';
    }else if(strategy==='backtrack'){
      const r=await this.browserUi('back');success=r?.execution?.completed===true;action='back';await sleep(1000);
    }else{
      selected=this.chooseCandidate(strategy,decision.rows,snapshot);if(!selected){const q=this.nextQuery();query=q.query;await this.search(q);action='search_fallback';}
      else{const clicked=await this.clickCandidate(selected);success=clicked.ok;if(success){this.visitedVideos.add(selected.videoId);dwellSec=this.dwellSeconds();this.ledger('dwell',{videoId:selected.videoId,seconds:dwellSec,mode:dwellSec<=8?'quick':dwellSec<=30?'medium':'long'});await sleep(dwellSec*1000);}else this.failedVideos.add(selected.videoId);}
    }
    const afterState=await this.waitForSemantic(()=>true,{timeoutMs:12000,reason:'after_action'});if(!afterState?.semantic)throw new Error('semantic_observation_lost_after_action');const after=await this.enrichedSnapshot(afterState,`after_${action}`);const targetOpened=await this.maybeOpenTarget(after,strategy);const reward=this.reward({newVideos:after.newVideos,newTopics:after.newTopics,newTransitions:after.newTransitions,proximityGain:after.proximityGain,targetSeen:Boolean(after.targetCandidate),targetOpened,success});
    this.memory.recordStrategy(strategy,{context,reward,success,newTopics:after.newTopics,newTransitions:after.newTransitions,targetSeen:Boolean(after.targetCandidate)||targetOpened});if(query)this.memory.recordQuery(query,{reward,targetSeen:Boolean(after.targetCandidate)||targetOpened,resultCount:after.snapshot.candidates.length});this.memory.save();this.stagnation=reward<=1?this.stagnation+1:0;
    this.batchPath.push({step:this.stepNo,strategy,sourceVideoId:snapshot.currentVideoId,sourceTopic:snapshot.currentTopic,pageType:snapshot.pageType,action,selectedVideoId:selected?.videoId||null,selectedTitle:selected?.youtubeApi?.title||selected?.title||null,selectedTopic:selected?.classification?.primary||null,surface:selected?.surface||null,rank:selected?.position??null,query,dwellSec,reward,success,targetSeen:Boolean(after.targetCandidate),targetOpened});
    return {strategy,success,reward,targetSeen:Boolean(after.targetCandidate),targetOpened,after};
  }
  reportObject(status){
    return {schemaVersion:1,source:this.sourceInfo,sessionFile:this.ledgerFile,reportScope:'batch',summaryScope:'run_cumulative',batch:{index:this.batchIndex,firstStep:this.batchPath[0]?.step??null,lastStep:this.batchPath.at(-1)?.step??null},tool:'BODY Autonomous YouTube Discovery Brain',runId:this.runId,status,target:{videoId:this.config.target,title:this.targetApi?.title||null,categoryId:this.targetApi?.categoryId||null,topicLabels:this.targetApi?.topicLabels||[],classification:classifyVideo(this.targetApi||{}),planningFingerprint:this.queryPlan?.fingerprint||null,titleSearchForbidden:true},startedAt:new Date(this.startedAt).toISOString(),updatedAt:nowIso(),config:{...this.config,apiKey:undefined},summary:{steps:this.stepNo,uniqueVideosObserved:this.seenVideos.size,uniqueTopicsObserved:this.seenTopics.size,uniqueTransitionsObserved:this.seenTransitions.size,queryAttempts:this.queryAttempts,bodyActions:this.bodyActions,bestTargetProximity:this.bestProximity,stagnationCount:this.stagnation},targetDiscovery:this.targetDiscovery,snapshots:this.batchSnapshots,path:this.batchPath,queryAudit:this.queryAudit,memory:this.memory.summary(),youtubeApi:this.api.stats()};
  }
  writeBatch(status,force=false){
    const dueSteps=this.config.reportEverySteps>0&&this.stepNo>0&&this.stepNo%this.config.reportEverySteps===0,dueTime=this.config.reportEveryMinutes>0&&Date.now()-this.lastBatchAt>=this.config.reportEveryMinutes*60000;if(!force&&!dueSteps&&!dueTime){this.reporter.writeLatest(this.reportObject(status));return null;}this.batchIndex++;const report=this.reportObject(status),paths=this.reporter.write(report,this.batchIndex);this.ledger('batch_report',{batchIndex:this.batchIndex,status,paths});this.batchSnapshots=[];this.batchPath=[];this.lastBatchAt=Date.now();return paths;
  }
  limitReached(){if(!this.config.unlimited&&this.config.maxSteps>0&&this.stepNo>=this.config.maxSteps)return 'max_steps';if(!this.config.unlimited&&this.config.maxMinutes>0&&Date.now()-this.startedAt>=this.config.maxMinutes*60000)return 'max_runtime';return null;}
  async run(){
    this.status='STARTING';this.memory.startRun();this.targetApi=await this.api.profileTarget(this.config.target);this.queryPlan=buildQueryPlan(this.targetApi,{maxQueries:this.config.maxQueries});this.queryAudit.push(...this.queryPlan.audit);this.ledger('target_profiled',{videoId:this.targetApi.videoId,title:this.targetApi.title,categoryId:this.targetApi.categoryId,topics:this.targetApi.topicLabels,planningFingerprint:this.queryPlan.fingerprint,queryPlanner:this.queryPlan.planner,safeQueryCount:this.queryPlan.plan.length,plannedQueries:this.queryPlan.plan.map(row=>({query:row.query,kind:row.kind,components:row.components||[]}))});
    await this.body.connect();await this.selectBrowser();await this.createTask();this.status='RUNNING';
    try{
      let state=await this.ensureYouTube();let first=await this.enrichedSnapshot(state,'initial');if(await this.maybeOpenTarget(first,'initial_observation')){this.status='TARGET_REACHED';this.writeBatch(this.status,true);if(!this.config.continueAfterFound)return this.reportObject(this.status);}
      if(!first.snapshot.candidates.length||['other','channel','feed','playlist'].includes(first.snapshot.pageType)){const q=this.nextQuery();state=await this.search(q);first=await this.enrichedSnapshot(state,'initial_search');}
      while(true){const limit=this.limitReached();if(limit){this.status=limit.toUpperCase();break;}this.stepNo++;const stateNow=await this.observe(`step_${this.stepNo}_before`);if(!stateNow.semantic){await this.ensureYouTube();continue;}const before=await this.enrichedSnapshot(stateNow,`step_${this.stepNo}_before`);const result=await this.act(before);if(result.stop){this.status='TARGET_REACHED';if(!this.config.continueAfterFound)break;}if(result.targetOpened){this.status='TARGET_REACHED';this.writeBatch(this.status,true);if(!this.config.continueAfterFound)break;}
        this.writeBatch(this.status,false);
      }
      this.writeBatch(this.status,true);await this.body.finishTask(this.task.taskId,'COMPLETED',{status:this.status,targetVideoId:this.config.target,targetOpened:this.targetOpened,steps:this.stepNo});return this.reportObject(this.status);
    }catch(error){this.status='ERROR';this.ledger('run_error',{error:String(error?.stack||error)});this.writeBatch(this.status,true);if(this.task)await this.body.finishTask(this.task.taskId,'FAILED',String(error?.message||error)).catch(()=>{});throw error;}finally{await this.body.close().catch(()=>{});}
  }
}

module.exports={AutonomousYouTubeBrain,flattenCandidates,currentDescriptor,routeType,currentVideoId,planningProximity,contextKey,targetFoundMethod,localBrainRoot};
