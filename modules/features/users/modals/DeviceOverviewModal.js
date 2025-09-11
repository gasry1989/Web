/**
 * 设备概览 (宽度改为 80% 视口宽度 + 异步刷新无闪烁版本)
 * 说明：
 *  - width: 80vw，最大 1600，可按需改 MAX_WIDTH
 *  - 其余逻辑同上一个异步刷新版本
 */

import { createModal, getModal } from '@ui/modal.js';
import { apiDeviceList } from '@api/deviceApi.js';
import { buildPageWindow } from '@core/pagination.js';

const MAX_WIDTH = 1600;

let modalRef = null;
let state = {
  list: [],
  listInfo: { total:0, pageSize:10, pageIndex:1, pageTotal:1 },
  loading: false,
  filters: { userIds: [] }
};

const COL_MAP = [
  { key:'devId',       title:'设备ID',     format:v=>safe(v) },
  { key:'devName',     title:'名称',       format:v=>escapeHTML(v||'') },
  { key:'devNo',       title:'编号',       format:v=>escapeHTML(v||'') },
  { key:'onlineState', title:'在线',       format:v=> v?'<span class="dot dot-green"></span>':'<span class="dot dot-gray"></span>' },
  { key:'devTypeName', title:'类型',       format:v=>escapeHTML(v||'') },
  { key:'devModes',    title:'支持模式',   format:arr=> Array.isArray(arr)&&arr.length? arr.map(m=>escapeHTML(modeName(m))).join('、'):'' },
  { key:'userId',      title:'所属用户ID', format:v=>safe(v) },
  { key:'userName',    title:'所属帐号',   format:v=>escapeHTML(v||'') }
];

export function showDeviceOverviewModal(opt={}) {
  const exist = getModal('deviceOverviewModal');
  if (exist) {
    if (opt.userIds) state.filters.userIds = Array.isArray(opt.userIds)?opt.userIds:[];
    loadPage(1, { silentLoading:false });
    exist.open();
    return;
  }
  state.filters.userIds = Array.isArray(opt.userIds)?opt.userIds:[];
  createAndOpen();
  loadPage(1, { silentLoading:true });
}

function createAndOpen() {
  const content = document.createElement('div');
  content.className = 'device-overview';
  content.innerHTML = `
    <div class="dev-toolbar">
      <div class="dev-actions">
        <button class="btn btn-sm" id="btnDevRefresh">刷新</button>
      </div>
    </div>
    <div class="table-wrapper">
      <table class="data-table dev-table">
        <thead>
          <tr>${COL_MAP.map(c=>`<th>${c.title}</th>`).join('')}</tr>
        </thead>
        <tbody class="dev-tbody">
          ${renderLoadingRow()}
        </tbody>
      </table>
    </div>
    <div class="pagination dev-pager"><span class="pg-info">加载中...</span></div>
  `;

  const width = Math.min(Math.floor(window.innerWidth * 0.8), MAX_WIDTH);

  modalRef = createModal({
    id:'deviceOverviewModal',
    title:'设备概览',
    width,
    content,
    footerButtons:[{ text:'关闭', onClick: close=>{ close(); modalRef=null; } }]
  });
  if (!modalRef) return;
  bindEvents();
}

function bindEvents() {
  modalRef.body.querySelector('#btnDevRefresh')
    .addEventListener('click', () => loadPage(state.listInfo.pageIndex, { silentLoading:false }));
  window.addEventListener('resize', onResize);
}

function onResize() {
  const m = getModal('deviceOverviewModal');
  if (!m) return;
  const width = Math.min(Math.floor(window.innerWidth * 0.8), MAX_WIDTH);
  // createModal 若支持 setWidth，可调用；没有则直接修改 DOM（假设 modal 外层有 .modal-dialog 或 body.parentNode)
  m.el.style.width = width + 'px';
}

function loadPage(pageIndex, { silentLoading }) {
  if (state.loading) return;
  state.loading = true;

  if (modalRef && !silentLoading) {
    const tbody = modalRef.body.querySelector('.dev-tbody');
    tbody.insertAdjacentHTML('afterbegin', renderInlineLoadingTr());
  }

  apiDeviceList({
    userIds: state.filters.userIds,
    pageIndex,
    pageSize: state.listInfo.pageSize
  }).then(data => {
    const list = data.devList || [];
    const li = data.listInfo || {};
    const pageSize = li.pageSize || state.listInfo.pageSize;
    const total = li.total ?? list.length;
    const pageTotal = li.pageTotal || Math.max(1, Math.ceil(total / pageSize));
    state = {
      ...state,
      list: list.map(normalizeItem),
      listInfo: { total, pageIndex, pageSize, pageTotal }
    };
    renderTable();
    renderPager();
  }).catch(err => {
    console.error('[DeviceOverviewModal] load error', err);
    if (modalRef) {
      const tbody = modalRef.body.querySelector('.dev-tbody');
      tbody.innerHTML = `<tr><td colspan="${COL_MAP.length}" class="center text-error">${escapeHTML(err?.msg || '加载失败')}</td></tr>`;
      modalRef.body.querySelector('.dev-pager').innerHTML = '';
    }
  }).finally(() => {
    state.loading = false;
    if (modalRef) {
      modalRef.body.querySelectorAll('.row-inline-loading').forEach(r => r.remove());
    }
  });
}

function renderTable() {
  if (!modalRef) return;
  const tbody = modalRef.body.querySelector('.dev-tbody');
  if (!state.list.length) {
    tbody.innerHTML = `<tr><td colspan="${COL_MAP.length}" class="center">暂无数据</td></tr>`;
    return;
  }
  tbody.innerHTML = state.list.map(item =>
    `<tr>${COL_MAP.map(c=>`<td>${c.format(item[c.key])}</td>`).join('')}</tr>`
  ).join('');
}

function renderPager() {
  if (!modalRef) return;
  const { pageIndex, pageTotal, total } = state.listInfo;
  if (pageTotal <= 1) {
    modalRef.body.querySelector('.dev-pager').innerHTML = `<span class="pg-info">共 ${total} 条</span>`;
    return;
  }
  const pages = buildPageWindow(pageIndex, pageTotal, 2);
  const pagerEl = modalRef.body.querySelector('.dev-pager');
  pagerEl.innerHTML = `
    <button class="pg-btn" data-pg="prev" ${pageIndex===1?'disabled':''}>&lt;</button>
    ${pages.map(p=>`<button class="pg-btn ${p===pageIndex?'active':''}" data-pg="${p}">${p}</button>`).join('')}
    <button class="pg-btn" data-pg="next" ${pageIndex===pageTotal?'disabled':''}>&gt;</button>
    <span class="pg-info">共 ${total} 条</span>
  `;
  pagerEl.querySelectorAll('.pg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.getAttribute('data-pg');
      let target = pageIndex;
      if (val === 'prev') target = pageIndex - 1;
      else if (val === 'next') target = pageIndex + 1;
      else target = Number(val);
      if (target < 1 || target > pageTotal) return;
      loadPage(target, { silentLoading:false });
    });
  });
}

function renderLoadingRow() {
  return `<tr><td colspan="${COL_MAP.length}" class="center">加载中...</td></tr>`;
}
function renderInlineLoadingTr() {
  return `<tr class="row-inline-loading"><td colspan="${COL_MAP.length}" class="center slim-loading">加载中...</td></tr>`;
}

/* ---- 数据标准化 ---- */
function normalizeItem(raw) {
  const di = raw?.devInfo || {};
  const ui = raw?.userInfo || {};
  return {
    devId: di.id,
    devName: di.name,
    devNo: di.no,
    onlineState: di.onlineState,
    devTypeName: di.typeName,
    devModes: di.modeList || [],
    userId: ui.userId,
    userName: ui.userName
  };
}
function modeName(m){ if(!m) return ''; if(typeof m==='string') return m; return m.modeName || m.name || String(m.modeId || m.id || ''); }
function safe(v){ return v==null?'':v; }
function escapeHTML(str=''){ return str.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }