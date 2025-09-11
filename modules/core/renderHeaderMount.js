import { authState, authLogout } from '@core/auth.js';
import { eventBus } from '@core/eventBus.js';

let lastIsLoginRoute = null;
let cachedSidebarDisplay = null;
let unsubscribeAuth = null;

export function renderHeaderUserMount() {
  const headerRight = document.getElementById('headerRight');

  function isLoginRoute() {
    const h = location.hash || '#/login';
    return h === '#/login' || h.startsWith('#/login?');
  }

  function getSidebar() {
    // 兼容两种写法：#sidebar 或 #sideBar
    return document.getElementById('sidebar') || document.getElementById('sideBar');
  }

  function applyLayoutForRoute() {
    const isLogin = isLoginRoute();
    if (isLogin === lastIsLoginRoute) return;
    lastIsLoginRoute = isLogin;

    const sidebar = getSidebar();
    const appLayout = document.getElementById('appLayout');
    const mainView = document.getElementById('mainView');

    if (isLogin) {
      if (sidebar && cachedSidebarDisplay === null) {
        cachedSidebarDisplay = sidebar.style.display || '';
      }
      if (sidebar) {
        sidebar.style.display = 'none';
        // 去掉可能的边框
        sidebar.style.borderRight = 'none';
        sidebar.style.border = 'none';
      }
      if (mainView) {
        mainView.dataset._prevBorderLeft = mainView.style.borderLeft || '';
        mainView.dataset._prevBorder = mainView.style.border || '';
        mainView.style.borderLeft = 'none';
        mainView.style.border = 'none';
        mainView.style.marginLeft = '0';
      }
      appLayout && appLayout.classList.add('login-mode');
      if (headerRight) headerRight.innerHTML = ''; // 登录页不显示“登录”按钮自身
    } else {
      // 还原
      if (sidebar && cachedSidebarDisplay !== null) {
        sidebar.style.display = cachedSidebarDisplay;
      }
      if (mainView) {
        if (mainView.dataset._prevBorderLeft !== undefined) {
          mainView.style.borderLeft = mainView.dataset._prevBorderLeft;
        }
        if (mainView.dataset._prevBorder !== undefined) {
          mainView.style.border = mainView.dataset._prevBorder;
        }
        // 若你的布局本来通过 class 控制 margin-left，可在此不强制设置
      }
      appLayout && appLayout.classList.remove('login-mode');
      renderUserArea(); // 非登录路由重新渲染 header 用户区
    }
  }

  function renderUserArea() {
    if (isLoginRoute()) {
      if (headerRight) headerRight.innerHTML = '';
      return;
    }
    const s = authState.get();
    if (!headerRight) return;

    if (!s.token || !s.userInfo) {
      headerRight.innerHTML = `<a href="#/login" class="btn btn-xs" id="btnLoginLink">登录</a>`;
    } else {
      headerRight.innerHTML = `
        <span class="user-label">${escapeHTML(s.userInfo.userName||'用户')} (角色ID:${s.userInfo.roleId})</span>
        <button class="btn btn-xs" id="btnLogout">退出</button>
      `;
      headerRight.querySelector('#btnLogout')?.addEventListener('click', () => {
        authLogout();
        eventBus.emit('toast:show', { type:'info', message:'已退出登录' });
      });
    }
  }

  function fullRefresh() {
    applyLayoutForRoute();
    if (!isLoginRoute()) renderUserArea();
  }

  unsubscribeAuth = authState.subscribe(fullRefresh);
  window.addEventListener('hashchange', fullRefresh);
  fullRefresh();
}

function escapeHTML(str='') {
  return str.replace(/[&<>"']/g, c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}