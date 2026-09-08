'use strict';

let server;
try {
  server = require('./server');
} catch (error) {
  console.error('[FATAL_BOOTSTRAP]', String(error?.stack || error?.message || error));
  throw error;
}

const {ProtectionSupervisor}=require('./src/protection_supervisor');

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

const protection=new ProtectionSupervisor(server.runtime).start();
server.runtime.protection=protection;
process.once('exit',()=>{try{protection.stop();}catch{}});

console.log(`Protection Guardian: ${JSON.stringify(protection.status().policy)}`);

module.exports={...server,protection};
