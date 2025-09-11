import '@config/env.js';
import { initApp } from '@features/bootstrap/init.js';
import { initRouter } from '@features/bootstrap/router.js';
import { renderHeaderUserMount } from '@core/renderHeaderMount.js';
import { eventBus } from '@core/eventBus.js';
import { authState } from '@core/auth.js';
import { showToast } from '@ui/toast.js';

// 初始化基础（加载 token / 侧栏 / 预览容量）
initApp();

// 渲染头部（监听 authState）
renderHeaderUserMount();

// 初始化路由（含登录守卫）
initRouter();

// 全局 toast 事件
eventBus.on('toast:show', p => showToast(p));

// 若已登录访问 login，自动跳回用户列表
authState.subscribe(s => {
  const hash = location.hash || '#/login';
  if (s.token && hash === '#/login') {
    location.hash = '#/users';
  }
});

// 方便调试
console.log('[main] app started');