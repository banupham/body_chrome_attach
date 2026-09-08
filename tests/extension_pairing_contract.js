'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {displayState,POLL_MS}=require('../src/guardian_status_overlay');

const root=path.join(__dirname,'..');

test('manifest exposes status popup and only approved runtime/Guardian permissions',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  assert.equal(manifest.action.default_popup,'pairing.html');
  assert.deepEqual(manifest.permissions,['debugger','tabs','activeTab','storage','alarms','proxy','scripting','privacy','system.cpu','system.memory','system.display']);
  for(const forbidden of ['cookies','history','webRequest','webRequestBlocking','nativeMessaging','management'])assert.equal(manifest.permissions.includes(forbidden),false,`unexpected privileged permission: ${forbidden}`);
});

test('popup shows only compact readiness state and contains no manual pairing input',()=>{
  const html=fs.readFileSync(path.join(root,'pairing.html'),'utf8');
  const popup=fs.readFileSync(path.join(root,'src','pairing_popup.js'),'utf8');
  const worker=fs.readFileSync(path.join(root,'src','service_worker_entry.js'),'utf8');
  assert.match(html,/src="pairing_popup\.js"/);
  assert.match(html,/id="reset"/);
  assert.match(html,/ĐANG KIỂM TRA/);
  assert.doesNotMatch(html,/<input/i);
  assert.doesNotMatch(html,/one-time-code|ABCD-EFGH|Ghép nối/);
  assert.doesNotMatch(html,/<script(?![^>]*src=)[^>]*>/i);
  assert.match(popup,/SẴN SÀNG/);
  assert.match(popup,/BỊ CHẶN/);
  assert.match(popup,/ĐANG KIỂM TRA/);
  assert.match(popup,/body\.pairingStatus/);
  assert.match(popup,/body\.pairReset/);
  assert.doesNotMatch(popup,/body\.pair['"]/);
  assert.match(worker,/READINESS_POLL/);
  assert.match(worker,/readiness:\s*daemon\.readinessStatus/);
  assert.match(worker,/bodyDaemonAuthToken/);
  assert.match(worker,/storage\.local\.remove\('bodyDaemonAuthToken'\)/);
  assert.doesNotMatch(worker,/body\.pair['"]/);
  assert.match(worker,/automatic_local/);
});

test('service worker has a Chrome-alarm reconnect backstop for Desktop restarts and MV3 suspension',()=>{
  const worker=fs.readFileSync(path.join(root,'src','service_worker_entry.js'),'utf8');
  assert.match(worker,/DAEMON_WAKE_ALARM\s*=\s*'body-daemon-wake'/);
  assert.match(worker,/DAEMON_WAKE_PERIOD_MINUTES\s*=\s*0\.5/);
  assert.match(worker,/chrome\.alarms\.onAlarm\.addListener/);
  assert.match(worker,/periodInMinutes:\s*DAEMON_WAKE_PERIOD_MINUTES/);
  assert.match(worker,/type:\s*'KEEPALIVE'/);
  assert.match(worker,/daemon\.connect\(\)\.then\(\(\)\s*=>\s*observeDaemonSocket\(\)\)\.catch/);
  assert.match(worker,/chrome\.runtime\.onStartup\.addListener/);
  assert.match(worker,/Body daemon WebSocket closed/);
});

test('release path is protected offline ZIP only and contains no legacy CRX materializer',()=>{
  assert.equal(fs.existsSync(path.join(root,'tools','materialize_extension_crx.js')),false);
  const releaseDir=path.join(root,'release');
  if(fs.existsSync(releaseDir)){
    const releaseFiles=fs.readdirSync(releaseDir);
    assert.equal(releaseFiles.some(name=>/\.crx|crx\.b64|\.(pem|pfx)$/i.test(name)),false);
  }
});

test('real Chrome release acceptance is fully manual and uses one clean protected package',()=>{
  const workflow=fs.readFileSync(path.join(root,'.github','workflows','verify.yml'),'utf8');
  const guide=fs.readFileSync(path.join(root,'MANUAL_RELEASE_TEST.md'),'utf8');
  assert.doesNotMatch(workflow,/body_chrome_real_e2e\.js|puppeteer/i);
  assert.match(guide,/BodyChromeAttach-v0\.8\.0\.zip/);
  assert.doesNotMatch(guide,/BodyChromeAttach-v0\.8\.0-PROTECTED|PROTECTED\.json|dist_protected|\.crx/);
  assert.match(guide,/Load unpacked/);
  assert.match(guide,/First-start BODY check/);
  assert.match(guide,/Restart\/token reuse|Desktop restart check/);
  assert.match(guide,/tokenHash/);
  assert.match(guide,/brain.*NOT_CONFIGURED/is);
  assert.match(guide,/browser_offline/);
});

test('Guardian page overlay is passive, periodic, and maps readiness to three compact states',()=>{
  const source=fs.readFileSync(path.join(root,'src','guardian_status_overlay.js'),'utf8');
  const content=fs.readFileSync(path.join(root,'src','virtual_cursor_content.js'),'utf8');
  assert.equal(POLL_MS,1500);
  assert.deepEqual(displayState({connected:true,readiness:{state:'READY'}}).state,'READY');
  assert.deepEqual(displayState({connected:true,readiness:{state:'CHECKING',reason:'bot_check_pending'}}).state,'CHECKING');
  assert.deepEqual(displayState({connected:true,readiness:{state:'BLOCKED',reason:'BOT_BEHAVIOR_HIGH_CONFIDENCE'}}).state,'BLOCKED');
  assert.deepEqual(displayState({connected:false}).state,'BLOCKED');
  assert.match(source,/pointerEvents:'none'/);
  assert.match(source,/body\.pairingStatus/);
  assert.match(content,/installGuardianStatusOverlay/);
});

test('build emits status popup bundle and copies pairing html',()=>{
  const build=fs.readFileSync(path.join(root,'build.js'),'utf8');
  assert.match(build,/pairing_popup/);
  assert.match(build,/pairing\.html/);
});
