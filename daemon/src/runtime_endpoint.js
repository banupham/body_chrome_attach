'use strict';

const fs=require('node:fs');
const path=require('node:path');

const RUNTIME_ENDPOINT_VERSION=1;
const RUNTIME_HOST='127.0.0.1';
const RUNTIME_ENDPOINT_FILENAME='runtime-endpoint.json';
const RUNTIME_LOCK_FILENAME='runtime.lock';

function validPort(value){const port=Number(value);return Number.isInteger(port)&&port>=1&&port<=65535?port:null;}
function endpointPaths(baseDir){return {state:path.join(baseDir,'state',RUNTIME_ENDPOINT_FILENAME),lock:path.join(baseDir,'state',RUNTIME_LOCK_FILENAME),extension:path.join(baseDir,'..','dist',RUNTIME_ENDPOINT_FILENAME)};}
function endpointRecord(port,{pid=process.pid,now=()=>Date.now()}={}){
  const normalized=validPort(port);if(!normalized)throw new Error('runtime_endpoint_port_invalid');
  return {schemaVersion:RUNTIME_ENDPOINT_VERSION,active:true,host:RUNTIME_HOST,port:normalized,wsUrl:`ws://${RUNTIME_HOST}:${normalized}`,pid:Number(pid)||null,startedAt:new Date(now()).toISOString()};
}
function inactiveRecord(){return {schemaVersion:RUNTIME_ENDPOINT_VERSION,active:false,host:RUNTIME_HOST,port:null,wsUrl:null};}
function processAlive(pid,killImpl=process.kill){
  const value=Number(pid);if(!Number.isInteger(value)||value<=0)return false;
  try{killImpl(value,0);return true;}catch(error){return error?.code==='EPERM';}
}
function readJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
function writeJsonAtomic(file,value){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=`${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{encoding:'utf8',mode:0o600});
  try{fs.renameSync(tmp,file);}catch(error){
    if(error?.code!=='EEXIST'&&error?.code!=='EPERM'&&error?.code!=='EACCES')throw error;
    try{fs.rmSync(file,{force:true});}catch{}
    fs.renameSync(tmp,file);
  }finally{try{fs.rmSync(tmp,{force:true});}catch{}}
  try{fs.chmodSync(file,0o600);}catch{}
}
function lockAgeMs(file,now=Date.now()){try{return Math.max(0,Number(now)-fs.statSync(file).mtimeMs);}catch{return Infinity;}}
function acquireRuntimeLock(baseDir,{pid=process.pid,killImpl=process.kill,now=Date.now}={}){
  const paths=endpointPaths(baseDir),ownerPid=Number(pid);if(!Number.isInteger(ownerPid)||ownerPid<=0)throw new Error('runtime_lock_pid_invalid');
  fs.mkdirSync(path.dirname(paths.lock),{recursive:true});
  for(let attempt=0;attempt<2;attempt++){
    try{
      fs.writeFileSync(paths.lock,JSON.stringify({pid:ownerPid,createdAt:new Date(now()).toISOString()})+'\n',{encoding:'utf8',mode:0o600,flag:'wx'});
      try{fs.chmodSync(paths.lock,0o600);}catch{}
      return {acquired:true,pid:ownerPid,path:paths.lock};
    }catch(error){
      if(error?.code!=='EEXIST')throw error;
      const current=readJson(paths.lock),currentPid=Number(current?.pid);
      if(currentPid===ownerPid)return {acquired:false,pid:ownerPid,path:paths.lock,alreadyOwned:true};
      if(Number.isInteger(currentPid)&&currentPid>0&&processAlive(currentPid,killImpl))throw new Error(`company_runtime_already_running:${currentPid}`);
      if((!Number.isInteger(currentPid)||currentPid<=0)&&lockAgeMs(paths.lock,now())<10000)throw new Error('company_runtime_lock_busy');
      try{fs.rmSync(paths.lock,{force:true});}catch{}
    }
  }
  throw new Error('company_runtime_lock_unavailable');
}
function releaseRuntimeLock(baseDir,{pid=process.pid}={}){
  const paths=endpointPaths(baseDir),current=readJson(paths.lock);
  if(current&&Number(current.pid)!==Number(pid))return false;
  try{fs.rmSync(paths.lock,{force:true});return true;}catch{return false;}
}
function assertRuntimeOwnershipAvailable(stateFile,{pid=process.pid,killImpl=process.kill}={}){
  const current=readJson(stateFile),ownerPid=Number(current?.pid);
  if(current?.active===true&&Number.isInteger(ownerPid)&&ownerPid>0&&ownerPid!==Number(pid)&&processAlive(ownerPid,killImpl))throw new Error(`company_runtime_already_running:${ownerPid}:${validPort(current.port)||'unknown'}`);
  return true;
}
function publishRuntimeEndpoint(baseDir,port,options={}){
  const record=endpointRecord(port,options),paths=endpointPaths(baseDir);
  assertRuntimeOwnershipAvailable(paths.state,{pid:record.pid,killImpl:options.killImpl||process.kill});
  writeJsonAtomic(paths.state,record);
  if(fs.existsSync(path.dirname(paths.extension)))writeJsonAtomic(paths.extension,{schemaVersion:record.schemaVersion,active:true,host:record.host,port:record.port,wsUrl:record.wsUrl,startedAt:record.startedAt});
  return record;
}
function clearRuntimeEndpoint(baseDir,{pid=process.pid}={}){
  const paths=endpointPaths(baseDir),current=readJson(paths.state);
  if(current?.active===true&&Number(current.pid)!==Number(pid))return false;
  try{fs.rmSync(paths.state,{force:true});}catch{}
  if(fs.existsSync(path.dirname(paths.extension)))try{writeJsonAtomic(paths.extension,inactiveRecord());}catch{}
  return true;
}
function readRuntimeEndpoint(file){
  let raw;try{raw=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw new Error(`runtime_endpoint_unavailable:${file}`);}
  const port=validPort(raw?.port);if(raw?.active!==true||raw?.host!==RUNTIME_HOST||!port)throw new Error(`runtime_endpoint_inactive:${file}`);
  return {schemaVersion:Number(raw.schemaVersion)||RUNTIME_ENDPOINT_VERSION,active:true,host:RUNTIME_HOST,port,wsUrl:`ws://${RUNTIME_HOST}:${port}`,pid:raw.pid??null,startedAt:raw.startedAt||null};
}

module.exports={RUNTIME_ENDPOINT_VERSION,RUNTIME_HOST,RUNTIME_ENDPOINT_FILENAME,RUNTIME_LOCK_FILENAME,validPort,endpointPaths,endpointRecord,inactiveRecord,processAlive,readJson,writeJsonAtomic,lockAgeMs,acquireRuntimeLock,releaseRuntimeLock,assertRuntimeOwnershipAvailable,publishRuntimeEndpoint,clearRuntimeEndpoint,readRuntimeEndpoint};
