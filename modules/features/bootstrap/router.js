import { authRequireGuard } from '@core/auth.js';
import { closeAllModals } from '@ui/modal.js';
import { mountUserListPage, unmountUserListPage } from '@features/pages/UserListPage.js';
import { mountSitePage, unmountSitePage } from '@features/pages/SitePage.js';
import { mountLoginPage, unmountLoginPage } from '@features/pages/LoginPage.js';

let currentUnmount = null;

const routes = {
  '/login': { allowAnon: true, mount: mountLoginPage, unmount: unmountLoginPage },
  '/users': { allowAnon: false, mount: mountUserListPage, unmount: unmountUserListPage },
  '/site' : { allowAnon: false, mount: mountSitePage, unmount: unmountSitePage }
};

export function initRouter() {
  window.addEventListener('hashchange', navigate);
  if (!location.hash) location.hash = '#/users';
  navigate();
}

function navigate() {
  const path = (location.hash.replace(/^#/, '') || '/users');
  const route = routes[path] || routes['/users'];

  // 守卫
  if (!route.allowAnon && !authRequireGuard()) {
    location.hash = '#/login';
    return;
  }
  if (route.allowAnon && authRequireGuard() && path === '/login') {
    location.hash = '#/users';
    return;
  }

  // 关闭所有残留弹窗
  closeAllModals();

  // 卸载旧页面
  currentUnmount && currentUnmount();

  // 挂载新页面
  currentUnmount = route.mount();

  highlightNav(path);
}

function highlightNav(path) {
  document.querySelectorAll('.nav-link').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === '#' + path);
  });
}