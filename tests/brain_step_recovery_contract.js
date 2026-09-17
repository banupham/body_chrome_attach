'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {AutonomousYouTubeBrainV4}=require('../research/autonomous_discovery/brain_v4');
const {buildWorld,contextKey}=require('../research/autonomous_discovery/world_model');
const {actionMemoryId}=require('../research/autonomous_discovery/agent_planner');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'brain-step-recovery-'));
let serial=0;
const target={videoId:'target00001',title:'Japanese regional food traditions',categoryId:'22',tags:['Japanese','regional food'],defaultLanguage:'en',mediaFormat:{kind:'LONG_FORM'}};
const candidate={videoId:'candidate01',surface:'related',position:1,visible:true,title:'Example',actionRect:{x:200,y:200,width:220,height:120},classification:{primary:'food'},targetProximity:0.5};
function semantic(videoId='current0001'){return {available:true,platform:'youtube',route:{pageType:'watch',videoId},viewport:{width:1000,height:700},surfaces:[{surface:'related',items:[candidate]}],controls:{},advertising:{playingAd:false},affordances:[]};}
function observation(s=semantic()){return {content:{semantic:s},bodyState:{activeTabId:1},environment:{online:true,eligible:true}};}
function brain(body={}){
 const b=new AutonomousYouTubeBrainV4({root:path.join(root,String(++serial)),target:target.videoId,accountId:'test-account',maxSteps:2,maxMinutes:1,maxQueries:8,reportEverySteps:10,reportEveryMinutes:10},{body,api:{stats:()=>({}),profileTarget:async()=>target,enrichVideoIds:async()=>new Map()}});
 b.browser={browserInstanceId:'browser-a'};b.tabId=1;b.task={taskId:'task-a',workspace:{tabIds:[1,2],primaryTabId:1}};b.targetApi=target;return b;
}
function topology({loading=false,switchWorks=true,observeThrows=false,tabs:provided=null}={}){
 let tabs=provided||[{id:1,active:true,siteKey:'youtube.com',status:'complete'},{id:2,active:false,siteKey:'youtube.com',status:loading?'loading':'complete'}];
 let activeTabId=tabs.find(t=>t.active)?.id;const closed=[],reads=[];
 const body={status:async()=>({browsers:[{browserInstanceId:'browser-a',tabs,activeTabId}]}),
 observe:async({tabId})=>{reads.push(tabId);if(tabId===2&&observeThrows)throw new Error('body_request_timeout:BODY_OBSERVE');return observation(tabId===2?(loading?null:semantic(candidate.videoId)):semantic());},
 switchTab:async(_task,id)=>{if(switchWorks){activeTabId=id;tabs=tabs.map(t=>({...t,active:t.id===id}));}return {execution:{completed:switchWorks}};},
 finishTask:async()=>{},createTask:async spec=>({...spec,state:'RUNNING',workspace:{tabIds:spec.tabIds,primaryTabId:spec.primaryTabId}})};
 const b=brain(body);b.verifyTimeoutMs=1;b.closeTab=async id=>{closed.push(id);return true;};
 return {b,closed,reads,before:[{id:1,active:true,siteKey:'youtube.com',status:'complete'}]};
}
async function main(){
 const stale=brain({observe:async()=>({...observation(),freshness:{liveRefreshAttempted:true,liveRefreshSucceeded:false,semanticAgeMs:120000}})});
 assert.equal((await stale.observe()).semantic,null);
 stale.currentBrowser=async()=>({tabs:[{id:1,status:'complete',siteKey:'youtube.com'}],activeTabId:1,online:true});
 const metadata=await stale.recoverObservation('partial',{attempts:1,allowPartial:true});assert.equal(metadata.partial,true);assert.equal(metadata.semantic,null);assert.equal(metadata.observation.content.page,null);

 for(const options of [{},{loading:true},{observeThrows:true},{switchWorks:false}]){
  const {b,closed,reads,before}=topology(options),out=await b.reconcileTabEffects(before,{expectedVideoId:candidate.videoId,sourceTabId:1});
  assert.deepEqual(closed,[]);assert.equal(out.expectedFound,!options.loading&&!options.observeThrows&&options.switchWorks!==false);
  if(out.expectedFound)assert.equal(b.tabId,2);if(options.loading||options.observeThrows)assert.equal(reads.filter(id=>id===2).length,3);
 }
 const gone=topology({tabs:[{id:2,active:true,siteKey:'youtube.com',status:'complete'}]});
 await gone.b.reconcileTabEffects([...gone.before,{id:2,active:false,siteKey:'youtube.com'}],{sourceTabId:1});assert.equal(gone.b.tabId,2);assert.deepEqual(gone.b.task.workspace.tabIds,[2]);
 const multiple=topology({tabs:[{id:1,active:true,siteKey:'youtube.com'},{id:2,siteKey:'youtube.com'},{id:3,siteKey:'example.com'}]});
 await multiple.b.reconcileTabEffects(multiple.before,{expectedVideoId:candidate.videoId});assert.ok(multiple.b.tabBranches.has(3),'all new tabs must be recorded even after a target match');assert.deepEqual(multiple.closed,[]);
 const info={snapshot:{pageType:'watch',currentVideoId:'current0001',currentTopic:'food',candidates:[candidate]},proximityGain:0,newVideos:0,newTopics:0,newTransitions:0,targetCandidate:null};
 const world=buildWorld({semantic:semantic(),tabId:1,target,snapshot:info.snapshot});
 // Real run/actAgent feedback path: transient after-action timeout, one input, fresh retry, next step.
 let inputs=0,afterReads=0,closed=false;const finished=[];
 const b=brain({connect:async()=>{},finishTask:async(_id,state)=>finished.push(state),close:async()=>{closed=true;}});
 b.selectBrowser=async()=>{};b.createTask=async()=>{};b.profileAccountContext=async()=>null;b.browserTabs=async()=>[{id:1,active:true}];b.ensureWorkspaceTabs=async()=>{};
 b.observe=async reason=>{if(reason==='agent_after_action'&&++afterReads===1)throw new Error('body_request_timeout:BODY_OBSERVE');return {semantic:semantic(),observation:observation()};};
 b.enrichedSnapshot=async()=>info;b.worldFrom=async()=>world;b.writeBatch=()=>{};
 const action={type:'click_candidate',capability:'motor.click',purpose:'open_candidate',target:candidate,actionKey:'candidate-test',utility:10,expected:'current_video:candidate01'};
 b.agentPlanner.generate=()=>({subgoal:{id:'test'},context:'test',actions:[action]});b.agentPlanner.choose=()=>action;
 b.executeAgentAction=async()=>{inputs++;return {success:false,error:'candidate_click_no_expected_video_change',selected:candidate};};
 await b.run();assert.equal(inputs,2,'one input per step, no replay on observation timeout');assert.equal(afterReads,3);assert.equal(b.agentHistory.length,2);assert.equal(b.agentHistory[0].feedback.verdict,'failed');assert.equal(closed,true);assert.deepEqual(finished,['COMPLETED']);
 assert.equal(b.memory.state.totalSteps,2);assert.equal(b.memory.strategy(actionMemoryId(action),contextKey(world)).successes,0);
 // Persistent outage preserves the attempted action as unknown and stops at a bounded checkpoint.
 const outage=brain({connect:async()=>{},finishTask:async()=>{},close:async()=>{}});Object.assign(outage,{selectBrowser:async()=>{},createTask:async()=>{},profileAccountContext:async()=>null,browserTabs:async()=>[{id:1}],ensureWorkspaceTabs:async()=>{},enrichedSnapshot:async()=>info,worldFrom:async()=>world,writeBatch:()=>{}});
 outage.config.maxSteps=20;outage.observe=async reason=>{if(reason==='agent_after_action')throw new Error('body_request_timeout:BODY_OBSERVE');return {semantic:semantic(),observation:observation()};};
 outage.agentPlanner.generate=b.agentPlanner.generate;outage.agentPlanner.choose=b.agentPlanner.choose;let outageInputs=0;outage.executeAgentAction=async()=>{outageInputs++;return {success:true};};
 const report=await outage.run();assert.equal(report.status,'RECOVERY_REQUIRED');assert.equal(outageInputs,3);assert.equal(outage.agentHistory.length,3);assert.ok(outage.agentHistory.every(r=>r.feedback.verdict==='unknown'&&r.success===false));
 // Rebind a generic observed affordance before CDP; never fall back to native page clicking.
 const raw=brain({step:async(_task,step)=>{assert.equal(step.kind,'motor');assert.equal(step.intent.x,700);return {execution:{completed:true}};}});
 const aff={tag:'button',role:'button',label:'Expand',link:null,actionRect:{x:650,y:200,width:100,height:40},actionPoint:{x:700,y:220},actionable:true};
 raw.observe=async()=>({semantic:{...semantic(),affordances:[aff]}});raw.browserTabs=async()=>[];raw.reconcileTabEffects=async()=>({});
 const rawAction={type:'body_step',capability:'motor.click',affordance:aff,step:{kind:'motor',intent:{type:'click',x:10,y:10}}};assert.equal((await raw.executeRawBodyStep(rawAction)).success,true);
 raw.observe=async()=>({semantic:{...semantic(),affordances:[]}});assert.equal((await raw.executeRawBodyStep(rawAction)).reason,'affordance_changed_replan_required');
 console.log('brain_step_recovery_contract: PASS');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
