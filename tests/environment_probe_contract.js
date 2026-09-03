'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {proxyObservation,publicIpObservation,environmentProbe,endpointUrl}=require('../src/environment_probe');

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

  const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'..','manifest.json'),'utf8'));assert.ok(manifest.permissions.includes('proxy'),'Guardian requires read-only Chrome proxy observation permission');
  const probeSource=fs.readFileSync(path.join(__dirname,'..','src','environment_probe.js'),'utf8');assert.ok(probeSource.includes('proxy.settings.get'));assert.equal(/proxy\.settings\.(set|clear)/.test(probeSource),false,'Guardian must never mutate Chrome proxy settings');
  const deviceSource=fs.readFileSync(path.join(__dirname,'..','daemon','src','device_network_probe.js'),'utf8');assert.ok(deviceSource.includes("'reg',['query'"));assert.ok(deviceSource.includes("'netsh',['winhttp','show','proxy']"));for(const forbidden of ['set proxy','reset proxy','route add','route delete','ipconfig /flushdns'])assert.equal(deviceSource.toLowerCase().includes(forbidden),false,`Device probe mutation forbidden: ${forbidden}`);
  const content=fs.readFileSync(path.join(__dirname,'..','src','virtual_cursor_content.js'),'utf8');assert.ok(content.includes('body.environmentObservation'));assert.equal(content.includes('navigator.webdriver ='),false);
  console.log('environment_probe_contract: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
