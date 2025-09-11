/**
 * 单 WebSocket 客户端封装
 * 功能：
 *  - 单实例全局复用
 *  - 固定 4 秒重连（不指数退避）
 *  - 发送时若未连接：排队并触发连接
 *  - 简单 cmd 路由：wsClient.onCmd(cmd, handler)
 *  - ensureWS(): 外部调用确保已进入连接流程
 *
 * 后续扩展建议：
 *  - 增加手动关闭函数，用于登出销毁
 *  - 增加最大重连次数 / 指数退避
 *  - 增加 request/response 对应（requestId -> Promise）
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
  }

  connect() {
    if (this.manualClosed) {
      // 如果是手动关闭状态下不再自动连接
      return;
    }
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

  onClose(ev) {
    this.status = 'disconnected';
    eventBus.emit('ws:statusChange', this.status);
    if (!this.manualClosed) {
      this.scheduleReconnect();
    }
  }

  onError(err) {
    // 出错时直接关闭，进入 close 流程再重连
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
    // msg: { cmd, requestId?, data? }
    if (this.status !== 'connected') {
      this.queue.push(msg);
      this.ensureConnected();
      eventBus.emit('toast:show', { type: 'info', message: '实时连接重试中…' });
      return;
    }
    this._sendRaw(msg);
  }

  _sendRaw(msg) {
    try {
      this.ws.send(JSON.stringify(msg));
    } catch (e) {
      console.error('[WS] send failed', e);
      // 回退：重新加入队列并尝试重连
      this.queue.unshift(msg);
      if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
        this.status = 'disconnected';
        this.scheduleReconnect();
      }
    }
  }

  onCmd(cmd, fn) {
    if (!this.handlers.has(cmd)) this.handlers.set(cmd, new Set());
    this.handlers.get(cmd).add(fn);
    return () => {
      this.handlers.get(cmd)?.delete(fn);
    };
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

/**
 * 外部调用：保证进入连接流程
 * 典型调用点：
 *  - 现场管理页面 mount
 *  - 打开模式窗口
 *  - 用户手动点击“重试”按钮（未来可加）
 */
export function ensureWS() {
  wsClient.ensureConnected();
}

// 也可以提供一个快捷函数用于发送（可选）
export function wsSend(payload) {
  wsClient.send(payload);
}