'use strict';

let server;
try{
  server=require('./server');
}catch(error){
  console.error('[FATAL_BODY_BOOTSTRAP]',String(error?.stack||error?.message||error));
  throw error;
}

let transportFailureHandled=false;
server.wss.on('error',error=>{
  if(transportFailureHandled)return;
  transportFailureHandled=true;
  console.error('[FATAL_TRANSPORT]',String(error?.stack||error?.message||error));
  try{server.flushStores();}catch{}
  try{server.clearEndpoint();}catch{}
  process.exitCode=1;
  setImmediate(()=>process.exit(1));
});

function processAlive(pid){
  const value=Number(pid);
  if(!Number.isInteger(value)||value<=0)return false;
  try{process.kill(value,0);return true;}catch(error){return error?.code==='EPERM';}
}

const desktopParentPid=Number(process.env.BODY_DESKTOP_PARENT_PID||0);
let parentWatch=null,parentLossHandled=false;
if(Number.isInteger(desktopParentPid)&&desktopParentPid>0&&desktopParentPid!==process.pid){
  parentWatch=setInterval(()=>{
    if(parentLossHandled||processAlive(desktopParentPid))return;
    parentLossHandled=true;
    console.error(`[DESKTOP_PARENT_LOST] pid=${desktopParentPid}; stopping BODY core worker.`);
    try{server.flushStores();}catch{}
    try{server.clearEndpoint();}catch{}
    process.exitCode=0;
    setImmediate(()=>process.exit(0));
  },1000);
  parentWatch.unref?.();
}
process.once('exit',()=>{if(parentWatch)clearInterval(parentWatch);});

console.log('BODY Core mode: Guardian is a separate external authority; Brain CDP is fail-closed without an external grant.');
module.exports={...server,processAlive};
