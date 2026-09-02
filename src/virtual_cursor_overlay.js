'use strict';

const { VIRTUAL_CURSOR_SCOPE, MESSAGE_TYPES, SOURCES } = require('./virtual_cursor_protocol');

const HOST_TAG = 'body-chrome-attach-virtual-cursor';
const POSITION_KEY = '__bodyChromeAttachVirtualCursorPosition';
const DOM_POINTER_TO_CDP = Object.freeze({
  mousemove: 'mouseMoved',
  mousedown: 'mousePressed',
  mouseup: 'mouseReleased',
  wheel: 'mouseWheel'
});

function installVirtualCursorOverlay({ chromeApi, documentRef } = {}) {
  if (!chromeApi?.runtime?.onMessage || !documentRef) {
    throw new Error('virtual_cursor_overlay_dependencies_required');
  }

  const win = documentRef.defaultView;
  const clock = () => win?.performance?.now?.() ?? Date.now();
  let host = null;
  let cursor = null;
  let label = null;
  let resetTimer = null;
  let lastMoveSentAt = 0;
  let userEvents = 0;
  let cdpEvents = 0;
  let cdpFailures = 0;
  let suppressedDomEvents = 0;
  const expectedPointers = [];
  const expectedKeys = [];

  function readPosition() {
    try {
      const raw = win?.sessionStorage?.getItem(POSITION_KEY);
      if (!raw) return null;
      const value = JSON.parse(raw);
      const x = Number(value?.x);
      const y = Number(value?.y);
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    } catch (_) {
      return null;
    }
  }

  function writePosition(x, y) {
    try {
      win?.sessionStorage?.setItem(POSITION_KEY, JSON.stringify({ x, y }));
    } catch (_) {}
  }

  function ensure() {
    if (host?.isConnected && cursor && label) return true;
    const root = documentRef.documentElement || documentRef.body;
    if (!root) return false;

    documentRef.querySelector(HOST_TAG)?.remove();
    host = documentRef.createElement(HOST_TAG);
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;overflow:visible;pointer-events:none;z-index:2147483647';

    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>
        :host{all:initial;pointer-events:none!important}
        #cursor{position:fixed;left:0;top:0;width:34px;height:42px;pointer-events:none;transform:translate3d(-100px,-100px,0);transform-origin:3px 3px;will-change:transform;display:none;filter:drop-shadow(0 1px 2px rgba(0,0,0,.55))}
        #arrow{position:absolute;left:0;top:0;width:21px;height:28px}
        #ring{position:absolute;left:-9px;top:-9px;width:26px;height:26px;border:2px solid #ef4444;border-radius:50%;opacity:0;transform:scale(.55);transition:opacity 70ms linear,transform 70ms linear}
        #cursor[data-state="down"] #ring{opacity:1;transform:scale(1)}
        #label{position:absolute;left:16px;top:22px;padding:3px 7px;border-radius:5px;color:#fff;font:600 10px/1.25 system-ui,sans-serif;white-space:nowrap;user-select:none;letter-spacing:.02em;background:rgba(37,99,235,.95)}
        #cursor[data-source="CDP"] #label{background:rgba(180,83,9,.96)}
        #cursor[data-state="error"] #label{background:rgba(185,28,28,.97)}
        #cursor[data-state="key"] #label{outline:1px solid rgba(255,255,255,.35)}
        #cursor[data-state="wheel"] #label{outline:1px solid rgba(255,255,255,.35)}
      </style>
      <div id="cursor" data-state="move" data-source="USER">
        <svg id="arrow" viewBox="0 0 20 26" aria-hidden="true"><path d="M2 1 L2 20 L7.2 15.6 L11 24 L15 22.2 L11.2 14.1 L18 13.8 Z" fill="#fff" stroke="#111827" stroke-width="1.4" stroke-linejoin="round"/></svg>
        <div id="ring"></div>
        <div id="label">USER</div>
      </div>`;

    cursor = shadow.getElementById('cursor');
    label = shadow.getElementById('label');
    root.appendChild(host);

    const stored = readPosition();
    if (stored) {
      cursor.style.display = 'block';
      cursor.style.transform = `translate3d(${stored.x}px,${stored.y}px,0)`;
    }
    return true;
  }

  function sourceLabel(source) {
    return source === SOURCES.CDP ? 'CDP' : 'USER';
  }

  function resetLabel(delay = 170) {
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      if (!cursor || !label) return;
      cursor.dataset.state = 'move';
      label.textContent = sourceLabel(cursor.dataset.source);
    }, delay);
  }

  function applyPointer(event, source) {
    const x = Number(event?.x);
    const y = Number(event?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !ensure()) return false;

    clearTimeout(resetTimer);
    cursor.style.display = 'block';
    cursor.style.transform = `translate3d(${x}px,${y}px,0)`;
    cursor.dataset.source = source;
    writePosition(x, y);

    const wheel = event.type === 'mouseWheel';
    cursor.dataset.state = event.type === 'mousePressed' ? 'down' : event.type === 'mouseReleased' ? 'up' : wheel ? 'wheel' : 'move';
    const prefix = sourceLabel(source);
    if (event.type === 'mousePressed') label.textContent = `${prefix} · DOWN`;
    else if (event.type === 'mouseReleased') label.textContent = `${prefix} · UP`;
    else if (wheel) {
      const dx = Math.abs(Number(event.deltaX || 0));
      const dy = Math.abs(Number(event.deltaY || 0));
      label.textContent = `${prefix} · WHEEL ${dx > dy ? '↔' : '↕'}`;
    } else label.textContent = prefix;

    if (source === SOURCES.CDP) cdpEvents += 1;
    else userEvents += 1;
    if (event.type === 'mouseReleased') resetLabel(140);
    else if (wheel) resetLabel(220);
    return true;
  }

  function applyKey(event, source) {
    if (!ensure() || cursor.style.display !== 'block') return false;
    const key = String(event?.key || '');
    if (!key) return false;
    clearTimeout(resetTimer);
    cursor.dataset.source = source;
    cursor.dataset.state = 'key';
    label.textContent = `${sourceLabel(source)} · KEY ${key}`;
    resetLabel(190);
    if (source === SOURCES.CDP) cdpEvents += 1;
    else userEvents += 1;
    return true;
  }

  function pruneExpected() {
    const now = clock();
    while (expectedPointers.length && expectedPointers[0].expiresAt < now) expectedPointers.shift();
    while (expectedKeys.length && expectedKeys[0].expiresAt < now) expectedKeys.shift();
  }

  function expectPointer(event) {
    pruneExpected();
    expectedPointers.push({ ...event, expiresAt: clock() + 260 });
    if (expectedPointers.length > 96) expectedPointers.splice(0, expectedPointers.length - 96);
    applyPointer(event, SOURCES.CDP);
  }

  function expectKey(event) {
    pruneExpected();
    expectedKeys.push({ ...event, expiresAt: clock() + 320 });
    if (expectedKeys.length > 96) expectedKeys.splice(0, expectedKeys.length - 96);
    applyKey(event, SOURCES.CDP);
  }

  function removeExpectedById(eventId) {
    if (!eventId) return;
    const pointerIndex = expectedPointers.findIndex(item => item.eventId === eventId);
    if (pointerIndex >= 0) expectedPointers.splice(pointerIndex, 1);
    const keyIndex = expectedKeys.findIndex(item => item.eventId === eventId);
    if (keyIndex >= 0) expectedKeys.splice(keyIndex, 1);
  }

  function applyFailure(event) {
    removeExpectedById(event?.eventId);
    if (!ensure()) return false;
    cdpFailures += 1;
    clearTimeout(resetTimer);
    cursor.dataset.source = SOURCES.CDP;
    cursor.dataset.state = 'error';
    cursor.style.display = 'block';
    label.textContent = 'CDP · ERROR';
    resetLabel(900);
    return true;
  }

  function normalizeButton(button) {
    if (button === 0) return 'left';
    if (button === 1) return 'middle';
    if (button === 2) return 'right';
    return 'none';
  }

  function normalizeDomPointer(event) {
    const type = DOM_POINTER_TO_CDP[event.type];
    if (!type) return null;
    return {
      type,
      x: Number(event.clientX),
      y: Number(event.clientY),
      button: normalizeButton(event.button),
      buttons: Number(event.buttons || 0),
      clickCount: Number(event.detail || 0),
      deltaX: Number(event.deltaX || 0),
      deltaY: Number(event.deltaY || 0),
      at: Date.now()
    };
  }

  function targetContext(target) {
    const el = target?.nodeType === 1 ? target : null;
    if (!el) return { tag: null, role: null, inputType: null, formContext: false, isSubmitControl: false };
    const tag = String(el.tagName || '').toLowerCase();
    const role = String(el.getAttribute?.('role') || '').toLowerCase() || null;
    const inputType = String(el.getAttribute?.('type') || '').toLowerCase() || null;
    const formContext = Boolean(el.closest?.('form'));
    const buttonType = tag === 'button' ? String(el.getAttribute?.('type') || 'submit').toLowerCase() : null;
    const isSubmitControl = (tag === 'button' && buttonType === 'submit') || (tag === 'input' && ['submit', 'image'].includes(inputType));
    return { tag, role, inputType, formContext, isSubmitControl };
  }

  function consumeExpectedPointer(actual) {
    pruneExpected();
    let bestIndex = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < expectedPointers.length; i += 1) {
      const expected = expectedPointers[i];
      if (expected.type !== actual.type) continue;
      const distance = Math.hypot(Number(expected.x) - actual.x, Number(expected.y) - actual.y);
      if (distance <= 10 && distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    if (bestIndex < 0) return null;
    return expectedPointers.splice(bestIndex, 1)[0];
  }

  function consumeExpectedKey(event) {
    pruneExpected();
    const wanted = String(event.key || '');
    const expectedTypes = event.type === 'keyup' ? new Set(['keyUp']) : new Set(['rawKeyDown', 'keyDown', 'char']);
    const index = expectedKeys.findIndex(item => item.key === wanted && expectedTypes.has(item.type));
    if (index < 0) return null;
    return expectedKeys.splice(index, 1)[0];
  }

  function emitUserMotorEvent(kind, event, context) {
    chromeApi.runtime.sendMessage({
      scope: VIRTUAL_CURSOR_SCOPE,
      type: MESSAGE_TYPES.USER_MOTOR_EVENT,
      payload: {
        source: SOURCES.USER,
        kind,
        event,
        context,
        url: String(win?.location?.href || ''),
        at: Date.now()
      }
    }).catch(() => {});
  }

  function onDomPointer(event) {
    const normalized = normalizeDomPointer(event);
    if (!normalized) return;
    const expected = consumeExpectedPointer(normalized);
    if (expected) {
      suppressedDomEvents += 1;
      return;
    }

    applyPointer(normalized, SOURCES.USER);
    const now = clock();
    if (event.type !== 'mousemove' || now - lastMoveSentAt >= 20) {
      lastMoveSentAt = now;
      emitUserMotorEvent('pointer', normalized, targetContext(event.target));
    }
  }

  function onDomKey(event) {
    const expected = consumeExpectedKey(event);
    if (expected) {
      suppressedDomEvents += 1;
      return;
    }
    const normalized = {
      type: event.type,
      key: String(event.key || ''),
      code: String(event.code || ''),
      repeat: event.repeat === true,
      at: Date.now()
    };
    applyKey(normalized, SOURCES.USER);
    emitUserMotorEvent('keyboard', normalized, targetContext(event.target));
  }

  function messageListener(message, _sender, sendResponse) {
    if (message?.scope !== VIRTUAL_CURSOR_SCOPE) return false;
    if (message.type === MESSAGE_TYPES.CDP_POINTER_EXPECTED) expectPointer(message.event);
    else if (message.type === MESSAGE_TYPES.CDP_KEY_EXPECTED) expectKey(message.event);
    else if (message.type === MESSAGE_TYPES.CDP_INPUT_FAILED) applyFailure(message.event);
    else if (message.type === MESSAGE_TYPES.CURSOR_STATUS) {
      sendResponse({ ok: true, result: status() });
    }
    return false;
  }

  function status() {
    return {
      installed: true,
      visible: cursor?.style?.display === 'block',
      source: cursor?.dataset?.source || null,
      userEvents,
      cdpEvents,
      cdpFailures,
      suppressedDomEvents,
      expectedPointerCount: expectedPointers.length,
      expectedKeyCount: expectedKeys.length
    };
  }

  chromeApi.runtime.onMessage.addListener(messageListener);
  documentRef.addEventListener('mousemove', onDomPointer, true);
  documentRef.addEventListener('mousedown', onDomPointer, true);
  documentRef.addEventListener('mouseup', onDomPointer, true);
  documentRef.addEventListener('wheel', onDomPointer, { capture: true, passive: true });
  documentRef.addEventListener('keydown', onDomKey, true);
  documentRef.addEventListener('keyup', onDomKey, true);
  ensure();

  return {
    status,
    uninstall() {
      chromeApi.runtime.onMessage.removeListener?.(messageListener);
      documentRef.removeEventListener('mousemove', onDomPointer, true);
      documentRef.removeEventListener('mousedown', onDomPointer, true);
      documentRef.removeEventListener('mouseup', onDomPointer, true);
      documentRef.removeEventListener('wheel', onDomPointer, true);
      documentRef.removeEventListener('keydown', onDomKey, true);
      documentRef.removeEventListener('keyup', onDomKey, true);
      clearTimeout(resetTimer);
      host?.remove();
      host = cursor = label = null;
    }
  };
}

module.exports = { HOST_TAG, POSITION_KEY, installVirtualCursorOverlay };
