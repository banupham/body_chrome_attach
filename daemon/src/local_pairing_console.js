'use strict';

function pairingConsoleCommand(auth,line,{disconnectExtension=()=>false}={}){
  const text=String(line||'').trim();
  const [cmd,action='status',arg]=text.split(/\s+/);
  if(cmd!=='pair')return {handled:false,result:null};
  if(!auth)throw new Error('local_auth_required');

  if(action==='status')return {handled:true,result:{...auth.status(),paired:pairedList(auth)}};
  if(action==='list')return {handled:true,result:pairedList(auth)};
  if(action==='close')return {handled:true,result:auth.closePairingWindow()};
  if(action==='forget'){
    const extensionId=String(arg||'').trim();
    if(!extensionId)throw new Error('pair_forget_extension_id_required');
    const forgotten=auth.forgetExtension(extensionId);
    let disconnected=false;
    if(forgotten)disconnected=disconnectExtension(extensionId)===true;
    return {handled:true,result:{extensionId,forgotten,disconnected}};
  }
  if(action==='open')throw new Error('pair_open_removed_pairing_is_automatic');
  throw new Error('pair_usage: pair status | pair list | pair close | pair forget <extensionId>');
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
