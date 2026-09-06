'use strict';

const RUNTIME_ENDPOINT_RESOURCE = 'runtime-endpoint.json';
const RUNTIME_HOST = '127.0.0.1';
const RUNTIME_ENDPOINT_PORT_STORAGE_KEY = 'bodyDaemonEndpointPort';

function validPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function normalizeRuntimeEndpoint(raw, { allowInactiveKnownPort = false } = {}) {
  const port = validPort(raw?.port);
  if (raw?.host !== RUNTIME_HOST || !port) throw new Error('runtime_endpoint_unavailable');
  if (raw?.active !== true && !allowInactiveKnownPort) throw new Error('runtime_endpoint_unavailable');
  return {
    active: raw?.active === true,
    host: RUNTIME_HOST,
    port,
    wsUrl: `ws://${RUNTIME_HOST}:${port}`,
    startedAt: raw?.startedAt || null
  };
}

async function readPersistedRuntimeEndpoint(chromeApi) {
  if (!chromeApi?.storage?.local?.get) return null;
  try {
    const saved = await chromeApi.storage.local.get({ [RUNTIME_ENDPOINT_PORT_STORAGE_KEY]: null });
    const port = validPort(saved?.[RUNTIME_ENDPOINT_PORT_STORAGE_KEY]);
    if (!port) return null;
    return { active: false, host: RUNTIME_HOST, port, wsUrl: `ws://${RUNTIME_HOST}:${port}`, startedAt: null, source: 'storage' };
  } catch {
    return null;
  }
}

async function rememberRuntimeEndpoint(chromeApi, endpoint) {
  const port = validPort(endpoint?.port);
  if (!port || !chromeApi?.storage?.local?.set) return false;
  await chromeApi.storage.local.set({ [RUNTIME_ENDPOINT_PORT_STORAGE_KEY]: port });
  return true;
}

async function resolveRuntimeEndpoint(chromeApi, { fetchImpl = globalThis.fetch, cacheBust = () => Date.now(), ignoreStored = false } = {}) {
  if (!ignoreStored) {
    const stored = await readPersistedRuntimeEndpoint(chromeApi);
    if (stored) return stored;
  }
  if (!chromeApi?.runtime?.getURL) throw new Error('runtime_endpoint_chrome_url_unavailable');
  if (typeof fetchImpl !== 'function') throw new Error('runtime_endpoint_fetch_unavailable');
  const base = chromeApi.runtime.getURL(RUNTIME_ENDPOINT_RESOURCE);
  const separator = base.includes('?') ? '&' : '?';
  const response = await fetchImpl(`${base}${separator}v=${encodeURIComponent(String(cacheBust()))}`, { cache: 'no-store' });
  if (!response?.ok) throw new Error(`runtime_endpoint_fetch_failed:${response?.status ?? 'unknown'}`);
  const endpoint = normalizeRuntimeEndpoint(await response.json(), { allowInactiveKnownPort: true });
  await rememberRuntimeEndpoint(chromeApi, endpoint).catch(() => {});
  return { ...endpoint, source: 'resource' };
}

module.exports = {
  RUNTIME_ENDPOINT_RESOURCE,
  RUNTIME_HOST,
  RUNTIME_ENDPOINT_PORT_STORAGE_KEY,
  validPort,
  normalizeRuntimeEndpoint,
  readPersistedRuntimeEndpoint,
  rememberRuntimeEndpoint,
  resolveRuntimeEndpoint
};
