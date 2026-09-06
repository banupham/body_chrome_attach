'use strict';

const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const dist = path.join(root, 'dist');

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
console.log(`Built extension: ${dist}`);
