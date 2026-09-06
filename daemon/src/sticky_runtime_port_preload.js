'use strict';

const path = require('node:path');
const ws = require('ws');
const { RUNTIME_HOST, preferredRuntimePort } = require('./runtime_endpoint');

const baseDir = path.resolve(__dirname, '..');
const rememberedPort = preferredRuntimePort(baseDir);

if (rememberedPort) {
  const OriginalWebSocketServer = ws.WebSocketServer;

  class StickyRuntimeWebSocketServer extends OriginalWebSocketServer {
    constructor(options = {}, callback) {
      const shouldReuse = options?.host === RUNTIME_HOST && Number(options?.port) === 0;
      const nextOptions = shouldReuse ? { ...options, port: rememberedPort } : options;
      super(nextOptions, callback);
      if (shouldReuse) {
        this.bodyRuntimePortMode = 'remembered_auto_port';
        this.bodyRuntimeRequestedPort = rememberedPort;
      }
    }
  }

  ws.WebSocketServer = StickyRuntimeWebSocketServer;
  if (ws.Server === OriginalWebSocketServer) ws.Server = StickyRuntimeWebSocketServer;
  process.env.BODY_RUNTIME_REMEMBERED_PORT = String(rememberedPort);
}

module.exports = { rememberedPort };
