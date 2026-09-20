'use strict';

const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const WebSocket=require('ws');

function defaultBodyDataDir(env=process.env){
  const explicit=String(env.BODY_RUNTIME_DATA_DIR||'').trim();
  if(explicit)return path.resolve(explicit);
  const home=String(env.BODYBRAIN_HOME||'').trim();
  if(home)return path.join(path.resolve(home),'body');
  if(process.platform==='win32'&&String(env.LOCALAPPDATA||'').trim())return path.join(path.resolve(env.LOCALAPPDATA),'BodyBrain','body');
  return path.join(os.homedir(),'.bodybrain','body');
}
function readJson(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function readText(file){return fs.readFileSync(file,'utf8').trim();}
function requestId(prefix='guardian'){return prefix+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);}

class GuardianBodyClient extends EventEmitter{
  constructor({env=process.env,bodyDataDir=null,WebSocketImpl=WebSocket,timeoutMs=10000,guardianId='guardian-runtime'}={}){
    super();
    this.env=env;
    this.bodyDataDir=path.resolve(bodyDataDir||defaultBodyDataDir(env));
    this.WebSocketImpl=WebSocketImpl;
    this.timeoutMs=Math.max(1000,Number(timeoutMs)||10000);
    this.guardianId=String(guardianId||'guardian-runtime');
    this.ws=null;
    this.pending=new Map();
    this.hello=null;
  }

  endpointFile(){return path.join(this.bodyDataDir,'state','runtime-endpoint.json');}
  tokenFile(){return path.join(this.bodyDataDir,'profiles','.auth','guardian.token');}

  async connect(){
    if(this.ws&&this.ws.readyState===this.WebSocketImpl.OPEN)return this.hello;
    const endpoint=readJson(this.endpointFile());
    if(endpoint?.active!==true||!endpoint.wsUrl)throw new Error('guardian_body_endpoint_inactive');
    const token=readText(this.tokenFile());
    const ws=new this.WebSocketImpl(endpoint.wsUrl,{origin:undefined});
    this.ws=ws;
    const hello=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('guardian_hello_timeout')),this.timeoutMs);
      const onOpen=()=>{ws.send(JSON.stringify({type:'HELLO',role:'guardian',protocolVersion:7,guardianId:this.guardianId,token}));};
      const onMessage=raw=>{
        let msg;try{msg=JSON.parse(String(raw));}catch{return;}
        if(msg.type==='HELLO_ACK'&&msg.role==='guardian'){
          clearTimeout(timer);
          ws.off('message',onMessage);
          resolve(msg);
        }else if(msg.type==='AUTH_ERROR'){
          clearTimeout(timer);
          ws.off('message',onMessage);
          reject(new Error(String(msg.error||'guardian_auth_error')));
        }
      };
      ws.once('open',onOpen);
      ws.on('message',onMessage);
      ws.once('error',error=>{clearTimeout(timer);reject(error);});
    });
    this.hello=hello;
    ws.on('message',raw=>this._onMessage(raw));
    ws.on('close',()=>this._onClose());
    ws.on('error',error=>this.emit('transportError',error));
    this.emit('connected',hello);
    return hello;
  }

  _onMessage(raw){
    let msg;try{msg=JSON.parse(String(raw));}catch{return;}
    if(msg.type==='GUARDIAN_EVENT'){this.emit('event',msg.event||{});return;}
    const id=String(msg.requestId||'');
    const pending=id?this.pending.get(id):null;
    if(!pending)return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if(msg.ok===false||msg.type==='GUARDIAN_ERROR')pending.reject(new Error(String(msg.error||'guardian_request_failed')));
    else pending.resolve(msg);
  }

  _onClose(){
    const error=new Error('guardian_body_connection_closed');
    for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(error);}
    this.pending.clear();
    this.ws=null;
    this.hello=null;
    this.emit('disconnected');
  }

  request(type,payload={},timeoutMs=this.timeoutMs){
    if(!this.ws||this.ws.readyState!==this.WebSocketImpl.OPEN)return Promise.reject(new Error('guardian_body_not_connected'));
    const id=requestId();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('guardian_request_timeout:'+type));},Math.max(1000,Number(timeoutMs)||this.timeoutMs));
      this.pending.set(id,{resolve,reject,timer});
      this.ws.send(JSON.stringify({type,requestId:id,...payload}),error=>{
        if(!error)return;
        const row=this.pending.get(id);if(!row)return;
        this.pending.delete(id);clearTimeout(row.timer);reject(error);
      });
    });
  }

  async bodyStatus(){return (await this.request('GUARDIAN_BODY_STATUS')).result;}
  async observe(browserInstanceId,tabId=null){return (await this.request('GUARDIAN_BODY_OBSERVE',{browserInstanceId,tabId})).result;}
  async probeEnvironment(browserInstanceId,{tabId=null,publicIpEndpoint=null,timeoutMs=null}={}){
    return (await this.request('GUARDIAN_EXTENSION_ENVIRONMENT_PROBE',{browserInstanceId,tabId,publicIpEndpoint,timeoutMs},Math.max(this.timeoutMs,Number(timeoutMs)||0)+5000)).result;
  }
  async setGate(browserInstanceId,{allowed,leaseId=null,ttlMs=30000}={}){
    return (await this.request('GUARDIAN_GATE_SET',{browserInstanceId,allowed:allowed===true,leaseId,ttlMs})).result;
  }
  async revokeGate(browserInstanceId){return (await this.request('GUARDIAN_GATE_REVOKE',{browserInstanceId})).result;}
  async gateStatus(){return (await this.request('GUARDIAN_GATE_STATUS')).result;}

  close(){
    if(!this.ws)return;
    try{this.ws.close(1000,'guardian_shutdown');}catch{}
  }
}

module.exports={GuardianBodyClient,defaultBodyDataDir,readJson,readText,requestId};
