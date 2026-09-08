'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { RUNTIME_FILES, JS_FILES, obfuscatorOptions } = require('../tools/protect_extension');
const { listZipEntries } = require('../tools/package_extension');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const protectedDir = path.join(root, 'dist_protected');
const version = require('../package.json').version;
const artifactZip = path.join(root, 'artifacts', `BodyChromeAttach-v${version}-PROTECTED.zip`);

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
  assert.equal(options.target, 'browser-no-eval');
  assert.equal(options.sourceMap, false);
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
    assert.doesNotMatch(protectedCode, /(?:^|[^\w$])eval\s*\(/);
    assert.doesNotMatch(protectedCode, /new\s+Function\s*\(/);
    assert.doesNotThrow(() => new vm.Script(protectedCode, { filename: name }));
    protectedCombined.push(protectedCode);
  }

  const combined = protectedCombined.join('\n');
  for (const marker of ['body.pairingStatus', 'automatic_local', 'Body daemon WebSocket closed']) {
    assert.equal(combined.includes(marker), false, `plain-text runtime marker leaked: ${marker}`);
  }
});

test('protected ZIP contains only runtime files and no source/signing material', () => {
  assert.ok(fs.existsSync(artifactZip), 'protected ZIP missing');
  const names = listZipEntries(fs.readFileSync(artifactZip));
  assert.deepEqual(names.sort(), RUNTIME_FILES);
  for (const forbidden of ['src/', '.pem', '.map', 'node_modules/']) {
    assert.equal(names.some(name => name.includes(forbidden)), false, `forbidden protected artifact entry: ${forbidden}`);
  }
});