'use strict';

const { installVirtualCursorOverlay } = require('./virtual_cursor_overlay');

const overlay = installVirtualCursorOverlay({ chromeApi: chrome, documentRef: document });

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action !== 'body.virtualCursorPing') return false;
  sendResponse({ ok: true, result: overlay.status() });
  return false;
});
