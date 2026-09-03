'use strict';

function ipLike(value){const text=String(value||'').trim();return text.length>2&&text.length<=64&&/^[0-9a-fA-F:.]+$/.test(text)&&(text.includes('.')||text.includes(':'));}
function endpointUrl(value){const url=new URL(String(value||''));if(url.protocol!=='https:')throw new Error('public_ip_endpoint_https_required');return url;}

async function proxyObservation(chromeApi){
  if(!chromeApi?.proxy?.settings?.get)return {available:false,detected:null,mode:'unavailable',levelOfControl:null};
  try{
    const details=await chromeApi.proxy.settings.get({incognito:false});const value=details?.value||{},mode=String(value.mode||'unknown');
    const fixed=mode==='fixed_servers',pac=mode==='pac_script',autoDetect=mode==='auto_detect';
    return {available:true,detected:fixed||pac,mode,autoDetect,levelOfControl:details?.levelOfControl||null,rulesConfigured:Boolean(value.rules),pacConfigured:Boolean(value.pacScript)};
  }catch(error){return {available:false,detected:null,mode:'error',levelOfControl:null,error:String(error?.message||error)};}
}

async function pageEnvironmentObservation(chromeApi,tabId){
  try{const response=await chromeApi.tabs.sendMessage(Number(tabId),{action:'body.environmentObservation'});if(response?.ok&&response.result)return response.result;}catch(error){return {available:false,error:String(error?.message||error)};}
  return {available:false,error:'environment_observation_unavailable'};
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

async function environmentProbe(chromeApi,tabId,{publicIpEndpoint='https://api.ipify.org?format=json',fetchImpl=globalThis.fetch?.bind(globalThis),timeoutMs=5000}={}){
  const [pageEnvironment,proxy,publicEgress]=await Promise.all([pageEnvironmentObservation(chromeApi,tabId),proxyObservation(chromeApi),publicIpObservation(fetchImpl,publicIpEndpoint,timeoutMs)]);
  return {tabId:Number(tabId),observedAt:new Date().toISOString(),pageEnvironment,proxy,publicEgress};
}

module.exports={ipLike,endpointUrl,proxyObservation,pageEnvironmentObservation,publicIpObservation,environmentProbe};
