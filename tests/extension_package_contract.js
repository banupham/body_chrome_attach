'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../package.json');
const { EXPECTED_ENTRIES, listZipEntries } = require('../tools/package_extension');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const artifact = path.join(root, 'artifacts', `body-chrome-attach-v${pkg.version}.zip`);

assert.ok(fs.existsSync(artifact), 'release ZIP must exist after npm run extension:package');

const zip = fs.readFileSync(artifact);
assert.equal(zip.readUInt32LE(0), 0x04034b50, 'artifact must be a ZIP archive');
assert.deepEqual(listZipEntries(zip).sort(), [...EXPECTED_ENTRIES], 'ZIP may contain only approved Extension runtime files');

for (const forbidden of ['src/', 'daemon/', 'node_modules/', 'package.json']) {
  assert.equal(listZipEntries(zip).some(name => name.startsWith(forbidden) || name === forbidden), false, `release ZIP must not contain ${forbidden}`);
}
assert.equal(listZipEntries(zip).some(name => name.endsWith('.map')), false, 'release ZIP must not contain sourcemaps');
assert.equal(listZipEntries(zip).some(name => name.endsWith('.pem')), false, 'release ZIP must never contain signing keys');

const endpoint = JSON.parse(fs.readFileSync(path.join(dist, 'runtime-endpoint.json'), 'utf8'));
assert.equal(endpoint.active, false, 'release endpoint must start inactive');
assert.equal(endpoint.port, null, 'release endpoint must not embed a build-machine runtime port');
assert.equal(endpoint.wsUrl, null, 'release endpoint must not embed a build-machine websocket URL');

for (const name of EXPECTED_ENTRIES.filter(name => name.endsWith('.js'))) {
  const text = fs.readFileSync(path.join(dist, name), 'utf8');
  assert.equal(/sourceMappingURL\s*=/.test(text), false, `${name} must not reference a sourcemap`);
}

const distNames = fs.readdirSync(dist).sort();
assert.deepEqual(distNames, [...EXPECTED_ENTRIES], 'release dist must contain only approved runtime files');

console.log('extension_package_contract: PASS');
