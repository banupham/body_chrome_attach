'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const runtimeConfig = require('../config/bodybrain-runtime.json');
const { EXPECTED_ENTRIES, assertReleaseDist } = require('../tools/package_extension');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

assert.deepEqual(assertReleaseDist(), [...EXPECTED_ENTRIES], 'release dist must contain only approved Extension runtime files');

const endpoint = JSON.parse(fs.readFileSync(path.join(dist, 'runtime-endpoint.json'), 'utf8'));
assert.equal(endpoint.active, false, 'release endpoint must start inactive');
assert.equal(endpoint.host, runtimeConfig.host, 'release endpoint host must match BodyBrain runtime contract');
assert.equal(endpoint.port, runtimeConfig.port, 'release endpoint must use the product bootstrap port');
assert.equal(endpoint.wsUrl, `ws://${runtimeConfig.host}:${runtimeConfig.port}`, 'release websocket URL must be deterministic');

for (const forbidden of ['src', 'daemon', 'node_modules']) {
  assert.equal(fs.existsSync(path.join(dist, forbidden)), false, `release dist must not contain ${forbidden}`);
}
for (const name of EXPECTED_ENTRIES.filter(name => name.endsWith('.js'))) {
  const text = fs.readFileSync(path.join(dist, name), 'utf8');
  assert.equal(/sourceMappingURL\s*=/.test(text), false, `${name} must not reference a sourcemap`);
}

console.log('extension_package_contract: PASS');