/**
 * 单 WebSocket 客户端封装（全局单例）
 * - 单实例全局复用
 * - 固定 4 秒重连
 * - 未连接时排队发送
 * - 简单 cmd 路由：onCmd(cmd, handler)
 * - 新增：请求-响应 Promise 化（sendRequest），按 requestId 匹配
 * - 新增：onRaw 监听原始消息（用于 Hub 转发）
 * - Mock 与真实可并行（即使 Mock 也会连接）
 */
import { ENV } from '@config/env.js';
import { authGetToken } from '@core/auth.js';
import { eventBus } from '@core/eventBus.js';

class WSClient {
  constructor() {
    this.ws = null;
    this.status = 'disconnected'; // disconnected | connecting | connected
    this.queue = [];
    this.retryTimer = null;
    this.retryInterval = 4000;
    this.handlers = new Map(); // cmd -> Set<fn>
    this.manualClosed = false;

    // 请求-响应
    this.pending = new Map(); // requestId -> { resolve, reject, timer }
    this.requestTimeoutMs = 10000;

    // 原始监听
    this.rawListeners = new Set();
  }

  connect() {
    if (this.manualClosed) return;
    if (this.status === 'connecting' || this.status === 'connected') return;

    const token = authGetToken();
    if (!token) {
      // 未登录不建立连接
      return;
    }

    try {
      this.status = 'connecting';
      eventBus.emit('ws:statusChange', this.status);

      const url = `${ENV.WS_URL}?token=${encodeURIComponent(token)}`;
      this.ws = new WebSocket(url);

      this.ws.onopen = () => this.onOpen();
      this.ws.onclose = (ev) => this.onClose(ev);
      this.ws.onerror = (err) => this.onError(err);
      this.ws.onmessage = (ev) => this.onMessage(ev);
    } catch (e) {
      console.error('[WS] connect exception', e);
      this.scheduleReconnect();
    }
  }

  onOpen() {
    this.status = 'connected';
    eventBus.emit('ws:statusChange', this.status);
    // Flush queue
    while (this.queue.length > 0 && this.status === 'connected') {
      const msg = this.queue.shift();
      this._sendRaw(msg);
    }
    eventBus.emit('toast:show', { type: 'info', message: '实时连接已恢复' });
  }

  onClose() {
    this.status = 'disconnected';
    eventBus.emit('ws:statusChange', this.status);
    // 拒绝所有 pending
    for (const [rid, p] of this.pending.entries()) {
      try { p.reject(new Error('WS closed')); } catch {}
      clearTimeout(p.timer);
    }
    this.pending.clear();
    if (!this.manualClosed) {
      this.scheduleReconnect();
    }
  }

  onError() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.close(); } catch {}
    }
  }

  onMessage(ev) {
    let data = null;
    try {
      data = JSON.parse(ev.data);
    } catch (e) {
      console.warn('[WS] invalid JSON', ev.data);
      return;
    }

    // 原始分发
    for (const fn of this.rawListeners) {
      try { fn(data); } catch (e) { console.error('[WS] raw listener error', e); }
    }

    // 请求-响应匹配
    if (data && data.requestId != null) {
      const req = this.pending.get(data.requestId);
      if (req) {
        this.pending.delete(data.requestId);
        clearTimeout(req.timer);
        // 约定：有 code 字段，0 为成功
        if (data.code == null || data.code === 0) req.resolve(data);
        else req.reject(data);
        return;
      }
    }

    // cmd 分发
    if (data && data.cmd) {
      const set = this.handlers.get(data.cmd);
      if (set) {
        for (const fn of set) {
          try { fn(data); } catch (e) { console.error('[WS] handler error', e); }
        }
      }
    }
  }

  scheduleReconnect() {
    if (this.manualClosed) return;
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, this.retryInterval);
  }

  ensureConnected() {
    if (this.status === 'disconnected') {
      this.connect();
    }
  }

  send(msg) {
    // msg: { cmd, requestId?, data?, to? }
    if (this.status !== 'connected') {
      this.queue.push(msg);
      this.ensureConnected();
      return;
    }
    this._sendRaw(msg);
  }

  _sendRaw(msg) {
    try {
      this.ws.send(JSON.stringify(msg));
    } catch (e) {
      console.error('[WS] send failed', e);
      this.queue.unshift(msg);
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.status = 'disconnected';
        this.scheduleReconnect();
      }
    }
  }

  // 发送请求，返回 Promise，并自动超时
  sendRequest({ cmd, to, data, requestId }) {
    const rid = requestId != null ? requestId : (Date.now() + Math.floor(Math.random()*1000));
    const payload = { requestId: rid, cmd, to, data };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(rid);
        reject(new Error('WS request timeout'));
      }, this.requestTimeoutMs);
      this.pending.set(rid, { resolve, reject, timer });
      this.send(payload);
    });
  }

  onCmd(cmd, fn) {
    if (!this.handlers.has(cmd)) this.handlers.set(cmd, new Set());
    this.handlers.get(cmd).add(fn);
    return () => {
      this.handlers.get(cmd)?.delete(fn);
    };
  }

  onRaw(fn) {
    this.rawListeners.add(fn);
    return () => this.rawListeners.delete(fn);
  }

  removeCmdHandlers(cmd) {
    this.handlers.delete(cmd);
  }

  closeManual() {
    this.manualClosed = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this.status = 'disconnected';
    eventBus.emit('ws:statusChange', this.status);
  }
}

export const wsClient = new WSClient();
export function ensureWS() { wsClient.ensureConnected(); }
export function wsSend(payload) { wsClient.send(payload); }