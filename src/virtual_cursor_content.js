'use strict';

const { installVirtualCursorOverlay } = require('./virtual_cursor_overlay');

let overlay = installVirtualCursorOverlay({ chromeApi: chrome, documentRef: document });
let enabled = true;

function describeTarget(el) {
  const node = el?.nodeType === 1 ? el : null;
  if (!node) return { tag:null, role:null, inputType:null, editable:false, sensitive:false, rect:null };
  const tag = String(node.tagName || '').toLowerCase();
  const role = String(node.getAttribute?.('role') || '').toLowerCase() || null;
  const inputType = String(node.getAttribute?.('type') || '').toLowerCase() || null;
  const autocomplete = String(node.getAttribute?.('autocomplete') || '').toLowerCase();
  const sensitive = inputType === 'password' || /password|cc-|one-time-code/.test(autocomplete);
  const editable = !sensitive && (tag === 'input' || tag === 'textarea' || node.isContentEditable === true);
  let rect = null;
  try {
    const r = node.getBoundingClientRect?.();
    if (r && [r.x,r.y,r.width,r.height].every(Number.isFinite)) {
      rect = { x:r.x, y:r.y, width:r.width, height:r.height };
    }
  } catch {}
  return { tag, role, inputType, editable, sensitive, rect };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action === 'body.virtualCursorSet') {
    const next = message.enabled !== false;
    if (next && !enabled) overlay = installVirtualCursorOverlay({ chromeApi: chrome, documentRef: document });
    if (!next && enabled) overlay.uninstall();
    enabled = next;
    sendResponse({ ok: true, result: { enabled, ...(enabled ? overlay.status() : { installed:false, visible:false }) } });
    return false;
  }

  if (message?.action === 'body.targetContextAt') {
    const x = Number(message.x), y = Number(message.y);
    const target = Number.isFinite(x) && Number.isFinite(y)
      ? document.elementFromPoint(x,y)
      : document.activeElement;
    sendResponse({ ok:true, result:describeTarget(target) });
    return false;
  }

  if (message?.action !== 'body.virtualCursorPing') return false;
  sendResponse({ ok: true, result: { enabled, ...(enabled ? overlay.status() : { installed:false, visible:false }) } });
  return false;
});

module.exports={describeTarget};
