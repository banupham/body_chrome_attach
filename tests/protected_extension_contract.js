'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  RUNTIME_FILES,
  JS_FILES,
  OUTPUT_NAME,
  protectionProfile,
  obfuscatorOptions
} = require('../tools/protect_extension');
const { listZipEntries, readZipEntries } = require('../tools/package_extension');

const root = path.join(__dirname, '..');
const packageJson = require('../package.json');
const artifactsDir = path.join(root, 'artifacts');
const artifactZip = path.join(artifactsDir, OUTPUT_NAME);

function extensionEvent() {
  const listeners = [];
  return {
    listeners,
    addListener(listener) { listeners.push(listener); },
    removeListener(listener) {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    }
  };
}

function protectedWorkerHarness(protectedCode) {
  const onMessage = extensionEvent();
  const noopEvent = () => extensionEvent();
  const storage = {};

  class FakeWebSocket {
    static OPEN = 1;
    constructor(url) {
      this.url = String(url || '');
      this.readyState = 0;
      this.listeners = new Map();
    }
    addEventListener(type, listener) {
      const rows = this.listeners.get(String(type)) || [];
      rows.push(listener);
      this.listeners.set(String(type), rows);
    }
    send() { return true; }
    close() { this.readyState = 3; }
  }

  const chrome = {
    runtime: {
      id: 'abcdefghijklmnopabcdefghijklmnop',
      getURL(resource) { return `chrome-extension://abcdefghijklmnopabcdefghijklmnop/${resource}`; },
      onMessage,
      onStartup: noopEvent(),
      onInstalled: noopEvent(),
      async sendMessage() { return { ok: true }; }
    },
    storage: {
      local: {
        async get(defaults = {}) { return { ...defaults, ...storage }; },
        async set(values = {}) { Object.assign(storage, values); },
        async remove(key) {
          for (const name of Array.isArray(key) ? key : [key]) delete storage[name];
        }
      }
    },
    tabs: {
      async query() { return []; },
      async get() { return null; },
      async sendMessage() { return { ok: true }; },
      onActivated: noopEvent(),
      onUpdated: noopEvent(),
      onRemoved: noopEvent()
    },
    windows: { onFocusChanged: noopEvent() },
    alarms: {
      async get() { return null; },
      async create() {},
      onAlarm: noopEvent()
    },
    debugger: {
      async attach() {},
      async detach() {},
      async sendCommand() { return {}; },
      onDetach: noopEvent()
    },
    scripting: { async executeScript() { return []; } },
    proxy: { settings: { async get() { return { value: { mode: 'direct' } }; } } },
    privacy: { network: { webRTCIPHandlingPolicy: { async get() { return { value: 'default' }; } } } },
    system: {
      cpu: { async getInfo() { return { numOfProcessors: 4, archName: 'x86-64', modelName: 'contract' }; } },
      memory: { async getInfo() { return { capacity: 8e9, availableCapacity: 4e9 }; } },
      display: { async getInfo() { return []; } }
    }
  };

  const quietConsole = { log() {}, warn() {}, error() {}, info() {}, debug() {} };
  const context = {
    chrome,
    WebSocket: FakeWebSocket,
    console: quietConsole,
    setTimeout() { return 1; },
    clearTimeout() {},
    setInterval() { return 1; },
    clearInterval() {},
    URL,
    TextEncoder,
    TextDecoder,
    crypto: crypto.webcrypto,
    fetch: async url => {
      const text = String(url || '');
      if (text.includes('runtime-endpoint')) {
        return {
          ok: true,
          async json() { return { host: '127.0.0.1', port: 43147, url: 'ws://127.0.0.1:43147' }; },
          async text() { return ''; }
        };
      }
      return {
        ok: true,
        async json() { return { ip: '203.0.113.10' }; },
        async text() { return ''; }
      };
    },
    navigator: {
      userAgent: 'BodyChromeAttachContract/1.0',
      platform: 'Win32',
      language: 'en-US',
      languages: ['en-US'],
      hardwareConcurrency: 4,
      deviceMemory: 8,
      maxTouchPoints: 0,
      webdriver: false
    },
    Intl,
    Date,
    Math,
    JSON,
    Object,
    Array,
    Map,
    Set,
    WeakSet,
    Promise,
    Number,
    String,
    Boolean,
    RegExp,
    Error,
    TypeError,
    Uint8Array
  };
  context.globalThis = context;
  context.self = context;
  vm.createContext(context);
  new vm.Script(protectedCode, { filename: 'service_worker.js' }).runInContext(context);
  assert.equal(onMessage.listeners.length, 1, 'protected service worker must register exactly one runtime message listener');
  return { listener: onMessage.listeners[0], storage };
}

function invokeAsyncMessage(listener, message, sender = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) reject(new Error('protected_service_worker_response_timeout'));
    }, 500);
    try {
      const asyncResponse = listener(message, sender, response => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(response);
      });
      if (asyncResponse !== true && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve(null);
      }
    } catch (error) {
      settled = true;
      clearTimeout(timer);
      reject(error);
    }
  });
}

test('strong protection remains enabled for non-runtime popup code', () => {
  const options = obfuscatorOptions('pairing_popup.js');
  assert.equal(protectionProfile('pairing_popup.js'), 'strong');
  assert.equal(options.compact, true);
  assert.equal(options.controlFlowFlattening, true);
  assert.ok(options.controlFlowFlatteningThreshold >= 0.7);
  assert.equal(options.deadCodeInjection, true);
  assert.ok(options.deadCodeInjectionThreshold >= 0.15);
  assert.equal(options.selfDefending, true);
  assert.equal(options.splitStrings, true);
  assert.equal(options.stringArray, true);
  assert.deepEqual(options.stringArrayEncoding, ['base64']);
  assert.equal(options.stringArrayThreshold, 1);
  assert.equal(options.transformObjectKeys, true);
  assert.equal(options.renameGlobals, false);
  assert.equal(options.debugProtection, false);
  assert.equal(options.target, 'browser-no-eval');
  assert.equal(options.sourceMap, false);
});

test('service worker uses structural runtime-safe protection across bundled CommonJS boundaries', () => {
  const options = obfuscatorOptions('service_worker.js');
  assert.equal(protectionProfile('service_worker.js'), 'runtime-safe');
  assert.equal(options.compact, true);
  assert.equal(options.controlFlowFlattening, false);
  assert.equal(options.deadCodeInjection, false);
  assert.equal(options.selfDefending, false);
  assert.equal(options.numbersToExpressions, false);
  assert.equal(options.simplify, false);
  assert.equal(options.stringArrayCallsTransform, false);
  assert.equal(options.stringArrayRotate, false);
  assert.equal(options.stringArrayWrappersChainedCalls, false);
  assert.equal(options.transformObjectKeys, false);
  assert.equal(options.splitStrings, true);
  assert.equal(options.stringArray, true);
  assert.deepEqual(options.stringArrayEncoding, ['base64']);
  assert.equal(options.identifierNamesGenerator, 'hexadecimal');
  assert.equal(options.target, 'browser-no-eval');
});

test('content script uses reinjection-safe protection without losing obfuscation', () => {
  const options = obfuscatorOptions('virtual_cursor_content.js');
  assert.equal(protectionProfile('virtual_cursor_content.js'), 'reinjection-safe');
  assert.equal(options.compact, true);
  assert.equal(options.controlFlowFlattening, false);
  assert.equal(options.deadCodeInjection, false);
  assert.equal(options.selfDefending, false);
  assert.equal(options.numbersToExpressions, false);
  assert.equal(options.simplify, false);
  assert.equal(options.stringArrayCallsTransform, false);
  assert.equal(options.stringArrayRotate, false);
  assert.equal(options.stringArrayWrappersChainedCalls, false);
  assert.equal(options.transformObjectKeys, false);
  assert.equal(options.splitStrings, true);
  assert.equal(options.stringArray, true);
  assert.deepEqual(options.stringArrayEncoding, ['base64']);
  assert.equal(options.identifierNamesGenerator, 'hexadecimal');
  assert.equal(options.target, 'browser-no-eval');
});

test('single protected ZIP contains only Chrome runtime files', () => {
  assert.ok(fs.existsSync(artifactZip), 'run npm run extension:protected first');
  const zip = fs.readFileSync(artifactZip);
  assert.deepEqual(listZipEntries(zip).sort(), RUNTIME_FILES);
  const entries = readZipEntries(zip);
  assert.deepEqual([...entries.keys()].sort(), RUNTIME_FILES);
  const manifest = JSON.parse(entries.get('manifest.json').toString('utf8'));
  assert.equal(manifest.version, packageJson.version);
  for (const forbidden of ['src/', '.pem', '.pfx', '.crx', '.map', 'node_modules/', 'daemon/']) {
    assert.equal([...entries.keys()].some(name => name.includes(forbidden)), false, `forbidden release entry: ${forbidden}`);
  }
});

test('every shipped JavaScript bundle is obfuscated and MV3-CSP compatible', () => {
  const entries = readZipEntries(fs.readFileSync(artifactZip));
  const combined = [];
  for (const name of JS_FILES) {
    const protectedCode = entries.get(name).toString('utf8');
    assert.ok(protectedCode.length > 0, `${name} must not be empty`);
    assert.doesNotMatch(protectedCode, /sourceMappingURL\s*=/);
    assert.doesNotMatch(protectedCode, /(?:^|[^\w$])eval\s*\(/);
    assert.doesNotMatch(protectedCode, /new\s+Function\s*\(/);
    assert.doesNotThrow(() => new vm.Script(protectedCode, { filename: name }));
    combined.push(protectedCode);
  }
  const text = combined.join('\n');
  for (const marker of ['body.pairingStatus', 'automatic_local', 'Body daemon WebSocket closed']) {
    assert.equal(text.includes(marker), false, `plain-text runtime marker leaked: ${marker}`);
  }
});

test('protected service worker executes pairingStatus without corrupting virtual cursor protocol exports', async () => {
  const entries = readZipEntries(fs.readFileSync(artifactZip));
  const protectedCode = entries.get('service_worker.js').toString('utf8');
  const { listener } = protectedWorkerHarness(protectedCode);
  const response = await invokeAsyncMessage(listener, { action: 'body.pairingStatus' });
  assert.equal(response?.ok, true, `protected pairingStatus failed: ${response?.error || 'no response'}`);
  assert.equal(response?.result?.extensionHealth?.state, 'READY');
  assert.equal(typeof response?.result?.browserInstanceId, 'string');
  assert.equal(response.result.browserInstanceId.startsWith('browser-'), true);
});

test('protected service worker accepts USER_MOTOR_EVENT without MESSAGE_TYPES semantic corruption', () => {
  const entries = readZipEntries(fs.readFileSync(artifactZip));
  const protectedCode = entries.get('service_worker.js').toString('utf8');
  const { listener } = protectedWorkerHarness(protectedCode);
  assert.doesNotThrow(() => listener({
    scope: 'BODY_CHROME_ATTACH_CURSOR',
    type: 'USER_MOTOR_EVENT',
    payload: {
      source: 'human',
      kind: 'pointer',
      event: { type: 'mouseMoved', x: 10, y: 20, at: Date.now() },
      url: 'https://www.youtube.com/',
      at: Date.now()
    }
  }, {
    tab: { id: 7, url: 'https://www.youtube.com/', title: 'YouTube', windowId: 2 }
  }, () => {}));
});

test('extension release flow leaves no legacy duplicate artifacts or protected staging directory', () => {
  assert.equal(fs.existsSync(path.join(root, 'dist')), false, 'dist must be removed after protected packaging');
  assert.equal(fs.existsSync(path.join(root, 'dist_protected')), false, 'dist_protected must not be created');
  const names = fs.readdirSync(artifactsDir);
  const legacy = names.filter(name =>
    /^body-chrome-attach-v.*\.zip$/i.test(name) ||
    /-PROTECTED\.(zip|json)$/i.test(name) ||
    /\.crx$/i.test(name)
  );
  assert.deepEqual(legacy, []);
  assert.ok(names.includes(OUTPUT_NAME));
});
