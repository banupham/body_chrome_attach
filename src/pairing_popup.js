'use strict';

const reset=document.getElementById('reset');
const statusBox=document.getElementById('status');
const hint=document.getElementById('hint');
let pollTimer=null;

const reasonText={
  protection_starting:'Đang khởi tạo kiểm tra.',
  environment_pending:'Đang kiểm tra môi trường.',
  bot_check_pending:'Đang kiểm tra bot/controller.',
  browser_offline:'Browser chưa kết nối.',
  browser_not_found:'Không tìm thấy Browser Runtime.',
  EXTERNAL_CONTROLLER_CONFLICT:'Phát hiện trình điều khiển ngoài BODY.',
  BOT_BEHAVIOR_HIGH_CONFIDENCE:'Phát hiện hành vi tự động.',
  CONTROLLER_BEHAVIOR_CORRELATED:'Phát hiện controller và hành vi tự động.'
};

function setStatus(text,kind='checking'){
  statusBox.textContent=text;
  statusBox.className=`status ${kind}`;
}

function detailFor(readiness){
  const reason=String(readiness?.reason||'');
  return reasonText[reason]||'Không đủ điều kiện hoạt động.';
}

function render(state){
  if(!state?.connected){
    reset.hidden=!state?.paired;
    setStatus('BỊ CHẶN','blocked');
    hint.textContent='Daemon chưa kết nối.';
    return;
  }
  reset.hidden=true;
  const readiness=state.readiness||null;
  if(readiness?.state==='READY'){
    setStatus('SẴN SÀNG','ready');
    hint.textContent='Environment và bot check đã đạt.';
    return;
  }
  if(readiness?.state==='BLOCKED'){
    setStatus('BỊ CHẶN','blocked');
    hint.textContent=detailFor(readiness);
    return;
  }
  setStatus('ĐANG KIỂM TRA','checking');
  hint.textContent=readiness?detailFor(readiness):'Đang lấy trạng thái từ Daemon.';
}

async function send(message){
  const response=await chrome.runtime.sendMessage(message);
  if(!response?.ok)throw new Error(response?.error||'extension_message_failed');
  return response.result;
}

async function refresh(){
  try{
    const state=await send({action:'body.pairingStatus'});
    render(state);
    return state;
  }catch(error){
    reset.hidden=true;
    setStatus('BỊ CHẶN','blocked');
    hint.textContent='Không đọc được trạng thái Extension.';
    return null;
  }
}

reset.addEventListener('click',async()=>{
  if(!confirm('Đặt lại token kết nối cục bộ?'))return;
  reset.disabled=true;
  try{
    await send({action:'body.pairReset'});
    setStatus('ĐANG KIỂM TRA','checking');
    hint.textContent='Đang tự kết nối lại.';
    await refresh();
  }catch(error){
    setStatus('BỊ CHẶN','blocked');
    hint.textContent='Không thể đặt lại kết nối.';
  }finally{
    reset.disabled=false;
  }
});

refresh();
pollTimer=setInterval(refresh,750);
window.addEventListener('unload',()=>{if(pollTimer)clearInterval(pollTimer);});
