'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {WebSocket}=require('ws');
const {readRuntimeEndpoint}=require('../daemon/src/runtime_endpoint');

const PROTOCOL_VERSION=7;
const ROOT=path.join(__dirname,'..');
const TOKEN_PATH=path.join(ROOT,'daemon','profiles','.auth','brain.token');
const ENDPOINT_PATH=path.join(ROOT,'daemon','state','runtime-endpoint.json');
const FORBIDDEN=new Set(['success','tasksuccess','verified','verification','goalachieved','correct','wrong','shouldretry','nextaction','recommendedaction']);

function readToken(){const env=String(process.env.BODY_BRAIN_TOKEN||'').trim();if(env)return env;const value=fs.readFileSync(TOKEN_PATH,'utf8').trim();if(!value)throw new Error(`brain_token_empty:${TOKEN_PATH}`);return value;}
function keyName(value){return String(value||'').replace(/[_-]/g,'').toLowerCase();}
function judgmentPaths(value,prefix=''){const found=[];if(Array.isArray(value)){value.forEach((row,index)=>found.push(...judgmentPaths(row,`${prefix}[${index}]`)));return found;}if(!value||typeof value!=='object')return found;for(const [key,row] of Object.entries(value)){const current=prefix?`${prefix}.${key}`:key;if(FORBIDDEN.has(keyName(key)))found.push(current);found.push(...judgmentPaths(row,current));}return found;}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}

class BrainSmokeClient{
  constructor(){this.url=readRuntimeEndpoint(ENDPOINT_PATH).wsUrl;this.token=readToken();this.ws=null;this.pending=new Map();this.seq=0;}
  async connect(){
    await new Promise((resolve,reject)=>{const ws=this.ws=new WebSocket(this.url),timer=setTimeout(()=>reject(new Error('brain_smoke_connect_timeout')),8000);const fail=error=>{clearTimeout(timer);reject(error instanceof Error?error:new Error(String(error)));};ws.once('open',()=>ws.send(JSON.stringify({type:'HELLO',role:'brain',protocolVersion:PROTOCOL_VERSION,controllerId:`body-contract-smoke-${process.pid}`,token:this.token})));ws.once('error',fail);ws.on('message',raw=>{let msg;try{msg=JSON.parse(String(raw));}catch{return;}if(msg.type==='HELLO_ACK'&&msg.authenticated===true){clearTimeout(timer);if(msg.bodyContractVersion!=='1.0')return fail(new Error(`body_contract_version_mismatch:${msg.bodyContractVersion}`));resolve();return;}if(msg.type==='AUTH_ERROR')return fail(new Error(`brain_auth_failed:${msg.error||'unknown'}`));const id=String(msg.requestId||'');if(!id||!this.pending.has(id))return;const row=this.pending.get(id);clearTimeout(row.timer);this.pending.delete(id);if(msg.type==='BRAIN_ERROR'||msg.ok===false)row.reject(new Error(msg.error?.message||msg.error||'brain_request_failed'));else row.resolve(msg);});ws.on('close',()=>{for(const row of this.pending.values()){clearTimeout(row.timer);row.reject(new Error('brain_smoke_disconnected'));}this.pending.clear();});});
  }
  async request(type,payload={},timeoutMs=20000){const requestId=`smoke-${Date.now()}-${++this.seq}`,promise=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(requestId);reject(new Error(`brain_smoke_timeout:${type}`));},timeoutMs);this.pending.set(requestId,{resolve,reject,timer});});this.ws.send(JSON.stringify({type,requestId,...payload}));return promise;}
  async close(){if(!this.ws)return;const ws=this.ws;this.ws=null;await new Promise(resolve=>{ws.once('close',resolve);ws.close();setTimeout(resolve,250);});}
}

function resultOf(message){return message?.result??message;}
function chooseBrowser(status){const browsers=status?.browsers||[];return browsers.find(row=>row.online===true&&row.environment?.eligible===true&&Number.isInteger(Number(row.activeTabId)))||null;}
function center(viewport){const width=Number(viewport?.width),height=Number(viewport?.height);if(!Number.isFinite(width)||!Number.isFinite(height)||width<80||height<80)throw new Error('live_viewport_unavailable');return {x:Math.round(Math.max(20,Math.min(width-20,width/2))),y:Math.round(Math.max(20,Math.min(height-20,height/2)))};}

async function main(){
  const client=new BrainSmokeClient();let taskId=null;
  try{
    await client.connect();
    const status=resultOf(await client.request('BODY_STATUS'));
    if(status?.bodyContract?.version!=='1.0')throw new Error('body_contract_v1_not_active');
    const browser=chooseBrowser(status);if(!browser)throw new Error('no_online_eligible_browser');
    const tabId=Number(browser.activeTabId);
    const firstObservation=(await client.request('BODY_OBSERVE',{browserInstanceId:browser.browserInstanceId,tabId})).observation;
    if(firstObservation?.freshness?.liveRefreshSucceeded!==true)throw new Error('live_eyes_snapshot_not_available');
    if(firstObservation?.bodyState?.pointer?.known!==true)throw new Error('pointer_unknown_move_real_mouse_inside_page_then_retry');
    const target=center(firstObservation?.content?.page?.viewport);

    taskId=`body-smoke-${Date.now()}`;
    const created=resultOf(await client.request('TASK_CREATE',{task:{taskId,capability:'body.contract.smoke',internalOnly:true,policyClass:'SAFE_AUTO',browserInstanceId:browser.browserInstanceId,primaryTabId:tabId,tabIds:[tabId]}}));
    if(created?.state!=='READY')throw new Error(`smoke_task_not_ready:${created?.state}`);
    const started=resultOf(await client.request('TASK_START',{taskId}));if(started?.state!=='RUNNING')throw new Error(`smoke_task_not_running:${started?.state}`);

    const stepId=`step-${Date.now()}`,step={kind:'motor',intent:{type:'moveTo',x:target.x,y:target.y,width:8,height:8,role:'unknown'}};
    const first=await client.request('BODY_STEP',{contractVersion:'1.0',stepId,taskId,tabId:'primary',step},65000);
    if(first?.type!=='BODY_STEP_RESULT')throw new Error('body_step_result_missing');
    if(first.execution?.attemptCount!==1||first.execution?.replayed!==false||first.execution?.completed!==true)throw new Error(`first_body_step_invalid:${JSON.stringify(first.execution)}`);
    const leaks=judgmentPaths(first);if(leaks.length)throw new Error(`judgment_field_leak:${leaks.join(',')}`);

    const duplicate=await client.request('BODY_STEP',{contractVersion:'1.0',stepId,taskId,tabId:'primary',step},65000);
    if(duplicate.execution?.replayed!==true||duplicate.execution?.attemptCount!==1)throw new Error(`duplicate_not_replayed:${JSON.stringify(duplicate.execution)}`);
    const duplicateLeaks=judgmentPaths(duplicate);if(duplicateLeaks.length)throw new Error(`duplicate_judgment_field_leak:${duplicateLeaks.join(',')}`);

    await sleep(100);
    const after=(await client.request('BODY_OBSERVE',{taskId,tabId:'primary'})).observation;
    if(after?.freshness?.liveRefreshSucceeded!==true)throw new Error('post_step_live_eyes_snapshot_not_available');
    const px=Number(after?.bodyState?.pointer?.x),py=Number(after?.bodyState?.pointer?.y);
    if(!Number.isFinite(px)||!Number.isFinite(py)||Math.hypot(px-target.x,py-target.y)>12)throw new Error(`pointer_not_at_expected_target:${px},${py}->${target.x},${target.y}`);

    await client.request('TASK_CANCEL',{taskId,reason:'body_contract_live_smoke_complete'});taskId=null;
    console.log(JSON.stringify({ok:true,test:'BODY Contract v1 live smoke',bodyContractVersion:'1.0',browserInstanceId:browser.browserInstanceId,tabId,target,firstExecution:first.execution,duplicateExecution:duplicate.execution,liveEyesBefore:firstObservation.freshness,liveEyesAfter:after.freshness,judgmentLeakCount:0},null,2));
    console.log('BODY_CONTRACT_LIVE_SMOKE: PASS');
  }catch(error){
    if(taskId)try{await client.request('TASK_CANCEL',{taskId,reason:'body_contract_live_smoke_cleanup'});}catch{}
    console.error('BODY_CONTRACT_LIVE_SMOKE: FAIL');console.error(String(error?.stack||error));process.exitCode=1;
  }finally{await client.close().catch(()=>{});}
}

if(require.main===module)main();
module.exports={BrainSmokeClient,judgmentPaths,chooseBrowser,center,main};
