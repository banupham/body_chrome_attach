'use strict';

const { CdpInputGateway } = require('./cdp_input_gateway');
const { BehaviorLearner } = require('./behavior_learner');
const { BodyExecutor } = require('./body_executor');
const { parseBodyCommand } = require('./body_command_parser');
const { createCommandPorts } = require('./command_ports');
const { VIRTUAL_CURSOR_SCOPE, MESSAGE_TYPES } = require('./virtual_cursor_protocol');

const gateway = new CdpInputGateway(chrome);
const learner = new BehaviorLearner(chrome);
const executor = new BodyExecutor({ gateway, learner });
const learnerReady = learner.init();
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
  const bounded = Math.max(1, Math.min(5000, Number(limit) || 250));
  return { tabId: Number(tabId), total: rows.length, events: rows.slice(-bounded) };
}

async function runTextCommand({ text, source }) {
  await learnerReady;
  const command = parseBodyCommand(text);
  const tabId = await activeTabId();

  if (command.type === 'help') {
    return {
      source,
      commands: [
        'move <x> <y>',
        'click <x> <y>',
        'doubleclick <x> <y>',
        'type <text>',
        'press <key>',
        'combo <Modifier+Key>',
        'scroll <deltaY> [x y]',
        'submit [x y]',
        'profile',
        'events [limit]',
        'status',
        'attach',
        'detach'
      ]
    };
  }
  if (command.type === 'profile') return { source, tabId, profile: learner.snapshot() };
  if (command.type === 'events') return { source, ...recentEvents(tabId, command.limit) };
  if (command.type === 'attach') return { source, tabId, ...(await gateway.attach(tabId)) };
  if (command.type === 'detach') return { source, tabId, ...(await gateway.detach(tabId)) };
  if (command.type === 'status') {
    return {
      source,
      tabId,
      profile: learner.snapshot(),
      executor: executor.status(),
      cursor: await cursorStatus(tabId)
    };
  }

  return {
    source,
    command,
    execution: await executor.execute(tabId, command)
  };
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
    const tabId = Number(sender?.tab?.id);
    rememberUserMotor(tabId, message.payload);
    learnerReady.then(() => learner.observe(tabId, message.payload)).catch(() => {});
    return false;
  }

  if (message?.action === 'body.attachActiveTab') return result(sendResponse, async () => gateway.attach(await activeTabId()));
  if (message?.action === 'body.detachActiveTab') return result(sendResponse, async () => gateway.detach(await activeTabId()));

  if (message?.action === 'body.cdpInput') {
    return result(sendResponse, async () => {
      const tabId = Number.isInteger(Number(message.tabId)) ? Number(message.tabId) : await activeTabId();
      return gateway.sendInput(tabId, String(message.method || ''), message.params || {});
    });
  }

  if (message?.action === 'body.executeText') {
    return result(sendResponse, () => runTextCommand({ text: String(message.text || ''), source: 'runtime-action' }));
  }

  if (message?.action === 'body.virtualCursorStatus') {
    return result(sendResponse, async () => {
      const tabId = Number.isInteger(Number(message.tabId)) ? Number(message.tabId) : await activeTabId();
      return { tabId, gateway: gateway.status(), overlay: await cursorStatus(tabId) };
    });
  }

  if (message?.action === 'body.getObservedUserMotor') {
    return result(sendResponse, async () => {
      const tabId = Number.isInteger(Number(message.tabId)) ? Number(message.tabId) : await activeTabId();
      return recentEvents(tabId, message.limit);
    });
  }

  if (message?.action === 'body.profile') return result(sendResponse, async () => ({ profile: learner.snapshot() }));
  return false;
});

chrome.debugger.onDetach.addListener(debuggee => {
  const tabId = Number(debuggee?.tabId);
  if (Number.isInteger(tabId)) gateway.attachedTabs.delete(tabId);
});

const commandPorts = createCommandPorts({
  chromeApi: chrome,
  WebSocketImpl: WebSocket,
  runCommand: runTextCommand
});

learnerReady
  .then(() => commandPorts.start())
  .then(status => console.log('Body Chrome Attach ready.', status))
  .catch(error => console.error('Body Chrome Attach startup error:', error));
