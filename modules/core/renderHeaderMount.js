import { authState, authLogout } from '@core/auth.js';
import { eventBus } from '@core/eventBus.js';

export function renderHeaderUserMount() {
  const headerRight = document.getElementById('headerRight');
  function render() {
    const s = authState.get();
    if (!s.token || !s.userInfo) {
      headerRight.innerHTML = `<a href="#/login" class="btn btn-xs" id="btnLoginLink">登录</a>`;
    } else {
      headerRight.innerHTML = `
        <span class="user-label">${escapeHTML(s.userInfo.userName||'用户')} (角色ID:${s.userInfo.roleId})</span>
        <button class="btn btn-xs" id="btnLogout">退出</button>
      `;
      headerRight.querySelector('#btnLogout').addEventListener('click', () => {
        authLogout();
        eventBus.emit('toast:show', { type:'info', message:'已退出登录' });
      });
    }
  }
  authState.subscribe(render);
  render();
}

function escapeHTML(str=''){
  return str.replace(/[&<>"']/g, c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}