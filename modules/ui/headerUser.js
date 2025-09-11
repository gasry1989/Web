import { authState, authLogout } from '../core/auth.js';

export function renderHeaderUser() {
  const headerRight = document.getElementById('headerRight');
  const { userInfo } = authState.get();
  if (!userInfo) {
    headerRight.innerHTML = `<a href="#/login" class="btn btn-xs">登录</a>`;
    return;
  }
  headerRight.innerHTML = `
    <span class="user-label">${userInfo.userName} (角色ID:${userInfo.roleId})</span>
    <button class="btn btn-xs" id="btnLogout">退出</button>
  `;
  headerRight.querySelector('#btnLogout').addEventListener('click', () => {
    authLogout();
  });
}