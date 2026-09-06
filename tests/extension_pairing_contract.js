'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');

test('manifest exposes pairing popup without adding new privileged permissions',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  assert.equal(manifest.action.default_popup,'pairing.html');
  assert.deepEqual(manifest.permissions,['debugger','tabs','activeTab','storage','proxy']);
});

test('pairing popup uses external script and service worker exposes local pairing and recovery messages',()=>{
  const html=fs.readFileSync(path.join(root,'pairing.html'),'utf8');
  const popup=fs.readFileSync(path.join(root,'src','pairing_popup.js'),'utf8');
  const worker=fs.readFileSync(path.join(root,'src','service_worker_entry.js'),'utf8');
  assert.match(html,/src="pairing_popup\.js"/);
  assert.match(html,/id="reset"/);
  assert.doesNotMatch(html,/<script(?![^>]*src=)[^>]*>/i);
  for(const type of ['body.pairingStatus','body.pair','body.pairReset']){
    const escaped=type.replace('.','\\.');
    assert.match(popup,new RegExp(escaped));
    assert.match(worker,new RegExp(escaped));
  }
  assert.match(worker,/bodyDaemonAuthToken/);
  assert.match(worker,/storage\.local\.remove\('bodyDaemonAuthToken'\)/);
  assert.match(worker,/extension_already_paired/);
});

test('build emits pairing popup bundle and copies pairing html',()=>{
  const build=fs.readFileSync(path.join(root,'build.js'),'utf8');
  assert.match(build,/pairing_popup/);
  assert.match(build,/pairing\.html/);
});
