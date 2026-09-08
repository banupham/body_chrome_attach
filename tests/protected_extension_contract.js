'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { RUNTIME_FILES, JS_FILES, OUTPUT_NAME, obfuscatorOptions } = require('../tools/protect_extension');
const { listZipEntries, readZipEntries } = require('../tools/package_extension');

const root = path.join(__dirname, '..');
const packageJson = require('../package.json');
const artifactsDir = path.join(root, 'artifacts');
const artifactZip = path.join(artifactsDir, OUTPUT_NAME);

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

test('single protected ZIP contains only Chrome runtime files', () => {
  assert.ok(fs.existsSync(artifactZip), 'run npm run extension:protected first');
  const zip = fs.readFileSync(artifactZip);
  assert.deepEqual(listZipEntries(zip).sort(), RUNTIME_FILES);
  const entries = readZipEntries(zip);
  assert.deepEqual([...entries.keys()].sort(), RUNTIME_FILES);
  const manifest = JSON.parse(entries.get('manifest.json').toString('utf8'));
  assert.equal(manifest.version, packageJson.version);
  for (const forbidden of ['src/', '.pem', '.pfx', '.crx', '.map', 'node_modules/', 'daemon/']) {
    assert.equal([...entries.keys()].some(name => name.includes(forbidden)), false, `forbidden release entry: ${forbidden}`);
  }
});

test('every shipped JavaScript bundle is obfuscated and MV3-CSP compatible', () => {
  const entries = readZipEntries(fs.readFileSync(artifactZip));
  const combined = [];
  for (const name of JS_FILES) {
    const protectedCode = entries.get(name).toString('utf8');
    assert.ok(protectedCode.length > 0, `${name} must not be empty`);
    assert.doesNotMatch(protectedCode, /sourceMappingURL\s*=/);
    assert.doesNotMatch(protectedCode, /(?:^|[^\w$])eval\s*\(/);
    assert.doesNotMatch(protectedCode, /new\s+Function\s*\(/);
    assert.doesNotThrow(() => new vm.Script(protectedCode, { filename: name }));
    combined.push(protectedCode);
  }
  const text = combined.join('\n');
  for (const marker of ['body.pairingStatus', 'automatic_local', 'Body daemon WebSocket closed']) {
    assert.equal(text.includes(marker), false, `plain-text runtime marker leaked: ${marker}`);
  }
});

test('extension release flow leaves no legacy duplicate artifacts or protected staging directory', () => {
  assert.equal(fs.existsSync(path.join(root, 'dist')), false, 'dist must be removed after protected packaging');
  assert.equal(fs.existsSync(path.join(root, 'dist_protected')), false, 'dist_protected must not be created');
  const names = fs.readdirSync(artifactsDir);
  const legacy = names.filter(name =>
    /^body-chrome-attach-v.*\.zip$/i.test(name) ||
    /-PROTECTED\.(zip|json)$/i.test(name) ||
    /\.crx$/i.test(name)
  );
  assert.deepEqual(legacy, []);
  assert.ok(names.includes(OUTPUT_NAME));
});
