'use strict';

class ControllerLease {
  constructor() {
    this.brainSocket = null;
    this.brain = null;
  }

  attachBrain(ws, { controllerId = 'brain', connectedAt = Date.now() } = {}) {
    if (!ws) throw new Error('brain_socket_required');
    if (this.brainSocket && this.brainSocket !== ws) throw new Error('brain_controller_already_attached');
    this.brainSocket = ws;
    this.brain = { controllerId: String(controllerId || 'brain'), connectedAt: Number(connectedAt) || Date.now() };
    return this.status();
  }

  detachSocket(ws) {
    if (this.brainSocket !== ws) return false;
    this.brainSocket = null;
    this.brain = null;
    return true;
  }

  hasBrain() {
    return Boolean(this.brainSocket);
  }

  assertDebugControlAllowed() {
    if (this.hasBrain()) throw new Error('brain_controller_active');
    return true;
  }

  status() {
    return {
      controller: this.hasBrain() ? 'brain' : 'none',
      brainOnline: this.hasBrain(),
      exclusive: true,
      brain: this.brain ? { ...this.brain } : null
    };
  }
}

module.exports = { ControllerLease };
