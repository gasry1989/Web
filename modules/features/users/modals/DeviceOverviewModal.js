/**
 * 设备概览弹窗（改用 3.10 /api/web/dev/list）
 * - 支持分页
 * - 可根据需要向 showDeviceOverviewModal 传入 filters（如 { userId }）
 * - Reopen 机制：若已打开则置顶
 *
 * 返回结构兼容：
 *  - data.devList / data.list / data.devices 之一为数组
 *  - data.listInfo / data.pagination 含分页信息
 */

import { createModal, getModal } from '@ui/modal.js';
import { apiDeviceList } from '@api/deviceApi.js';
import { buildPageWindow } from '@core/pagination.js';

let modalRef = null;

let state = {
  list: [],
  listInfo: { total: 0, pageSize: 10, pageIndex: 1, pageTotal: 1 },
  loading: false,
  filters: {
    userId: 0,     // 可由外部传入
    devType: 0,
    devMode: 0,
    searchStr: '',
    filterOnline: false
  }
};

const COL_MAP = [
  { key: 'devId',       title: '设备ID',     format: v => safe(v) },
  { key: 'devName',     title: '名称',       format: v => escapeHTML(v || '') },
  { key: 'devNo',       title: '编号',       format: v => escapeHTML(v || '') },
  { key: 'onlineState', title: '在线',       format: v => v ? '<span class="dot dot-green"></span>' : '<span class="dot dot-gray"></span>' },
  { key: 'devTypeName', title: '类型',       format: v => escapeHTML(v || '') },
  { key: 'devModes',    title: '支持模式',   format: arr => Array.isArray(arr) && arr.length ? arr.map(m => escapeHTML(normalizeModeName(m))).join('、') : '' },
  { key: 'userId',      title: '所属用户ID', format: v => safe(v) },
  { key: 'userName',    title: '所属帐号',   format: v => escapeHTML(v || '') }
];

/**
 * @param {Object} filters 可选：{ userId, devType, devMode, searchStr, filterOnline }
 */
export function showDeviceOverviewModal(filters = {}) {
  // 已存在 -> reopen
  const exist = getModal('deviceOverviewModal');
  if (exist) {
    // 如果传入新的过滤条件，刷新
    state.filters = { ...state.filters, ...filters };
    loadPage(state.listInfo.pageIndex);
    exist.open();
    return;
  }

  state.filters = { ...state.filters, ...filters };

  const content = document.createElement('div');
  content.className = 'device-overview';
  content.innerHTML = `
    <div class="dev-toolbar">
      <div class="dev-filters">
        <input id="fltDevSearch" placeholder="名称/编号" class="dev-input" />
        <label class="chk-inline">
          <input type="checkbox" id="fltOnlineOnly"/> 仅在线
        </label>
      </div>
      <div class="dev-actions">
        <button class="btn btn-sm" id="btnDevRefresh">刷新</button>
      </div>
    </div>
    <div class="table-wrapper">
      <table class="data-table dev-table">
        <thead>
          <tr>${COL_MAP.map(c => `<th>${c.title}</th>`).join('')}</tr>
        </thead>
        <tbody class="dev-tbody"><tr><td colspan="${COL_MAP.length}" class="center">加载中...</td></tr></tbody>
      </table>
    </div>
    <div class="pagination dev-pager"></div>
  `;

  modalRef = createModal({
    id: 'deviceOverviewModal',
    title: '设备概览',
    content,
    width: 960,
    footerButtons: [
      { text: '关闭', onClick: close => { close(); modalRef = null; } }
    ]
  });

  if (!modalRef) return;

  bindLocalFilters();
  loadPage(1);
}

/* ----------- 交互绑定 ----------- */
function bindLocalFilters() {
  if (!modalRef) return;
  const root = modalRef.body;
  const searchInput = root.querySelector('#fltDevSearch');
  const onlineChk = root.querySelector('#fltOnlineOnly');
  const refreshBtn = root.querySelector('#btnDevRefresh');

  // 初始值
  searchInput.value = state.filters.searchStr;
  onlineChk.checked = !!state.filters.filterOnline;

  let t = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.filters.searchStr = searchInput.value.trim();
      loadPage(1);
    }, 300);
  });
  onlineChk.addEventListener('change', () => {
    state.filters.filterOnline = onlineChk.checked;
    loadPage(1);
  });
  refreshBtn.addEventListener('click', () => {
    loadPage(state.listInfo.pageIndex);
  });
}

/* ----------- 数据加载 ----------- */
function loadPage(pageIndex) {
  if (state.loading) return;
  state.loading = true;
  renderTable(true);

  apiDeviceList({
    pageIndex,
    pageSize: state.listInfo.pageSize,
    ...state.filters
  })
    .then(data => {
      const list = data.devList || data.list || data.devices || [];
      const liRaw = data.listInfo || data.pagination || {};
      const pageSize = liRaw.pageSize || state.listInfo.pageSize;
      const total = liRaw.total || list.length;
      const pageTotal = liRaw.pageTotal || Math.max(1, Math.ceil(total / pageSize));

      state = {
        ...state,
        list: list.map(normalizeItem),
        listInfo: {
          total,
          pageIndex,
          pageSize,
          pageTotal
        },
        loading: false
      };
      renderTable(false);
      renderPager();
    })
    .catch(err => {
      console.error('[DeviceOverviewModal] load error', err);
      state.loading = false;
      renderError(err && err.code === 1003 ? '没有权限查看该数据 (1003)' : '加载失败');
    });
}

/* ----------- 渲染 ----------- */
function renderTable(loading) {
  if (!modalRef) return;
  const tbody = modalRef.body.querySelector('.dev-tbody');
  if (loading) {
    tbody.innerHTML = `<tr><td colspan="${COL_MAP.length}" class="center">加载中...</td></tr>`;
    return;
  }
  if (!state.list.length) {
    tbody.innerHTML = `<tr><td colspan="${COL_MAP.length}" class="center">暂无数据</td></tr>`;
    return;
  }
  tbody.innerHTML = state.list.map(item =>
    `<tr>${COL_MAP.map(c => `<td>${c.format(item[c.key])}</td>`).join('')}</tr>`
  ).join('');
}

function renderPager() {
  if (!modalRef) return;
  const pager = modalRef.body.querySelector('.dev-pager');
  const { pageIndex, pageTotal, total } = state.listInfo;
  const pages = buildPageWindow(pageIndex, pageTotal, 2);
  pager.innerHTML = `
    <button class="pg-btn" data-pg="prev" ${pageIndex === 1 ? 'disabled' : ''}>&lt;</button>
    ${pages.map(p => `<button class="pg-btn ${p === pageIndex ? 'active' : ''}" data-pg="${p}">${p}</button>`).join('')}
    <button class="pg-btn" data-pg="next" ${pageIndex === pageTotal ? 'disabled' : ''}>&gt;</button>
    <span class="pg-info">共 ${total} 条</span>
  `;
  pager.querySelectorAll('.pg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.getAttribute('data-pg');
      let target = pageIndex;
      if (val === 'prev') target = pageIndex - 1;
      else if (val === 'next') target = pageIndex + 1;
      else target = parseInt(val, 10);
      if (target < 1 || target > pageTotal) return;
      loadPage(target);
    });
  });
}

function renderError(msg) {
  if (!modalRef) return;
  const tbody = modalRef.body.querySelector('.dev-tbody');
  tbody.innerHTML = `<tr><td colspan="${COL_MAP.length}" class="center text-error">${escapeHTML(msg)}</td></tr>`;
  modalRef.body.querySelector('.dev-pager').innerHTML = '';
}

/* ----------- 数据标准化 ----------- */
function normalizeItem(raw) {
  return {
    devId: raw.devId ?? raw.id ?? raw.deviceId,
    devName: raw.devName ?? raw.name ?? '',
    devNo: raw.devNo ?? raw.no ?? '',
    onlineState: raw.onlineState ?? raw.online ?? raw.isOnline ?? false,
    devTypeName: raw.devTypeName ?? raw.typeName ?? '',
    devModes: raw.devModes || raw.modeList || raw.modes || [],
    userId: raw.userId ?? raw.ownerUserId ?? '',
    userName: raw.userName ?? raw.ownerUserName ?? ''
  };
}

function normalizeModeName(m) {
  if (typeof m === 'string') return m;
  if (!m) return '';
  return m.name || m.modeName || String(m.id || '');
}

/* ----------- 工具 ----------- */
function safe(v) { return v == null ? '' : v; }
function escapeHTML(str = '') {
  return str.replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}