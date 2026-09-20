'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {WebSocket}=require('ws');

const PROTOCOL_VERSION=7;
const BODY_CONTRACT_VERSION='1.0';
function localAppData(){const root=String(process.env.LOCALAPPDATA||'').trim();if(!root)throw new Error('LOCALAPPDATA_required');return root;}
function defaultBodyRoot(){return String(process.env.BODY_RUNTIME_DATA_DIR||'').trim()||path.join(localAppData(),'BodyBrain','body');}
function loadRuntimeFiles(root=defaultBodyRoot()){
  const endpointFile=path.join(root,'state','runtime-endpoint.json'),tokenFile=path.join(root,'profiles','.auth','brain.token');
  const endpoint=JSON.parse(fs.readFileSync(endpointFile,'utf8'));if(endpoint.active!==true||endpoint.host!=='127.0.0.1'||!Number.isInteger(Number(endpoint.port)))throw new Error('body_runtime_endpoint_inactive');
  const token=fs.readFileSync(tokenFile,'utf8').trim();if(!token)throw new Error('body_brain_token_empty');
  return {root,endpointFile,tokenFile,wsUrl:endpoint.wsUrl||`ws://127.0.0.1:${Number(endpoint.port)}`,token};
}
function id(prefix){return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;}

class BodyBrainClient{
  constructor({bodyRoot=defaultBodyRoot(),controllerId='youtube-autonomous-discovery',timeoutMs=30000}={}){this.files=loadRuntimeFiles(bodyRoot);this.controllerId=controllerId;this.timeoutMs=Math.max(3000,Number(timeoutMs)||30000);this.ws=null;this.pending=new Map();this.events=[];this.seq=0;}
  async connect(){
    if(this.ws?.readyState===WebSocket.OPEN)return;
    await new Promise((resolve,reject)=>{
      const ws=this.ws=new WebSocket(this.files.wsUrl);let settled=false;
      const timer=setTimeout(()=>{if(!settled){settled=true;reject(new Error('body_brain_connect_timeout'));try{ws.close();}catch{}}},8000);
      ws.once('open',()=>ws.send(JSON.stringify({type:'HELLO',role:'brain',protocolVersion:PROTOCOL_VERSION,controllerId:this.controllerId,token:this.files.token})));
      ws.once('error',error=>{if(!settled){settled=true;clearTimeout(timer);reject(error);}});
      ws.on('message',raw=>{let msg;try{msg=JSON.parse(String(raw));}catch{return;}
        if(msg.type==='HELLO_ACK'&&msg.authenticated===true&&!settled){settled=true;clearTimeout(timer);if(Number(msg.protocolVersion)!==PROTOCOL_VERSION)return reject(new Error('body_protocol_version_mismatch'));if(String(msg.bodyContractVersion)!==BODY_CONTRACT_VERSION)return reject(new Error('body_contract_version_mismatch'));resolve();return;}
        if(msg.type==='AUTH_ERROR'&&!settled){settled=true;clearTimeout(timer);reject(new Error(`body_auth_failed:${msg.error||'unknown'}`));return;}
        if(msg.type==='BODY_EVENT'&&!msg.requestId){this.events.push(msg);if(this.events.length>1000)this.events.shift();return;}
        const rid=String(msg.requestId||'');const p=this.pending.get(rid);if(!rid||!p)return;clearTimeout(p.timer);this.pending.delete(rid);if(msg.type==='BRAIN_ERROR'||msg.ok===false)p.reject(new Error(String(msg.error||'body_request_failed')));else p.resolve(msg);
      });
      ws.on('close',()=>{const error=new Error('body_brain_disconnected');for(const [rid,p] of this.pending){clearTimeout(p.timer);p.reject(error);this.pending.delete(rid);}this.ws=null;});
    });
  }
  async request(type,payload={},timeoutMs=this.timeoutMs){
    await this.connect();const requestId=`autodiscovery-${Date.now()}-${++this.seq}`;
    const promise=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(requestId);reject(new Error(`body_request_timeout:${type}`));},timeoutMs);this.pending.set(requestId,{resolve,reject,timer});});
    this.ws.send(JSON.stringify({type,requestId,...payload}));return promise;
  }
  async status(){return (await this.request('BODY_STATUS')).result||{};}
  async observe({taskId=null,browserInstanceId=null,tabId=null}={}){return (await this.request('BODY_OBSERVE',{taskId,browserInstanceId,tabId})).observation||{};}
  async createTask(spec){return (await this.request('TASK_CREATE',{task:spec})).result||{};}
  async getTask(taskId){return (await this.request('TASK_GET',{taskId})).result||{};}
  async startTask(taskId){return (await this.request('TASK_START',{taskId})).result||{};}
  async finishTask(taskId,state,payload){const type=state==='COMPLETED'?'TASK_COMPLETE':state==='FAILED'?'TASK_FAIL':'TASK_CANCEL';const args=type==='TASK_COMPLETE'?{taskId,result:payload}:type==='TASK_FAIL'?{taskId,error:String(payload||'failed')}:{taskId,reason:String(payload||'cancelled')};return (await this.request(type,args)).result||{};}
  async step(taskId,step,{tabId='primary'}={}){const stepId=id('STEP');return this.request('BODY_STEP',{contractVersion:BODY_CONTRACT_VERSION,taskId,stepId,tabId,step});}
  async motor(taskId,intent,{tabId='primary'}={}){return this.step(taskId,{kind:'motor',intent},{tabId});}
  async browserUi(taskId,action,value=null,{tabId='primary'}={}){return this.step(taskId,{kind:'browser_ui',action,value},{tabId});}
  async switchTab(taskId,targetTabId){return this.step(taskId,{kind:'tab_switch',targetTabId:Number(targetTabId)},{tabId:Number(targetTabId)});}
  drainEvents(){const rows=this.events.splice(0,this.events.length);return rows;}
  async close(){const ws=this.ws;this.ws=null;for(const [rid,p] of this.pending){clearTimeout(p.timer);p.reject(new Error('body_brain_closed'));this.pending.delete(rid);}if(ws)await new Promise(resolve=>{ws.once('close',resolve);try{ws.close();}catch{resolve();}setTimeout(resolve,200);});}
}

module.exports={BodyBrainClient,loadRuntimeFiles,defaultBodyRoot,PROTOCOL_VERSION,BODY_CONTRACT_VERSION,id};
