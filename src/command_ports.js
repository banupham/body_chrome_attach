'use strict';

const { BrokerClient } = require('./broker_client');
const { COMMAND_MESSAGE_TYPE, BodyCommandIngress } = require('./command_ingress');

const DEFAULT_COMMAND_SOCKET_URL = 'ws://127.0.0.1:8766';
const COMMAND_SOCKET_STORAGE_KEY = 'bodyCommandSocketUrl';

async function configuredSocketUrl(chromeApi) {
  try {
    const stored = await chromeApi.storage.local.get(COMMAND_SOCKET_STORAGE_KEY);
    const value = stored?.[COMMAND_SOCKET_STORAGE_KEY];
    if (value === null || value === false || value === '') return null;
    if (typeof value === 'string' && value.trim()) return value.trim();
  } catch (_) {}
  return DEFAULT_COMMAND_SOCKET_URL;
}

function createCommandPorts({ chromeApi, WebSocketImpl, runCommand } = {}) {
  if (!chromeApi?.runtime?.onMessage?.addListener) throw new Error('body_command_chrome_api_required');
  if (typeof runCommand !== 'function') throw new Error('body_command_run_command_required');

  const ingress = new BodyCommandIngress({ runCommand });
  let broker = null;

  const runtimeListener = (message, _sender, sendResponse) => {
    if (message?.type !== COMMAND_MESSAGE_TYPE) return false;
    const keys = Object.keys(message || {}).sort();
    if (keys.length !== 2 || keys[0] !== 'text' || keys[1] !== 'type') {
      sendResponse({ ok: false, error: 'body_runtime_command_text_only' });
      return false;
    }
    Promise.resolve(ingress.dispatch('runtime', { text: message.text }))
      .then(result => sendResponse({ ok: true, result }))
      .catch(error => sendResponse({ ok: false, error: String(error?.message || error), code: error?.code || null }));
    return true;
  };

  return {
    ingress,
    runtimeListener,
    async start() {
      chromeApi.runtime.onMessage.addListener(runtimeListener);
      const url = await configuredSocketUrl(chromeApi);
      if (url && WebSocketImpl) {
        broker = new BrokerClient({
          WebSocketImpl,
          url,
          identity: { role: 'body-chrome-attach' },
          handleCommand: payload => ingress.dispatch('socket', payload)
        });
        broker.connect();
      }
      return { runtime: true, socket: Boolean(broker), socketUrl: url };
    },
    stop() {
      try { chromeApi.runtime.onMessage.removeListener?.(runtimeListener); } catch (_) {}
      broker?.close();
      broker = null;
    }
  };
}

module.exports = { DEFAULT_COMMAND_SOCKET_URL, COMMAND_SOCKET_STORAGE_KEY, configuredSocketUrl, createCommandPorts };
