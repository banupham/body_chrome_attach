'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {LocalIdentityStore}=require('./src/local_identity');
const {ExtensionRegistry}=require('./src/extension_registry');
const {LocalAuth}=require('./src/local_auth');

function tmp(name){return fs.mkdtempSync(path.join(os.tmpdir(),`${name}-`));}

test('local company and device identities persist and remain separate',()=>{
  const base=tmp('identity-persist');
  const first=new LocalIdentityStore(base,{env:{BODY_COMPANY_ID:'company-demo'},uuid:()=> '11111111-1111-4111-8111-111111111111',now:()=>0});
  assert.equal(first.snapshot().companyId,'company-demo');
  assert.match(first.snapshot().deviceId,/^device-/);
  assert.notEqual(first.snapshot().companyId,first.snapshot().deviceId);
  const second=new LocalIdentityStore(base,{env:{BODY_COMPANY_ID:'company-demo'},uuid:()=> '22222222-2222-4222-8222-222222222222',now:()=>1000});
  assert.deepEqual(second.snapshot().companyId,first.snapshot().companyId);
  assert.deepEqual(second.snapshot().deviceId,first.snapshot().deviceId);
});

test('one device can register multiple distinct Browser Instances and preserve bindings',()=>{
  const base=tmp('identity-browsers');
  const ids=new LocalIdentityStore(base,{env:{BODY_COMPANY_ID:'company-demo'},uuid:()=> '33333333-3333-4333-8333-333333333333'});
  ids.registerBrowser({browserInstanceId:'browser-a',extensionInstanceId:'ext-a',runtimeExtensionId:'runtime-a'});
  ids.registerBrowser({browserInstanceId:'browser-b',extensionInstanceId:'ext-b',runtimeExtensionId:'runtime-a'});
  ids.bindPlatformIdentity('browser-a',{platform:'youtube',accountId:'account-a',channelId:'channel-a'});
  assert.equal(ids.browserRegistrations().length,2);
  assert.equal(ids.identityChain('browser-a').platformIdentities.youtube.channelId,'channel-a');
  assert.throws(()=>ids.registerBrowser({browserInstanceId:'browser-c',extensionInstanceId:'ext-a',runtimeExtensionId:'runtime-a'}),/extension_browser_binding_mismatch/);
  const reloaded=new LocalIdentityStore(base,{env:{BODY_COMPANY_ID:'company-demo'}});
  assert.equal(reloaded.browserRegistrations().length,2);
  assert.equal(reloaded.identityChain('browser-b').extensionInstanceId,'ext-b');
});

test('many tabs share one Browser Instance identity without becoming duplicate browsers',()=>{
  const registry=new ExtensionRegistry();
  registry.register('ext-a',{}, {
    companyId:'company-a',deviceId:'device-a',browserInstanceId:'browser-a',runtimeExtensionId:'runtime-a',
    tabs:[{id:1,active:true},{id:2,active:false},{id:3,active:false}]
  });
  const row=registry.list()[0];
  assert.equal(row.browserInstanceId,'browser-a');
  assert.equal(row.tabCount,3);
  assert.equal(row.companyId,'company-a');
  assert.equal(row.deviceId,'device-a');
});

test('extension auth token is bound to Browser Instance when browser identity is supplied',()=>{
  const auth=new LocalAuth(tmp('identity-auth'));
  const first=auth.authenticateExtension({extensionId:'ext-a',browserInstanceId:'browser-a',runtimeExtensionId:'runtime-a',token:null,origin:'chrome-extension://runtime-a'});
  assert.equal(first.ok,true);
  const second=auth.authenticateExtension({extensionId:'ext-a',browserInstanceId:'browser-a',runtimeExtensionId:'runtime-a',token:first.pairedToken,origin:'chrome-extension://runtime-a'});
  assert.equal(second.ok,true);
  assert.equal(auth.authenticateExtension({extensionId:'ext-a',browserInstanceId:'browser-b',runtimeExtensionId:'runtime-a',token:first.pairedToken,origin:'chrome-extension://runtime-a'}).ok,false);
});
