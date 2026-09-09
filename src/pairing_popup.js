'use strict';

const reset=document.getElementById('reset');
const statusBox=document.getElementById('status');
const hint=document.getElementById('hint');
let pollTimer=null;

const reasonText={
  protection_starting:'Đang khởi tạo kiểm tra.',
  environment_pending:'Đang kiểm tra môi trường.',
  bot_check_pending:'Đang kiểm tra bot/controller.',
  controller_probe_unavailable:'Không xác minh được controller trên máy. Hệ thống sẽ tự kiểm tra lại.',
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

function diagnosticText(state){
  const browser=String(state?.browserInstanceId||'').trim();
  const shortBrowser=browser?browser.slice(0,13):'chưa có';
  const learning=state?.learningInput||{};
  const observed=Math.max(0,Number(learning.eventCount)||0);
  const forwarded=Math.max(0,Number(learning.forwardedEventCount)||0);
  const pending=Math.max(0,Number(learning.pendingEventCount)||0);
  const rawTab=state?.activeTabId;
  const tab=rawTab!==null&&rawTab!==undefined&&Number.isInteger(Number(rawTab))?Number(rawTab):null;
  const content=state?.contentScript?.ready===true?'CS:OK':`CS:${String(state?.contentScript?.reason||'WAIT').slice(0,22)}`;
  return `Browser ${shortBrowser} · Nhận ${observed} · Gửi ${forwarded} · Chờ ${pending}${tab===null?'':` · Tab ${tab}`} · ${content}`;
}

function setHint(text,state){
  hint.textContent=`${text} ${diagnosticText(state)}`;
}

function extensionErrorText(error){
  const text=String(error?.message||error||'extension_unreachable').replace(/\s+/g,' ').trim();
  return text.length>80?`${text.slice(0,77)}...`:text;
}

function render(state){
  if(state?.extensionHealth?.state==='ERROR'){
    reset.hidden=true;
    setStatus('LỖI EXTENSION','blocked');
    setHint(`Service worker lỗi: ${String(state.extensionHealth.reason||'không xác định')}.`,state);
    return;
  }
  if(!state?.connected){
    reset.hidden=!state?.paired;
    setStatus('BỊ CHẶN','blocked');
    setHint('Daemon chưa kết nối.',state);
    return;
  }
  reset.hidden=true;
  const readiness=state.readiness||null;
  if(readiness?.state==='READY'){
    setStatus('SẴN SÀNG','ready');
    setHint('Environment và bot check đã đạt.',state);
    return;
  }
  if(readiness?.state==='BLOCKED'){
    setStatus('BỊ CHẶN','blocked');
    setHint(detailFor(readiness),state);
    return;
  }
  setStatus('ĐANG KIỂM TRA','checking');
  setHint(readiness?detailFor(readiness):'Đang lấy trạng thái từ Daemon.',state);
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
    setStatus('LỖI EXTENSION','blocked');
    hint.textContent=`Service worker không phản hồi: ${extensionErrorText(error)}`;
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
    setStatus('LỖI EXTENSION','blocked');
    hint.textContent=`Không thể đặt lại kết nối: ${extensionErrorText(error)}`;
  }finally{
    reset.disabled=false;
  }
});

refresh();
pollTimer=setInterval(refresh,750);
window.addEventListener('unload',()=>{if(pollTimer)clearInterval(pollTimer);});