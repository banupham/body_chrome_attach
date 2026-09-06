'use strict';

const reset=document.getElementById('reset');
const statusBox=document.getElementById('status');
const hint=document.getElementById('hint');
let pollTimer=null;

function setStatus(text,kind='muted'){
  statusBox.textContent=text;
  statusBox.className=`status ${kind}`;
}

async function send(message){
  const response=await chrome.runtime.sendMessage(message);
  if(!response?.ok)throw new Error(response?.error||'extension_message_failed');
  return response.result;
}

async function refresh(){
  try{
    const state=await send({action:'body.pairingStatus'});
    if(state.paired&&state.connected){
      reset.hidden=true;
      setStatus('Đã tự động ghép nối và đang kết nối với Company Runtime.','ok');
      hint.textContent='Không cần nhập mã. Kết nối được duy trì bằng token cục bộ.';
    }else if(state.paired){
      reset.hidden=false;
      setStatus('Đã có token nhưng hiện chưa kết nối được.','bad');
      hint.textContent='Bạn có thể đặt lại token; Extension sẽ tự ghép nối lại khi daemon khả dụng.';
    }else{
      reset.hidden=true;
      setStatus('Đang tự động ghép nối với Company Runtime…','muted');
      hint.textContent='Không cần nhập mã. Hãy đảm bảo daemon đang chạy trên máy này.';
    }
    return state;
  }catch(error){
    setStatus(`Không đọc được trạng thái: ${String(error?.message||error)}`,'bad');
    return null;
  }
}

reset.addEventListener('click',async()=>{
  if(!confirm('Đặt lại token kết nối cục bộ? Extension sẽ tự ghép nối lại khi daemon khả dụng.'))return;
  reset.disabled=true;
  try{
    await send({action:'body.pairReset'});
    setStatus('Đã đặt lại token. Đang chờ tự động ghép nối lại…','muted');
    await refresh();
  }catch(error){
    setStatus(`Không thể đặt lại token: ${String(error?.message||error)}`,'bad');
  }finally{
    reset.disabled=false;
  }
});

refresh();
pollTimer=setInterval(refresh,1000);
window.addEventListener('unload',()=>{if(pollTimer)clearInterval(pollTimer);});
