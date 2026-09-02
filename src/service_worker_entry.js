'use strict';

const { CdpInputGateway } = require('./cdp_input_gateway');
const { VIRTUAL_CURSOR_SCOPE, MESSAGE_TYPES } = require('./virtual_cursor_protocol');

const gateway = new CdpInputGateway(chrome);
const observedUserMotorByTab = new Map();
const MAX_OBSERVED_EVENTS_PER_TAB = 5000;

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
  if (rows.length > MAX_OBSERVED_EVENTS_PER_TAB) {
    rows.splice(0, rows.length - MAX_OBSERVED_EVENTS_PER_TAB);
  }
  observedUserMotorByTab.set(id, rows);
}

function result(sendResponse, work) {
  Promise.resolve()
    .then(work)
    .then(value => sendResponse({ ok: true, result: value }))
    .catch(error => sendResponse({ ok: false, error: String(error?.message || error), code: error?.code || null }));
  return true;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.scope === VIRTUAL_CURSOR_SCOPE && message?.type === MESSAGE_TYPES.USER_MOTOR_EVENT) {
    rememberUserMotor(sender?.tab?.id, message.payload);
    return false;
  }

  if (message?.action === 'body.attachActiveTab') {
    return result(sendResponse, async () => gateway.attach(await activeTabId()));
  }

  if (message?.action === 'body.detachActiveTab') {
    return result(sendResponse, async () => gateway.detach(await activeTabId()));
  }

  if (message?.action === 'body.cdpInput') {
    return result(sendResponse, async () => {
      const tabId = Number.isInteger(Number(message.tabId)) ? Number(message.tabId) : await activeTabId();
      return gateway.sendInput(tabId, String(message.method || ''), message.params || {});
    });
  }

  if (message?.action === 'body.virtualCursorStatus') {
    return result(sendResponse, async () => {
      const tabId = Number.isInteger(Number(message.tabId)) ? Number(message.tabId) : await activeTabId();
      let overlay = null;
      try {
        overlay = await chrome.tabs.sendMessage(tabId, { action: 'body.virtualCursorPing' });
      } catch (error) {
        overlay = { ok: false, error: String(error?.message || error) };
      }
      return { tabId, gateway: gateway.status(), overlay };
    });
  }

  if (message?.action === 'body.getObservedUserMotor') {
    return result(sendResponse, async () => {
      const tabId = Number.isInteger(Number(message.tabId)) ? Number(message.tabId) : await activeTabId();
      const limit = Math.max(1, Math.min(5000, Number(message.limit) || 250));
      const rows = observedUserMotorByTab.get(tabId) || [];
      return { tabId, total: rows.length, events: rows.slice(-limit) };
    });
  }

  return false;
});

chrome.debugger.onDetach.addListener(debuggee => {
  const tabId = Number(debuggee?.tabId);
  if (Number.isInteger(tabId)) gateway.attachedTabs.delete(tabId);
});

console.log('Body Chrome Attach service worker ready. Visible virtual cursor enabled.');
