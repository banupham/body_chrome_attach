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

test('popup distinguishes Extension failure from Guardian block and exposes per-Browser learning diagnostics',()=>{
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
  assert.match(popup,/LỖI EXTENSION/);
  assert.match(popup,/extensionHealth/);
  assert.match(popup,/Service worker không phản hồi/);
  assert.match(popup,/Nhận \$\{observed\}/);
  assert.match(popup,/Gửi \$\{forwarded\}/);
  assert.match(popup,/Chờ \$\{pending\}/);
  assert.match(popup,/CS:OK/);
  assert.match(popup,/browserInstanceId/);
  assert.match(popup,/activeTabId/);
  assert.match(popup,/body\.pairingStatus/);
  assert.match(popup,/body\.pairReset/);
  assert.doesNotMatch(popup,/body\.pair['"]/);
  assert.match(worker,/READINESS_POLL/);
  assert.match(worker,/readiness:\s*daemon\.readinessStatus/);
  assert.match(worker,/extensionHealth:/);
  assert.match(worker,/contentScript/);
  assert.match(worker,/forwardedEventCount/);
  assert.match(worker,/pendingEventCount/);
  assert.match(worker,/lastForwardError/);
  assert.match(worker,/learningInput:\s*learningInputStatus\(\)/);
  assert.match(worker,/bodyDaemonAuthToken/);
  assert.match(worker,/storage\.local\.remove\('bodyDaemonAuthToken'\)/);
  assert.doesNotMatch(worker,/body\.pair['"]/);
  assert.match(worker,/automatic_local/);
});

test('service worker identity failure is retryable and cannot poison one Chrome profile',()=>{
  const worker=fs.readFileSync(path.join(root,'src','service_worker_entry.js'),'utf8');
  assert.match(worker,/let daemonIdentityPromise\s*=\s*null/);
  assert.match(worker,/let daemonIdentityLastError\s*=\s*null/);
  assert.match(worker,/function ensureDaemonIdentity\(\)/);
  assert.match(worker,/daemonIdentityPromise\s*=\s*Promise\.resolve\(\)/);
  assert.match(worker,/daemonIdentityPromise\s*=\s*null;\s*throw error/);
  assert.match(worker,/async function connectDaemon\(\)[\s\S]*await ensureDaemonIdentity\(\)/);
  assert.match(worker,/async function pairingStatus\(\)[\s\S]*extensionHealth:/);
  assert.match(worker,/identityReady/);
  assert.match(worker,/storageReady/);
  assert.match(worker,/lastIdentityError/);
});

test('service worker has identity-first Chrome-alarm reconnect backstop for Desktop restarts and MV3 suspension',()=>{
  const worker=fs.readFileSync(path.join(root,'src','service_worker_entry.js'),'utf8');
  assert.match(worker,/DAEMON_WAKE_ALARM\s*=\s*'body-daemon-wake'/);
  assert.match(worker,/DAEMON_WAKE_PERIOD_MINUTES\s*=\s*0\.5/);
  assert.match(worker,/ensureDaemonIdentity/);
  assert.match(worker,/async function connectDaemon\(\)/);
  assert.match(worker,/await ensureDaemonIdentity\(\)/);
  assert.match(worker,/const status = await daemon\.connect\(\)/);
  assert.match(worker,/chrome\.alarms\.onAlarm\.addListener/);
  assert.match(worker,/periodInMinutes:\s*DAEMON_WAKE_PERIOD_MINUTES/);
  assert.match(worker,/type:\s*'KEEPALIVE'/);
  assert.match(worker,/connectDaemon\(\)\.catch/);
  assert.match(worker,/chrome\.runtime\.onStartup\.addListener/);
  assert.match(worker,/ensureDaemonIdentity\(\)[\s\S]*repairOpenWebTabs/);
  assert.match(worker,/Body daemon WebSocket closed/);
});

test('content script and Guardian overlay are takeover-owned across reinjection',()=>{
  const content=fs.readFileSync(path.join(root,'src','virtual_cursor_content.js'),'utf8');
  const overlay=fs.readFileSync(path.join(root,'src','guardian_status_overlay.js'),'utf8');
  assert.match(content,/CONTENT_OWNER_KEY/);
  assert.match(content,/\[CONTENT_OWNER_KEY\]\?\.uninstall/);
  assert.match(content,/removeListener\?\.\(messageListener\)/);
  assert.match(content,/inputTrustAudit\?\.uninstall/);
  assert.match(content,/guardianStatusOverlay\?\.uninstall/);
  assert.match(overlay,/OWNER_KEY/);
  assert.match(overlay,/\[OWNER_KEY\]\?\.uninstall/);
  assert.match(overlay,/getElementById\?\.\(ROOT_ID\)\?\.remove/);
  assert.doesNotMatch(overlay,/getElementById\?\.\(ROOT_ID\)\)return \{installed:true,reused:true/);
  assert.match(overlay,/LỖI EXTENSION/);
  assert.match(overlay,/Service worker không phản hồi/);
});

test('release path is protected offline ZIP only and contains no legacy CRX materializer',()=>{
  assert.equal(fs.existsSync(path.join(root,'tools','materialize_extension_crx.js')),false);
  const releaseDir=path.join(root,'release');
  if(fs.existsSync(releaseDir)){
    const releaseFiles=fs.readdirSync(releaseDir);
    assert.equal(releaseFiles.some(name=>/\.crx|crx\.b64|\.(pem|pfx)$/i.test(name)),false);
  }
});

test('release acceptance is code-enforced without Markdown or automated real-Chrome E2E',()=>{
  const workflow=fs.readFileSync(path.join(root,'.github','workflows','verify.yml'),'utf8');
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  const releaseContract=fs.readFileSync(path.join(root,'tests','bodybrain_release_manifest_contract.py'),'utf8');
  assert.doesNotMatch(workflow,/body_chrome_real_e2e\.js|puppeteer/i);
  assert.match(workflow,/Build and verify protected Chrome BODY Extension/);
  assert.match(workflow,/Build one-file BodyBrain\.exe/);
  assert.match(workflow,/Verify exact three-file release/);
  assert.match(workflow,/artifacts\/BodyBrain\.exe/);
  assert.match(workflow,/artifacts\/BodyChromeAttach-v\*\.zip/);
  assert.equal(pkg.scripts['extension:protected:test'],'npm run extension:protected && node tests/protected_extension_contract.js');
  assert.match(releaseContract,/release directory must contain exactly/);
  assert.match(releaseContract,/BodyBrain\.exe/);
  assert.match(releaseContract,/BodyChromeAttach-v/);
  assert.match(releaseContract,/NOT_CONFIGURED/);
});

test('Guardian page overlay is passive, periodic, maps readiness, and exposes learning receive/forward health',()=>{
  const source=fs.readFileSync(path.join(root,'src','guardian_status_overlay.js'),'utf8');
  const content=fs.readFileSync(path.join(root,'src','virtual_cursor_content.js'),'utf8');
  assert.equal(POLL_MS,1500);
  assert.deepEqual(displayState({connected:true,readiness:{state:'READY'}}).state,'READY');
  assert.deepEqual(displayState({connected:true,readiness:{state:'CHECKING',reason:'bot_check_pending'}}).state,'CHECKING');
  assert.deepEqual(displayState({connected:true,readiness:{state:'BLOCKED',reason:'BOT_BEHAVIOR_HIGH_CONFIDENCE'}}).state,'BLOCKED');
  assert.deepEqual(displayState({extensionHealth:{state:'ERROR',reason:'identity:failed'}}).state,'ERROR');
  assert.deepEqual(displayState({connected:false}).state,'BLOCKED');
  assert.match(displayState({connected:true,readiness:{state:'READY'},learningInput:{eventCount:12,forwardedEventCount:11,pendingEventCount:1}}).detail,/Học 12\/11 · chờ 1/);
  assert.match(source,/pointerEvents:'none'/);
  assert.match(source,/body\.pairingStatus/);
  assert.match(source,/learningSuffix/);
  assert.match(content,/installGuardianStatusOverlay/);
});

test('build emits status popup bundle and copies pairing html',()=>{
  const build=fs.readFileSync(path.join(root,'build.js'),'utf8');
  assert.match(build,/pairing_popup/);
  assert.match(build,/pairing\.html/);
});
