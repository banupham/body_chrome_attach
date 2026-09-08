'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const packageJson = require('../package.json');
const version = String(packageJson.version || '');
const releaseDir = path.join(root, 'release');
const outputPath = path.join(root, 'artifacts', `BodyChromeAttach-v${version}.crx`);
const expectedSha256 = '80aad0d0e86f6676481cdf82cf7173e624c74784384d63ae4763178c4bb06fd2';
const extensionId = 'lgjlhlfiihfbehgjghpbkmngfpdnclhc';

function payloadParts() {
  const prefix = `BodyChromeAttach-v${version}.crx.b64.part`;
  return fs.readdirSync(releaseDir)
    .filter(name => name.startsWith(prefix))
    .sort()
    .map(name => path.join(releaseDir, name));
}

function materialize() {
  if (version !== '0.8.0') throw new Error(`signed_crx_payload_version_missing:${version}`);
  const parts = payloadParts();
  if (parts.length !== 5) throw new Error(`signed_crx_payload_parts_invalid:${parts.length}`);
  const encoded = parts.map(file => fs.readFileSync(file, 'utf8')).join('').replace(/\s+/g, '');
  const crx = Buffer.from(encoded, 'base64');
  if (crx.length < 12 || crx.subarray(0, 4).toString('ascii') !== 'Cr24') throw new Error('signed_crx_invalid_magic');
  if (crx.readUInt32LE(4) !== 3) throw new Error(`signed_crx_version_invalid:${crx.readUInt32LE(4)}`);
  const actualSha256 = crypto.createHash('sha256').update(crx).digest('hex');
  if (actualSha256 !== expectedSha256) throw new Error(`signed_crx_sha256_mismatch:${actualSha256}`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, crx);
  console.log(`Materialized signed Extension CRX: ${outputPath}`);
  console.log(`CRX SHA256: ${actualSha256}`);
  console.log(`Extension ID: ${extensionId}`);
  return outputPath;
}

if (require.main === module) {
  try {
    materialize();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

module.exports = { materialize, expectedSha256, extensionId };
