'use strict';

const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');
const { inactiveRecord } = require('./daemon/src/runtime_endpoint');
const { ensureRememberedRuntimePort } = require('./daemon/src/runtime_port_migration');

const root = __dirname;
const dist = path.join(root, 'dist');
const daemonDir = path.join(root, 'daemon');
const runtimeConfig = JSON.parse(fs.readFileSync(path.join(root, 'config', 'bodybrain-runtime.json'), 'utf8'));
const productionRuntimePort = Number(runtimeConfig.port);
const devBuild = process.argv.includes('--dev');

if (!Number.isInteger(productionRuntimePort) || productionRuntimePort < 1 || productionRuntimePort > 65535) {
  throw new Error('bodybrain_runtime_port_invalid');
}
if (runtimeConfig.host !== '127.0.0.1') throw new Error('bodybrain_runtime_host_must_be_localhost');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

esbuild.buildSync({
  entryPoints: {
    service_worker: path.join(root, 'src', 'service_worker_entry.js'),
    virtual_cursor_content: path.join(root, 'src', 'virtual_cursor_content.js'),
    pairing_popup: path.join(root, 'src', 'pairing_popup.js')
  },
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['chrome125'],
  outdir: dist,
  entryNames: '[name]',
  minify: !devBuild,
  sourcemap: devBuild ? 'external' : false,
  sourcesContent: devBuild,
  legalComments: 'none'
});

fs.copyFileSync(path.join(root, 'manifest.json'), path.join(dist, 'manifest.json'));
fs.copyFileSync(path.join(root, 'pairing.html'), path.join(dist, 'pairing.html'));

// Development builds may reuse the local daemon port selected on that machine.
// Production packages instead carry the product bootstrap port from the shared
// BodyBrain runtime contract. The Desktop Host starts BODY on exactly this port,
// so a signed/packed Extension never depends on rewriting its own files at runtime.
const endpointPort = devBuild ? ensureRememberedRuntimePort(daemonDir) : productionRuntimePort;
fs.writeFileSync(
  path.join(dist, 'runtime-endpoint.json'),
  JSON.stringify(inactiveRecord(endpointPort), null, 2) + '\n'
);

console.log(
  `Built ${devBuild ? 'development' : 'release'} extension: ${dist}` +
  (endpointPort ? ` (runtime bootstrap port ${endpointPort})` : '')
);
