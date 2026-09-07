'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const puppeteer = require('puppeteer');

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
    const child = spawn(executable, ['--check', '--json', '--ready-timeout', '25'], {
      env: { ...process.env, LOCALAPPDATA: localAppData },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      reject(new Error(`bodybrain_real_chrome_timeout:stdout=${JSON.stringify(stdout)}:stderr=${JSON.stringify(stderr)}`));
    }, 75000);
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
  try {
    browser = await puppeteer.launch({
      headless: true,
      pipe: true,
      enableExtensions: true
    });
    const extensionId = await browser.installExtension(extensionDir);
    assert.equal(typeof extensionId, 'string');
    assert.ok(extensionId.length > 0, 'Puppeteer did not return an Extension id');
    const extensions = await browser.extensions();
    assert.ok(extensions.get(extensionId), `BODY Extension not installed in Chrome for Testing: ${extensionId}`);

    const page = await browser.newPage();
    await page.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });

    const result = await runBodyBrain(executable, localAppData);
    assert.ok([0, 2].includes(result.code), `BodyBrain real-Chrome check failed rc=${result.code}; stdout=${result.stdout}; stderr=${result.stderr}`);
    const payload = parseStatus(result.stdout);
    assert.equal(payload.bodyRuntime, 'CONNECTED', 'BODY runtime must be connected');
    assert.equal(payload.brain, 'NOT_CONFIGURED', 'Brain must remain excluded from production');

    const health = payload.health || {};
    const extension = health.extensionConnectivity || {};
    const guardian = health.guardian || {};
    assert.equal(extension.state, 'READY', `real Chrome BODY Extension did not connect: ${JSON.stringify(extension)}`);
    assert.ok(['READY', 'BLOCKED'].includes(guardian.state), `Guardian did not resolve fail-closed readiness: ${JSON.stringify(guardian)}`);

    const browsers = Array.isArray(payload.guardianReadiness?.browsers) ? payload.guardianReadiness.browsers : [];
    assert.ok(browsers.length > 0, 'real Chrome BrowserInstance missing from BODY status');
    assert.equal(browsers.some(row => String(row?.reason || '') === 'browser_offline'), false, `real Chrome was stale/offline: ${JSON.stringify(browsers)}`);

    const pairedPath = path.join(localAppData, 'BodyBrain', 'body', 'profiles', '.auth', 'extensions.json');
    assert.equal(fs.existsSync(pairedPath), true, `Extension pairing state missing: ${pairedPath}`);
    const paired = JSON.parse(fs.readFileSync(pairedPath, 'utf8'));
    assert.ok(paired && typeof paired === 'object' && Object.keys(paired).length > 0, 'Extension pairing state is empty');

    console.log('body_chrome_real_e2e: PASS');
  } finally {
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
