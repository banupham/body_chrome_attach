'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const packageJson = require('../package.json');
const version = String(packageJson.version || '');
const payloadPath = path.join(root, 'release', `BodyChromeAttach-v${version}.crx.b64`);
const outputPath = path.join(root, 'artifacts', `BodyChromeAttach-v${version}.crx`);
const expectedSha256 = '80aad0d0e86f6676481cdf82cf7173e624c74784384d63ae4763178c4bb06fd2';

function materialize() {
  if (version !== '0.8.0') throw new Error(`signed_crx_payload_version_missing:${version}`);
  if (!fs.existsSync(payloadPath)) throw new Error(`signed_crx_payload_missing:${payloadPath}`);
  const encoded = fs.readFileSync(payloadPath, 'utf8').replace(/\s+/g, '');
  const crx = Buffer.from(encoded, 'base64');
  if (crx.length < 12 || crx.subarray(0, 4).toString('ascii') !== 'Cr24') throw new Error('signed_crx_invalid_magic');
  if (crx.readUInt32LE(4) !== 3) throw new Error(`signed_crx_version_invalid:${crx.readUInt32LE(4)}`);
  const actualSha256 = crypto.createHash('sha256').update(crx).digest('hex');
  if (actualSha256 !== expectedSha256) throw new Error(`signed_crx_sha256_mismatch:${actualSha256}`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, crx);
  console.log(`Materialized signed Extension CRX: ${outputPath}`);
  console.log(`CRX SHA256: ${actualSha256}`);
  console.log('Extension ID: lgjlhlfiihfbehgjghpbkmngfpdnclhc');
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

module.exports = { materialize, expectedSha256 };
