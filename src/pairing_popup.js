'use strict';

const form=document.getElementById('form');
const code=document.getElementById('code');
const submit=document.getElementById('submit');
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
    if(state.paired){
      setStatus('Đã ghép nối an toàn với Company Runtime.','ok');
      form.hidden=true;
      hint.textContent='Extension đã có token ghép nối cục bộ.';
      if(pollTimer){clearInterval(pollTimer);pollTimer=null;}
      return state;
    }
    form.hidden=false;
    setStatus(state.connected?'Đang kết nối nhưng chưa ghép nối.':'Chưa ghép nối. Hãy mở pairing window ở daemon.','muted');
    return state;
  }catch(error){
    setStatus(`Không đọc được trạng thái: ${String(error?.message||error)}`,'bad');
    return null;
  }
}

form.addEventListener('submit',async event=>{
  event.preventDefault();
  submit.disabled=true;
  try{
    await send({action:'body.pair',code:code.value});
    setStatus('Đã gửi mã. Đang chờ daemon xác nhận…','muted');
    if(pollTimer)clearInterval(pollTimer);
    pollTimer=setInterval(refresh,700);
    await refresh();
  }catch(error){
    setStatus(`Ghép nối thất bại: ${String(error?.message||error)}`,'bad');
  }finally{
    submit.disabled=false;
  }
});

refresh();
