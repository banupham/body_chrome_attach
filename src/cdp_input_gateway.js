'use strict';

const { VirtualCursorMirror } = require('./virtual_cursor_mirror');

const HUMAN_MOTOR_METHODS = new Set([
  'Input.dispatchMouseEvent',
  'Input.dispatchKeyEvent'
]);

class CdpInputGateway {
  constructor(chromeApi) {
    if (!chromeApi?.debugger?.attach || !chromeApi?.debugger?.sendCommand) {
      throw new Error('chrome_debugger_api_required');
    }
    this.chrome = chromeApi;
    this.attachedTabs = new Set();
    this.mirror = new VirtualCursorMirror(chromeApi);
  }

  debuggee(tabId) {
    const id = Number(tabId);
    if (!Number.isInteger(id)) throw new Error('cdp_tab_id_required');
    return { tabId: id };
  }

  async attach(tabId) {
    const target = this.debuggee(tabId);
    if (this.attachedTabs.has(target.tabId)) return { attached: true, reused: true };
    try {
      await this.chrome.debugger.attach(target, '1.3');
      this.attachedTabs.add(target.tabId);
      return { attached: true, reused: false };
    } catch (error) {
      const message = String(error?.message || error);
      if (/already attached|Another debugger/i.test(message)) {
        this.attachedTabs.add(target.tabId);
        return { attached: true, reused: true, warning: message };
      }
      throw error;
    }
  }

  async detach(tabId) {
    const target = this.debuggee(tabId);
    try {
      await this.chrome.debugger.detach(target);
    } finally {
      this.attachedTabs.delete(target.tabId);
    }
    return { detached: true };
  }

  async sendInput(tabId, method, params = {}) {
    if (!HUMAN_MOTOR_METHODS.has(method)) {
      throw new Error(`human_motor_method_forbidden:${method}`);
    }
    const target = this.debuggee(tabId);
    await this.attach(target.tabId);

    // Publish before dispatch so the content script can mark the matching DOM event as CDP-origin.
    const mirror = await this.mirror.publishExpected(target.tabId, method, params);
    const result = await this.chrome.debugger.sendCommand(target, method, params);

    return {
      ok: true,
      method,
      params,
      mirror,
      result: result ?? null
    };
  }

  status() {
    return {
      attachedTabs: [...this.attachedTabs],
      allowedMethods: [...HUMAN_MOTOR_METHODS],
      mirror: this.mirror.status()
    };
  }
}

module.exports = { HUMAN_MOTOR_METHODS, CdpInputGateway };
