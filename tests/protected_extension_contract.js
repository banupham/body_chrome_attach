'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { RUNTIME_FILES, JS_FILES, obfuscatorOptions } = require('../tools/protect_extension');
const { listZipEntries } = require('../tools/package_extension');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const protectedDir = path.join(root, 'dist_protected');
const packageJson = require('../package.json');
const artifactJson = path.join(root, 'artifacts', `BodyChromeAttach-v${packageJson.version}-PROTECTED.json`);
const artifactZip = path.join(root, 'artifacts', `BodyChromeAttach-v${packageJson.version}-PROTECTED.zip`);

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

test('offline protection profile is intentionally strong and CSP-compatible', () => {
  const options = obfuscatorOptions('service_worker.js');
  assert.equal(options.compact, true);
  assert.equal(options.controlFlowFlattening, true);
  assert.ok(options.controlFlowFlatteningThreshold >= 0.7);
  assert.equal(options.deadCodeInjection, true);
  assert.ok(options.deadCodeInjectionThreshold >= 0.15);
  assert.equal(options.selfDefending, true);
  assert.equal(options.splitStrings, true);
  assert.equal(options.stringArray, true);
  assert.deepEqual(options.stringArrayEncoding, ['base64']);
  assert.equal(options.stringArrayThreshold, 1);
  assert.equal(options.transformObjectKeys, true);
  assert.equal(options.renameGlobals, false);
  assert.equal(options.debugProtection, false);
});

test('protected directory contains only Chrome runtime files and every JS bundle is transformed', () => {
  assert.ok(fs.existsSync(protectedDir), 'run npm run extension:protected first');
  assert.deepEqual(fs.readdirSync(protectedDir).sort(), RUNTIME_FILES);

  const protectedCombined = [];
  for (const name of JS_FILES) {
    const original = fs.readFileSync(path.join(dist, name), 'utf8');
    const protectedCode = fs.readFileSync(path.join(protectedDir, name), 'utf8');
    assert.notEqual(protectedCode, original, `${name} must be transformed`);
    assert.ok(protectedCode.length > 0, `${name} must not be empty`);
    assert.doesNotMatch(protectedCode, /sourceMappingURL\s*=/);
    assert.doesNotThrow(() => new vm.Script(protectedCode, { filename: name }));
    protectedCombined.push(protectedCode);
  }

  const combined = protectedCombined.join('\n');
  for (const marker of ['body.pairingStatus', 'automatic_local', 'Body daemon WebSocket closed']) {
    assert.equal(combined.includes(marker), false, `plain-text runtime marker leaked: ${marker}`);
  }
});

test('protected release manifest hashes exactly match generated bundles', () => {
  assert.ok(fs.existsSync(artifactJson), 'protected release manifest missing');
  const manifest = JSON.parse(fs.readFileSync(artifactJson, 'utf8'));
  assert.equal(manifest.product, 'Body Chrome Attach');
  assert.equal(manifest.version, packageJson.version);
  assert.equal(manifest.protectionProfile, 'offline-obfuscated-v1');
  assert.equal(manifest.javascript.length, JS_FILES.length);

  for (const item of manifest.javascript) {
    assert.ok(JS_FILES.includes(item.file), `unexpected protected JS: ${item.file}`);
    const original = fs.readFileSync(path.join(dist, item.file));
    const protectedCode = fs.readFileSync(path.join(protectedDir, item.file));
    assert.equal(item.sourceSha256, sha256(original));
    assert.equal(item.protectedSha256, sha256(protectedCode));
    assert.notEqual(item.sourceSha256, item.protectedSha256);
  }
});

test('protected ZIP is deterministic-format and contains no source tree or signing key', () => {
  assert.ok(fs.existsSync(artifactZip), 'protected ZIP missing');
  const zip = fs.readFileSync(artifactZip);
  assert.deepEqual(listZipEntries(zip).sort(), RUNTIME_FILES);
  const names = listZipEntries(zip);
  for (const forbidden of ['src/', '.pem', '.map', 'node_modules/']) {
    assert.equal(names.some(name => name.includes(forbidden)), false, `forbidden protected artifact entry: ${forbidden}`);
  }
});
