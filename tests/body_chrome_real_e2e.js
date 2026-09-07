'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const puppeteer = require('puppeteer');

const READY_TIMEOUT_SECONDS = 8;

function parseStatus(stdout) {
  const lines = String(stdout || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).reverse();
  for (const line of lines) {
    try {
      const payload = JSON.parse(line);
      if (payload && payload.product === 'BodyBrain') return payload;
    } catch {}
  }
  throw new Error(`bodybrain_json_status_missing:${JSON.stringify(stdout)}`);
}

function runBodyBrain(executable, localAppData) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['--check', '--json', '--ready-timeout', String(READY_TIMEOUT_SECONDS)], {
      env: { ...process.env, LOCALAPPDATA: localAppData },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      reject(new Error(`bodybrain_real_chrome_timeout:stdout=${JSON.stringify(stdout)}:stderr=${JSON.stringify(stderr)}`));
    }, 45000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code: Number(code), signal, stdout, stderr });
    });
  });
}

function runtimeLogTail(localAppData) {
  const logPath = path.join(localAppData, 'BodyBrain', 'logs', 'body-runtime.log');
  if (!fs.existsSync(logPath)) return 'body-runtime.log missing';
  return fs.readFileSync(logPath, 'utf8').split(/\r?\n/).slice(-80).join('\n');
}

function diagnosticText(diagnostics, localAppData) {
  return `workerDiagnostics=${JSON.stringify(diagnostics)}\nbodyRuntimeLogTail=\n${runtimeLogTail(localAppData)}`;
}

function assertConnectedRun(result, label, diagnostics, localAppData) {
  assert.ok([0, 2].includes(result.code), `${label}: BodyBrain check failed rc=${result.code}; stdout=${result.stdout}; stderr=${result.stderr}\n${diagnosticText(diagnostics, localAppData)}`);
  const payload = parseStatus(result.stdout);
  assert.equal(payload.bodyRuntime, 'CONNECTED', `${label}: BODY runtime must be connected`);
  assert.equal(payload.brain, 'NOT_CONFIGURED', `${label}: Brain must remain excluded from production`);

  const health = payload.health || {};
  const extension = health.extensionConnectivity || {};
  const guardian = health.guardian || {};
  assert.equal(extension.state, 'READY', `${label}: real Chrome BODY Extension did not connect: ${JSON.stringify(extension)}\n${diagnosticText(diagnostics, localAppData)}`);
  assert.ok(['READY', 'BLOCKED', 'WAITING'].includes(guardian.state), `${label}: Guardian health invalid: ${JSON.stringify(guardian)}`);

  const browsers = Array.isArray(payload.guardianReadiness?.browsers) ? payload.guardianReadiness.browsers : [];
  assert.ok(browsers.length > 0, `${label}: real Chrome BrowserInstance missing from BODY status`);
  assert.equal(browsers.some(row => String(row?.reason || '') === 'browser_offline'), false, `${label}: real Chrome was stale/offline: ${JSON.stringify(browsers)}\n${diagnosticText(diagnostics, localAppData)}`);
  return payload;
}

function readPairing(localAppData) {
  const pairedPath = path.join(localAppData, 'BodyBrain', 'body', 'profiles', '.auth', 'extensions.json');
  assert.equal(fs.existsSync(pairedPath), true, `Extension pairing state missing: ${pairedPath}`);
  const paired = JSON.parse(fs.readFileSync(pairedPath, 'utf8'));
  assert.ok(paired && typeof paired === 'object' && Object.keys(paired).length > 0, 'Extension pairing state is empty');
  return paired;
}

function firstTokenHash(paired) {
  const key = Object.keys(paired)[0];
  const hash = String(paired[key]?.tokenHash || '');
  assert.ok(hash.length > 0, 'Extension pairing token hash missing');
  return hash;
}

async function delay(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

function remoteValue(arg) {
  return arg?.value ?? arg?.unserializableValue ?? arg?.description ?? arg?.type ?? 'unknown';
}

async function startWorkerDiagnostics(extension) {
  const diagnostics = { samples: [], console: [], exceptions: [] };
  const attached = new Set();
  let stopped = false;

  async function sample() {
    if (stopped) return;
    try {
      const workers = await extension.workers();
      diagnostics.samples.push({ at: Date.now(), count: workers.length, urls: workers.map(worker => worker.url()) });
      if (diagnostics.samples.length > 80) diagnostics.samples.shift();
      for (const worker of workers) {
        const url = worker.url();
        if (attached.has(url)) continue;
        attached.add(url);
        worker.client.on('Runtime.consoleAPICalled', event => {
          diagnostics.console.push({ at: Date.now(), type: event.type, args: (event.args || []).map(remoteValue) });
          if (diagnostics.console.length > 80) diagnostics.console.shift();
        });
        worker.client.on('Runtime.exceptionThrown', event => {
          diagnostics.exceptions.push({ at: Date.now(), exception: event.exceptionDetails?.exception?.description || event.exceptionDetails?.text || 'unknown' });
          if (diagnostics.exceptions.length > 40) diagnostics.exceptions.shift();
        });
      }
    } catch (error) {
      diagnostics.samples.push({ at: Date.now(), error: String(error?.message || error) });
    }
  }

  await sample();
  const timer = setInterval(() => { sample().catch(() => {}); }, 500);
  return {
    diagnostics,
    stop() {
      stopped = true;
      clearInterval(timer);
    }
  };
}

async function main() {
  if (process.platform !== 'win32') throw new Error('body_chrome_real_e2e_windows_only');
  if (process.argv.length !== 4) throw new Error('usage: node body_chrome_real_e2e.js <BodyBrain.exe> <extension-dir>');

  const executable = path.resolve(process.argv[2]);
  const extensionDir = path.resolve(process.argv[3]);
  assert.equal(fs.existsSync(executable), true, `BodyBrain.exe missing: ${executable}`);
  assert.equal(fs.existsSync(path.join(extensionDir, 'manifest.json')), true, `Extension dist missing: ${extensionDir}`);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'body-real-chrome-e2e-'));
  const localAppData = path.join(tempRoot, 'local-app-data');
  fs.mkdirSync(localAppData, { recursive: true });
  let browser = null;
  let workerDiagnostics = null;
  try {
    browser = await puppeteer.launch({ headless: true, pipe: true, enableExtensions: true });
    const extensionId = await browser.installExtension(extensionDir);
    assert.equal(typeof extensionId, 'string');
    assert.ok(extensionId.length > 0, 'Puppeteer did not return an Extension id');
    const extensions = await browser.extensions();
    const extension = extensions.get(extensionId);
    assert.ok(extension, `BODY Extension not installed in Chrome for Testing: ${extensionId}`);
    workerDiagnostics = await startWorkerDiagnostics(extension);

    const page = await browser.newPage();
    await page.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });

    const first = await runBodyBrain(executable, localAppData);
    assertConnectedRun(first, 'first-start', workerDiagnostics.diagnostics, localAppData);
    const firstPairing = readPairing(localAppData);
    const tokenHash = firstTokenHash(firstPairing);

    // The first --check exits cleanly and stops the hosted BODY runtime. Keep Chrome
    // open, then restart the real EXE and require the already-paired Extension to
    // reconnect automatically without reinstalling/reloading it.
    await delay(1500);
    const second = await runBodyBrain(executable, localAppData);
    assertConnectedRun(second, 'desktop-restart', workerDiagnostics.diagnostics, localAppData);
    const secondPairing = readPairing(localAppData);
    assert.equal(firstTokenHash(secondPairing), tokenHash, 'Extension token rotated instead of reusing persisted automatic pairing after Desktop restart');

    console.log('body_chrome_real_e2e: PASS');
  } finally {
    workerDiagnostics?.stop();
    if (browser) {
      try { await browser.close(); } catch {}
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
