'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');

test('manifest exposes status popup and only approved runtime/Guardian permissions',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  assert.equal(manifest.action.default_popup,'pairing.html');
  assert.deepEqual(manifest.permissions,['debugger','tabs','activeTab','storage','proxy','scripting','privacy','system.cpu','system.memory','system.display']);
  for(const forbidden of ['cookies','history','webRequest','webRequestBlocking','nativeMessaging','management'])assert.equal(manifest.permissions.includes(forbidden),false,`unexpected privileged permission: ${forbidden}`);
});

test('pairing popup is status-only and contains no manual code entry',()=>{
  const html=fs.readFileSync(path.join(root,'pairing.html'),'utf8');
  const popup=fs.readFileSync(path.join(root,'src','pairing_popup.js'),'utf8');
  const worker=fs.readFileSync(path.join(root,'src','service_worker_entry.js'),'utf8');
  assert.match(html,/src="pairing_popup\.js"/);
  assert.match(html,/id="reset"/);
  assert.doesNotMatch(html,/<input/i);
  assert.doesNotMatch(html,/one-time-code|ABCD-EFGH|Ghép nối/);
  assert.match(html,/Không cần nhập mã/);
  assert.doesNotMatch(html,/<script(?![^>]*src=)[^>]*>/i);
  assert.match(popup,/body\.pairingStatus/);
  assert.match(popup,/body\.pairReset/);
  assert.doesNotMatch(popup,/body\.pair['"]/);
  assert.match(worker,/bodyDaemonAuthToken/);
  assert.match(worker,/storage\.local\.remove\('bodyDaemonAuthToken'\)/);
  assert.doesNotMatch(worker,/body\.pair['"]/);
  assert.match(worker,/automatic_local/);
});

test('build emits status popup bundle and copies pairing html',()=>{
  const build=fs.readFileSync(path.join(root,'build.js'),'utf8');
  assert.match(build,/pairing_popup/);
  assert.match(build,/pairing\.html/);
});
