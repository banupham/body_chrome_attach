'use strict';

const POLL_MS=1500;
const ROOT_ID='__body_guardian_status_overlay__';

const REASONS={
  protection_starting:'Đang khởi tạo kiểm tra',
  environment_pending:'Đang kiểm tra môi trường',
  bot_check_pending:'Đang kiểm tra bot/controller',
  browser_offline:'Daemon/Browser chưa kết nối',
  browser_not_found:'Không tìm thấy Browser Runtime',
  EXTERNAL_CONTROLLER_CONFLICT:'Phát hiện controller bên ngoài BODY',
  BOT_BEHAVIOR_HIGH_CONFIDENCE:'Phát hiện hành vi tự động',
  CONTROLLER_BEHAVIOR_CORRELATED:'Phát hiện controller + hành vi tự động'
};

function displayState(state){
  if(!state?.connected)return {state:'BLOCKED',label:'BỊ CHẶN',detail:'Daemon chưa kết nối'};
  const readiness=state.readiness||null;
  if(readiness?.state==='READY')return {state:'READY',label:'SẴN SÀNG',detail:'Environment + bot check đạt'};
  if(readiness?.state==='BLOCKED')return {state:'BLOCKED',label:'BỊ CHẶN',detail:REASONS[String(readiness.reason||'')]||'Không đủ điều kiện hoạt động'};
  return {state:'CHECKING',label:'ĐANG KIỂM TRA',detail:REASONS[String(readiness?.reason||'')]||'Đang lấy trạng thái Guardian'};
}

function installGuardianStatusOverlay({chromeApi=chrome,documentRef=document,setIntervalImpl=setInterval,clearIntervalImpl=clearInterval}={}){
  if(!chromeApi?.runtime||!documentRef)return {installed:false,uninstall(){}};
  if(documentRef.getElementById?.(ROOT_ID))return {installed:true,reused:true,uninstall(){}};

  const host=documentRef.createElement('div');
  host.id=ROOT_ID;
  host.setAttribute('aria-hidden','true');
  Object.assign(host.style,{position:'fixed',top:'12px',right:'12px',zIndex:'2147483647',pointerEvents:'none',margin:'0',padding:'0'});
  const shadow=host.attachShadow({mode:'closed'});
  const wrap=documentRef.createElement('div');
  wrap.innerHTML='<span class="dot"></span><span class="label">ĐANG KIỂM TRA</span><span class="detail">Đang lấy trạng thái Guardian</span>';
  const style=documentRef.createElement('style');
  style.textContent=`
    :host{all:initial}
    div{box-sizing:border-box;display:grid;grid-template-columns:10px auto;grid-template-areas:"dot label" ". detail";column-gap:8px;row-gap:2px;min-width:190px;max-width:280px;padding:9px 12px;border:1px solid rgba(255,255,255,.18);border-radius:10px;background:rgba(17,24,39,.94);box-shadow:0 6px 20px rgba(0,0,0,.24);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#f9fafb;backdrop-filter:blur(6px)}
    .dot{grid-area:dot;width:9px;height:9px;margin-top:5px;border-radius:999px;background:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.14)}
    .label{grid-area:label;font-size:12px;font-weight:800;line-height:18px;letter-spacing:.04em}
    .detail{grid-area:detail;font-size:10px;line-height:14px;color:#cbd5e1;white-space:normal}
    div[data-state="READY"]{border-color:rgba(34,197,94,.42)}
    div[data-state="READY"] .dot{background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.14)}
    div[data-state="BLOCKED"]{border-color:rgba(239,68,68,.48)}
    div[data-state="BLOCKED"] .dot{background:#ef4444;box-shadow:0 0 0 3px rgba(239,68,68,.14)}
  `;
  shadow.append(style,wrap);
  (documentRef.documentElement||documentRef.body)?.appendChild(host);

  let stopped=false,timer=null,inflight=false;
  const label=wrap.querySelector('.label'),detail=wrap.querySelector('.detail');
  function render(next){wrap.dataset.state=next.state;label.textContent=next.label;detail.textContent=next.detail;}
  async function refresh(){
    if(stopped||inflight)return;
    inflight=true;
    try{
      const response=await chromeApi.runtime.sendMessage({action:'body.pairingStatus'});
      render(displayState(response?.ok?response.result:null));
    }catch{render({state:'CHECKING',label:'ĐANG KIỂM TRA',detail:'Đang kết nối Extension'});}
    finally{inflight=false;}
  }
  refresh();
  timer=setIntervalImpl(refresh,POLL_MS);
  return {installed:true,refresh,status:()=>({state:wrap.dataset.state||'CHECKING'}),uninstall(){stopped=true;if(timer)clearIntervalImpl(timer);host.remove();}};
}

module.exports={POLL_MS,ROOT_ID,REASONS,displayState,installGuardianStatusOverlay};
