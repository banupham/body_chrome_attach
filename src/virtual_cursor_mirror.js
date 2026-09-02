'use strict';

const { VIRTUAL_CURSOR_SCOPE, MESSAGE_TYPES, SOURCES } = require('./virtual_cursor_protocol');

const POINTER_EVENT_TYPES = new Set(['mouseMoved', 'mousePressed', 'mouseReleased', 'mouseWheel']);
const KEY_EVENT_TYPES = new Set(['rawKeyDown', 'keyDown', 'keyUp', 'char']);

class VirtualCursorMirror {
  constructor(chromeApi, { now = Date.now } = {}) {
    this.chrome = chromeApi;
    this.now = now;
    this.sequence = 0;
    this.pointerEvents = 0;
    this.keyEvents = 0;
    this.failedEvents = 0;
    this.deliveryErrors = 0;
  }

  nextId(prefix) {
    this.sequence += 1;
    return `${prefix}-${this.now()}-${this.sequence}`;
  }

  pointerEvent(params = {}) {
    const type = String(params.type || '');
    const x = Number(params.x);
    const y = Number(params.y);
    if (!POINTER_EVENT_TYPES.has(type) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    return {
      eventId: this.nextId('pointer'),
      source: SOURCES.CDP,
      type,
      x,
      y,
      button: params.button || 'none',
      buttons: Number(params.buttons || 0),
      clickCount: Number(params.clickCount || 0),
      deltaX: Number(params.deltaX || 0),
      deltaY: Number(params.deltaY || 0),
      at: this.now()
    };
  }

  keyEvent(params = {}) {
    const type = String(params.type || '');
    const key = String(params.key || '');
    if (!KEY_EVENT_TYPES.has(type) || !key) return null;
    return {
      eventId: this.nextId('key'),
      source: SOURCES.CDP,
      type,
      key,
      code: String(params.code || ''),
      modifiers: Number(params.modifiers || 0),
      at: this.now()
    };
  }

  async deliver(tabId, type, event) {
    if (!Number.isInteger(Number(tabId))) throw new Error('virtual_cursor_tab_id_required');
    try {
      await this.chrome.tabs.sendMessage(Number(tabId), {
        scope: VIRTUAL_CURSOR_SCOPE,
        type,
        event
      });
      return { published: true, event };
    } catch (error) {
      this.deliveryErrors += 1;
      return { published: false, event, error: String(error?.message || error) };
    }
  }

  async publishExpected(tabId, method, params = {}) {
    if (method === 'Input.dispatchMouseEvent') {
      const event = this.pointerEvent(params);
      if (!event) return { published: false };
      const result = await this.deliver(tabId, MESSAGE_TYPES.CDP_POINTER_EXPECTED, event);
      if (result.published) this.pointerEvents += 1;
      return result;
    }
    if (method === 'Input.dispatchKeyEvent') {
      const event = this.keyEvent(params);
      if (!event) return { published: false };
      const result = await this.deliver(tabId, MESSAGE_TYPES.CDP_KEY_EXPECTED, event);
      if (result.published) this.keyEvents += 1;
      return result;
    }
    return { published: false };
  }

  async publishFailure(tabId, expectedResult, method, error) {
    const expectedEvent = expectedResult?.event || null;
    const failure = {
      eventId: expectedEvent?.eventId || this.nextId('failed'),
      method: String(method || ''),
      error: String(error?.message || error || 'cdp_input_failed'),
      at: this.now()
    };
    const result = await this.deliver(tabId, MESSAGE_TYPES.CDP_INPUT_FAILED, failure);
    if (result.published) this.failedEvents += 1;
    return result;
  }

  status() {
    return {
      scope: VIRTUAL_CURSOR_SCOPE,
      pointerEvents: this.pointerEvents,
      keyEvents: this.keyEvents,
      failedEvents: this.failedEvents,
      deliveryErrors: this.deliveryErrors
    };
  }
}

module.exports = { POINTER_EVENT_TYPES, KEY_EVENT_TYPES, VirtualCursorMirror };
