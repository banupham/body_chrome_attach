'use strict';

const { CdpInputGateway } = require('./cdp_input_gateway');
const { DaemonBridge, siteKeyFromUrl, navigationToken } = require('./daemon_bridge');
const { VIRTUAL_CURSOR_SCOPE, MESSAGE_TYPES } = require('./virtual_cursor_protocol');

const gateway = new CdpInputGateway(chrome);
const daemon = new DaemonBridge(chrome, { gateway, WebSocketImpl: WebSocket });
const observedUserMotorByTab = new Map();
const pendingPageContextByTab = new Map();
const MAX_OBSERVED_EVENTS_PER_TAB = 1500;
const PAGE_CONTEXT_RETRY_MS = 250;
const PAGE_CONTEXT_RETRY_WINDOW_MS = 15000;
const DAEMON_WAKE_ALARM = 'body-daemon-wake';
const DAEMON_WAKE_PERIOD_MINUTES = 0.5;
let pageContextRetryTimer = null;
let pageContextRetryStartedAt = 0;

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

function flushPendingPageContexts() {
  if (!pendingPageContextByTab.size) {
    pageContextRetryStartedAt = 0;
    return true;
  }
  let allSent = true;
  for (const [tabId, packet] of [...pendingPageContextByTab.entries()]) {
    if (daemon.send(packet)) pendingPageContextByTab.delete(tabId);
    else allSent = false;
  }
  if (!pendingPageContextByTab.size) pageContextRetryStartedAt = 0;
  return allSent;
}

function schedulePageContextFlush(delayMs = PAGE_CONTEXT_RETRY_MS) {
  if (pageContextRetryTimer || !pendingPageContextByTab.size) return;
  if (!pageContextRetryStartedAt) pageContextRetryStartedAt = Date.now();
  if (Date.now() - pageContextRetryStartedAt > PAGE_CONTEXT_RETRY_WINDOW_MS) return;
  pageContextRetryTimer = setTimeout(() => {
    pageContextRetryTimer = null;
    if (flushPendingPageContexts()) return;
    daemon.connect().catch(() => {});
    schedulePageContextFlush(PAGE_CONTEXT_RETRY_MS);
  }, Math.max(0, Number(delayMs) || 0));
}

function pageContextFromContent(sender, message) {
  const packet = pageContextPacket(sender, message);
  if (!packet) return false;
  pendingPageContextByTab.set(packet.tabId, packet);
  if (flushPendingPageContexts()) return true;
  daemon.connect().catch(() => {});
  schedulePageContextFlush(0);
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
  const connected = daemon.socket?.readyState === 1;
  if (connected) daemon.send({ type: 'READINESS_POLL', ts: Date.now() });
  return {
    paired: Boolean(saved.bodyDaemonAuthToken),
    connected,
    browserInstanceId: daemon.browserInstanceId,
    extensionInstanceId: daemon.extensionInstanceId,
    readiness: daemon.readinessStatus,
    mode: 'automatic_local'
  };
}

async function resetLocalPairing() {
  await chrome.storage.local.remove('bodyDaemonAuthToken');
  daemon.authToken = null;
  daemon.readinessStatus = null;
  try { daemon.socket?.close(); } catch {}
  return { reset: true, paired: false, automaticReconnect: true };
}

async function ensureDaemonWakeAlarm() {
  if (!chrome.alarms?.get || !chrome.alarms?.create) return false;
  const current = await chrome.alarms.get(DAEMON_WAKE_ALARM);
  if (!current) await chrome.alarms.create(DAEMON_WAKE_ALARM, { periodInMinutes: DAEMON_WAKE_PERIOD_MINUTES });
  return true;
}

function wakeDaemonConnection() {
  if (daemon.socket?.readyState === 1) {
    daemon.send({ type: 'KEEPALIVE', ts: Date.now(), source: 'alarm' });
    return true;
  }
  daemon.connect().catch(() => {});
  return false;
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
      observedTabs: [...observedUserMotorByTab.keys()],
      pendingPageContextTabs: [...pendingPageContextByTab.keys()]
    }));
  }

  return false;
});

if (chrome.alarms?.onAlarm) {
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm?.name !== DAEMON_WAKE_ALARM) return;
    wakeDaemonConnection();
  });
}

chrome.runtime.onStartup.addListener(() => {
  ensureDaemonWakeAlarm().then(() => wakeDaemonConnection()).catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
  ensureDaemonWakeAlarm().then(() => wakeDaemonConnection()).catch(() => {});
});

chrome.debugger.onDetach.addListener(debuggee => {
  const tabId = Number(debuggee?.tabId);
  if (Number.isInteger(tabId)) gateway.attachedTabs.delete(tabId);
});

ensureDaemonWakeAlarm().catch(() => {});

daemon.start()
  .then(status => {
    flushPendingPageContexts();
    schedulePageContextFlush(0);
    console.log('Body Chrome Attach ready. Production actions are daemon-only.', status);
  })
  .catch(error => console.error('Body Chrome Attach startup error:', error));

module.exports={pageContextPacket,pageContextFromContent,flushPendingPageContexts,schedulePageContextFlush};
