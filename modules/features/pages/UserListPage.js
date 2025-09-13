/**
 * 用户管理页面
 * 变更：
 *  - 移除标题栏内折叠按钮（只保留侧栏自身按钮）
 *  - 其它逻辑保持
 */

import { userState } from '@state/userState.js';
import { authState } from '@state/authState.js';
import { apiUserList, apiUserDelete, apiRoleList } from '@api/userApi.js';
import { buildPageWindow } from '@core/pagination.js';
import { eventBus } from '@core/eventBus.js';
import { hasModifyRolePermission } from '@utils/permissions.js';
import { initSidebarToggle } from '@layout/SidebarToggle.js';

let rootEl = null;
let unsubscribe = null;

export function mountUserListPage() {
  console.debug('[UserListPage] mount');
  const main = document.getElementById('mainView');
  if (!main) {
    console.error('[UserListPage] #mainView missing');
    return () => {};
  }

  main.innerHTML = `
    <div class="page users-page users-page-wrapper">
      <div class="page-title-bar">
        <h2>用户管理</h2>
        <div class="actions" id="userActions"></div>
      </div>
      <div class="table-wrapper user-table-wrapper">
        <table class="data-table" id="userTable">
          <thead>
            <tr>
              <th><input type="checkbox" id="chkAll"/></th>
              <th>ID</th>
              <th>账号</th>
              <th>用户角色</th>
              <th>用户名</th>
              <th>在线</th>
              <th>上级账号</th>
              <th>上级名称</th>
              <th>创建者帐号</th>
              <th>创建者名称</th>
              <th>所属地区</th>
              <th>创建时间</th>
              <th>备注</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody id="userTableBody"></tbody>
        </table>
      </div>
      <div class="pagination pagination-fixed" id="userPagination"></div>
    </div>
  `;
  rootEl = main.querySelector('.users-page');

  // 初始化单一侧栏折叠按钮
  initSidebarToggle();

  bindGlobalActions();
  subscribeState();
  loadUserPage(1);

  return () => {
    unsubscribe && unsubscribe();
  };
}

export function unmountUserListPage() {
  unsubscribe && unsubscribe();
}

/* ---------------- 数据加载 ---------------- */
function loadUserPage(pageIndex) {
  const { listInfo } = userState.get();
  userState.set({ loading: true });
  apiUserList(pageIndex, listInfo.pageSize)
    .then(data => {
      const list = data.userList || data.users || [];
      const li = data.listInfo || {
        total: list.length,
        pageIndex,
        pageSize: listInfo.pageSize,
        pageTotal: Math.max(1, Math.ceil(list.length / listInfo.pageSize))
      };
      userState.set({ loading:false, list, listInfo: li });
    })
    .catch(err => {
      console.error('[UserListPage] loadUserPage error', err);
      userState.set({ loading: false });
    });
}

/* ---------------- 状态订阅与渲染 ---------------- */
function subscribeState() {
  unsubscribe = userState.subscribe(renderAll);
}
function renderAll(s) {
  if (!rootEl) return;
  renderTable(s);
  renderPagination(s);
}

function renderTable(state) {
  const tbody = rootEl.querySelector('#userTableBody');
  const selection = state.selection;
  tbody.innerHTML = state.list.map(u => {
    const checked = selection.has(u.userId) ? 'checked' : '';
    return `
      <tr>
        <td><input type="checkbox" data-id="${u.userId}" ${checked}/></td>
        <td>${safe(u.userId)}</td>
        <td>${escapeHTML(u.userAccount || '')}</td>
        <td>${escapeHTML(u.roleName || '')}</td>
        <td>${escapeHTML(u.userName || '')}</td>
        <td>${u.onlineState
          ? '<span class="dot dot-green" title="在线"></span>'
          : '<span class="dot dot-gray" title="离线"></span>'}
        </td>
        <td>${escapeHTML(u.parentUserAccount || '')}</td>
        <td>${escapeHTML(u.parentUserName || '')}</td>
        <td>${escapeHTML(u.rootUserAccount || '')}</td>
        <td>${escapeHTML(u.rootUserName || '')}</td>
        <td>${escapeHTML([u.provinceName,u.cityName,u.zoneName].filter(Boolean).join(''))}</td>
        <td>${formatTime(u.createTime)}</td>
        <td>${escapeHTML(u.memo || '')}</td>
        <td>
          <button class="btn btn-xs" data-op="edit" data-id="${u.userId}">修改信息</button>
          <button class="btn btn-xs" data-op="pwd" data-id="${u.userId}">修改密码</button>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('input[type=checkbox][data-id]').forEach(chk => {
    chk.addEventListener('change', () => {
      const id = Number(chk.getAttribute('data-id'));
      const sel = new Set(userState.get().selection);
      chk.checked ? sel.add(id) : sel.delete(id);
      userState.set({ selection: sel });
    });
  });

  tbody.addEventListener('click', onRowButtonClick, { once:true });
}

function onRowButtonClick(e) {
  const btn = e.target.closest('button[data-op]');
  if (!btn) {
    e.currentTarget.addEventListener('click', onRowButtonClick, { once:true });
    return;
  }
  const op = btn.getAttribute('data-op');
  const id = Number(btn.getAttribute('data-id'));
  const user = userState.get().list.find(u => u.userId === id);
  if (!user) return;
  if (op === 'edit') openEditUserModal(user);
  if (op === 'pwd') openPasswordModal(user);
  e.currentTarget.addEventListener('click', onRowButtonClick, { once:true });
}

function renderPagination(state) {
  const pager = rootEl.querySelector('#userPagination');
  const { pageIndex, pageTotal } = state.listInfo;
  const pages = buildPageWindow(pageIndex, pageTotal, 2);
  pager.innerHTML = `
    <button class="pg-btn" data-pg="prev" ${pageIndex===1?'disabled':''}>&lt;</button>
    ${pages.map(p => `<button class="pg-btn ${p===pageIndex?'active':''}" data-pg="${p}">${p}</button>`).join('')}
    <button class="pg-btn" data-pg="next" ${pageIndex===pageTotal?'disabled':''}>&gt;</button>
  `;
  pager.querySelectorAll('.pg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.getAttribute('data-pg');
      let target = pageIndex;
      if (val==='prev') target = pageIndex - 1;
      else if (val==='next') target = pageIndex + 1;
      else target = Number(val);
      if (target < 1 || target > pageTotal) return;
      loadUserPage(target);
    });
  });
}

/* ---------------- 操作区 ---------------- */
function bindGlobalActions() {
  const actionsEl = rootEl.querySelector('#userActions');
  const roleId = authState.get().userInfo?.roleId;
  const showRoleMatrixBtn = hasModifyRolePermission(roleId);

  actionsEl.innerHTML = `
    <button class="btn btn-primary" id="btnAddUser">添加</button>
    <button class="btn btn-danger" id="btnDeleteUser">删除</button>
    <button class="btn" id="btnDeviceOverview">设备概览</button>
    ${showRoleMatrixBtn ? '<button class="btn" id="btnRoleMatrix">用户角色权限管理</button>' : ''}
  `;

  actionsEl.addEventListener('click', e => {
    if (!(e.target instanceof HTMLElement)) return;
    switch (e.target.id) {
      case 'btnAddUser': openAddUserModal(); break;
      case 'btnDeleteUser': deleteSelectedUsers(); break;
      case 'btnDeviceOverview': openDeviceOverview(); break;
      case 'btnRoleMatrix': openRoleMatrixPanel(); break;
    }
  });

  rootEl.querySelector('#chkAll').addEventListener('change', e => {
    const checked = e.target.checked;
    const newSel = new Set();
    if (checked) userState.get().list.forEach(u => newSel.add(u.userId));
    userState.set({ selection: newSel });
  });
}

function deleteSelectedUsers() {
  const sel = Array.from(userState.get().selection);
  if (!sel.length) {
    eventBus.emit('toast:show', { type:'info', message:'请选择要删除的用户' });
    return;
  }
  if (!confirm(`确认删除选中 ${sel.length} 个用户？`)) return;
  apiUserDelete(sel).then(() => {
    eventBus.emit('toast:show', { type:'success', message:'删除成功' });
    userState.set({ selection: new Set() });
    loadUserPage(userState.get().listInfo.pageIndex);
  });
}

/* ---------------- 动态 import ---------------- */
function openAddUserModal() { import('./modals/AddUserModal.js').then(m => m.showAddUserModal()); }
function openEditUserModal(user) { import('./modals/EditUserModal.js').then(m => m.showEditUserModal(user)); }
function openPasswordModal(user) {
  import('./modals/PasswordModal.js').then(m => m.showPasswordModal(user))
    .catch(err => console.error('[UserListPage] open password modal failed', err));
}
function openDeviceOverview() {
  const sel = Array.from(userState.get().selection);
  import('./modals/DeviceOverviewModal.js').then(m => m.showDeviceOverviewModal({ userIds: sel.length?sel:[] }));
}
function openRoleMatrixPanel() {
  apiRoleList().then(data => {
    import('./modals/RoleMatrixPanel.js').then(m => m.showRoleMatrixPanel(data.roles || []));
  });
}

/* ---------------- 工具 ---------------- */
function escapeHTML(str='') {
  return str.replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
function safe(v){ return v==null?'' : v; }
function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = n => n<10?'0'+n:n;
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}