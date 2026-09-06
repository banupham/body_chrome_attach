'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {LocalAuth,normalizePairingCode}=require('./src/local_auth');
const {pairingConsoleCommand}=require('./src/local_pairing_console');

function tmp(name){return fs.mkdtempSync(path.join(os.tmpdir(),`${name}-`));}
function hello(extensionId='ext-a',runtimeExtensionId='runtime-a',token=null){return {extensionId,browserInstanceId:`browser-${extensionId}`,runtimeExtensionId,token,origin:`chrome-extension://${runtimeExtensionId}`};}

test('new extension fails closed until a local pairing window is opened',()=>{
  const auth=new LocalAuth(tmp('pair-closed'));
  const denied=auth.authenticateExtension(hello());
  assert.deepEqual(denied,{ok:false,error:'extension_pairing_required'});
  assert.equal(auth.status().pairedExtensions,0);
  assert.equal(auth.pairingStatus().active,false);
});

test('one-time pairing code authorizes exactly one new extension and reconnect uses persistent token',()=>{
  const auth=new LocalAuth(tmp('pair-one-time'),{randomBytes:()=>Buffer.alloc(8,0)});
  const opened=auth.openPairingWindow({ttlMs:120000,maxAttempts:8});
  assert.equal(opened.code,'AAAA-AAAA');
  assert.equal(normalizePairingCode(opened.code),'AAAAAAAA');
  assert.equal(auth.pairingStatus().active,true);

  const paired=auth.authenticateExtension(hello('ext-a','runtime-a',opened.code));
  assert.equal(paired.ok,true);
  assert.equal(paired.paired,true);
  assert.match(paired.pairedToken,/^[0-9a-f]{64}$/);
  assert.equal(auth.pairingStatus().active,false);

  const reconnect=auth.authenticateExtension(hello('ext-a','runtime-a',paired.pairedToken));
  assert.deepEqual(reconnect,{ok:true,paired:false});

  const replay=auth.authenticateExtension(hello('ext-b','runtime-b',opened.code));
  assert.equal(replay.ok,false);
  assert.equal(replay.error,'extension_pairing_required');
});

test('wrong pairing code consumes only unique attempts so websocket retries cannot exhaust the window',()=>{
  const auth=new LocalAuth(tmp('pair-attempts'),{randomBytes:()=>Buffer.alloc(8,0)});
  auth.openPairingWindow({maxAttempts:4});
  const first=auth.authenticateExtension(hello('ext-a','runtime-a','BBBB-BBBB'));
  assert.equal(first.error,'extension_pairing_code_invalid');
  assert.equal(auth.pairingStatus().remainingAttempts,3);
  const retry=auth.authenticateExtension(hello('ext-a','runtime-a','BBBB-BBBB'));
  assert.equal(retry.error,'extension_pairing_code_invalid');
  assert.equal(auth.pairingStatus().remainingAttempts,3);
  auth.authenticateExtension(hello('ext-a','runtime-a','CCCC-CCCC'));
  assert.equal(auth.pairingStatus().remainingAttempts,2);
});

test('expired pairing window rejects even the previously correct code',()=>{
  let now=1000;
  const auth=new LocalAuth(tmp('pair-expiry'),{now:()=>now,randomBytes:()=>Buffer.alloc(8,0)});
  const opened=auth.openPairingWindow({ttlMs:30000});
  now+=30001;
  assert.equal(auth.pairingStatus().active,false);
  const denied=auth.authenticateExtension(hello('ext-a','runtime-a',opened.code));
  assert.equal(denied.error,'extension_pairing_required');
});

test('origin/runtime/browser binding still applies after pairing',()=>{
  const auth=new LocalAuth(tmp('pair-binding'),{randomBytes:()=>Buffer.alloc(8,0)});
  const opened=auth.openPairingWindow();
  const paired=auth.authenticateExtension(hello('ext-a','runtime-a',opened.code));
  assert.equal(paired.ok,true);
  assert.equal(auth.authenticateExtension({...hello('ext-a','runtime-b',paired.pairedToken),origin:'chrome-extension://runtime-b'}).error,'extension_runtime_id_mismatch');
  assert.equal(auth.authenticateExtension({...hello('ext-a','runtime-a',paired.pairedToken),browserInstanceId:'browser-other'}).error,'extension_browser_id_mismatch');
  assert.equal(auth.authenticateExtension({...hello('ext-a','runtime-a',paired.pairedToken),origin:'chrome-extension://other'}).error,'extension_origin_mismatch');
});

test('pairing console commands are local-control helpers and never expose stored auth tokens',()=>{
  const auth=new LocalAuth(tmp('pair-console'),{randomBytes:()=>Buffer.alloc(8,0)});
  const opened=pairingConsoleCommand(auth,'pair open 60');
  assert.equal(opened.handled,true);
  assert.equal(opened.result.code,'AAAA-AAAA');
  const status=pairingConsoleCommand(auth,'pair status').result;
  assert.equal(status.pairing.active,true);
  assert.equal(JSON.stringify(status).includes('tokenHash'),false);
  assert.equal(JSON.stringify(status).includes(auth.clientSecret),false);
  assert.equal(pairingConsoleCommand(auth,'status').handled,false);
  assert.throws(()=>pairingConsoleCommand(auth,'pair open 5'),/30_to_300/);
  assert.equal(pairingConsoleCommand(auth,'pair close').result.active,false);
});
