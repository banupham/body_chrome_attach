'use strict';

const { CdpInputGateway } = require('./cdp_input_gateway');
const { DaemonBridge } = require('./daemon_bridge');
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

async function youtubeObservationForTab(tabId, maxItems = 50) {
  const id = Number(tabId);
  if (!Number.isInteger(id)) throw new Error('youtube_observation_tab_required');
  const tab = await chrome.tabs.get(id);
  let host = '';
  try { host = new URL(String(tab?.url || '')).hostname.toLowerCase(); } catch {}
  if (!/(^|\.)youtube\.com$/.test(host)) throw new Error(`youtube_observation_wrong_site:${host || 'unknown'}`);
  const response = await chrome.tabs.sendMessage(id, { action:'body.youtubeObservation', maxItems });
  if (!response?.ok || !response.result) throw new Error(response?.error || 'youtube_observation_unavailable');
  return { tabId:id, ...response.result };
}

const baseDaemonHandle = daemon.handle.bind(daemon);
daemon.handle = async message => {
  if (message?.type === 'YOUTUBE_OBSERVE') {
    const tabId = Number.isInteger(Number(message.tabId)) ? Number(message.tabId) : await activeTabId();
    return youtubeObservationForTab(tabId, message.maxItems);
  }
  return baseDaemonHandle(message);
};

function rememberUserMotor(tabId, payload) {
  const id = Number(tabId);
  if (!Number.isInteger(id)) return;
  const rows = observedUserMotorByTab.get(id) || [];
  rows.push(payload);
  if (rows.length > MAX_OBSERVED_EVENTS_PER_TAB) rows.splice(0, rows.length - MAX_OBSERVED_EVENTS_PER_TAB);
  observedUserMotorByTab.set(id, rows);
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

function result(sendResponse, work) {
  Promise.resolve().then(work)
    .then(value => sendResponse({ ok: true, result: value }))
    .catch(error => sendResponse({ ok: false, error: String(error?.message || error), code: error?.code || null }));
  return true;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.scope === VIRTUAL_CURSOR_SCOPE && message?.type === MESSAGE_TYPES.USER_MOTOR_EVENT) {
    const tabId = Number(sender?.tab?.id);
    rememberUserMotor(tabId, message.payload);
    daemon.forwardUserMotor(tabId, message.payload);
    return false;
  }

  // Production runtime API is intentionally read-only. All actions go through daemon :8765.
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
