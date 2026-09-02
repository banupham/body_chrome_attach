'use strict';

const readline = require('node:readline');
const { WebSocketServer } = require('ws');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8766;
const BODY_ROLE = 'body-chrome-attach';

function normalizeText(value) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error('body_cli_text_required');
  return text;
}

class BodyCommandBroker {
  constructor({ host = DEFAULT_HOST, port = DEFAULT_PORT, resultTimeoutMs = 120000 } = {}) {
    this.host = host;
    this.port = Number(port);
    this.resultTimeoutMs = Number(resultTimeoutMs);
    this.server = null;
    this.extension = null;
    this.pending = new Map();
    this.waiters = new Set();
    this.sequence = 0;
  }

  async start() {
    if (this.server) return { host: this.host, port: this.port };
    await new Promise((resolve, reject) => {
      const server = this.server = new WebSocketServer({ host: this.host, port: this.port });
      server.once('listening', resolve);
      server.once('error', reject);
      server.on('connection', socket => this.onConnection(socket));
    });
    return { host: this.host, port: this.port };
  }

  onConnection(socket) {
    socket.on('message', raw => this.onMessage(socket, raw));
    socket.on('close', () => {
      if (socket !== this.extension) return;
      this.extension = null;
      const error = new Error('Body extension disconnected.');
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
  }

  onMessage(socket, raw) {
    let message;
    try { message = JSON.parse(String(raw)); } catch (_) { return; }
    if (message.type === 'register' && message.role === BODY_ROLE) {
      if (this.extension && this.extension !== socket) this.extension.close();
      this.extension = socket;
      for (const resolve of this.waiters) resolve(socket);
      this.waiters.clear();
      return;
    }
    if (message.type === 'heartbeat') return;
    if (message.type !== 'commandResult' || !message.id) return;
    const pending = this.pending.get(String(message.id));
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(String(message.id));
    pending.resolve(message);
  }

  waitForExtension(timeoutMs = 8000) {
    if (this.extension?.readyState === this.extension.OPEN) return Promise.resolve(this.extension);
    return new Promise((resolve, reject) => {
      const done = socket => {
        clearTimeout(timer);
        this.waiters.delete(done);
        resolve(socket);
      };
      const timer = setTimeout(() => {
        this.waiters.delete(done);
        reject(new Error('Chưa có Body extension kết nối tới ws://127.0.0.1:8766.'));
      }, timeoutMs);
      this.waiters.add(done);
    });
  }

  async sendText(text) {
    const socket = await this.waitForExtension();
    const id = `body-cli-${Date.now()}-${++this.sequence}`;
    const payload = { type: 'command', id, payload: { text: normalizeText(text) } };
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Body command timeout.'));
      }, this.resultTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    socket.send(JSON.stringify(payload));
    return result;
  }

  async close() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Body CLI closed.'));
    }
    this.pending.clear();
    try { this.extension?.close(); } catch (_) {}
    this.extension = null;
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise(resolve => server.close(resolve));
  }
}

function printResult(message) {
  if (message?.ok === false) {
    console.error(`Lỗi: ${message.error || message.code || 'Body command failed.'}`);
    return false;
  }
  console.log(JSON.stringify(message?.result ?? message, null, 2));
  return true;
}

async function interactive(broker) {
  console.log('Đang chờ Body extension kết nối...');
  await broker.waitForExtension();
  console.log('Đã kết nối. Ví dụ: click 400 250 | type hello | submit 500 600 | profile | status');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'Body > ' });
  rl.prompt();
  rl.on('line', async line => {
    if (!String(line).trim()) return rl.prompt();
    rl.pause();
    try { printResult(await broker.sendText(line)); }
    catch (error) { console.error(`Lỗi: ${error?.message || error}`); }
    finally { rl.resume(); rl.prompt(); }
  });
  await new Promise(resolve => rl.once('close', resolve));
}

async function main(argv = process.argv.slice(2)) {
  const broker = new BodyCommandBroker();
  try {
    await broker.start();
    console.log(`Body CLI broker: ws://${DEFAULT_HOST}:${DEFAULT_PORT}`);
    if (argv.length) printResult(await broker.sendText(argv.join(' ')));
    else await interactive(broker);
  } catch (error) {
    console.error(`Lỗi: ${error?.message || error}`);
    process.exitCode = 1;
  } finally {
    await broker.close().catch(() => {});
  }
}

if (require.main === module) main();

module.exports = { DEFAULT_HOST, DEFAULT_PORT, BODY_ROLE, BodyCommandBroker, main };
