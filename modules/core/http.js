import { authGetToken, authLogout } from '@core/auth.js';
import { eventBus } from '@core/eventBus.js';
import { ENV } from '@config/env.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function request(path, options = {}) {
  const url = path.startsWith('http') ? path : `${ENV.API_BASE}${path}`;
  const headers = new Headers(options.headers || {});

  // 自动附加 Authorization（登录接口除外——不过即使附加也无妨）
  const token = authGetToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const fetchOpts = {
    method: options.method || 'POST',
    headers,
    body: options.body,
    credentials: 'omit' // 使用 Bearer，不依赖 cookie
  };

  let resp;
  try {
    resp = await fetch(url, fetchOpts);
  } catch (e) {
    eventBus.emit('toast:show', { type: 'error', message: '网络异常' });
    throw e;
  }

  // 服务器可能返回非 200，但仍有 JSON
  let data = null;
  try {
    data = await resp.json();
  } catch {
    // 非 JSON (可能 502 网关)
    eventBus.emit('toast:show', { type: 'error', message: `服务器错误(${resp.status})` });
    throw new Error(`Bad response ${resp.status}`);
  }

  // 统一业务码处理：假设 code=0 成功
  if (data.code !== 0) {
    if (data.code === 1001) {
      // 未授权或 token 失效
      eventBus.emit('toast:show', { type: 'error', message: '登录失效，请重新登录' });
      authLogout();
    } else {
      eventBus.emit('toast:show', { type: 'error', message: data.msg || '操作失败' });
    }
    throw data;
  }
  return data;
}

export function httpPost(apiPath, payload = {}) {
  return request(apiPath, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}