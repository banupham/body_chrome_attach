'use strict';

const os=require('node:os');
const {execFileSync}=require('node:child_process');

const VPN_NAME_PATTERN=/(^|\b)(vpn|tun|tap|wireguard|tailscale|zerotier|hamachi|openvpn|nord|proton|wg\d*)($|\b)/i;
const PROXY_ENV_KEYS=['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'];

class DeviceNetworkProbe{
  constructor({env=process.env,networkInterfaces=()=>os.networkInterfaces(),platform=process.platform,exec=execFileSync}={}){this.env=env||{};this.networkInterfaces=networkInterfaces;this.platform=platform;this.exec=exec;}
  _windowsSystemProxy(){
    if(this.platform!=='win32')return {available:false,detected:false,sources:[]};const sources=[];let detected=false,available=false;
    try{const out=String(this.exec('reg',['query','HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings','/v','ProxyEnable'],{encoding:'utf8',timeout:1200,windowsHide:true})||'');available=true;if(/ProxyEnable\s+REG_DWORD\s+0x1/i.test(out)){detected=true;sources.push('wininet');}}catch{}
    try{const out=String(this.exec('netsh',['winhttp','show','proxy'],{encoding:'utf8',timeout:1200,windowsHide:true})||'');available=true;if(out&&!/Direct access \(no proxy server\)/i.test(out)&&/(Proxy Server|Proxy Server\(s\)|Current WinHTTP proxy)/i.test(out)){detected=true;sources.push('winhttp');}}catch{}
    return {available,detected,sources};
  }
  probe(){
    const proxyEnvKeys=PROXY_ENV_KEYS.filter(key=>String(this.env[key]||'').trim().length>0),interfaces=[];let vpnInterfaceDetected=false;const vpnInterfaces=[];
    const rows=this.networkInterfaces()||{};for(const [name,entries] of Object.entries(rows)){const external=(entries||[]).filter(entry=>entry&&entry.internal!==true);if(!external.length)continue;const families=[...new Set(external.map(entry=>String(entry.family||'unknown')))];interfaces.push({name,families});if(VPN_NAME_PATTERN.test(name)){vpnInterfaceDetected=true;vpnInterfaces.push(name);}}
    const systemProxy=this._windowsSystemProxy();
    return {observedAt:new Date().toISOString(),proxyEnvDetected:proxyEnvKeys.length>0,proxyEnvKeys,systemProxyDetected:systemProxy.detected,systemProxyAvailable:systemProxy.available,systemProxySources:systemProxy.sources,vpnInterfaceDetected,vpnInterfaces,activeInterfaces:interfaces};
  }
}
module.exports={DeviceNetworkProbe,VPN_NAME_PATTERN,PROXY_ENV_KEYS};
