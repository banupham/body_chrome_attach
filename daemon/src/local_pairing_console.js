'use strict';

function pairingConsoleCommand(auth,line){
  const text=String(line||'').trim();
  const [cmd,action='status',arg]=text.split(/\s+/);
  if(cmd!=='pair')return {handled:false,result:null};
  if(!auth)throw new Error('local_auth_required');

  if(action==='open'){
    const seconds=arg===undefined?120:Number(arg);
    if(!Number.isFinite(seconds)||seconds<30||seconds>300)throw new Error('pair_open_seconds_must_be_30_to_300');
    return {handled:true,result:auth.openPairingWindow({ttlMs:Math.round(seconds*1000)})};
  }
  if(action==='status')return {handled:true,result:{...auth.status(),paired:pairedList(auth)}};
  if(action==='list')return {handled:true,result:pairedList(auth)};
  if(action==='close')return {handled:true,result:auth.closePairingWindow()};
  if(action==='forget'){
    const extensionId=String(arg||'').trim();
    if(!extensionId)throw new Error('pair_forget_extension_id_required');
    return {handled:true,result:{extensionId,forgotten:auth.forgetExtension(extensionId)}};
  }
  throw new Error('pair_usage: pair open [30-300 seconds] | pair status | pair list | pair close | pair forget <extensionId>');
}

function pairedList(auth){
  return Object.entries(auth?.extensions||{}).map(([extensionId,record])=>({
    extensionId,
    runtimeExtensionId:record.runtimeExtensionId||null,
    browserInstanceId:record.browserInstanceId||null,
    pairedAt:record.pairedAt||null
  })).sort((a,b)=>a.extensionId.localeCompare(b.extensionId));
}

module.exports={pairingConsoleCommand,pairedList};
