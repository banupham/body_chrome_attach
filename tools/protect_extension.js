'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const JavaScriptObfuscator = require('javascript-obfuscator');
const { createZip, listZipEntries } = require('./package_extension');

const root = path.join(__dirname, '..');
const sourceDir = path.join(root, 'dist');
const protectedDir = path.join(root, 'dist_protected');
const artifactsDir = path.join(root, 'artifacts');
const packageJson = require('../package.json');

const RUNTIME_FILES = Object.freeze([
  'manifest.json',
  'pairing.html',
  'runtime-endpoint.json',
  'service_worker.js',
  'virtual_cursor_content.js',
  'pairing_popup.js'
].sort());
const JS_FILES = Object.freeze(RUNTIME_FILES.filter(name => name.endsWith('.js')));

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function deterministicSeed() {
  const digest = crypto
    .createHash('sha256')
    .update(`${packageJson.name}@${packageJson.version}:offline-protected-v1`)
    .digest();
  return digest.readUInt32LE(0);
}

function assertSourceDist() {
  if (!fs.existsSync(sourceDir)) throw new Error('protected_extension_source_missing:run_npm_run_build');
  const actual = fs.readdirSync(sourceDir, { withFileTypes: true });
  const files = actual.filter(item => item.isFile()).map(item => item.name).sort();
  const dirs = actual.filter(item => item.isDirectory()).map(item => item.name);
  if (dirs.length) throw new Error(`protected_extension_source_nested_directories:${dirs.join(',')}`);
  if (JSON.stringify(files) !== JSON.stringify(RUNTIME_FILES)) {
    throw new Error(`protected_extension_source_contents_invalid:${files.join(',')}`);
  }
}

function obfuscatorOptions(fileName) {
  return {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.75,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.2,
    debugProtection: false,
    disableConsoleOutput: false,
    identifierNamesGenerator: 'hexadecimal',
    identifiersPrefix: `_body_${path.basename(fileName, '.js').replace(/[^a-z0-9_]/gi, '_')}_`,
    log: false,
    numbersToExpressions: true,
    renameGlobals: false,
    selfDefending: true,
    simplify: true,
    sourceMap: false,
    splitStrings: true,
    splitStringsChunkLength: 6,
    stringArray: true,
    stringArrayCallsTransform: true,
    stringArrayCallsTransformThreshold: 0.75,
    stringArrayEncoding: ['base64'],
    stringArrayIndexesType: ['hexadecimal-number'],
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersChainedCalls: true,
    stringArrayWrappersCount: 2,
    stringArrayWrappersParametersMaxCount: 4,
    stringArrayWrappersType: 'function',
    stringArrayThreshold: 1,
    target: 'browser-no-eval',
    transformObjectKeys: true,
    unicodeEscapeSequence: false,
    seed: deterministicSeed()
  };
}

function protectJavaScript(name) {
  const source = fs.readFileSync(path.join(sourceDir, name), 'utf8');
  const protectedSource = JavaScriptObfuscator.obfuscate(source, obfuscatorOptions(name)).getObfuscatedCode();
  if (!protectedSource.trim()) throw new Error(`protected_extension_empty_output:${name}`);
  if (protectedSource === source) throw new Error(`protected_extension_unchanged_output:${name}`);
  if (/sourceMappingURL\s*=/.test(protectedSource)) throw new Error(`protected_extension_sourcemap_forbidden:${name}`);
  if (/(?:^|[^\w$])eval\s*\(/.test(protectedSource)) throw new Error(`protected_extension_eval_forbidden:${name}`);
  if (/new\s+Function\s*\(/.test(protectedSource)) throw new Error(`protected_extension_function_constructor_forbidden:${name}`);
  new vm.Script(protectedSource, { filename: name });
  fs.writeFileSync(path.join(protectedDir, name), protectedSource, 'utf8');
}

function buildProtectedExtension() {
  assertSourceDist();
  fs.rmSync(protectedDir, { recursive: true, force: true });
  fs.mkdirSync(protectedDir, { recursive: true });

  for (const name of RUNTIME_FILES.filter(name => !name.endsWith('.js'))) {
    fs.copyFileSync(path.join(sourceDir, name), path.join(protectedDir, name));
  }
  for (const name of JS_FILES) protectJavaScript(name);

  const protectedFiles = fs.readdirSync(protectedDir).sort();
  if (JSON.stringify(protectedFiles) !== JSON.stringify(RUNTIME_FILES)) {
    throw new Error(`protected_extension_contents_invalid:${protectedFiles.join(',')}`);
  }

  const entries = RUNTIME_FILES.map(name => ({ name, data: fs.readFileSync(path.join(protectedDir, name)) }));
  const zip = createZip(entries);
  if (JSON.stringify(listZipEntries(zip).sort()) !== JSON.stringify(RUNTIME_FILES)) {
    throw new Error('protected_extension_zip_contents_invalid');
  }

  fs.mkdirSync(artifactsDir, { recursive: true });
  const zipPath = path.join(artifactsDir, `BodyChromeAttach-v${packageJson.version}-PROTECTED.zip`);
  fs.writeFileSync(zipPath, zip);
  const zipSha256 = sha256(zip);

  console.log(`Protected Extension directory: ${protectedDir}`);
  console.log(`Protected Extension package:   ${zipPath}`);
  console.log(`Protected ZIP SHA256:          ${zipSha256}`);
  return { protectedDir, zipPath, zipSha256 };
}

if (require.main === module) {
  try {
    buildProtectedExtension();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

module.exports = { RUNTIME_FILES, JS_FILES, deterministicSeed, obfuscatorOptions, buildProtectedExtension };