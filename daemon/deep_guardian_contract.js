'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {LocalIdentityStore}=require('./src/local_identity');
const {BrowserManager}=require('./src/browser_manager');
const {EnvironmentGuardian}=require('./src/environment_guardian');

function setup(deep){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'deep-guardian-')),identity=new LocalIdentityStore(base,{env:{BODY_COMPANY_ID:'company-test',BODY_DEVICE_ID:'device-test'}});identity.registerBrowser({browserInstanceId:'browser-a',extensionInstanceId:'ext-a',runtimeExtensionId:'runtime'});const browsers=new BrowserManager(identity);browsers.registerExtension({companyId:'company-test',deviceId:'device-test',browserInstanceId:'browser-a',extensionInstanceId:'ext-a',extensionId:'ext-a',runtimeExtensionId:'runtime',connectedAt:1,lastSeenAt:1,activeTabId:1,tabs:new Map([[1,{id:1,active:true,siteKey:'example.com'}]])});
  const pageEnvironment={available:true,userAgent:'Chrome/test',platform:'Win32',language:'en-US',languages:['en-US'],hardwareConcurrency:8,deviceMemory:8,maxTouchPoints:0,webdriver:false,timezone:'UTC',screen:{width:1920,height:1080},devicePixelRatio:1};
  const requestExtension=async()=>({pageEnvironment,proxy:{available:true,detected:false,mode:'direct',autoDetect:false},publicEgress:{available:true,ip:'1.1.1.1',provider:'test.invalid'},deepFingerprint:deep});
  const deviceProbe={probe(){return {proxyEnvDetected:false,systemProxyDetected:false,vpnInterfaceDetected:false,vpnInterfaces:[]};}};
  const guardian=new EnvironmentGuardian(base,browsers,{requestExtension,deviceProbe,env:{BODY_ENV_DIRECT_ONLY:'true',BODY_ENV_REQUIRE_UNIQUE_PUBLIC_IP:'false',BODY_ENV_REQUIRE_UNIQUE_SIGNATURE:'false',BODY_ENV_DEEP_FINGERPRINT_ENABLED:'true',BODY_ENV_DEEP_BLOCK_HIGH_SUSPICION:'true',BODY_ENV_DEEP_MIN_COVERAGE_PERCENT:'50'},now:()=>1000000});return {base,browsers,guardian};
}

test('high-suspicion deep fingerprint quarantines Browser and persists compact evidence only',async()=>{const ctx=setup({available:true,score:82,verdict:'HIGH_SUSPICION',suspected:true,highSuspicion:true,stableHash:'abc123',coverage:{percent:91,available:10,total:11},signals:[{id:'webdriver_true',detail:'raw-secret-fingerprint'},{id:'canvas_unstable',detail:'raw-secret-canvas'}]});const result=await ctx.guardian.probeBrowser('browser-a');assert.equal(result.eligible,false);assert.ok(result.reasons.includes('DEEP_FINGERPRINT_HIGH_SUSPICION'));assert.equal(ctx.browsers.require('browser-a').state,'QUARANTINED');const raw=fs.readFileSync(path.join(ctx.base,'state','environment.json'),'utf8');assert.equal(raw.includes('raw-secret-fingerprint'),false);assert.equal(raw.includes('raw-secret-canvas'),false);assert.ok(raw.includes('webdriver_true'));});

test('non-high-suspicion deep findings remain evidence and do not independently quarantine',async()=>{const ctx=setup({available:true,score:42,verdict:'SUSPECTED',suspected:true,highSuspicion:false,stableHash:'abc123',coverage:{percent:91,available:10,total:11},signals:[{id:'review_signal'}]});const result=await ctx.guardian.probeBrowser('browser-a');assert.equal(result.eligible,true);assert.equal(result.deepFingerprint.score,42);assert.equal(ctx.browsers.require('browser-a').state,'ACTIVE');});
