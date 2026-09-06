'use strict';

const path = require('node:path');
const ws = require('ws');
const { RUNTIME_HOST, preferredRuntimePort } = require('./runtime_endpoint');

function installStickyRuntimePort(wsModule, rememberedPort) {
  const port = Number(rememberedPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  const OriginalWebSocketServer = wsModule?.WebSocketServer;
  if (typeof OriginalWebSocketServer !== 'function') throw new Error('websocket_server_constructor_unavailable');

  class StickyRuntimeWebSocketServer extends OriginalWebSocketServer {
    constructor(options = {}, callback) {
      const shouldReuse = options?.host === RUNTIME_HOST && Number(options?.port) === 0;
      const nextOptions = shouldReuse ? { ...options, port } : options;
      super(nextOptions, callback);
      if (shouldReuse) {
        this.bodyRuntimePortMode = 'remembered_auto_port';
        this.bodyRuntimeRequestedPort = port;
      }
    }
  }

  wsModule.WebSocketServer = StickyRuntimeWebSocketServer;
  if (wsModule.Server === OriginalWebSocketServer) wsModule.Server = StickyRuntimeWebSocketServer;
  return true;
}

const baseDir = path.resolve(__dirname, '..');
const rememberedPort = preferredRuntimePort(baseDir);
if (rememberedPort) {
  installStickyRuntimePort(ws, rememberedPort);
  process.env.BODY_RUNTIME_REMEMBERED_PORT = String(rememberedPort);
}

module.exports = { rememberedPort, installStickyRuntimePort };
