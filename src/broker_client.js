'use strict';

class BrokerClient {
  constructor({ WebSocketImpl, url, identity, handleCommand, reconnectMs = 1500, heartbeatMs = 20000 }) {
    this.WebSocketImpl = WebSocketImpl;
    this.url = url;
    this.identity = identity;
    this.handleCommand = handleCommand;
    this.reconnectMs = reconnectMs;
    this.heartbeatMs = heartbeatMs;
    this.socket = null;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.closed = false;
  }

  connect() {
    if (!this.WebSocketImpl) throw new Error('WebSocket implementation required');
    this.closed = false;
    const socket = this.socket = new this.WebSocketImpl(this.url);
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'register', ...this.identity }));
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = setInterval(() => {
        if (this.socket?.readyState === 1) {
          this.socket.send(JSON.stringify({ type: 'heartbeat', at: Date.now() }));
        }
      }, this.heartbeatMs);
    });
    socket.addEventListener('message', event => this.onMessage(event));
    socket.addEventListener('close', () => this.onClose());
    socket.addEventListener('error', () => {});
    return socket;
  }

  onClose() {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.socket = null;
    if (this.closed) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectMs);
  }

  async onMessage(event) {
    let message;
    try { message = JSON.parse(event.data); } catch (_) { return; }
    if (message.type !== 'command') return;
    try {
      const result = await this.handleCommand(message.payload || {});
      this.reply(message.id, { ok: true, result });
    } catch (error) {
      this.reply(message.id, { ok: false, error: String(error?.message || error), code: error?.code || null });
    }
  }

  reply(id, payload) {
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify({ type: 'commandResult', id, ...payload }));
  }

  close() {
    this.closed = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.heartbeatTimer);
    this.socket?.close();
    this.socket = null;
  }
}

module.exports = { BrokerClient };
