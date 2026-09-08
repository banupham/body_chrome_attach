'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  endpointPaths,
  acquireRuntimeLock,
  refreshRuntimeLock,
  releaseRuntimeLock,
  assertRuntimeOwnershipAvailable,
  publishRuntimeEndpoint,
  clearRuntimeEndpoint,
  readRuntimeEndpoint,
  readRememberedRuntimePort,
  rememberRuntimePort,
  preferredRuntimePort,
  currentBootEpochMs,
  timestampPredatesCurrentBoot,
  RUNTIME_LOCK_STALE_MS
} = require('../daemon/src/runtime_endpoint');
const { ensureRememberedRuntimePort } = require('../daemon/src/runtime_port_migration');
const {
  normalizeRuntimeEndpoint,
  resolveRuntimeEndpoint,
  RUNTIME_ENDPOINT_PORT_STORAGE_KEY
} = require('../src/runtime_endpoint_client');

function tmp(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

(async () => {
  const project = tmp('runtime-endpoint');
  const daemonDir = path.join(project, 'daemon');
  fs.mkdirSync(path.join(project, 'dist'), { recursive: true });

  const lock = acquireRuntimeLock(daemonDir, { pid: 111, now: () => 0 });
  assert.equal(lock.acquired, true);
  assert.ok(lock.ownerToken);
  assert.throws(() => acquireRuntimeLock(daemonDir, { pid: 222, now: () => 1, killImpl: () => true }), /company_runtime_already_running:111/);
  assert.equal(releaseRuntimeLock(daemonDir, { pid: 222 }), false);
  assert.equal(fs.existsSync(endpointPaths(daemonDir).lock), true);
  assert.equal(releaseRuntimeLock(daemonDir, { pid: 111, ownerToken: lock.ownerToken }), true);
  assert.equal(fs.existsSync(endpointPaths(daemonDir).lock), false);

  assert.equal(currentBootEpochMs({ now: () => 200000, uptimeImpl: () => 100 }), 100000);
  assert.equal(timestampPredatesCurrentBoot(new Date(1000).toISOString(), { now: () => 200000, uptimeImpl: () => 100 }), true);
  assert.equal(timestampPredatesCurrentBoot(new Date(150000).toISOString(), { now: () => 200000, uptimeImpl: () => 100 }), false);

  const rebootProject = tmp('runtime-lock-reboot');
  const rebootDaemonDir = path.join(rebootProject, 'daemon');
  fs.mkdirSync(path.join(rebootDaemonDir, 'state'), { recursive: true });
  fs.writeFileSync(endpointPaths(rebootDaemonDir).lock, JSON.stringify({ pid: 8720, createdAt: new Date(1000).toISOString() }) + '\n');
  const recovered = acquireRuntimeLock(rebootDaemonDir, {
    pid: 9000,
    now: () => 200000,
    uptimeImpl: () => 100,
    killImpl: () => true
  });
  assert.equal(recovered.acquired, true);
  assert.equal(JSON.parse(fs.readFileSync(endpointPaths(rebootDaemonDir).lock, 'utf8')).pid, 9000);
  releaseRuntimeLock(rebootDaemonDir, { pid: 9000, ownerToken: recovered.ownerToken });

  fs.writeFileSync(endpointPaths(rebootDaemonDir).lock, JSON.stringify({ pid: 8720, createdAt: new Date(150000).toISOString() }) + '\n');
  assert.throws(() => acquireRuntimeLock(rebootDaemonDir, {
    pid: 9000,
    now: () => 200000,
    uptimeImpl: () => 100,
    killImpl: () => true
  }), /company_runtime_already_running:8720/);
  fs.rmSync(endpointPaths(rebootDaemonDir).lock, { force: true });

  const staleProject = tmp('runtime-lock-stale-pid');
  const staleDaemonDir = path.join(staleProject, 'daemon');
  fs.mkdirSync(path.dirname(endpointPaths(staleDaemonDir).lock), { recursive: true });
  const staleLockPath = endpointPaths(staleDaemonDir).lock;

  // Legacy v1 lock: Windows may reuse a still-alive PID. An old lock must not block forever.
  fs.writeFileSync(staleLockPath, JSON.stringify({ pid: 8712, createdAt: new Date(150000).toISOString() }) + '\n');
  fs.utimesSync(staleLockPath, new Date(150000 - RUNTIME_LOCK_STALE_MS - 1), new Date(150000 - RUNTIME_LOCK_STALE_MS - 1));
  const legacyRecovered = acquireRuntimeLock(staleDaemonDir, {
    pid: 5336,
    now: () => 200000,
    uptimeImpl: () => 100,
    killImpl: () => true
  });
  assert.equal(legacyRecovered.acquired, true);
  assert.equal(JSON.parse(fs.readFileSync(staleLockPath, 'utf8')).pid, 5336);

  // A v2 lock is a lease: stale heartbeat recovers even when the old PID now belongs to another process.
  releaseRuntimeLock(staleDaemonDir, { pid: 5336, ownerToken: legacyRecovered.ownerToken });
  fs.writeFileSync(staleLockPath, JSON.stringify({
    schemaVersion: 2,
    pid: 8712,
    ownerToken: 'old-runtime-owner',
    createdAt: new Date(150000).toISOString(),
    heartbeatAt: new Date(150000).toISOString()
  }) + '\n');
  const leaseRecovered = acquireRuntimeLock(staleDaemonDir, {
    pid: 5336,
    now: () => 200000,
    uptimeImpl: () => 100,
    killImpl: () => true
  });
  assert.equal(leaseRecovered.acquired, true);
  assert.equal(refreshRuntimeLock(staleDaemonDir, { pid: 5336, ownerToken: leaseRecovered.ownerToken, now: () => 205000 }), true);
  assert.equal(JSON.parse(fs.readFileSync(staleLockPath, 'utf8')).heartbeatAt, new Date(205000).toISOString());

  // A fresh lease remains fail-closed against a second runtime.
  assert.throws(() => acquireRuntimeLock(staleDaemonDir, {
    pid: 7000,
    now: () => 206000,
    uptimeImpl: () => 100,
    killImpl: () => true
  }), /company_runtime_already_running:5336/);
  releaseRuntimeLock(staleDaemonDir, { pid: 5336, ownerToken: leaseRecovered.ownerToken });

  fs.writeFileSync(endpointPaths(rebootDaemonDir).state, JSON.stringify({
    schemaVersion: 2,
    active: true,
    host: '127.0.0.1',
    port: 54321,
    pid: 8720,
    startedAt: new Date(1000).toISOString()
  }) + '\n');
  assert.equal(assertRuntimeOwnershipAvailable(endpointPaths(rebootDaemonDir).state, {
    pid: 9000,
    now: () => 200000,
    uptimeImpl: () => 100,
    killImpl: () => true
  }), true);
  fs.writeFileSync(endpointPaths(rebootDaemonDir).state, JSON.stringify({
    schemaVersion: 2,
    active: true,
    host: '127.0.0.1',
    port: 54321,
    pid: 8720,
    startedAt: new Date(150000).toISOString()
  }) + '\n');
  assert.throws(() => assertRuntimeOwnershipAvailable(endpointPaths(rebootDaemonDir).state, {
    pid: 9000,
    now: () => 200000,
    uptimeImpl: () => 100,
    killImpl: () => true
  }), /company_runtime_already_running:8720:54321/);

  assert.equal(preferredRuntimePort(daemonDir), 0);
  const record = publishRuntimeEndpoint(daemonDir, 54321, { pid: 111, now: () => 0, killImpl: () => { const e = new Error('dead'); e.code = 'ESRCH'; throw e; } });
  assert.equal(record.wsUrl, 'ws://127.0.0.1:54321');
  assert.equal(readRememberedRuntimePort(daemonDir), 54321);
  assert.equal(preferredRuntimePort(daemonDir), 54321);

  const paths = endpointPaths(daemonDir);
  const loaded = readRuntimeEndpoint(paths.state);
  assert.equal(loaded.port, 54321);
  assert.equal(loaded.host, '127.0.0.1');
  const extensionRecord = JSON.parse(fs.readFileSync(paths.extension, 'utf8'));
  assert.equal(extensionRecord.port, 54321);
  assert.equal(extensionRecord.active, true);
  assert.equal('pid' in extensionRecord, false);

  assert.throws(() => rememberRuntimePort(daemonDir, 54322), /runtime_port_change_forbidden:54321:54322/);
  assert.throws(() => publishRuntimeEndpoint(daemonDir, 54322, { pid: 222, killImpl: () => true }), /runtime_port_change_forbidden:54321:54322/);
  assert.equal(clearRuntimeEndpoint(daemonDir, { pid: 222 }), false);
  assert.equal(readRuntimeEndpoint(paths.state).port, 54321);

  assert.equal(clearRuntimeEndpoint(daemonDir, { pid: 111 }), true);
  assert.throws(() => readRuntimeEndpoint(paths.state), /runtime_endpoint_unavailable/);
  assert.equal(readRememberedRuntimePort(daemonDir), 54321);
  const inactiveExtensionRecord = JSON.parse(fs.readFileSync(paths.extension, 'utf8'));
  assert.equal(inactiveExtensionRecord.active, false);
  assert.equal(inactiveExtensionRecord.port, 54321);
  assert.equal(inactiveExtensionRecord.wsUrl, 'ws://127.0.0.1:54321');

  const migrationProject = tmp('runtime-port-migration');
  const migrationDaemonDir = path.join(migrationProject, 'daemon');
  fs.mkdirSync(path.join(migrationDaemonDir, 'state'), { recursive: true });
  fs.writeFileSync(endpointPaths(migrationDaemonDir).state, JSON.stringify({ schemaVersion: 1, active: true, host: '127.0.0.1', port: 55001, pid: 999 }) + '\n');
  assert.equal(ensureRememberedRuntimePort(migrationDaemonDir), 55001);
  assert.equal(readRememberedRuntimePort(migrationDaemonDir), 55001);

  assert.deepEqual(
    normalizeRuntimeEndpoint({ active: true, host: '127.0.0.1', port: 60123, wsUrl: 'ws://evil.invalid:1' }),
    { active: true, host: '127.0.0.1', port: 60123, wsUrl: 'ws://127.0.0.1:60123', startedAt: null }
  );
  assert.throws(() => normalizeRuntimeEndpoint({ active: true, host: '0.0.0.0', port: 60123 }), /runtime_endpoint_unavailable/);
  assert.throws(() => normalizeRuntimeEndpoint({ active: false, host: '127.0.0.1', port: 60123 }), /runtime_endpoint_unavailable/);
  assert.equal(normalizeRuntimeEndpoint({ active: false, host: '127.0.0.1', port: 60123 }, { allowInactiveKnownPort: true }).port, 60123);

  let fetchedUrl = null;
  let fetchedOptions = null;
  const storageState = { [RUNTIME_ENDPOINT_PORT_STORAGE_KEY]: 62001 };
  const chromeApi = {
    runtime: { getURL: name => `chrome-extension://runtime-id/${name}` },
    storage: {
      local: {
        async get(defaults) { return { ...defaults, ...storageState }; },
        async set(value) { Object.assign(storageState, value); }
      }
    }
  };
  const endpoint = await resolveRuntimeEndpoint(chromeApi, {
    cacheBust: () => 123,
    fetchImpl: async (url, options) => {
      fetchedUrl = url;
      fetchedOptions = options;
      return { ok: true, async json() { return { active: false, host: '127.0.0.1', port: 61234 }; } };
    }
  });
  assert.equal(endpoint.wsUrl, 'ws://127.0.0.1:61234');
  assert.equal(endpoint.source, 'resource');
  assert.match(fetchedUrl, /runtime-endpoint\.json\?v=123$/);
  assert.equal(fetchedOptions.cache, 'no-store');
  assert.equal(storageState[RUNTIME_ENDPOINT_PORT_STORAGE_KEY], 61234, 'packaged resource must replace a stale stored port');

  fetchedUrl = null;
  const persisted = await resolveRuntimeEndpoint(chromeApi, {
    fetchImpl: async () => { throw new Error('resource_unavailable'); }
  });
  assert.equal(persisted.port, 61234);
  assert.equal(persisted.source, 'storage');
  assert.equal(fetchedUrl, null);

  for (const file of ['daemon/server.js', 'body_cli.js', 'src/daemon_bridge.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.equal(source.includes('8765'), false, `${file} must not hard-code port 8765`);
  }
  const server = fs.readFileSync(path.join(__dirname, '..', 'daemon', 'server.js'), 'utf8');
  const launcher = fs.readFileSync(path.join(__dirname, '..', 'daemon.cmd'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'daemon', 'src', 'sticky_runtime_port_preload.js'), 'utf8');
  const build = fs.readFileSync(path.join(__dirname, '..', 'build.js'), 'utf8');
  assert.match(server, /port:0/);
  assert.match(server, /acquireRuntimeLock/);
  assert.match(server, /startRuntimeLockHeartbeat/);
  assert.match(server, /ownerToken:runtimeLock\.ownerToken/);
  assert.doesNotMatch(server, /ensureAutomaticPairingWindow/);
  assert.match(launcher, /sticky_runtime_port_preload\.js/);
  assert.match(preload, /preferredRuntimePort/);
  assert.match(preload, /installStickyRuntimePort/);
  assert.match(preload, /BODY_RUNTIME_PORT/);
  assert.match(build, /ensureRememberedRuntimePort/);
  assert.match(build, /bodybrain-runtime\.json/);
  assert.match(build, /inactiveRecord\(endpointPort\)/);

  console.log('runtime_endpoint_contract: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});