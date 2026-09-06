'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {LocalAuth}=require('./src/local_auth');
const {pairingConsoleCommand}=require('./src/local_pairing_console');

function tmp(name){return fs.mkdtempSync(path.join(os.tmpdir(),`${name}-`));}
function hello(extensionId='ext-a',runtimeExtensionId='runtime-a',token=null){return {extensionId,browserInstanceId:`browser-${extensionId}`,runtimeExtensionId,token,origin:`chrome-extension://${runtimeExtensionId}`};}

test('new valid extension auto-pairs without manual code and reconnect uses persistent token',()=>{
  const auth=new LocalAuth(tmp('pair-auto'));
  const paired=auth.authenticateExtension(hello());
  assert.equal(paired.ok,true);
  assert.equal(paired.paired,true);
  assert.equal(paired.rotated,false);
  assert.match(paired.pairedToken,/^[0-9a-f]{64}$/);
  assert.equal(auth.status().pairingMode,'automatic_local');
  const reconnect=auth.authenticateExtension(hello('ext-a','runtime-a',paired.pairedToken));
  assert.deepEqual(reconnect,{ok:true,paired:false});
});

test('missing or stale token auto-rotates only when full extension binding still matches',()=>{
  const auth=new LocalAuth(tmp('pair-rotate'));
  const first=auth.authenticateExtension(hello());
  const rotated=auth.authenticateExtension(hello('ext-a','runtime-a','stale-token'));
  assert.equal(rotated.ok,true);
  assert.equal(rotated.paired,true);
  assert.equal(rotated.rotated,true);
  assert.notEqual(rotated.pairedToken,first.pairedToken);
  assert.deepEqual(auth.authenticateExtension(hello('ext-a','runtime-a',rotated.pairedToken)),{ok:true,paired:false});
});

test('origin runtime and browser binding remain fail-closed in automatic mode',()=>{
  const auth=new LocalAuth(tmp('pair-binding'));
  const paired=auth.authenticateExtension(hello());
  assert.equal(paired.ok,true);
  assert.equal(auth.authenticateExtension({...hello('ext-a','runtime-b',null),origin:'chrome-extension://runtime-b'}).error,'extension_runtime_id_mismatch');
  assert.equal(auth.authenticateExtension({...hello('ext-a','runtime-a',null),browserInstanceId:'browser-other'}).error,'extension_browser_id_mismatch');
  assert.equal(auth.authenticateExtension({...hello('ext-a','runtime-a',null),origin:'chrome-extension://other'}).error,'extension_origin_mismatch');
});

test('pair forget revokes current token and next reconnect auto-pairs again',()=>{
  const auth=new LocalAuth(tmp('pair-forget'));
  const first=auth.authenticateExtension(hello());
  let disconnected=null;
  const result=pairingConsoleCommand(auth,'pair forget ext-a',{disconnectExtension:extensionId=>{disconnected=extensionId;return true;}}).result;
  assert.deepEqual(result,{extensionId:'ext-a',forgotten:true,disconnected:true,willAutoPairOnReconnect:true});
  assert.equal(disconnected,'ext-a');
  assert.equal(auth.status().pairedExtensions,0);
  const repaired=auth.authenticateExtension(hello('ext-a','runtime-a',first.pairedToken));
  assert.equal(repaired.ok,true);
  assert.equal(repaired.paired,true);
  assert.equal(repaired.rotated,false);
  assert.notEqual(repaired.pairedToken,first.pairedToken);
});

test('pairing console no longer exposes manual open/close flow',()=>{
  const auth=new LocalAuth(tmp('pair-console'));
  const paired=auth.authenticateExtension(hello());
  assert.equal(paired.ok,true);
  const status=pairingConsoleCommand(auth,'pair status').result;
  assert.equal(status.pairingMode,'automatic_local');
  assert.equal(JSON.stringify(status).includes('tokenHash'),false);
  assert.equal(pairingConsoleCommand(auth,'status').handled,false);
  assert.throws(()=>pairingConsoleCommand(auth,'pair open'),/pair_usage/);
  assert.throws(()=>pairingConsoleCommand(auth,'pair close'),/pair_usage/);
});
