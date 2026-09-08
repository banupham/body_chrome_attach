'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const JavaScriptObfuscator = require('javascript-obfuscator');
const { EXPECTED_ENTRIES, assertReleaseDist, createZip, listZipEntries } = require('./package_extension');

const root = path.join(__dirname, '..');
const sourceDir = path.join(root, 'dist');
const artifactsDir = path.join(root, 'artifacts');
const packageJson = require('../package.json');

const RUNTIME_FILES = EXPECTED_ENTRIES;
const JS_FILES = Object.freeze(RUNTIME_FILES.filter(name => name.endsWith('.js')));
const OUTPUT_NAME = `BodyChromeAttach-v${packageJson.version}.zip`;

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
  return {
    entry: { name, data: Buffer.from(protectedSource, 'utf8') },
    metadata: {
      file: name,
      sourceSha256: sha256(Buffer.from(source)),
      protectedSha256: sha256(Buffer.from(protectedSource)),
      sourceBytes: Buffer.byteLength(source),
      protectedBytes: Buffer.byteLength(protectedSource)
    }
  };
}

function removeLegacyExtensionArtifacts() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  const legacy = [
    /^body-chrome-attach-v.*\.zip$/i,
    /^BodyChromeAttach-v.*-PROTECTED\.(zip|json)$/i,
    /^BodyChromeAttach-v.*\.crx$/i,
    /^BodyChromeAttach-v.*\.zip$/i
  ];
  for (const name of fs.readdirSync(artifactsDir)) {
    if (legacy.some(pattern => pattern.test(name))) fs.rmSync(path.join(artifactsDir, name), { force: true });
  }
}

function buildProtectedExtension() {
  assertReleaseDist();
  removeLegacyExtensionArtifacts();

  const protectedByName = new Map();
  const javascript = [];
  for (const name of JS_FILES) {
    const { entry, metadata } = protectJavaScript(name);
    protectedByName.set(name, entry.data);
    javascript.push(metadata);
  }

  const entries = RUNTIME_FILES.map(name => ({
    name,
    data: protectedByName.get(name) || fs.readFileSync(path.join(sourceDir, name))
  }));
  const zip = createZip(entries);
  if (JSON.stringify(listZipEntries(zip).sort()) !== JSON.stringify(RUNTIME_FILES)) {
    throw new Error('protected_extension_zip_contents_invalid');
  }

  const output = path.join(artifactsDir, OUTPUT_NAME);
  fs.writeFileSync(output, zip);
  const zipSha256 = sha256(zip);
  const manifest = {
    product: 'Body Chrome Attach',
    version: String(packageJson.version),
    protectionProfile: 'offline-obfuscated-v1',
    target: 'browser-no-eval',
    deterministicSeed: deterministicSeed(),
    sha256: zipSha256,
    javascript
  };

  // dist is only an intermediate; leave only the distributable ZIP behind.
  fs.rmSync(sourceDir, { recursive: true, force: true });

  console.log(`Protected Extension package: ${output}`);
  console.log(`Protected ZIP SHA256:        ${zipSha256}`);
  return { output, zipSha256, manifest };
}

if (require.main === module) {
  try {
    buildProtectedExtension();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

module.exports = {
  RUNTIME_FILES,
  JS_FILES,
  OUTPUT_NAME,
  deterministicSeed,
  obfuscatorOptions,
  buildProtectedExtension
};
