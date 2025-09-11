/**
 * 侧栏折叠单按钮控制
 * - 按钮插入到 sideBar 顶部 (绝对定位)
 * - 展开状态按钮文字 «  (表示点击后会向左收起)
 * - 折叠状态按钮文字 »  (表示点击后会展开)
 * - 状态持久化 localStorage
 */
const KEY = 'ui.sidebar.collapsed';
let initialized = false;

export function initSidebarToggle() {
  if (initialized) return;
  initialized = true;

  const sideBar = document.getElementById('sideBar');
  const appLayout = document.getElementById('appLayout');
  if (!sideBar || !appLayout) return;

  // 创建按钮（如果不存在）
  let btn = sideBar.querySelector('.sb-collapse-btn');
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sb-collapse-btn';
    sideBar.appendChild(btn);
  }

  let collapsed = loadState();
  apply(collapsed);

  btn.addEventListener('click', () => {
    collapsed = !collapsed;
    apply(collapsed);
    saveState(collapsed);
  });

  function apply(flag) {
    if (flag) {
      sideBar.classList.add('collapsed');
      appLayout.classList.add('sidebar-collapsed');
      btn.textContent = '»';
      btn.title = '展开侧栏';
    } else {
      sideBar.classList.remove('collapsed');
      appLayout.classList.remove('sidebar-collapsed');
      btn.textContent = '«';
      btn.title = '折叠侧栏';
    }
  }
}

function loadState() {
  try { return localStorage.getItem(KEY) === '1'; } catch(_) { return false; }
}
function saveState(v) {
  try { localStorage.setItem(KEY, v ? '1' : '0'); } catch(_){}
}