'use strict';

const { CdpInputGateway } = require('./cdp_input_gateway');
const { DaemonBridge, siteKeyFromUrl, navigationToken } = require('./daemon_bridge');
const { VIRTUAL_CURSOR_SCOPE, MESSAGE_TYPES } = require('./virtual_cursor_protocol');

const gateway = new CdpInputGateway(chrome);
const daemon = new DaemonBridge(chrome, { gateway, WebSocketImpl: WebSocket });
const daemonIdentityReady = daemon.identity();
const observedUserMotorByTab = new Map();
const pendingPageContextByTab = new Map();
const pendingUserMotorByTab = new Map();
const contentRepairByTab = new Map();
const observedDaemonSockets = new WeakSet();
const MAX_OBSERVED_EVENTS_PER_TAB = 1500;
const MAX_PENDING_USER_MOTOR_PER_TAB = 96;
const PAGE_CONTEXT_RETRY_MS = 250;
const PAGE_CONTEXT_RETRY_WINDOW_MS = 15000;
const CONTENT_SCRIPT_FILE = 'virtual_cursor_content.js';
const DAEMON_WAKE_ALARM = 'body-daemon-wake';
const DAEMON_WAKE_PERIOD_MINUTES = 0.5;
let pageContextRetryTimer = null;
let pageContextRetryStartedAt = 0;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

async function connectDaemon() {
  await daemonIdentityReady;
  const status = await daemon.connect();
  observeDaemonSocket();
  return status;
}

function webTab(tab) {
  try {
    const url = new URL(String(tab?.url || ''));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

async function activeTabId() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const id = Number(tabs?.[0]?.id);
  if (!Number.isInteger(id)) throw new Error('active_tab_required');
  return id;
}

async function contentScriptReady(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(Number(tabId), { action: 'body.virtualCursorPing' });
    return response?.ok === true;
  } catch {
    return false;
  }
}

async function ensureContentScript(tabId, tabHint = null) {
  const id = Number(tabId);
  if (!Number.isInteger(id)) return { ready: false, injected: false, reason: 'invalid_tab_id' };
  if (contentRepairByTab.has(id)) return contentRepairByTab.get(id);

  const work = (async () => {
    const tab = tabHint || await chrome.tabs.get(id).catch(() => null);
    if (!webTab(tab)) return { ready: false, injected: false, reason: 'non_web_tab' };
    if (await contentScriptReady(id)) return { ready: true, injected: false, reason: null };

    // A freshly loaded/unpacked Extension does not retroactively inject its
    // manifest content script into tabs that were already open. Give Chrome's
    // normal document_start injection a short chance to finish, then repair the
    // tab from the packaged local file. This is per-profile and per-tab.
    await delay(80);
    if (await contentScriptReady(id)) return { ready: true, injected: false, reason: null };
    if (!chrome.scripting?.executeScript) return { ready: false, injected: false, reason: 'scripting_unavailable' };

    try {
      await chrome.scripting.executeScript({
        target: { tabId: id, allFrames: false },
        files: [CONTENT_SCRIPT_FILE]
      });
    } catch (error) {
      return { ready: false, injected: false, reason: String(error?.message || error) };
    }

    for (const waitMs of [30, 80, 160]) {
      if (await contentScriptReady(id)) return { ready: true, injected: true, reason: null };
      await delay(waitMs);
    }
    return { ready: false, injected: true, reason: 'content_script_ping_failed_after_injection' };
  })().finally(() => contentRepairByTab.delete(id));

  contentRepairByTab.set(id, work);
  return work;
}

async function repairOpenWebTabs() {
  const tabs = await chrome.tabs.query({});
  const webTabs = tabs.filter(webTab);
  const results = await Promise.allSettled(webTabs.map(tab => ensureContentScript(tab.id, tab)));
  return {
    webTabs: webTabs.length,
    ready: results.filter(row => row.status === 'fulfilled' && row.value?.ready === true).length
  };
}

async function focusedTab(windowId = null) {
  const query = Number.isInteger(Number(windowId)) && Number(windowId) >= 0
    ? { active: true, windowId: Number(windowId) }
    : { active: true, lastFocusedWindow: true };
  const tabs = await chrome.tabs.query(query);
  return tabs?.[0] || null;
}

async function syncFocusedTabContext(windowId = null) {
  const tab = await focusedTab(windowId);
  if (!tab || !Number.isInteger(Number(tab.id))) return false;
  if (webTab(tab)) await ensureContentScript(tab.id, tab).catch(() => {});
  let urlScheme = '';
  try { urlScheme = new URL(String(tab.url || '')).protocol; } catch {}
  return daemon.send({
    type: 'TAB_CONTEXT',
    tabId: Number(tab.id),
    context: {
      siteKey: siteKeyFromUrl(tab.url),
      navigationToken: navigationToken(tab.url),
      navigationEpoch: Number(daemon.navigationEpochByTab.get(Number(tab.id)) || 0),
      title: String(tab.title || ''),
      windowId: Number.isInteger(Number(tab.windowId)) ? Number(tab.windowId) : null,
      status: String(tab.status || ''),
      urlScheme,
      contextSource: 'chrome_window_focus',
      active: true
    }
  });
}

function learningInputStatus() {
  let events = 0;
  let lastEventAt = null;
  for (const rows of observedUserMotorByTab.values()) {
    events += rows.length;
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const at = Number(rows[index]?.at || rows[index]?.event?.at || 0);
      if (Number.isFinite(at) && at > 0) {
        lastEventAt = Math.max(Number(lastEventAt || 0), at);
        break;
      }
    }
  }
  return {
    observedTabs: [...observedUserMotorByTab.keys()],
    eventCount: events,
    lastEventAt,
    pendingTabs: [...pendingUserMotorByTab.keys()]
  };
}

function queueUserMotor(tabId, payload) {
  const id = Number(tabId);
  if (!Number.isInteger(id) || daemon.recordingEnabled !== true) return false;
  const rows = pendingUserMotorByTab.get(id) || [];
  const isMove = payload?.kind === 'pointer' && payload?.event?.type === 'mouseMoved';
  const last = rows[rows.length - 1];
  if (rows.length >= 60 && isMove && last?.kind === 'pointer' && last?.event?.type === 'mouseMoved') rows[rows.length - 1] = payload;
  else rows.push(payload);
  if (rows.length > MAX_PENDING_USER_MOTOR_PER_TAB) rows.splice(0, rows.length - MAX_PENDING_USER_MOTOR_PER_TAB);
  pendingUserMotorByTab.set(id, rows);
  return true;
}

async function flushPendingUserMotor() {
  if (daemon.socket?.readyState !== 1) return false;
  if (daemon.recordingEnabled !== true) {
    pendingUserMotorByTab.clear();
    return true;
  }
  for (const [tabId, rows] of [...pendingUserMotorByTab.entries()]) {
    while (rows.length && daemon.socket?.readyState === 1) {
      const payload = rows[0];
      const sent = await daemon.forwardUserMotor(tabId, payload).catch(() => false);
      if (!sent && daemon.socket?.readyState !== 1) return false;
      rows.shift();
    }
    if (!rows.length) pendingUserMotorByTab.delete(tabId);
  }
  return pendingUserMotorByTab.size === 0;
}

async function forwardUserMotorReliable(tabId, payload) {
  if (daemon.socket?.readyState === 1) {
    const sent = await daemon.forwardUserMotor(tabId, payload).catch(() => false);
    if (sent || daemon.recordingEnabled !== true || daemon.socket?.readyState === 1) return sent;
  }
  queueUserMotor(tabId, payload);
  await connectDaemon().catch(() => null);
  return flushPendingUserMotor();
}

function observeDaemonSocket(socket = daemon.socket) {
  if (!socket || observedDaemonSockets.has(socket) || typeof socket.addEventListener !== 'function') return false;
  observedDaemonSockets.add(socket);
  socket.addEventListener('open', () => {
    // DaemonBridge sends HELLO from its own onopen handler. Run on the next turn
    // so focused-tab state and queued Human motor events are scoped after HELLO.
    setTimeout(() => {
      syncFocusedTabContext().catch(() => {});
      flushPendingUserMotor().catch(() => {});
      flushPendingPageContexts();
    }, 0);
  });
  socket.addEventListener('error', event => {
    console.warn('Body daemon WebSocket error', {
      type: String(event?.type || 'error'),
      readyState: Number(socket.readyState)
    });
  });
  socket.addEventListener('close', event => {
    console.warn('Body daemon WebSocket closed', {
      code: Number(event?.code || 0),
      reason: String(event?.reason || ''),
      wasClean: event?.wasClean === true
    });
  });
  if (socket.readyState === 1) {
    setTimeout(() => {
      syncFocusedTabContext().catch(() => {});
      flushPendingUserMotor().catch(() => {});
    }, 0);
  }
  return true;
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
    connectDaemon().catch(() => {});
    schedulePageContextFlush(PAGE_CONTEXT_RETRY_MS);
  }, Math.max(0, Number(delayMs) || 0));
}

function pageContextFromContent(sender, message) {
  const packet = pageContextPacket(sender, message);
  if (!packet) return false;
  pendingPageContextByTab.set(packet.tabId, packet);
  if (flushPendingPageContexts()) return true;
  connectDaemon().catch(() => {});
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
  await daemonIdentityReady;
  const saved = await chrome.storage.local.get({ bodyDaemonAuthToken: null });
  const connected = daemon.socket?.readyState === 1;
  if (connected) daemon.send({ type: 'READINESS_POLL', ts: Date.now() });
  const active = await focusedTab().catch(() => null);
  return {
    paired: Boolean(saved.bodyDaemonAuthToken),
    connected,
    browserInstanceId: daemon.browserInstanceId,
    extensionInstanceId: daemon.extensionInstanceId,
    activeTabId: Number.isInteger(Number(active?.id)) ? Number(active.id) : null,
    activeWindowId: Number.isInteger(Number(active?.windowId)) ? Number(active.windowId) : null,
    learningInput: learningInputStatus(),
    readiness: daemon.readinessStatus,
    mode: 'automatic_local'
  };
}

async function resetLocalPairing() {
  await daemonIdentityReady;
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
    syncFocusedTabContext().catch(() => {});
    flushPendingUserMotor().catch(() => {});
    return true;
  }
  connectDaemon().catch(() => {});
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
    if (daemon.socket?.readyState === 1) {
      daemon.forwardUserMotor(tabId, message.payload).catch(() => {
        queueUserMotor(tabId, message.payload);
        connectDaemon().catch(() => {});
      });
      return false;
    }
    return result(sendResponse, async () => ({ forwarded: await forwardUserMotorReliable(tabId, message.payload) }));
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
      await ensureContentScript(tabId).catch(() => {});
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
      learningInput: learningInputStatus(),
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

chrome.tabs?.onActivated?.addListener(info => {
  ensureContentScript(Number(info?.tabId)).catch(() => {});
});

chrome.tabs?.onUpdated?.addListener((tabId, changeInfo, tab) => {
  if (changeInfo?.status === 'complete' || (changeInfo?.url && tab?.status === 'complete')) ensureContentScript(Number(tabId), tab).catch(() => {});
});

chrome.tabs?.onRemoved?.addListener(tabId => {
  const id = Number(tabId);
  observedUserMotorByTab.delete(id);
  pendingUserMotorByTab.delete(id);
  pendingPageContextByTab.delete(id);
  contentRepairByTab.delete(id);
});

chrome.windows?.onFocusChanged?.addListener(windowId => {
  const id = Number(windowId);
  if (!Number.isInteger(id) || id < 0) return;
  syncFocusedTabContext(id).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  daemonIdentityReady
    .then(() => repairOpenWebTabs())
    .catch(() => null)
    .then(() => ensureDaemonWakeAlarm())
    .then(() => wakeDaemonConnection())
    .catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
  daemonIdentityReady
    .then(() => repairOpenWebTabs())
    .catch(() => null)
    .then(() => ensureDaemonWakeAlarm())
    .then(() => wakeDaemonConnection())
    .catch(() => {});
});

chrome.debugger.onDetach.addListener(debuggee => {
  const tabId = Number(debuggee?.tabId);
  if (Number.isInteger(tabId)) gateway.attachedTabs.delete(tabId);
});

ensureDaemonWakeAlarm().catch(() => {});

(async () => {
  await daemonIdentityReady;
  await repairOpenWebTabs().catch(() => null);
  const status = await daemon.start();
  observeDaemonSocket();
  syncFocusedTabContext().catch(() => {});
  flushPendingUserMotor().catch(() => {});
  flushPendingPageContexts();
  schedulePageContextFlush(0);
  console.log('Body Chrome Attach ready. Production actions are daemon-only.', status);
})().catch(error => console.error('Body Chrome Attach startup error:', error));

module.exports={
  pageContextPacket,
  pageContextFromContent,
  flushPendingPageContexts,
  schedulePageContextFlush,
  observeDaemonSocket,
  webTab,
  ensureContentScript,
  repairOpenWebTabs,
  focusedTab,
  syncFocusedTabContext,
  learningInputStatus,
  queueUserMotor,
  flushPendingUserMotor,
  forwardUserMotorReliable,
  connectDaemon
};
