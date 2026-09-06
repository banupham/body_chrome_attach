'use strict';

const {
  deepEnvironmentProbe,
  collectRealmSnapshot,
  extensionSignals,
  analyzeDeepSnapshots
}=require('./deep_environment_probe');

function ipLike(value){const text=String(value||'').trim();return text.length>2&&text.length<=64&&/^[0-9a-fA-F:.]+$/.test(text)&&(text.includes('.')||text.includes(':'));}
function endpointUrl(value){const url=new URL(String(value||''));if(url.protocol!=='https:')throw new Error('public_ip_endpoint_https_required');return url;}

function collectPageEnvironmentSnapshot(){
  const s=globalThis.screen||{};
  let timezone='unknown';try{timezone=Intl.DateTimeFormat().resolvedOptions().timeZone||'unknown';}catch{}
  return {
    available:true,
    userAgent:String(navigator.userAgent||''),
    platform:String(navigator.platform||''),
    language:String(navigator.language||''),
    languages:Array.isArray(navigator.languages)?navigator.languages.map(String):[],
    hardwareConcurrency:Number(navigator.hardwareConcurrency||0),
    deviceMemory:Number(navigator.deviceMemory||0),
    maxTouchPoints:Number(navigator.maxTouchPoints||0),
    webdriver:navigator.webdriver===true,
    timezone,
    screen:{
      width:Number(s.width||0),height:Number(s.height||0),
      availWidth:Number(s.availWidth||0),availHeight:Number(s.availHeight||0),
      colorDepth:Number(s.colorDepth||0),pixelDepth:Number(s.pixelDepth||0)
    },
    devicePixelRatio:Number(globalThis.devicePixelRatio||1)
  };
}

async function pageEnvironmentObservation(chromeApi,tabId){
  let messageError=null;
  try{
    const response=await chromeApi.tabs.sendMessage(Number(tabId),{action:'body.environmentObservation'});
    if(response?.ok&&response.result)return response.result;
  }catch(error){messageError=String(error?.message||error);}
  if(chromeApi?.scripting?.executeScript){
    try{
      const injected=await chromeApi.scripting.executeScript({target:{tabId:Number(tabId)},world:'MAIN',func:collectPageEnvironmentSnapshot});
      const result=injected?.[0]?.result;
      if(result?.available===true)return {...result,source:'scripting_fallback'};
    }catch(error){
      const fallbackError=String(error?.message||error);
      return {available:false,error:messageError?`${messageError}; scripting_fallback:${fallbackError}`:`scripting_fallback:${fallbackError}`};
    }
  }
  return {available:false,error:messageError||'environment_observation_unavailable'};
}

async function proxyObservation(chromeApi){
  if(!chromeApi?.proxy?.settings?.get)return {available:false,detected:null,mode:'unavailable',levelOfControl:null};
  try{
    const details=await chromeApi.proxy.settings.get({incognito:false});const value=details?.value||{},mode=String(value.mode||'unknown');
    const fixed=mode==='fixed_servers',pac=mode==='pac_script',autoDetect=mode==='auto_detect';
    return {available:true,detected:fixed||pac,mode,autoDetect,levelOfControl:details?.levelOfControl||null,rulesConfigured:Boolean(value.rules),pacConfigured:Boolean(value.pacScript)};
  }catch(error){return {available:false,detected:null,mode:'error',levelOfControl:null,error:String(error?.message||error)};}
}

async function publicIpObservation(fetchImpl,endpoint,timeoutMs=5000){
  if(typeof fetchImpl!=='function')return {available:false,ip:null,error:'fetch_unavailable'};
  let url;try{url=endpointUrl(endpoint);}catch(error){return {available:false,ip:null,error:String(error?.message||error)};}
  const controller=typeof AbortController!=='undefined'?new AbortController():null;const timer=controller?setTimeout(()=>controller.abort(),Math.max(500,Number(timeoutMs)||5000)):null;
  try{
    const response=await fetchImpl(url.href,{method:'GET',cache:'no-store',credentials:'omit',redirect:'follow',signal:controller?.signal});
    if(!response.ok)throw new Error(`public_ip_http_${response.status}`);
    const text=await response.text();let candidate=text.trim();try{const parsed=JSON.parse(text);candidate=String(parsed.ip||parsed.address||parsed.query||'').trim();}catch{}
    if(!ipLike(candidate))throw new Error('public_ip_response_invalid');
    return {available:true,ip:candidate,provider:url.hostname};
  }catch(error){return {available:false,ip:null,provider:url.hostname,error:String(error?.message||error)};}finally{if(timer)clearTimeout(timer);}
}

async function stableHash(value){
  const text=JSON.stringify(value);
  try{
    const bytes=new TextEncoder().encode(text),digest=await crypto.subtle.digest('SHA-256',bytes);
    return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
  }catch{
    let h=0x811c9dc5;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,0x01000193);}return (h>>>0).toString(16).padStart(8,'0');
  }
}

function scriptAccessDenied(error){
  const text=String(error?.message||error||'').toLowerCase();
  return text.includes('cannot access')||text.includes('cannot script')||text.includes('missing host permission')||text.includes('extensions gallery cannot be scripted')||text.includes('chrome://')||text.includes('edge://');
}

async function deepEnvironmentProbeResilient(chromeApi,tabId,{timeoutMs=5000}={}){
  const first=await deepEnvironmentProbe(chromeApi,tabId,{timeoutMs});
  if(first?.available===true||first?.error!=='deep_probe_http_tab_required')return first;
  const id=Number(tabId);if(!Number.isInteger(id)||!chromeApi?.scripting?.executeScript)return first;
  const work=(async()=>{
    try{
      const extPromise=extensionSignals(chromeApi);
      const mainPromise=chromeApi.scripting.executeScript({target:{tabId:id},world:'MAIN',func:collectRealmSnapshot,args:[{fullContext:true,canvasRepeats:3,audioRepeats:1}]});
      const isoPromise=chromeApi.scripting.executeScript({target:{tabId:id},world:'ISOLATED',func:collectRealmSnapshot,args:[{fullContext:false,canvasRepeats:2,audioRepeats:1}]});
      const [mr,ir,ext]=await Promise.all([mainPromise,isoPromise,extPromise]),main=mr?.[0]?.result,isolated=ir?.[0]?.result;
      if(!main||!isolated)return {available:false,error:'deep_probe_realm_result_missing'};
      const analysis=analyzeDeepSnapshots(main,isolated,ext),stable={
        platform:main.navigator?.platform||null,
        languages:main.navigator?.languages||[],
        hardwareConcurrency:main.navigator?.hardwareConcurrency??null,
        deviceMemory:main.navigator?.deviceMemory??null,
        timeZone:main.intl?.timeZone||null,
        screen:main.screen?{width:main.screen.width,height:main.screen.height,devicePixelRatio:main.screen.devicePixelRatio}:null,
        webglRenderer:main.webgl?.primary?.unmaskedRenderer||main.webgl?.primary?.renderer||null,
        canvasHash:main.canvas?.samples?.[0]?.dataUrlHash||null,
        audioHash:main.audio?.primary?.hash||null,
        systemOs:ext.runtimePlatform?.os||null,
        systemCpuCount:ext.systemCpu?.numOfProcessors??null,
        systemMemoryCapacity:ext.systemMemory?.capacity??null
      };
      return {...analysis,stableHash:await stableHash(stable),metadataUrlBypassed:true,privacy:{rawSamplesPersisted:false,rawWebRtcAddressCaptured:false,proxyModified:false,privacySettingsModified:false}};
    }catch(error){return {available:false,error:scriptAccessDenied(error)?'deep_probe_http_tab_required':String(error?.message||error)};}
  })();
  const bounded=Math.max(1000,Math.min(9000,Number(timeoutMs)||5000));
  return Promise.race([work,new Promise(resolve=>setTimeout(()=>resolve({available:false,error:'deep_probe_timeout'}),bounded))]);
}

async function environmentProbe(chromeApi,tabId,{publicIpEndpoint='https://api.ipify.org?format=json',fetchImpl=globalThis.fetch?.bind(globalThis),timeoutMs=5000}={}){
  const [pageEnvironment,proxy,publicEgress,deepFingerprint]=await Promise.all([
    pageEnvironmentObservation(chromeApi,tabId),
    proxyObservation(chromeApi),
    publicIpObservation(fetchImpl,publicIpEndpoint,timeoutMs),
    deepEnvironmentProbeResilient(chromeApi,tabId,{timeoutMs:Math.min(7000,Math.max(1500,Number(timeoutMs)||5000))})
  ]);
  return {tabId:Number(tabId),observedAt:new Date().toISOString(),pageEnvironment,proxy,publicEgress,deepFingerprint};
}

module.exports={ipLike,endpointUrl,collectPageEnvironmentSnapshot,pageEnvironmentObservation,proxyObservation,publicIpObservation,stableHash,scriptAccessDenied,deepEnvironmentProbeResilient,environmentProbe};
