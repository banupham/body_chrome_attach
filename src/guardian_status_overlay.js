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
  Object.assign(host.style,{position:'fixed',top:'8px',right:'8px',zIndex:'2147483647',pointerEvents:'none',margin:'0',padding:'0'});
  const shadow=host.attachShadow({mode:'closed'});
  const wrap=documentRef.createElement('div');
  wrap.innerHTML='<span class="dot"></span><span class="label">ĐANG KIỂM TRA</span><span class="detail">Đang lấy trạng thái Guardian</span>';
  const style=documentRef.createElement('style');
  style.textContent=`
    :host{all:initial}
    div{box-sizing:border-box;display:grid;grid-template-columns:7px auto;grid-template-areas:"dot label" ". detail";column-gap:5px;row-gap:1px;min-width:118px;max-width:165px;padding:5px 7px;border:1px solid rgba(255,255,255,.12);border-radius:7px;background:rgba(17,24,39,.30);box-shadow:0 3px 9px rgba(0,0,0,.14);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:rgba(249,250,251,.94);backdrop-filter:blur(3px)}
    .dot{grid-area:dot;width:6px;height:6px;margin-top:3px;border-radius:999px;background:#f59e0b;box-shadow:0 0 0 2px rgba(245,158,11,.10)}
    .label{grid-area:label;font-size:10px;font-weight:800;line-height:12px;letter-spacing:.025em;white-space:nowrap}
    .detail{grid-area:detail;font-size:8px;line-height:10px;color:rgba(203,213,225,.82);white-space:normal}
    div[data-state="READY"]{border-color:rgba(34,197,94,.28)}
    div[data-state="READY"] .dot{background:#22c55e;box-shadow:0 0 0 2px rgba(34,197,94,.10)}
    div[data-state="BLOCKED"]{border-color:rgba(239,68,68,.32)}
    div[data-state="BLOCKED"] .dot{background:#ef4444;box-shadow:0 0 0 2px rgba(239,68,68,.10)}
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
