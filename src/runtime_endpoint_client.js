'use strict';

const RUNTIME_ENDPOINT_RESOURCE='runtime-endpoint.json';
const RUNTIME_HOST='127.0.0.1';

function normalizeRuntimeEndpoint(raw){
  const port=Number(raw?.port);
  if(raw?.active!==true||raw?.host!==RUNTIME_HOST||!Number.isInteger(port)||port<1||port>65535)throw new Error('runtime_endpoint_unavailable');
  return {active:true,host:RUNTIME_HOST,port,wsUrl:`ws://${RUNTIME_HOST}:${port}`,startedAt:raw.startedAt||null};
}

async function resolveRuntimeEndpoint(chromeApi,{fetchImpl=globalThis.fetch,cacheBust=()=>Date.now()}={}){
  if(!chromeApi?.runtime?.getURL)throw new Error('runtime_endpoint_chrome_url_unavailable');
  if(typeof fetchImpl!=='function')throw new Error('runtime_endpoint_fetch_unavailable');
  const base=chromeApi.runtime.getURL(RUNTIME_ENDPOINT_RESOURCE),separator=base.includes('?')?'&':'?';
  const response=await fetchImpl(`${base}${separator}v=${encodeURIComponent(String(cacheBust()))}`,{cache:'no-store'});
  if(!response?.ok)throw new Error(`runtime_endpoint_fetch_failed:${response?.status??'unknown'}`);
  return normalizeRuntimeEndpoint(await response.json());
}

module.exports={RUNTIME_ENDPOINT_RESOURCE,RUNTIME_HOST,normalizeRuntimeEndpoint,resolveRuntimeEndpoint};
