'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {LocalIdentityStore}=require('./src/local_identity');
const {BrowserManager}=require('./src/browser_manager');
const {EnvironmentGuardian}=require('./src/environment_guardian');
const {TaskManager}=require('./src/task_manager');

function tmp(name){return fs.mkdtempSync(path.join(os.tmpdir(),`${name}-`));}
function pageEnv(tag='a'){return {available:true,userAgent:`Chrome/${tag}`,platform:'Win32',language:'en-US',languages:['en-US','en'],hardwareConcurrency:8,deviceMemory:8,maxTouchPoints:0,webdriver:false,timezone:'Asia/Ho_Chi_Minh',screen:{width:1920,height:1080,availWidth:1920,availHeight:1040,colorDepth:24,pixelDepth:24},devicePixelRatio:1};}
function probe({ip='1.1.1.1',tag='a',proxy=false,proxyAvailable=true,autoDetect=false}={}){return {pageEnvironment:pageEnv(tag),proxy:{available:proxyAvailable,detected:proxy,mode:proxy?'fixed_servers':'direct',autoDetect},publicEgress:{available:Boolean(ip),ip,provider:'test.invalid'}};}
function deferredProbe(){return {pageEnvironment:{available:false,error:'Could not establish connection. Receiving end does not exist.'},proxy:{available:true,detected:false,mode:'system'},publicEgress:{available:true,ip:'1.1.1.1',provider:'test.invalid'},deepFingerprint:{available:false,error:'deep_probe_http_tab_required'}};}
function device({proxyEnv=false,systemProxy=false,vpn=false}={}){return {probe(){return {proxyEnvDetected:proxyEnv,proxyEnvKeys:proxyEnv?['HTTPS_PROXY']:[],systemProxyDetected:systemProxy,systemProxyAvailable:true,systemProxySources:systemProxy?['wininet']:[],vpnInterfaceDetected:vpn,vpnInterfaces:vpn?['WireGuard Tunnel']:[],activeInterfaces:[{name:'Ethernet',families:['IPv4']} ]};}};}
function setup({env={},responses={},deviceProbe=device(),tabsA=[1,2,3],tabsB=[4,5],now=()=>1000000}={}){
  const base=tmp('guardian');const identity=new LocalIdentityStore(base,{env:{BODY_COMPANY_ID:'company-test',BODY_DEVICE_ID:'device-test'}});
  identity.registerBrowser({browserInstanceId:'browser-a',extensionInstanceId:'ext-a',runtimeExtensionId:'runtime'});identity.registerBrowser({browserInstanceId:'browser-b',extensionInstanceId:'ext-b',runtimeExtensionId:'runtime'});
  const browsers=new BrowserManager(identity);
  const item=(browserInstanceId,extensionId,tabs)=>({companyId:'company-test',deviceId:'device-test',browserInstanceId,extensionInstanceId:extensionId,extensionId,runtimeExtensionId:'runtime',connectedAt:1,lastSeenAt:1,activeTabId:tabs[0],tabs:new Map(tabs.map((id,i)=>[id,{id,active:i===0,siteKey:'youtube.com'}]))});
  browsers.registerExtension(item('browser-a','ext-a',tabsA));browsers.registerExtension(item('browser-b','ext-b',tabsB));
  let calls=0;const requestExtension=async(extensionId,type)=>{assert.equal(type,'ENVIRONMENT_PROBE');calls++;if(!(extensionId in responses))throw new Error(`missing_probe:${extensionId}`);const value=responses[extensionId];return typeof value==='function'?value():value;};
  const guardian=new EnvironmentGuardian(base,browsers,{requestExtension,deviceProbe,env:{BODY_ENV_DIRECT_ONLY:'true',BODY_ENV_REQUIRE_UNIQUE_PUBLIC_IP:'true',BODY_ENV_REQUIRE_UNIQUE_SIGNATURE:'true',...env},now});
  return {base,identity,browsers,guardian,get calls(){return calls;}};
}

test('one Browser with many tabs is evaluated once and becomes eligible',async()=>{
  const ctx=setup({responses:{'ext-a':probe({ip:'1.1.1.1',tag:'a'}),'ext-b':probe({ip:'2.2.2.2',tag:'b'})}});
  const result=await ctx.guardian.probeBrowser('browser-a');
  assert.equal(ctx.calls,1);assert.equal(result.eligible,true);assert.equal(ctx.browsers.require('browser-a').state,'ACTIVE');assert.equal(ctx.browsers.require('browser-a').tabs.size,3);assert.equal(result.reasons.length,0);
});

test('Task assignment is fail-closed until Browser environment passes',()=>{
  const ctx=setup({responses:{}});const tasks=new TaskManager(ctx.base,ctx.browsers);
  assert.equal(ctx.browsers.require('browser-a').state,'ENV_CHECK');
  assert.throws(()=>tasks.create({taskId:'blocked',capability:'youtube.search',browserInstanceId:'browser-a',primaryTabId:1,tabIds:[1]}),/browser_not_eligible/);
});

test('two Browser Instances with the same public egress are both quarantined, not their tabs',async()=>{
  const ctx=setup({responses:{'ext-a':probe({ip:'9.9.9.9',tag:'a'}),'ext-b':probe({ip:'9.9.9.9',tag:'b'})}});
  await ctx.guardian.probeBrowser('browser-a');const second=await ctx.guardian.probeBrowser('browser-b');
  assert.equal(second.eligible,false);for(const id of ['browser-a','browser-b']){const browser=ctx.browsers.require(id);assert.equal(browser.state,'QUARANTINED');assert.ok(browser.environment.reasons.includes('DUPLICATE_PUBLIC_EGRESS'));}
});

test('two Browser Instances with distinct IP but the same environment signature are quarantined by uniqueness policy',async()=>{
  const ctx=setup({responses:{'ext-a':probe({ip:'1.1.1.1',tag:'same'}),'ext-b':probe({ip:'2.2.2.2',tag:'same'})}});
  await ctx.guardian.probeBrowser('browser-a');await ctx.guardian.probeBrowser('browser-b');
  for(const id of ['browser-a','browser-b'])assert.ok(ctx.browsers.require(id).environment.reasons.includes('DUPLICATE_ENVIRONMENT_SIGNATURE'));
});

test('distinct Browser environment signature and public egress remain independently eligible',async()=>{
  const ctx=setup({responses:{'ext-a':probe({ip:'1.1.1.1',tag:'a'}),'ext-b':probe({ip:'2.2.2.2',tag:'b'})}});
  await ctx.guardian.probeBrowser('browser-a');await ctx.guardian.probeBrowser('browser-b');
  assert.equal(ctx.browsers.require('browser-a').state,'ACTIVE');assert.equal(ctx.browsers.require('browser-b').state,'ACTIVE');
});

test('DIRECT_ONLY quarantines detected browser proxy, system proxy, proxy env or VPN tunnel',async()=>{
  for(const [name,options] of [['browserProxy',{response:probe({proxy:true})}],['systemProxy',{deviceProbe:device({systemProxy:true})}],['proxyEnv',{deviceProbe:device({proxyEnv:true})}],['vpn',{deviceProbe:device({vpn:true})}]]){
    const response=options.response||probe();const ctx=setup({responses:{'ext-a':response,'ext-b':probe({ip:'2.2.2.2',tag:'b'})},deviceProbe:options.deviceProbe||device()});const result=await ctx.guardian.probeBrowser('browser-a');assert.equal(result.eligible,false,name);assert.equal(ctx.browsers.require('browser-a').state,'QUARANTINED',name);
  }
});

test('when duplicate Browser goes offline, remaining Browser is re-evaluated without changing its tabs',async()=>{
  const ctx=setup({responses:{'ext-a':probe({ip:'9.9.9.9',tag:'a'}),'ext-b':probe({ip:'9.9.9.9',tag:'b'})}});await ctx.guardian.probeBrowser('browser-a');await ctx.guardian.probeBrowser('browser-b');
  ctx.browsers.extensionOffline('ext-b');ctx.guardian.browserOffline('browser-b');
  assert.equal(ctx.browsers.require('browser-a').state,'ACTIVE');assert.equal(ctx.browsers.require('browser-a').tabs.size,3);assert.equal(ctx.browsers.require('browser-b').state,'OFFLINE');
});

test('Guardian refuses to probe a Browser while BODY marks it BUSY',async()=>{
  const ctx=setup({responses:{'ext-a':probe(),'ext-b':probe({ip:'2.2.2.2',tag:'b'})}});await ctx.guardian.probeBrowser('browser-a');ctx.browsers.setState('browser-a','BUSY','task:test');await assert.rejects(()=>ctx.guardian.probeBrowser('browser-a'),/environment_probe_browser_busy/);assert.equal(ctx.browsers.require('browser-a').state,'BUSY');
});

test('environment persistence stores only signature hash and evidence, not raw browser fingerprint',async()=>{
  const ctx=setup({responses:{'ext-a':probe({ip:'1.1.1.1',tag:'private-ua'}),'ext-b':probe({ip:'2.2.2.2',tag:'b'})}});await ctx.guardian.probeBrowser('browser-a');const raw=fs.readFileSync(path.join(ctx.base,'state','environment.json'),'utf8');assert.equal(raw.includes('Chrome/private-ua'),false);assert.match(raw,/environmentSignature/);
});

test('transient non-http tab is deferred instead of quarantining the Browser',async()=>{
  const ctx=setup({responses:{'ext-a':deferredProbe(),'ext-b':probe({ip:'2.2.2.2',tag:'b'})}});const result=await ctx.guardian.probeBrowser('browser-a');const browser=ctx.browsers.require('browser-a');
  assert.equal(result.status,'PENDING');assert.equal(result.probeDeferred,true);assert.equal(browser.state,'ENV_CHECK');assert.equal(browser.stateReason,'environment_waiting_for_http_tab');assert.equal(browser.environment.status,'PENDING');assert.equal(Object.prototype.hasOwnProperty.call(ctx.guardian.state.observations,'browser-a'),false);
});

test('deferred probe reuses a fresh persisted observation after Browser reconnect reset',async()=>{
  const responses={'ext-a':probe({ip:'1.1.1.1',tag:'a'}),'ext-b':probe({ip:'2.2.2.2',tag:'b'})};
  const ctx=setup({responses});
  const first=await ctx.guardian.probeBrowser('browser-a');assert.equal(first.eligible,true);
  const browser=ctx.browsers.require('browser-a');browser.state='ENV_CHECK';browser.stateReason='environment_check_required';browser.environment={eligible:false,status:'PENDING',reasons:['ENVIRONMENT_CHECK_REQUIRED'],evidence:[]};
  responses['ext-a']=deferredProbe();
  const restored=await ctx.guardian.probeBrowser('browser-a');
  assert.equal(restored.eligible,true);assert.equal(restored.status,'ELIGIBLE');assert.equal(restored.probeDeferred,true);assert.equal(restored.reusedFreshObservation,true);assert.equal(ctx.browsers.require('browser-a').state,'ACTIVE');assert.equal(ctx.browsers.require('browser-a').environment.environmentSignature,first.environmentSignature);
});

test('expired observation does not keep a Browser ACTIVE on a non-http tab',async()=>{
  let clock=1000000;const responses={'ext-a':probe({ip:'1.1.1.1',tag:'a'}),'ext-b':probe({ip:'2.2.2.2',tag:'b'})};const ctx=setup({responses,now:()=>clock});
  const first=await ctx.guardian.probeBrowser('browser-a');assert.equal(first.eligible,true);
  clock+=300001;responses['ext-a']=deferredProbe();
  const result=await ctx.guardian.probeBrowser('browser-a');const browser=ctx.browsers.require('browser-a');
  assert.equal(result.status,'PENDING');assert.equal(result.eligible,false);assert.equal(browser.state,'ENV_CHECK');assert.equal(browser.stateReason,'environment_waiting_for_http_tab');
});

test('concurrent environment requests for one Browser share a single in-flight probe',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});const ctx=setup({responses:{'ext-a':async()=>{await gate;return probe();},'ext-b':probe({ip:'2.2.2.2',tag:'b'})}});
  const a=ctx.guardian.probeBrowser('browser-a'),b=ctx.guardian.probeBrowser('browser-a');assert.equal(a,b);assert.equal(ctx.calls,1);release();const [ra,rb]=await Promise.all([a,b]);assert.equal(ra.eligible,true);assert.deepEqual(ra,rb);assert.equal(ctx.guardian.status().inflight.length,0);
});
