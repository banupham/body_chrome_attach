'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runtimeDataDir } = require('./runtime_data_dir');

const RUNTIME_ENDPOINT_VERSION = 2;
const RUNTIME_PORT_VERSION = 1;
const RUNTIME_LOCK_VERSION = 2;
const RUNTIME_HOST = '127.0.0.1';
const RUNTIME_ENDPOINT_FILENAME = 'runtime-endpoint.json';
const RUNTIME_PORT_FILENAME = 'runtime-port.json';
const RUNTIME_LOCK_FILENAME = 'runtime.lock';
const BOOT_STALE_TOLERANCE_MS = 5000;
const RUNTIME_LOCK_HEARTBEAT_INTERVAL_MS = 2000;
const RUNTIME_LOCK_STALE_MS = 30000;

function validPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function endpointPaths(baseDir, env = process.env) {
  const dataRoot = runtimeDataDir(baseDir, env);
  return {
    state: path.join(dataRoot, 'state', RUNTIME_ENDPOINT_FILENAME),
    port: path.join(dataRoot, 'state', RUNTIME_PORT_FILENAME),
    lock: path.join(dataRoot, 'state', RUNTIME_LOCK_FILENAME),
    // Development builds may still mirror the live endpoint into dist. For a
    // packed Extension this path normally does not exist, so no package file is
    // mutated at runtime.
    extension: path.join(baseDir, '..', 'dist', RUNTIME_ENDPOINT_FILENAME)
  };
}

function endpointRecord(port, { pid = process.pid, now = () => Date.now(), ownerToken = null } = {}) {
  const normalized = validPort(port);
  if (!normalized) throw new Error('runtime_endpoint_port_invalid');
  const record = {
    schemaVersion: RUNTIME_ENDPOINT_VERSION,
    active: true,
    host: RUNTIME_HOST,
    port: normalized,
    wsUrl: `ws://${RUNTIME_HOST}:${normalized}`,
    pid: Number(pid) || null,
    startedAt: new Date(now()).toISOString()
  };
  const token = String(ownerToken || '').trim();
  if (token) record.ownerToken = token;
  return record;
}

function inactiveRecord(port = null) {
  const normalized = validPort(port);
  return {
    schemaVersion: RUNTIME_ENDPOINT_VERSION,
    active: false,
    host: RUNTIME_HOST,
    port: normalized,
    wsUrl: normalized ? `ws://${RUNTIME_HOST}:${normalized}` : null
  };
}

function processAlive(pid, killImpl = process.kill) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    killImpl(value, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function currentBootEpochMs({ now = Date.now, uptimeImpl = os.uptime } = {}) {
  let nowMs, uptimeSeconds;
  try { nowMs = Number(now()); } catch { return null; }
  try { uptimeSeconds = Number(uptimeImpl()); } catch { return null; }
  if (!Number.isFinite(nowMs) || !Number.isFinite(uptimeSeconds) || uptimeSeconds < 0) return null;
  return nowMs - uptimeSeconds * 1000;
}

function timestampPredatesCurrentBoot(value, { now = Date.now, uptimeImpl = os.uptime, toleranceMs = BOOT_STALE_TOLERANCE_MS } = {}) {
  const timestamp = Date.parse(String(value || ''));
  const bootEpoch = currentBootEpochMs({ now, uptimeImpl });
  if (!Number.isFinite(timestamp) || !Number.isFinite(bootEpoch)) return false;
  const tolerance = Math.max(0, Number(toleranceMs) || 0);
  return timestamp + tolerance < bootEpoch;
}

function runtimeRecordPredatesCurrentBoot(record, options = {}) {
  if (!record || typeof record !== 'object') return false;
  return timestampPredatesCurrentBoot(record.createdAt || record.startedAt, options);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  try {
    fs.renameSync(tmp, file);
  } catch (error) {
    if (error?.code !== 'EEXIST' && error?.code !== 'EPERM' && error?.code !== 'EACCES') throw error;
    try { fs.rmSync(file, { force: true }); } catch {}
    fs.renameSync(tmp, file);
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch {}
  }
  try { fs.chmodSync(file, 0o600); } catch {}
}

function readRememberedRuntimePort(baseDir) {
  const file = endpointPaths(baseDir).port;
  if (!fs.existsSync(file)) return null;
  const raw = readJson(file);
  const port = validPort(raw?.port);
  if (!raw || raw?.host !== RUNTIME_HOST || !port) throw new Error(`runtime_port_state_invalid:${file}`);
  return port;
}

function rememberRuntimePort(baseDir, port, { now = () => Date.now(), allowChange = false } = {}) {
  const normalized = validPort(port);
  if (!normalized) throw new Error('runtime_port_invalid');
  const paths = endpointPaths(baseDir);
  const current = readRememberedRuntimePort(baseDir);
  if (current && current !== normalized && !allowChange) {
    throw new Error(`runtime_port_change_forbidden:${current}:${normalized}`);
  }
  writeJsonAtomic(paths.port, {
    schemaVersion: RUNTIME_PORT_VERSION,
    host: RUNTIME_HOST,
    port: normalized,
    selectedAt: new Date(now()).toISOString()
  });
  return normalized;
}

function preferredRuntimePort(baseDir) {
  return readRememberedRuntimePort(baseDir) || 0;
}

function lockAgeMs(file, now = Date.now()) {
  try {
    return Math.max(0, Number(now) - fs.statSync(file).mtimeMs);
  } catch {
    return Infinity;
  }
}

function newRuntimeLockOwnerToken() {
  return crypto.randomBytes(16).toString('hex');
}

function runtimeLockLeaseFresh(record, { now = Date.now, staleAfterMs = RUNTIME_LOCK_STALE_MS } = {}) {
  if (!record || typeof record !== 'object') return false;
  const leaseAt = Date.parse(String(record.heartbeatAt || record.createdAt || ''));
  let nowMs;
  try { nowMs = Number(now()); } catch { return false; }
  if (!Number.isFinite(leaseAt) || !Number.isFinite(nowMs)) return false;
  const threshold = Math.max(RUNTIME_LOCK_HEARTBEAT_INTERVAL_MS * 2, Number(staleAfterMs) || RUNTIME_LOCK_STALE_MS);
  return nowMs - leaseAt <= threshold;
}

function writeRuntimeLockRecord(file, record) {
  const text = JSON.stringify(record) + '\n';
  let fd;
  try {
    fd = fs.openSync(file, 'r+');
    fs.ftruncateSync(fd, 0);
    fs.writeFileSync(fd, text, { encoding: 'utf8' });
    try { fs.fsyncSync(fd); } catch {}
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
  }
  try { fs.chmodSync(file, 0o600); } catch {}
}

function acquireRuntimeLock(baseDir, {
  pid = process.pid,
  killImpl = process.kill,
  now = Date.now,
  uptimeImpl = os.uptime,
  ownerToken = newRuntimeLockOwnerToken(),
  staleAfterMs = RUNTIME_LOCK_STALE_MS
} = {}) {
  const paths = endpointPaths(baseDir);
  const ownerPid = Number(pid);
  const normalizedOwnerToken = String(ownerToken || '').trim();
  if (!Number.isInteger(ownerPid) || ownerPid <= 0) throw new Error('runtime_lock_pid_invalid');
  if (!normalizedOwnerToken) throw new Error('runtime_lock_owner_token_invalid');
  fs.mkdirSync(path.dirname(paths.lock), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    const createdAt = new Date(now()).toISOString();
    const record = {
      schemaVersion: RUNTIME_LOCK_VERSION,
      pid: ownerPid,
      ownerToken: normalizedOwnerToken,
      createdAt,
      heartbeatAt: createdAt
    };
    try {
      fs.writeFileSync(paths.lock, JSON.stringify(record) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      try { fs.chmodSync(paths.lock, 0o600); } catch {}
      return { acquired: true, pid: ownerPid, ownerToken: normalizedOwnerToken, path: paths.lock };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const current = readJson(paths.lock);
      const currentPid = Number(current?.pid);
      if (runtimeRecordPredatesCurrentBoot(current, { now, uptimeImpl })) {
        try { fs.rmSync(paths.lock, { force: true }); } catch {}
        continue;
      }
      if (currentPid === ownerPid) {
        return {
          acquired: false,
          pid: ownerPid,
          ownerToken: String(current?.ownerToken || ''),
          path: paths.lock,
          alreadyOwned: true
        };
      }
      if (Number.isInteger(currentPid) && currentPid > 0 && processAlive(currentPid, killImpl)) {
        const leaseAware = Number(current?.schemaVersion) >= RUNTIME_LOCK_VERSION && String(current?.ownerToken || '').trim();
        if (leaseAware && !runtimeLockLeaseFresh(current, { now, staleAfterMs })) {
          try { fs.rmSync(paths.lock, { force: true }); } catch {}
          continue;
        }
        throw new Error(`company_runtime_already_running:${currentPid}`);
      }
      if ((!Number.isInteger(currentPid) || currentPid <= 0) && lockAgeMs(paths.lock, now()) < 10000) {
        throw new Error('company_runtime_lock_busy');
      }
      try { fs.rmSync(paths.lock, { force: true }); } catch {}
    }
  }
  throw new Error('company_runtime_lock_unavailable');
}

function refreshRuntimeLock(baseDir, { pid = process.pid, ownerToken, now = Date.now } = {}) {
  const paths = endpointPaths(baseDir);
  const current = readJson(paths.lock);
  const token = String(ownerToken || '').trim();
  if (!current || Number(current.pid) !== Number(pid) || !token || String(current.ownerToken || '') !== token) return false;
  const next = {
    ...current,
    schemaVersion: RUNTIME_LOCK_VERSION,
    heartbeatAt: new Date(now()).toISOString()
  };
  try {
    writeRuntimeLockRecord(paths.lock, next);
    return true;
  } catch {
    return false;
  }
}

function startRuntimeLockHeartbeat(baseDir, lock, { intervalMs = RUNTIME_LOCK_HEARTBEAT_INTERVAL_MS } = {}) {
  const pid = Number(lock?.pid);
  const ownerToken = String(lock?.ownerToken || '').trim();
  if (!Number.isInteger(pid) || pid <= 0 || !ownerToken) throw new Error('runtime_lock_heartbeat_owner_invalid');
  const interval = Math.max(250, Number(intervalMs) || RUNTIME_LOCK_HEARTBEAT_INTERVAL_MS);
  let timer = setInterval(() => {
    if (!refreshRuntimeLock(baseDir, { pid, ownerToken })) {
      clearInterval(timer);
      timer = null;
    }
  }, interval);
  if (typeof timer.unref === 'function') timer.unref();
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}

function releaseRuntimeLock(baseDir, { pid = process.pid, ownerToken = null } = {}) {
  const paths = endpointPaths(baseDir);
  const current = readJson(paths.lock);
  if (current && Number(current.pid) !== Number(pid)) return false;
  const token = String(ownerToken || '').trim();
  if (current && token && String(current.ownerToken || '') && String(current.ownerToken) !== token) return false;
  try {
    fs.rmSync(paths.lock, { force: true });
    return true;
  } catch {
    return false;
  }
}

function runtimeLockOwnedBy(stateFile, { pid = process.pid, ownerToken = null, now = Date.now } = {}) {
  const token = String(ownerToken || '').trim();
  if (!token) return false;
  const lockFile = path.join(path.dirname(stateFile), RUNTIME_LOCK_FILENAME);
  const lock = readJson(lockFile);
  return Number(lock?.pid) === Number(pid) && String(lock?.ownerToken || '') === token && runtimeLockLeaseFresh(lock, { now });
}

function assertRuntimeOwnershipAvailable(stateFile, {
  pid = process.pid,
  killImpl = process.kill,
  now = Date.now,
  uptimeImpl = os.uptime,
  ownerToken = null
} = {}) {
  const current = readJson(stateFile);
  const ownerPid = Number(current?.pid);
  if (current?.active === true && Number.isInteger(ownerPid) && ownerPid > 0 && ownerPid !== Number(pid) && processAlive(ownerPid, killImpl)) {
    if (runtimeRecordPredatesCurrentBoot(current, { now, uptimeImpl })) return true;
    if (runtimeLockOwnedBy(stateFile, { pid, ownerToken, now })) return true;
    throw new Error(`company_runtime_already_running:${ownerPid}:${validPort(current.port) || 'unknown'}`);
  }
  return true;
}

function publishRuntimeEndpoint(baseDir, port, options = {}) {
  const record = endpointRecord(port, options);
  const paths = endpointPaths(baseDir);
  const remembered = rememberRuntimePort(baseDir, record.port, { now: options.now || (() => Date.now()) });
  if (remembered !== record.port) throw new Error(`runtime_port_publish_mismatch:${remembered}:${record.port}`);
  assertRuntimeOwnershipAvailable(paths.state, {
    pid: record.pid,
    killImpl: options.killImpl || process.kill,
    now: options.now || Date.now,
    uptimeImpl: options.uptimeImpl || os.uptime,
    ownerToken: options.ownerToken || null
  });
  writeJsonAtomic(paths.state, record);
  if (fs.existsSync(path.dirname(paths.extension))) {
    writeJsonAtomic(paths.extension, {
      schemaVersion: record.schemaVersion,
      active: true,
      host: record.host,
      port: record.port,
      wsUrl: record.wsUrl,
      startedAt: record.startedAt
    });
  }
  return record;
}

function clearRuntimeEndpoint(baseDir, { pid = process.pid, ownerToken = null } = {}) {
  const paths = endpointPaths(baseDir);
  const current = readJson(paths.state);
  if (current?.active === true && Number(current.pid) !== Number(pid)) return false;
  const token = String(ownerToken || '').trim();
  if (current?.active === true && token && String(current.ownerToken || '') && String(current.ownerToken) !== token) return false;
  const remembered = readRememberedRuntimePort(baseDir);
  try { fs.rmSync(paths.state, { force: true }); } catch {}
  if (fs.existsSync(path.dirname(paths.extension))) {
    try { writeJsonAtomic(paths.extension, inactiveRecord(remembered)); } catch {}
  }
  return true;
}

function readRuntimeEndpoint(file) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error(`runtime_endpoint_unavailable:${file}`);
  }
  const port = validPort(raw?.port);
  if (raw?.active !== true || raw?.host !== RUNTIME_HOST || !port) throw new Error(`runtime_endpoint_inactive:${file}`);
  return {
    schemaVersion: Number(raw.schemaVersion) || RUNTIME_ENDPOINT_VERSION,
    active: true,
    host: RUNTIME_HOST,
    port,
    wsUrl: `ws://${RUNTIME_HOST}:${port}`,
    pid: raw.pid ?? null,
    startedAt: raw.startedAt || null
  };
}

module.exports = {
  RUNTIME_ENDPOINT_VERSION,
  RUNTIME_PORT_VERSION,
  RUNTIME_LOCK_VERSION,
  RUNTIME_HOST,
  RUNTIME_ENDPOINT_FILENAME,
  RUNTIME_PORT_FILENAME,
  RUNTIME_LOCK_FILENAME,
  BOOT_STALE_TOLERANCE_MS,
  RUNTIME_LOCK_HEARTBEAT_INTERVAL_MS,
  RUNTIME_LOCK_STALE_MS,
  validPort,
  endpointPaths,
  endpointRecord,
  inactiveRecord,
  processAlive,
  currentBootEpochMs,
  timestampPredatesCurrentBoot,
  runtimeRecordPredatesCurrentBoot,
  readJson,
  writeJsonAtomic,
  readRememberedRuntimePort,
  rememberRuntimePort,
  preferredRuntimePort,
  lockAgeMs,
  newRuntimeLockOwnerToken,
  runtimeLockLeaseFresh,
  acquireRuntimeLock,
  refreshRuntimeLock,
  startRuntimeLockHeartbeat,
  releaseRuntimeLock,
  runtimeLockOwnedBy,
  assertRuntimeOwnershipAvailable,
  publishRuntimeEndpoint,
  clearRuntimeEndpoint,
  readRuntimeEndpoint
};