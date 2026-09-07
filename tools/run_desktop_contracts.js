'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const tests = [
  path.join(root, 'tests', 'desktop_host_contract.py'),
  path.join(root, 'tests', 'desktop_host_foundation_contract.py')
];

const candidates = process.platform === 'win32'
  ? [
      { command: 'py', prefix: ['-3'] },
      { command: 'python', prefix: [] },
      { command: 'python3', prefix: [] }
    ]
  : [
      { command: 'python3', prefix: [] },
      { command: 'python', prefix: [] }
    ];

function findPython() {
  for (const candidate of candidates) {
    const probe = spawnSync(candidate.command, [...candidate.prefix, '--version'], {
      cwd: root,
      stdio: 'ignore'
    });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return null;
}

const python = findPython();
if (!python) {
  console.error('desktop_contract_python_runtime_not_found');
  process.exit(2);
}

for (const test of tests) {
  const result = spawnSync(python.command, [...python.prefix, test], {
    cwd: root,
    stdio: 'inherit'
  });
  if (result.error) {
    console.error(`desktop_contract_start_failed:${path.basename(test)}:${result.error.code || result.error.message}`);
    process.exit(2);
  }
  if (result.status !== 0) process.exit(Number.isInteger(result.status) ? result.status : 1);
}
