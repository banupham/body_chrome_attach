'use strict';

const assert = require('node:assert/strict');
const { installStickyRuntimePort } = require('../daemon/src/sticky_runtime_port_preload');

class FakeWebSocketServer {
  constructor(options = {}) {
    this.options = options;
  }
}

const fakeWs = { WebSocketServer: FakeWebSocketServer, Server: FakeWebSocketServer };
assert.equal(installStickyRuntimePort(fakeWs, 54321), true);
assert.notEqual(fakeWs.WebSocketServer, FakeWebSocketServer);
assert.equal(fakeWs.Server, fakeWs.WebSocketServer);

const runtimeServer = new fakeWs.WebSocketServer({ host: '127.0.0.1', port: 0, marker: true });
assert.equal(runtimeServer.options.port, 54321);
assert.equal(runtimeServer.options.marker, true);
assert.equal(runtimeServer.bodyRuntimePortMode, 'remembered_auto_port');
assert.equal(runtimeServer.bodyRuntimeRequestedPort, 54321);

const unrelatedServer = new fakeWs.WebSocketServer({ host: '0.0.0.0', port: 0 });
assert.equal(unrelatedServer.options.port, 0);

const invalidWs = { WebSocketServer: FakeWebSocketServer, Server: FakeWebSocketServer };
assert.equal(installStickyRuntimePort(invalidWs, 0), false);
assert.equal(invalidWs.WebSocketServer, FakeWebSocketServer);

console.log('sticky_runtime_port_contract: PASS');
