'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {proxyObservation,publicIpObservation,environmentProbe,endpointUrl,pageEnvironmentObservation,deepEnvironmentProbeResilient}=require('../src/environment_probe');

function deepSnapshot(){return {context:{chromeObject:true},navigator:{userAgent:'Mozilla/5.0 Windows Chrome/140',platform:'Win32',languages:['en-US'],hardwareConcurrency:8,deviceMemory:8,webdriver:false},intl:{timeZone:'UTC'},screen:{width:1920,height:1080,devicePixelRatio:1},canvas:{samples:[{dataUrlHash:'a',pixelHash:'b',textWidth:1},{dataUrlHash:'a',pixelHash:'b',textWidth:1}]},webgl:{primary:{available:true,unmaskedVendor:'V',unmaskedRenderer:'R',maxTextureSize:4096,readPixelsHash:'h'},samples:[{available:true,readPixelsHash:'h'}]},audio:{primary:{available:true,hash:'x'},samples:[{available:true,hash:'x'}]},nativeIntegrity:{functionToString:{native:true,sourceHash:'1'},canvasToDataURL:{native:true,sourceHash:'2'},webglGetParameter:{native:true,sourceHash:'3'}},descriptors:{webdriver:{configurable:true,enumerable:true,hasGetter:true,hasSetter:false}},automationMarkers:[],iframe:{available:true,userAgent:'Mozilla/5.0 Windows Chrome/140',platform:'Win32',webdriver:false},worker:{available:true,userAgent:'Mozilla/5.0 Windows Chrome/140',platform:'Win32'}};}

(async()=>{
  const proxyChrome={proxy:{settings:{async get(){return {levelOfControl:'controlled_by_this_extension',value:{mode:'fixed_servers',rules:{singleProxy:{scheme:'http',host:'secret-proxy',port:8080}}}};}}}};
  const proxy=await proxyObservation(proxyChrome);assert.equal(proxy.available,true);assert.equal(proxy.detected,true);assert.equal(proxy.mode,'fixed_servers');assert.equal(JSON.stringify(proxy).includes('secret-proxy'),false);

  const direct=await proxyObservation({proxy:{settings:{async get(){return {value:{mode:'direct'}};}}}});assert.equal(direct.detected,false);assert.equal(direct.mode,'direct');
  assert.throws(()=>endpointUrl('http://example.com'),/https_required/);

  const ip=await publicIpObservation(async()=>({ok:true,status:200,async text(){return JSON.stringify({ip:'203.0.113.10'});}}),'https://example.com/ip',1000);assert.deepEqual({available:ip.available,ip:ip.ip,provider:ip.provider},{available:true,ip:'203.0.113.10',provider:'example.com'});
  const invalid=await publicIpObservation(async()=>({ok:true,status:200,async text(){return 'not-an-ip';}}),'https://example.com/ip',1000);assert.equal(invalid.available,false);

  const chromeApi={
    tabs:{async sendMessage(_tabId,message){assert.equal(message.action,'body.environmentObservation');return {ok:true,result:{available:true,userAgent:'ua',platform:'Win32',language:'en',languages:['en'],hardwareConcurrency:8,deviceMemory:8,maxTouchPoints:0,webdriver:false,timezone:'UTC',screen:{width:100,height:100},devicePixelRatio:1}};}},
    proxy:{settings:{async get(){return {value:{mode:'direct'}};}}}
  };
  const combined=await environmentProbe(chromeApi,7,{publicIpEndpoint:'https://example.com/ip',fetchImpl:async()=>({ok:true,status:200,async text(){return '198.51.100.5';}}),timeoutMs:1000});
  assert.equal(combined.tabId,7);assert.equal(combined.pageEnvironment.available,true);assert.equal(combined.proxy.detected,false);assert.equal(combined.publicEgress.ip,'198.51.100.5');

  const fallbackPage={
    tabs:{async sendMessage(){throw new Error('Could not establish connection. Receiving end does not exist.');}},
    scripting:{async executeScript(spec){assert.equal(spec.world,'MAIN');return [{result:{available:true,userAgent:'fallback-ua',platform:'Win32',language:'en',languages:['en'],hardwareConcurrency:8,deviceMemory:8,maxTouchPoints:0,webdriver:false,timezone:'UTC',screen:{width:1920,height:1080},devicePixelRatio:1}}];}}
  };
  const page=await pageEnvironmentObservation(fallbackPage,9);assert.equal(page.available,true);assert.equal(page.source,'scripting_fallback');assert.equal(page.userAgent,'fallback-ua');

  const masked={
    tabs:{async get(){return {id:11,url:'about:blank'};}},
    scripting:{async executeScript(spec){assert.ok(['MAIN','ISOLATED'].includes(spec.world));return [{result:deepSnapshot()}];}},
    runtime:{async getPlatformInfo(){return {os:'win'};}},
    system:{cpu:{async getInfo(){return {archName:'x86-64',numOfProcessors:8};}},memory:{async getInfo(){return {capacity:16*1073741824};}},display:{async getInfo(){return [{isPrimary:true,deviceScaleFactor:1,bounds:{width:1920,height:1080}}];}}},
    privacy:{network:{webRTCIPHandlingPolicy:{async get(){return {value:'default'};}}},websites:{doNotTrackEnabled:{async get(){return {value:false};}},referrersEnabled:{async get(){return {value:true};}}}}
  };
  const deep=await deepEnvironmentProbeResilient(masked,11,{timeoutMs:1000});assert.equal(deep.available,true);assert.equal(deep.metadataUrlBypassed,true);assert.equal(deep.highSuspicion,false);

  const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'..','manifest.json'),'utf8'));assert.ok(manifest.permissions.includes('proxy'),'Guardian requires read-only Chrome proxy observation permission');
  const probeSource=fs.readFileSync(path.join(__dirname,'..','src','environment_probe.js'),'utf8');assert.ok(probeSource.includes('proxy.settings.get'));assert.equal(/proxy\.settings\.(set|clear)/.test(probeSource),false,'Guardian must never mutate Chrome proxy settings');assert.ok(probeSource.includes('metadataUrlBypassed'));
  const deviceSource=fs.readFileSync(path.join(__dirname,'..','daemon','src','device_network_probe.js'),'utf8');assert.ok(deviceSource.includes("'reg',['query'"));assert.ok(deviceSource.includes("'netsh',['winhttp','show','proxy']"));for(const forbidden of ['set proxy','reset proxy','route add','route delete','ipconfig /flushdns'])assert.equal(deviceSource.toLowerCase().includes(forbidden),false,`Device probe mutation forbidden: ${forbidden}`);
  const content=fs.readFileSync(path.join(__dirname,'..','src','virtual_cursor_content.js'),'utf8');assert.ok(content.includes('body.environmentObservation'));assert.equal(content.includes('navigator.webdriver ='),false);
  console.log('environment_probe_contract: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
