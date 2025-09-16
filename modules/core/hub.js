/**
 * 全局 WS Hub（集中接入，统一分发）
 * - 依赖全局单例 wsClient（连接、重连、发送、请求/响应）
 * - 提供按 cmd 订阅、按自定义过滤订阅、主题发布（纯前端）等能力
 * - 其他页面/弹窗只需要 import { wsHub } 使用，不直接依赖 wsClient
 */
import { wsClient } from '@core/wsClient.js';
import { eventBus } from '@core/eventBus.js';

const cmdHandlers = new Map();       // cmd -> Set<fn>
const rawHandlers = new Set();       // 所有原始消息监听
const matchHandlers = new Set();     // { filter: (msg)=>bool, fn }
const topicHandlers = new Map();     // 纯前端 topic -> Set<fn>
let unbindRaw = null;

/** 简单浅匹配：pattern 仅对第一层字段和常见路径做判断 */
function shallowMatch(msg, pattern) {
  if (!pattern || typeof pattern !== 'object') return true;
  for (const k of Object.keys(pattern)) {
    const expect = pattern[k];
    // 支持常见嵌套键的快捷判断
    if (k === 'to.id') {
      if (!msg?.to || String(msg.to.id) !== String(expect)) return false;
      continue;
    }
    if (k === 'to.type') {
      if (!msg?.to || String(msg.to.type) !== String(expect)) return false;
      continue;
    }
    if (k === 'devId') {
      if (String(msg?.devId) !== String(expect)) return false;
      continue;
    }
    if (k === 'modeId') {
      if (String(msg?.modeId) !== String(expect)) return false;
      continue;
    }
    if (msg?.[k] !== expect) return false;
  }
  return true;
}

function dispatch(msg) {
  // 1) 原始
  for (const fn of rawHandlers) { try { fn(msg); } catch (e) { console.error('[wsHub] raw handler error', e); } }

  // 2) 根据 requestId：请求-响应已经在 wsClient 内处理，这里不再次路由

  // 3) cmd 路由
  if (msg && msg.cmd && cmdHandlers.has(msg.cmd)) {
    for (const fn of cmdHandlers.get(msg.cmd)) {
      try { fn(msg); } catch (e) { console.error('[wsHub] cmd handler error', e); }
    }
  }

  // 4) 匹配订阅
  for (const h of matchHandlers) {
    try {
      const ok = typeof h.filter === 'function'
        ? h.filter(msg)
        : shallowMatch(msg, h.filter);
      if (ok) h.fn(msg);
    } catch (e) { console.error('[wsHub] match handler error', e); }
  }

  // 5) 广播一份全局事件（可选）
  eventBus.emit('ws:message', msg);
}

export const wsHub = {
  // —— 订阅 —— //
  onRaw(fn) {
    rawHandlers.add(fn);
    return () => rawHandlers.delete(fn);
  },
  onCmd(cmd, fn) {
    if (!cmdHandlers.has(cmd)) cmdHandlers.set(cmd, new Set());
    cmdHandlers.get(cmd).add(fn);
    return () => cmdHandlers.get(cmd)?.delete(fn);
  },
  onMatch(filterOrFn, fn) {
    const item = typeof filterOrFn === 'function'
      ? { filter: filterOrFn, fn }
      : { filter: filterOrFn || {}, fn };
    matchHandlers.add(item);
    return () => matchHandlers.delete(item);
  },

  // —— 发送 —— //
  send(payload) {
    // payload: { cmd, to?, data?, requestId? }
    wsClient.send(payload);
  },
  request({ cmd, to, data, requestId }) {
    return wsClient.sendRequest({ cmd, to, data, requestId });
  },

  // —— 纯前端主题（与服务端无关，用于跨组件广播）—— //
  publish(topic, data) {
    if (!topicHandlers.has(topic)) return;
    for (const fn of topicHandlers.get(topic)) {
      try { fn(data); } catch (e) { console.error('[wsHub] topic handler error', e); }
    }
  },
  onTopic(topic, fn) {
    if (!topicHandlers.has(topic)) topicHandlers.set(topic, new Set());
    topicHandlers.get(topic).add(fn);
    return () => topicHandlers.get(topic)?.delete(fn);
  }
};

/** 启动 Hub：挂接 wsClient.onRaw，一次即可 */
export function startWSHub() {
  if (!unbindRaw) {
    unbindRaw = wsClient.onRaw(dispatch);
  }
  // 同步连接状态给前端
  eventBus.on('ws:statusChange', (s) => {
    eventBus.emit('ws:status', s);
    wsHub.publish('status', s);
  });
  // 调试辅助
  try { window.__wsHub = wsHub; } catch {}
}