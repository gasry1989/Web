import { createStore } from '@core/store.js';
import { eventBus } from '@core/eventBus.js';
import { httpPost } from '@core/http.js';
import { apiPath } from '@core/apiCatalog.js';
import { sha256Hex } from '@utils/hash.js'; // 已实现 WebCrypto + fallback

const LS_TOKEN = 'APP_TOKEN';
const LS_USER  = 'APP_USER';

export const authState = createStore({
  token: null,
  userInfo: null
});

export function authLoadToken() {
  const tk = localStorage.getItem(LS_TOKEN);
  const uiStr = localStorage.getItem(LS_USER);
  if (tk) {
    let userInfo = null;
    try { userInfo = JSON.parse(uiStr); } catch {}
    authState.set({ token: tk, userInfo });
  }
}

export function authGetToken() {
  return authState.get().token;
}

export function authRequireGuard() {
  return !!authGetToken();
}

export async function authLogin(account, rawPwd) {
  // 方案2：sha256Hex 内部自动区分安全上下文或 fallback
  const hashed = await sha256Hex(rawPwd);
  const data = await httpPost(apiPath('3.1'), {
    userAccount: account,
    pwd: hashed
  });
  authState.set({ token: data.token, userInfo: data.userInfo });
  localStorage.setItem(LS_TOKEN, data.token);
  localStorage.setItem(LS_USER, JSON.stringify(data.userInfo));
  eventBus.emit('toast:show', { type: 'success', message: '登录成功' });
  eventBus.emit('auth:login', data.userInfo);
  location.hash = '#/users';
}

export function authLogout() {
  authState.set({ token: null, userInfo: null });
  localStorage.removeItem(LS_TOKEN);
  localStorage.removeItem(LS_USER);
  eventBus.emit('auth:logout');
  location.hash = '#/login';
}