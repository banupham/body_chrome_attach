'use strict';

const fs=require('node:fs');
const path=require('node:path');

function readJson(file){
  try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}
}
function writeJsonAtomic(file,value){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=`${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{encoding:'utf8',mode:0o600});
  try{fs.renameSync(tmp,file);}
  catch(error){
    if(error?.code!=='EEXIST'&&error?.code!=='EPERM'&&error?.code!=='EACCES')throw error;
    try{fs.rmSync(file,{force:true});}catch{}
    fs.renameSync(tmp,file);
  }finally{try{fs.rmSync(tmp,{force:true});}catch{}}
  try{fs.chmodSync(file,0o600);}catch{}
}

class GuardianHeartbeat{
  constructor(client,{env=process.env,now=()=>Date.now(),setIntervalImpl=setInterval,clearIntervalImpl=clearInterval}={}){
    this.client=client;
    this.now=now;
    this.setIntervalImpl=setIntervalImpl;
    this.clearIntervalImpl=clearIntervalImpl;
    const raw=Number(env?.GUARDIAN_HEARTBEAT_MS);
    this.intervalMs=Number.isFinite(raw)?Math.max(100,Math.min(5000,Math.round(raw))):500;
    this.timer=null;
    this.armed=false;
    this._onConnected=()=>this.start();
    this._onDisconnected=()=>this.stop();
  }

  heartbeatFile(){
    const root=String(this.client?.bodyDataDir||'').trim();
    return root?path.join(root,'state','guardian-heartbeat.json'):null;
  }

  endpoint(){
    if(typeof this.client?.endpointFile!=='function')return null;
    return readJson(this.client.endpointFile());
  }

  pulse(){
    const file=this.heartbeatFile(),endpoint=this.endpoint();
    if(!file||!this.client?.hello||endpoint?.active!==true||!Number.isInteger(Number(endpoint.pid))||Number(endpoint.pid)<=0)return false;
    writeJsonAtomic(file,{
      schemaVersion:1,
      authenticated:true,
      connected:true,
      guardianPid:process.pid,
      bodyPid:Number(endpoint.pid),
      wsUrl:String(endpoint.wsUrl||''),
      observedAt:new Date(this.now()).toISOString()
    });
    return true;
  }

  _clearTimer(){
    if(this.timer){this.clearIntervalImpl(this.timer);this.timer=null;}
  }

  start(){
    this._clearTimer();
    this.pulse();
    this.timer=this.setIntervalImpl(()=>{try{this.pulse();}catch{}},this.intervalMs);
    this.timer?.unref?.();
    return this;
  }

  stop(){
    this._clearTimer();
    const file=this.heartbeatFile();
    if(!file)return this;
    const current=readJson(file);
    if(current&&Number(current.guardianPid)!==Number(process.pid))return this;
    try{fs.rmSync(file,{force:true});}catch{}
    return this;
  }

  arm(){
    if(this.armed)return this;
    this.armed=true;
    this.client?.on?.('connected',this._onConnected);
    this.client?.on?.('disconnected',this._onDisconnected);
    if(this.client?.hello)this.start();
    return this;
  }

  disarm(){
    if(this.armed){
      this.client?.off?.('connected',this._onConnected);
      this.client?.off?.('disconnected',this._onDisconnected);
      this.armed=false;
    }
    return this.stop();
  }
}

module.exports={GuardianHeartbeat,readJson,writeJsonAtomic};
