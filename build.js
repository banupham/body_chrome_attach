'use strict';

const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');
const { inactiveRecord } = require('./daemon/src/runtime_endpoint');
const { ensureRememberedRuntimePort } = require('./daemon/src/runtime_port_migration');

const root = __dirname;
const dist = path.join(root, 'dist');
const daemonDir = path.join(root, 'daemon');

function assertLauncher(pathname, marker) {
  let text = '';
  try { text = fs.readFileSync(pathname, 'utf8'); } catch {}
  if (!text.trim() || !text.includes(marker)) {
    throw new Error(`launcher_invalid:${path.basename(pathname)}:restore_from_git`);
  }
}

assertLauncher(path.join(root, 'body.cmd'), 'body_cli.js');

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
  sourcemap: true,
  legalComments: 'none'
});

fs.copyFileSync(path.join(root, 'manifest.json'), path.join(dist, 'manifest.json'));
fs.copyFileSync(path.join(root, 'pairing.html'), path.join(dist, 'pairing.html'));
const rememberedPort = ensureRememberedRuntimePort(daemonDir);
fs.writeFileSync(path.join(dist, 'runtime-endpoint.json'), JSON.stringify(inactiveRecord(rememberedPort), null, 2) + '\n');
console.log(`Built extension: ${dist}${rememberedPort ? ` (remembered runtime port ${rememberedPort})` : ''}`);
