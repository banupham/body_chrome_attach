'use strict';

const fs=require('node:fs');
const path=require('node:path');

const RUNTIME_ENDPOINT_VERSION=1;
const RUNTIME_HOST='127.0.0.1';
const RUNTIME_ENDPOINT_FILENAME='runtime-endpoint.json';

function validPort(value){const port=Number(value);return Number.isInteger(port)&&port>=1&&port<=65535?port:null;}
function endpointPaths(baseDir){return {state:path.join(baseDir,'state',RUNTIME_ENDPOINT_FILENAME),extension:path.join(baseDir,'..','dist',RUNTIME_ENDPOINT_FILENAME)};}
function endpointRecord(port,{pid=process.pid,now=()=>Date.now()}={}){
  const normalized=validPort(port);if(!normalized)throw new Error('runtime_endpoint_port_invalid');
  return {schemaVersion:RUNTIME_ENDPOINT_VERSION,active:true,host:RUNTIME_HOST,port:normalized,wsUrl:`ws://${RUNTIME_HOST}:${normalized}`,pid:Number(pid)||null,startedAt:new Date(now()).toISOString()};
}
function inactiveRecord(){return {schemaVersion:RUNTIME_ENDPOINT_VERSION,active:false,host:RUNTIME_HOST,port:null,wsUrl:null};}
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
function publishRuntimeEndpoint(baseDir,port,options={}){
  const record=endpointRecord(port,options),paths=endpointPaths(baseDir);
  writeJsonAtomic(paths.state,record);
  if(fs.existsSync(path.dirname(paths.extension)))writeJsonAtomic(paths.extension,{schemaVersion:record.schemaVersion,active:true,host:record.host,port:record.port,wsUrl:record.wsUrl,startedAt:record.startedAt});
  return record;
}
function clearRuntimeEndpoint(baseDir){
  const paths=endpointPaths(baseDir);
  try{fs.rmSync(paths.state,{force:true});}catch{}
  if(fs.existsSync(path.dirname(paths.extension)))try{writeJsonAtomic(paths.extension,inactiveRecord());}catch{}
}
function readRuntimeEndpoint(file){
  let raw;try{raw=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw new Error(`runtime_endpoint_unavailable:${file}`);}
  const port=validPort(raw?.port);if(raw?.active!==true||raw?.host!==RUNTIME_HOST||!port)throw new Error(`runtime_endpoint_inactive:${file}`);
  return {schemaVersion:Number(raw.schemaVersion)||RUNTIME_ENDPOINT_VERSION,active:true,host:RUNTIME_HOST,port,wsUrl:`ws://${RUNTIME_HOST}:${port}`,pid:raw.pid??null,startedAt:raw.startedAt||null};
}

module.exports={RUNTIME_ENDPOINT_VERSION,RUNTIME_HOST,RUNTIME_ENDPOINT_FILENAME,validPort,endpointPaths,endpointRecord,inactiveRecord,writeJsonAtomic,publishRuntimeEndpoint,clearRuntimeEndpoint,readRuntimeEndpoint};
