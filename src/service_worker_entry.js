'use strict';

const { CdpInputGateway } = require('./cdp_input_gateway');
const { DaemonBridge, siteKeyFromUrl, navigationToken } = require('./daemon_bridge');
const { VIRTUAL_CURSOR_SCOPE, MESSAGE_TYPES } = require('./virtual_cursor_protocol');

const gateway = new CdpInputGateway(chrome);
const daemon = new DaemonBridge(chrome, { gateway, WebSocketImpl: WebSocket });
const observedUserMotorByTab = new Map();
const MAX_OBSERVED_EVENTS_PER_TAB = 1500;

async function activeTabId() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const id = Number(tabs?.[0]?.id);
  if (!Number.isInteger(id)) throw new Error('active_tab_required');
  return id;
}

function rememberUserMotor(tabId, payload) {
  const id = Number(tabId);
  if (!Number.isInteger(id)) return;
  const rows = observedUserMotorByTab.get(id) || [];
  rows.push(payload);
  if (rows.length > MAX_OBSERVED_EVENTS_PER_TAB) rows.splice(0, rows.length - MAX_OBSERVED_EVENTS_PER_TAB);
  observedUserMotorByTab.set(id, rows);
}

function pageContextPacket(sender, message) {
  const tabId = Number(sender?.tab?.id);
  if (!Number.isInteger(tabId)) return null;
  const raw = message?.context || {};
  const url = String(raw.url || sender?.url || '');
  const siteKey = siteKeyFromUrl(url);
  if (siteKey === '__non_web__') return null;
  let urlScheme = '';
  try { urlScheme = new URL(url).protocol; } catch {}
  const epoch = Number(daemon.navigationEpochByTab.get(tabId) || 0);
  return {
    type: 'TAB_CONTEXT',
    tabId,
    context: {
      siteKey,
      navigationToken: navigationToken(url),
      navigationEpoch: epoch,
      title: String(raw.title || sender?.tab?.title || ''),
      windowId: Number.isInteger(Number(sender?.tab?.windowId)) ? Number(sender.tab.windowId) : null,
      status: String(raw.status || sender?.tab?.status || ''),
      urlScheme,
      contextSource: 'content_script'
    }
  };
}

function pageContextFromContent(sender, message) {
  const packet = pageContextPacket(sender, message);
  if (!packet) return false;
  if (daemon.send(packet)) return true;
  daemon.connect().then(() => daemon.send(packet)).catch(() => {});
  return false;
}

async function cursorStatus(tabId) {
  try {
    return await chrome.tabs.sendMessage(Number(tabId), { action: 'body.virtualCursorPing' });
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

function recentEvents(tabId, limit = 250) {
  const rows = observedUserMotorByTab.get(Number(tabId)) || [];
  const bounded = Math.max(1, Math.min(MAX_OBSERVED_EVENTS_PER_TAB, Number(limit) || 250));
  return { tabId: Number(tabId), total: rows.length, events: rows.slice(-bounded) };
}

async function pairingStatus() {
  const saved = await chrome.storage.local.get({ bodyDaemonAuthToken: null });
  return {
    paired: Boolean(saved.bodyDaemonAuthToken),
    connected: daemon.socket?.readyState === 1,
    browserInstanceId: daemon.browserInstanceId,
    extensionInstanceId: daemon.extensionInstanceId,
    mode: 'automatic_local'
  };
}

async function resetLocalPairing() {
  await chrome.storage.local.remove('bodyDaemonAuthToken');
  daemon.authToken = null;
  try { daemon.socket?.close(); } catch {}
  return { reset: true, paired: false, automaticReconnect: true };
}

function result(sendResponse, work) {
  Promise.resolve().then(work)
    .then(value => sendResponse({ ok: true, result: value }))
    .catch(error => sendResponse({ ok: false, error: String(error?.message || error), code: error?.code || null }));
  return true;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.scope === VIRTUAL_CURSOR_SCOPE && message?.type === MESSAGE_TYPES.USER_MOTOR_EVENT) {
    const tabId = Number(sender?.tab?.id);
    if (message?.payload?.kind === 'trust_audit') {
      const event = message.payload.event || {};
      if (daemon.recordingEnabled && Number.isInteger(tabId)) daemon.send({type:'RECORDER_EVENT',tabId,event:{eventType:'synthetic_input',ts:Number(event.at||Date.now()),source:'human',sourceConfidence:1,isTrusted:false,syntheticEventType:String(event.type||'unknown')}});
      return false;
    }
    rememberUserMotor(tabId, message.payload);
    daemon.forwardUserMotor(tabId, message.payload);
    return false;
  }

  if (message?.action === 'body.pageContext') {
    pageContextFromContent(sender, message);
    return false;
  }

  if (message?.action === 'body.pairingStatus') {
    return result(sendResponse, pairingStatus);
  }

  if (message?.action === 'body.pairReset') {
    return result(sendResponse, resetLocalPairing);
  }

  // Production runtime API is intentionally read-only. All actions go through the authenticated local daemon transport.
  if (message?.action === 'body.virtualCursorStatus') {
    return result(sendResponse, async () => {
      const tabId = Number.isInteger(Number(message.tabId)) ? Number(message.tabId) : await activeTabId();
      return { tabId, gateway: gateway.status(), overlay: await cursorStatus(tabId), daemon: daemon.status() };
    });
  }

  if (message?.action === 'body.getObservedUserMotor') {
    return result(sendResponse, async () => {
      const tabId = Number.isInteger(Number(message.tabId)) ? Number(message.tabId) : await activeTabId();
      return recentEvents(tabId, message.limit);
    });
  }

  if (message?.action === 'body.profile') {
    return result(sendResponse, async () => ({
      daemon: daemon.status(),
      gateway: gateway.status(),
      observedTabs: [...observedUserMotorByTab.keys()]
    }));
  }

  return false;
});

chrome.debugger.onDetach.addListener(debuggee => {
  const tabId = Number(debuggee?.tabId);
  if (Number.isInteger(tabId)) gateway.attachedTabs.delete(tabId);
});

daemon.start()
  .then(status => console.log('Body Chrome Attach ready. Production actions are daemon-only.', status))
  .catch(error => console.error('Body Chrome Attach startup error:', error));

module.exports={pageContextPacket,pageContextFromContent};
