'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {LocalIdentityStore}=require('./src/local_identity');
const {BrowserManager}=require('./src/browser_manager');
const {EnvironmentGuardian}=require('./src/environment_guardian');
const {syncBrowserExecutionState}=require('./src/daemon_runtime');

function tmp(name){return fs.mkdtempSync(path.join(os.tmpdir(),`${name}-`));}

test('Guardian refuses a live probe while execution lane marks Browser BUSY',async()=>{
  const base=tmp('guardian-busy');
  const identity=new LocalIdentityStore(base,{env:{BODY_COMPANY_ID:'company-test',BODY_DEVICE_ID:'device-test'}});
  identity.registerBrowser({browserInstanceId:'browser-a',extensionInstanceId:'ext-a',runtimeExtensionId:'runtime-a'});
  const browsers=new BrowserManager(identity);
  browsers.registerExtension({
    companyId:'company-test',deviceId:'device-test',browserInstanceId:'browser-a',
    extensionInstanceId:'ext-a',extensionId:'ext-a',runtimeExtensionId:'runtime-a',
    connectedAt:1,lastSeenAt:1,activeTabId:1,tabs:new Map([[1,{id:1,active:true,siteKey:'youtube.com'}]])
  });
  browsers.setEnvironment('browser-a',{eligible:true,status:'ELIGIBLE',publicIp:'1.1.1.1',environmentSignature:'sig-a',reasons:[],evidence:[]},'test_environment_eligible');
  const guardian=new EnvironmentGuardian(base,browsers,{
    requestExtension:async()=>{throw new Error('request_should_not_run_while_busy');},
    env:{BODY_ENV_DIRECT_ONLY:'false'},
    deviceProbe:{probe(){return {proxyEnvDetected:false,systemProxyDetected:false,vpnInterfaceDetected:false,vpnInterfaces:[]};}}
  });

  syncBrowserExecutionState(browsers,'ext-a',{busy:true,active:true,queued:0,current:{operation:'intent'}});
  await assert.rejects(()=>guardian.probeBrowser('browser-a'),/environment_probe_browser_busy/);
});
