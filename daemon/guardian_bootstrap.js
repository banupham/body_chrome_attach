'use strict';

const server=require('./server');
const {ProtectionSupervisor}=require('./src/protection_supervisor');

const protection=new ProtectionSupervisor(server.runtime).start();
server.runtime.protection=protection;
process.once('exit',()=>{try{protection.stop();}catch{}});

console.log(`Protection Guardian: ${JSON.stringify(protection.status().policy)}`);

module.exports={...server,protection};
