'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { materialize: materializeSignedCrx } = require('./materialize_extension_crx');

const root = path.join(__dirname, '..');
const distDir = path.join(root, 'dist');
const artifactsDir = path.join(root, 'artifacts');
const packageJson = require('../package.json');
const runtimeConfig = require('../config/bodybrain-runtime.json');

const EXPECTED_ENTRIES = Object.freeze([
  'manifest.json',
  'pairing.html',
  'runtime-endpoint.json',
  'service_worker.js',
  'virtual_cursor_content.js',
  'pairing_popup.js'
].sort());

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function assertReleaseDist() {
  if (!fs.existsSync(distDir)) throw new Error('extension_dist_missing:run_npm_run_build');
  const actual = fs.readdirSync(distDir, { withFileTypes: true });
  const files = actual.filter(item => item.isFile()).map(item => item.name).sort();
  const directories = actual.filter(item => item.isDirectory()).map(item => item.name);
  if (directories.length) throw new Error(`extension_release_nested_directories_forbidden:${directories.join(',')}`);
  if (JSON.stringify(files) !== JSON.stringify(EXPECTED_ENTRIES)) {
    throw new Error(`extension_release_contents_invalid:expected=${EXPECTED_ENTRIES.join(',')}:actual=${files.join(',')}`);
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8'));
  if (String(manifest.version || '') !== String(packageJson.version || '')) {
    throw new Error(`extension_release_version_mismatch:${manifest.version}:${packageJson.version}`);
  }

  const endpoint = JSON.parse(fs.readFileSync(path.join(distDir, 'runtime-endpoint.json'), 'utf8'));
  const expectedHost = String(runtimeConfig.host || '');
  const expectedPort = Number(runtimeConfig.port);
  const expectedUrl = `ws://${expectedHost}:${expectedPort}`;
  if (
    endpoint.active !== false ||
    endpoint.host !== expectedHost ||
    endpoint.port !== expectedPort ||
    endpoint.wsUrl !== expectedUrl
  ) {
    throw new Error('extension_release_runtime_endpoint_contract_mismatch');
  }

  for (const name of files.filter(name => name.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(distDir, name), 'utf8');
    if (/sourceMappingURL\s*=/.test(text)) throw new Error(`extension_release_sourcemap_reference_forbidden:${name}`);
  }

  return files;
}

function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const dosTime = 0;
  const dosDate = (1 << 5) | 1;

  for (const entry of entries) {
    const name = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const checksum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function findEndOfCentralDirectory(buffer) {
  const signature = 0x06054b50;
  const minOffset = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= minOffset; offset--) {
    if (buffer.readUInt32LE(offset) === signature) return offset;
  }
  throw new Error('zip_eocd_not_found');
}

function listZipEntries(buffer) {
  const eocd = findEndOfCentralDirectory(buffer);
  const total = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const names = [];
  for (let i = 0; i < total; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error(`zip_central_header_invalid:${i}`);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    names.push(buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

function packageExtension() {
  const files = assertReleaseDist();
  const entries = files.map(name => ({ name, data: fs.readFileSync(path.join(distDir, name)) }));
  const zip = createZip(entries);
  const listed = listZipEntries(zip).sort();
  if (JSON.stringify(listed) !== JSON.stringify(EXPECTED_ENTRIES)) throw new Error('extension_release_zip_entry_mismatch');

  fs.mkdirSync(artifactsDir, { recursive: true });
  const output = path.join(artifactsDir, `body-chrome-attach-v${packageJson.version}.zip`);
  fs.writeFileSync(output, zip);
  console.log(`Packaged extension: ${output}`);
  return output;
}

if (require.main === module) {
  try {
    packageExtension();
    materializeSignedCrx();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

module.exports = {
  EXPECTED_ENTRIES,
  crc32,
  createZip,
  listZipEntries,
  assertReleaseDist,
  packageExtension
};
