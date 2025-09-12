/**
 * 现场管理主页面（无整页垂直滚动 + 地图 InfoWindow 锚定 + 底部四宫格）
 * - 页面禁止出现全局垂直滚动条：html/body 以及组件容器均 overflow hidden；树/通知内部可滚动
 * - 上半区：地图（左） + 状态/通知（右）
 * - 下半区：四宫格媒体（视频/模式）
 * - 地图悬浮窗：使用 AMap.InfoWindow({isCustom:true})，锚定设备经纬度，随地图移动
 * - 视频播放：SRS WebRTC，固定地址 webrtc://media.szdght.com/1/camera_audio（参考 rtc_player7.html 的 video+canvas 渲染）
 * - 切换路由离开“现场管理”（hash 不含 /site）时销毁地图与媒体；返回后稳妥重建
 */
import { siteState } from '@state/siteState.js';
import { previewState } from '@state/previewState.js';
import {
  apiDevTypes,
  apiDevModes,
  apiGroupedDevices,
  apiUngroupedDevices,
  apiDeviceSummary,
  apiOnlineList,
  apiDeviceInfo
} from '@api/deviceApi.js';
import { eventBus } from '@core/eventBus.js';
import { ENV } from '@config/env.js';
import { ensureWS } from '@ws/wsClient.js';

/* ---------- 运行时变量 ---------- */
let unsubSite;
let unsubPreview;
let mapInstance = null;
let markersLayer = [];
let routeWatcher = null;

/* InfoWindow（地图悬浮窗） */
let infoWindow = null;
let currentInfoDevId = null;

/* 监听 mapContainer 尺寸变化 */
let mapResizeObs = null;

/* 记住 html/body 原 overflow，离开时恢复（全局禁滚） */
let __prevHtmlOverflow = '';
let __prevBodyOverflow = '';

/* 四宫格媒体 */
const SRS_FIXED_URL = 'webrtc://media.szdght.com/1/camera_audio';
const mediaSlots = [
  { idx: 0, type: null, player: null, node: null, title: '', timer: null },
  { idx: 1, type: null, player: null, node: null, title: '', timer: null },
  { idx: 2, type: null, player: null, node: null, title: '', timer: null },
  { idx: 3, type: null, player: null, node: null, title: '', timer: null },
];

/* ---------- 样式注入（无整页滚动，内部区滚动） ---------- */
let __SITE_STYLE_INJECTED = false;
const __SITE_STYLE_ID = 'sitepage-inline-style';
function injectSiteStylesOnce() {
  if (__SITE_STYLE_INJECTED || document.getElementById(__SITE_STYLE_ID)) return;
  const css = `
  .site-page {
    --panel-bg: #0f1720;
    --panel-bg-2: #0b121a;
    --panel-line: rgba(255,255,255,0.08);
    --text-primary: #cfd8dc;
    --text-dim: #9fb1bb;
    --online-text: #ffffff;
    --offline-text: #7a8a93;
    --grid-border: rgba(255,0,0,.45);
  }
  /* 组件占满视口，外层不滚动 */
  .site-page, .site-layout { height: 100vh; overflow: hidden; }
  .site-layout { display:flex; }

  .site-left {
    width: var(--site-left-width, 320px);
    min-width: 240px; max-width: 50vw;
    background: var(--panel-bg); color: var(--text-primary);
    border-right: 1px solid var(--panel-line);
    display:flex; flex-direction:column;
  }
  .site-splitter { width:6px; cursor:col-resize; position:relative; background:transparent; user-select:none; }
  .site-splitter::after { content:''; position:absolute; top:0; bottom:0; left:2px; width:2px; background: var(--panel-line); transition: background .15s; }
  .site-splitter:hover::after, .site-splitter.dragging::after { background: rgba(93,188,252,.45); }

  /* 中部采用两行 grid：上自适应，下固定 260px */
  .site-center {
    flex:1 1 auto;
    background:#0a0f14;
    display:grid;
    grid-template-rows: 1fr 260px;
    overflow:hidden;
  }

  .top-row { display:flex; gap:10px; padding:10px; overflow:hidden; }
  .map-wrap { flex: 1 1 auto; background:#0a0f14; border:1px solid var(--panel-line); border-radius:4px; overflow:hidden; }
  .map-container { width: 100%; height: 100%; background:#0a0f14; }

  .side-panel { width: 380px; max-width: 42vw; display:flex; flex-direction:column; gap:10px; overflow:hidden; }
  .panel-box { background: var(--panel-bg-2); border:1px solid var(--panel-line); border-radius:4px; padding:10px; color: var(--text-primary); display:flex; flex-direction:column; min-height:0; }
  .panel-box h3 { margin:0 0 8px; font-size:16px; font-weight:600; }
  .panel-scroll { flex:1 1 auto; overflow:auto; min-height:0; }

  .bottom-row { padding:0 10px 10px; }
  .media-grid { display:grid; grid-template-columns: repeat(4, 1fr); gap:10px; height:100%; }
  .media-cell { background:#111722; border: 2px solid var(--grid-border); border-radius:6px; display:flex; flex-direction:column; overflow:hidden; }
  .media-head { flex: 0 0 auto; display:flex; align-items:center; justify-content:space-between; color:#cfd8dc; padding:6px 8px; font-size:12px; background:#0f1b27; border-bottom:1px solid var(--panel-line); }
  .media-title { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width: calc(100% - 24px); }
  .media-close { width:20px; height:20px; border:none; color:#ccd; background:transparent; cursor:pointer; }
  .media-close:hover { color:#fff; }
  .media-body { position:relative; flex:1 1 auto; background:#000; display:flex; align-items:center; justify-content:center; }
  .media-body canvas { width:100%; height:100%; display:block; }
  .media-placeholder { color:#567; font-size:12px; }

  /* 左侧过滤器与树：树内部可滚动 */
  .filters { padding: 10px 12px; border-bottom: 1px solid var(--panel-line); }
  .filters label { color: var(--text-dim); }
  .filters input, .filters select {
    background: #0b121a; color: var(--text-primary); border: 1px solid var(--panel-line); border-radius: 4px; padding: 4px 6px;
  }
  .filters .btn { background: #122133; color: var(--text-primary); border: 1px solid var(--panel-line); }
  .filters .btn:hover { background: #17314d; }
  .filters .only-online { text-align:left; }
  .filters .only-online label { display:inline-flex; align-items:center; gap:6px; }

  .device-tree { flex:1 1 auto; overflow:auto; color: var(--text-primary); background: var(--panel-bg); }
  .gdt-tree { padding:6px 8px; width:max-content; min-width:100%; }
  .gdt-node + .gdt-node { margin-top:6px; }
  .gdt-row { display:flex; align-items:center; gap:6px; padding:4px 6px; border-radius:4px; cursor:pointer; user-select:none; }
  .gdt-row:hover { background:#0e1a24; }
  .gdt-toggle { width:16px; text-align:center; color:#9fb1bb; }
  .gdt-toggle.is-empty { visibility:hidden; }
  .gdt-icon { width:14px; height:14px; display:inline-block; }
  .gdt-icon-user { background:linear-gradient(135deg,#6a8,#3a6); border-radius:50%; }
  .gdt-icon-device { background:linear-gradient(135deg,#88a,#4653d3); border-radius:3px; }
  .gdt-title { white-space:nowrap; }
  .gdt-row.is-online .gdt-title { color: var(--online-text); }
  .gdt-row.is-offline .gdt-title { color: var(--offline-text); }
  .gdt-children { margin-left: 18px; border-left:1px dashed rgba(255,255,255,.12); padding-left: 10px; }
  .gdt-children.is-collapsed { display:none; }
  .gdt-node--device { padding:2px 6px 2px 22px; display:flex; align-items:center; gap:6px; cursor:pointer; }
  .gdt-node--device:hover { background:#0e1a24; border-radius:4px; }

  .gdt-section { margin: 8px 8px 12px; }
  .gdt-section__title { font-weight:600; padding:6px 8px; color:#e1edf7; background:#10212e; border-radius:4px; border: 1px solid rgba(255,255,255,.08); }
  .gdt-list { padding:6px 8px; display:flex; flex-direction:column; gap:4px; }
  .gdt-chip { display:flex; align-items:center; gap:6px; padding:6px 8px; border-radius:4px; cursor:pointer; background: transparent; border: 1px solid transparent; }
  .gdt-chip:hover { background: #15202b; border-color: rgba(255,255,255,.08); }
  .gdt-chip .gdt-title { white-space: nowrap; }
  .gdt-chip.is-online .gdt-title { color: var(--online-text); }
  .gdt-chip.is-offline .gdt-title { color: var(--offline-text); }
  `;
  const style = document.createElement('style');
  style.id = __SITE_STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
  __SITE_STYLE_INJECTED = true;
}

/* ---------- 页面挂载/卸载 ---------- */
const LS_LEFT_WIDTH_KEY = 'site.left.width';
const MIN_LEFT_WIDTH = 240;
const MAX_LEFT_WIDTH_VW = 50;

export function mountSitePage() {
  injectSiteStylesOnce();

  // 禁止整页滚动
  __prevHtmlOverflow = document.documentElement.style.overflow;
  __prevBodyOverflow = document.body.style.overflow;
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';

  const main = document.getElementById('mainView');
  main.innerHTML = `
    <div class="site-page">
      <div class="site-layout" id="siteLayout">
        <div class="site-left" id="siteLeft">
          <div class="filters">
            <div><label>设备类型：<select id="fltDevType"><option value="0">全部</option></select></label></div>
            <div><label>设备模式：<select id="fltDevMode"><option value="0">全部</option></select></label></div>
            <div><label>名称/编号：<input id="fltSearch" placeholder="模糊搜索"/></label></div>
            <div class="only-online"><label><input type="checkbox" id="fltOnline"/> 仅显示在线</label></div>
            <div><button class="btn btn-sm" id="btnSiteRefresh">刷新</button></div>
          </div>
          <div class="device-tree" id="deviceTree"></div>
        </div>

        <div class="site-splitter" id="siteSplitter" title="拖动调整左侧宽度"></div>

        <div class="site-center">
          <div class="top-row">
            <div class="map-wrap"><div id="mapContainer" class="map-container">地图加载中...</div></div>
            <div class="side-panel">
              <div class="panel-box">
                <h3>设备状态</h3>
                <div id="summaryChart"></div>
              </div>
              <div class="panel-box">
                <h3>通知列表</h3>
                <div id="notifyList" class="panel-scroll"></div>
              </div>
            </div>
          </div>

          <div class="bottom-row">
            <div class="media-grid" id="mediaGrid">
              ${[0,1,2,3].map(i => `
                <div class="media-cell" data-idx="${i}">
                  <div class="media-head">
                    <div class="media-title" id="mediaTitle${i}">空闲</div>
                    <button class="media-close" data-close="${i}" title="关闭">✕</button>
                  </div>
                  <div class="media-body" id="mediaBody${i}">
                    <div class="media-placeholder">在此显示视频流或模式</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  initSplitter();
  bindFilters();
  initMediaGrid();

  unsubSite = siteState.subscribe(renderSite);
  unsubPreview = previewState.subscribe(()=>{});

  loadBaseData();
  initAMap();
  ensureWS();
  setupRouteWatcher();

  window.addEventListener('resize', onWindowResize);
}

export function unmountSitePage() {
  teardownPage();
}

function teardownPage() {
  unsubSite && unsubSite(); unsubSite = null;
  unsubPreview && unsubPreview(); unsubPreview = null;

  window.removeEventListener('resize', onWindowResize);
  removeRouteWatcher();

  // 恢复整页滚动设置
  document.documentElement.style.overflow = __prevHtmlOverflow;
  document.body.style.overflow = __prevBodyOverflow;

  closeInfoWindow();
  destroyAMap();
  destroyAllMediaSlots();
}

/* ---------- 左侧栏宽度拖拽 ---------- */
let splitterMoveHandler = null;
let splitterUpHandler = null;

function initSplitter() {
  const layout = document.getElementById('siteLayout');
  const left = document.getElementById('siteLeft');
  const splitter = document.getElementById('siteSplitter');

  const saved = Number(localStorage.getItem(LS_LEFT_WIDTH_KEY));
  if (saved && saved >= MIN_LEFT_WIDTH) {
    left.style.width = saved + 'px';
    document.documentElement.style.setProperty('--site-left-width', saved + 'px');
  }

  splitter.addEventListener('mousedown', (e) => {
    splitter.classList.add('dragging');
    const bounds = layout.getBoundingClientRect();
    const maxPx = Math.floor(window.innerWidth * (MAX_LEFT_WIDTH_VW / 100));
    splitterMoveHandler = (ev) => {
      const x = ev.clientX - bounds.left;
      const w = clamp(Math.round(x), MIN_LEFT_WIDTH, maxPx);
      left.style.width = w + 'px';
      document.documentElement.style.setProperty('--site-left-width', w + 'px');
      throttleMapResize();
    };
    splitterUpHandler = () => {
      splitter.classList.remove('dragging');
      const w = parseInt(left.style.width || getComputedStyle(left).width, 10);
      if (w) localStorage.setItem(LS_LEFT_WIDTH_KEY, String(w));
      try { mapInstance && mapInstance.resize(); } catch {}
      document.removeEventListener('mousemove', splitterMoveHandler);
      document.removeEventListener('mouseup', splitterUpHandler);
      splitterMoveHandler = null; splitterUpHandler = null;
    };
    document.addEventListener('mousemove', splitterMoveHandler);
    document.addEventListener('mouseup', splitterUpHandler);
    e.preventDefault();
  });
}

function onWindowResize() {
  try { mapInstance && mapInstance.resize(); } catch {}
}
const throttleMapResize = throttle(()=>{ try { mapInstance && mapInstance.resize(); } catch {} }, 60);

/* ---------- 路由监听（离开 /site 清理，返回重建） ---------- */
function setupRouteWatcher() {
  removeRouteWatcher();
  const handler = () => {
    const isSite = String(location.hash || '').includes('/site');
    if (!isSite) {
      closeInfoWindow();
      destroyAMap();
      destroyAllMediaSlots();
      return;
    }
    // 回到现场管理：稳妥初始化并多次 resize 提升成功率
    initAMap().then(() => {
      requestAnimationFrame(() => { try { mapInstance && mapInstance.resize(); } catch {} });
      setTimeout(() => { try { mapInstance && mapInstance.resize(); } catch {} }, 120);
    });
  };
  window.addEventListener('hashchange', handler);
  routeWatcher = handler;
  handler();
}
function removeRouteWatcher() {
  if (routeWatcher) {
    window.removeEventListener('hashchange', routeWatcher);
    routeWatcher = null;
  }
}

/* ---------- 过滤与数据 ---------- */
function bindFilters() {
  const left = document.getElementById('siteLeft');
  left.addEventListener('change', e => {
    if (['fltDevType','fltDevMode','fltOnline'].includes(e.target.id)) updateFilters();
  });
  left.querySelector('#fltSearch').addEventListener('input', debounce(updateFilters,300));
  left.querySelector('#btnSiteRefresh').addEventListener('click', () => loadBaseData(true));
}
function updateFilters() {
  const devType = Number(document.getElementById('fltDevType').value);
  const devMode = Number(document.getElementById('fltDevMode').value);
  const filterOnline = document.getElementById('fltOnline').checked;
  const searchStr = document.getElementById('fltSearch').value.trim();
  const filters = { ...siteState.get().filters, devType, devMode, filterOnline, searchStr };
  siteState.set({ filters });
  loadDeviceTrees();
  loadSummary();
}
function loadBaseData() {
  Promise.all([apiDevTypes(), apiDevModes(), apiOnlineList(), apiDeviceSummary()])
    .then(([types, modes, online, summary]) => {
      fillDevTypeSelect(types.devTypeList || []);
      fillDevModeSelect(modes.devModeList || []);
      siteState.set({
        notifications: (online.list || []).slice(0,50),
        summary: {
          total: summary.total,
          onlineCount: summary.onlineCount,
          stateList: summary.stateList || []
        }
      });
      loadDeviceTrees();
    })
    .catch(err => console.error('[Site] loadBaseData error', err));
}
function loadDeviceTrees() {
  const filters = siteState.get().filters;
  Promise.all([apiGroupedDevices(filters), apiUngroupedDevices(filters)])
    .then(([g,u]) => {
      siteState.set({
        groupedDevices: g.devList || [],
        ungroupedDevices: u.devList || []
      });
      buildTree();
      buildMarkers();
    })
    .catch(err => {
      console.error('[Site] loadDeviceTrees error', err);
      siteState.set({ groupedDevices: [], ungroupedDevices: [] });
      buildTree(); buildMarkers();
    });
}
function loadSummary() {
  apiDeviceSummary()
    .then(summary => {
      siteState.set({
        summary: {
          total: summary.total,
          onlineCount: summary.onlineCount,
          stateList: summary.stateList || []
        }
      });
    })
    .catch(err => console.error('[Site] loadSummary error', err));
}
function fillDevTypeSelect(list) {
  const sel = document.getElementById('fltDevType');
  const cur = sel.value;
  sel.innerHTML = `<option value="0">全部</option>` + list.map(t => `<option value="${t.typeId}">${t.typeName}</option>`).join('');
  sel.value = cur || '0';
}
function fillDevModeSelect(list) {
  const sel = document.getElementById('fltDevMode');
  const cur = sel.value;
  sel.innerHTML = `<option value="0">全部</option>` + list.map(m => `<option value="${m.modeId}">${m.modeName}</option>`).join('');
  sel.value = cur || '0';
}

/* ---------- 树（根为当前用户；根行不显示角色名；在线状态来自 onlineState） ---------- */
function normalizeUserInfo(ui) {
  if (!ui) return null;
  return {
    userId: ui.userId ?? ui.id,
    userName: ui.userName ?? ui.name ?? '',
    parentUserId: ui.parentUserId ?? ui.pid ?? null,
    roleId: ui.roleId, roleName: ui.roleName, role: ui.role,
    onlineState: typeof ui.onlineState === 'boolean' ? ui.onlineState : undefined
  };
}
function getCurrentUserStrict() {
  try { const st = siteState.get(); if (st?.currentUser?.userId != null) return st.currentUser; } catch {}
  if (window.__currentUser?.userId != null) return window.__currentUser;
  try {
    const raw = localStorage.getItem('currentUser') || localStorage.getItem('auth.currentUser') || localStorage.getItem('USER_INFO');
    if (raw) { const obj = JSON.parse(raw); if (obj?.userId != null) return obj; }
  } catch {}
  return null;
}
function buildUserForestFromGroupedDevices(groupedDevices) {
  const userMap = new Map();
  groupedDevices.forEach(entry => {
    const ui = normalizeUserInfo(entry.userInfo);
    if (!ui || ui.userId == null) return;
    if (!userMap.has(ui.userId)) {
      userMap.set(ui.userId, { ...ui, type: 'user', children: [], deviceChildren: [], isOnline: ui.onlineState });
    } else {
      const cur = userMap.get(ui.userId);
      userMap.set(ui.userId, { ...cur, ...ui, children: cur.children, deviceChildren: cur.deviceChildren, isOnline: cur.isOnline ?? ui.onlineState });
    }
  });
  groupedDevices.forEach(entry => {
    const ui = normalizeUserInfo(entry.userInfo); const di = entry.devInfo || {};
    if (!ui || ui.userId == null) return;
    const node = userMap.get(ui.userId); if (!node) return;
    node.deviceChildren.push({ type:'device', devId: di.id, devName: di.no || di.name || String(di.id || ''), onlineState: !!di.onlineState, raw: di });
  });
  userMap.forEach(node => { node.children = node.children || []; });
  userMap.forEach(node => { const pid = node.parentUserId; if (pid != null && userMap.has(pid)) userMap.get(pid).children.push(node); });

  function computeOnline(n) {
    if (typeof n.isOnline === 'boolean') return n.isOnline;
    let online = n.deviceChildren?.some(d => d.onlineState) || false;
    if (n.children?.length) for (const c of n.children) online = computeOnline(c) || online;
    n.isOnline = online; return online;
  }
  userMap.forEach(n => computeOnline(n));

  const cu = getCurrentUserStrict();
  if (cu?.userId != null && userMap.has(cu.userId)) {
    const root = userMap.get(cu.userId);
    root.parentUserId = null; // 切断上级
    return { roots: [root] };
  }
  const roots = []; userMap.forEach(n => { if (n.parentUserId == null || !userMap.has(n.parentUserId)) roots.push(n); });
  return { roots };
}
function renderUserNodeHTML(node, level = 1, expandLevel = 2) {
  const hasChildren = (node.children && node.children.length) || (node.deviceChildren && node.deviceChildren.length);
  const expanded = level <= expandLevel;
  const rowOnlineCls = node.isOnline ? 'is-online' : 'is-offline';
  const header = `
    <div class="gdt-row ${rowOnlineCls}" data-node-type="user" data-user-id="${node.userId}">
      <span class="gdt-toggle ${hasChildren ? '' : 'is-empty'}">${hasChildren ? (expanded ? '▾' : '▸') : ''}</span>
      <span class="gdt-icon gdt-icon-user"></span>
      <span class="gdt-title" title="${escapeHTML(node.userName)}">${escapeHTML(node.userName || '(未命名用户)')}</span>
    </div>`;
  const childrenHTML = `
    <div class="gdt-children ${expanded ? '' : 'is-collapsed'}">
      ${(node.children || []).map(child => renderUserNodeHTML(child, level + 1, expandLevel)).join('')}
      ${(node.deviceChildren || []).map(d => `
        <div class="gdt-node gdt-node--device ${d.onlineState ? 'is-online' : 'is-offline'}" data-devid="${d.devId}">
          <span class="gdt-icon gdt-icon-device"></span>
          <span class="gdt-title" title="${escapeHTML(d.devName)}">${escapeHTML(d.devName)}</span>
        </div>
      `).join('')}
    </div>`;
  return `<div class="gdt-node gdt-node--user" data-user-id="${node.userId}">${header}${hasChildren ? childrenHTML : ''}</div>`;
}
function buildTree() {
  const treeEl = document.getElementById('deviceTree');
  const { groupedDevices, ungroupedDevices } = siteState.get();
  const { roots } = buildUserForestFromGroupedDevices(groupedDevices);
  const expandLevel = 2;
  const treeHTML = `
    <div class="gdt-tree">${roots.map(root => renderUserNodeHTML(root, 1, expandLevel)).join('')}</div>
    <div class="gdt-section">
      <div class="gdt-section__title">未分组设备 (${ungroupedDevices.length})</div>
      <div class="gdt-list">
        ${ungroupedDevices.map(e => {
          const d = e.devInfo || {}; const name = d.no || d.name || String(d.id || ''); const cls = d.onlineState ? 'is-online' : 'is-offline';
          return `<div class="gdt-chip ${cls}" data-devid="${d.id}" title="${escapeHTML(name)}"><span class="gdt-icon gdt-icon-device"></span><span class="gdt-title">${escapeHTML(name)}</span></div>`;
        }).join('')}
      </div>
    </div>`;
  treeEl.innerHTML = treeHTML;

  treeEl.addEventListener('click', (e) => {
    const row = e.target.closest('.gdt-row');
    if (row && treeEl.contains(row)) {
      const nodeEl = row.parentElement; const children = nodeEl.querySelector(':scope > .gdt-children'); const toggle = row.querySelector('.gdt-toggle');
      if (children) { const collapsed = children.classList.toggle('is-collapsed'); if (toggle) toggle.textContent = collapsed ? '▸' : '▾'; }
      return;
    }
    const devEl = e.target.closest('[data-devid]');
    if (devEl && treeEl.contains(devEl)) {
      const devId = Number(devEl.getAttribute('data-devid')); if (!Number.isNaN(devId)) openDeviceOverlay(devId);
    }
  }, { passive: true });
}

/* ---------- 地图（高德） + InfoWindow ---------- */
function ensureAMapReady() {
  return new Promise((resolve, reject) => {
    if (window.AMap) return resolve();
    const id = 'amap-sdk-v2';
    if (document.getElementById(id)) {
      const wait = setInterval(() => {
        if (window.AMap) { clearInterval(wait); resolve(); }
      }, 50);
      setTimeout(() => { clearInterval(wait); if (!window.AMap) reject(new Error('AMap not ready')); }, 6000);
      return;
    }
    const s = document.createElement('script');
    s.id = id;
    s.src = `https://webapi.amap.com/maps?v=2.0&key=${ENV.AMAP_KEY}`;
    s.onload = () => resolve();
    s.onerror = (e) => reject(e);
    document.head.appendChild(s);
  });
}

async function initAMap() {
  const container = document.getElementById('mapContainer');
  if (!container) return;
  if (mapInstance) {
    try { mapInstance.resize(); } catch {}
    return;
  }
  try {
    await ensureAMapReady();
    // 确保容器进入布局流
    await new Promise(r => requestAnimationFrame(r));
    createMap();
    // 观察容器尺寸变化，变化时强制 resize
    if (!mapResizeObs) {
      mapResizeObs = new ResizeObserver(() => {
        try { mapInstance && mapInstance.resize(); } catch {}
      });
      mapResizeObs.observe(container);
    }
  } catch (e) {
    console.error('[Site] initAMap failed', e);
  }
}

function createMap() {
  try {
    // eslint-disable-next-line no-undef
    mapInstance = new AMap.Map('mapContainer', { zoom: 5, center: [105.0, 35.0] });
    buildMarkers();
  } catch (e) {
    console.error('[Site] createMap error', e);
  }
}

function buildMarkers() {
  if (!mapInstance) return;
  markersLayer.forEach(m => { try { m.setMap(null); } catch {} });
  markersLayer = [];
  const { groupedDevices, ungroupedDevices } = siteState.get();
  const all = [...groupedDevices, ...ungroupedDevices];
  all.forEach(e => {
    const d = e.devInfo;
    if (!d || !d.lastLocation || d.lastLocation.lng == null || d.lastLocation.lat == null) return;
    // eslint-disable-next-line no-undef
    const marker = new AMap.Marker({ position: [d.lastLocation.lng, d.lastLocation.lat], title: d.no });
    marker.on('click', () => openDeviceOverlay(d.id));
    marker.setMap(mapInstance);
    markersLayer.push(marker);
  });
}

function destroyAMap() {
  try { markersLayer.forEach(m => { try { m.setMap(null); } catch {} }); } catch {}
  markersLayer = [];
  if (mapInstance) {
    try { mapInstance.destroy(); } catch {}
    mapInstance = null;
  }
  if (mapResizeObs) {
    try { const c = document.getElementById('mapContainer'); c && mapResizeObs.unobserve(c); } catch {}
    mapResizeObs.disconnect?.();
    mapResizeObs = null;
  }
  const mc = document.getElementById('mapContainer');
  if (mc) mc.innerHTML = '地图加载中...';
}

/* InfoWindow（跟随标注点） */
function closeInfoWindow() {
  try { if (infoWindow) infoWindow.close(); } catch {}
  infoWindow = null;
  currentInfoDevId = null;
}
function openDeviceOverlay(devId) {
  apiDeviceInfo(devId).then(data => {
    const info = data.devInfo;
    currentInfoDevId = info.id;
    const pos = info.lastLocation && info.lastLocation.lng != null && info.lastLocation.lat != null
      ? [info.lastLocation.lng, info.lastLocation.lat]
      : (mapInstance ? mapInstance.getCenter() : [105,35]);

    // 构建自定义内容 DOM
    const content = buildInfoContent(info);

    // eslint-disable-next-line no-undef
    if (!infoWindow) infoWindow = new AMap.InfoWindow({ isCustom: true, offset: new AMap.Pixel(0, -20), closeWhenClickMap: true });
    infoWindow.setContent(content);
    infoWindow.open(mapInstance, pos);
  }).catch(err => {
    console.error('[Site] apiDeviceInfo error', err);
    eventBus.emit('toast:show', { type: 'error', message: '获取设备信息失败' });
  });
}
function buildInfoContent(info) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'min-width:340px;max-width:420px;background:#111c28;color:#cfd8dc;border:1px solid rgba(255,255,255,.12);border-radius:6px;box-shadow:0 8px 22px rgba(0,0,0,.45);';
  wrap.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.08);">
      <div style="font-weight:600;">${escapeHTML(info.no || String(info.id||''))} ${info.onlineState?'<span style="font-size:12px;color:#7ef58b;margin-left:6px;">在线</span>':'<span style="font-size:12px;color:#99a;margin-left:6px;">离线</span>'}</div>
      <button id="ovCloseBtn" title="关闭" style="background:transparent;border:none;color:#ccd;cursor:pointer;">✕</button>
    </div>
    <div style="padding:10px 12px;font-size:12px;line-height:1.7;">
      <div>位置：${info.lastLocation ? (info.lastLocation.lat + ',' + info.lastLocation.lng + (info.lastLocation.height!=null?(' 高度:'+info.lastLocation.height+'m'):'') ) : '无定位数据'}</div>
      <div>更新时间：${info.lastLocation ? formatTime(info.lastLocation.time) : ''}  速度：${info.lastLocation ? (info.lastLocation.speed || 0) + ' km/h' : ''}</div>
    </div>
    <div style="padding:0 12px 12px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
      <label>媒体：<select id="ovStreamSel"><option value="main">主码流</option></select></label>
      <button class="btn btn-sm" id="btnOpenVideo" style="padding:4px 8px;background:#1f497d;border:1px solid rgba(255,255,255,.15);color:#e6f0ff;border-radius:4px;cursor:pointer;">打开视频</button>
      <label style="margin-left:8px;">设备模式：<select id="ovModeSel">${(info.modeList||[]).map(m=>`<option value="${m.id}">${escapeHTML(m.name)}</option>`).join('')}</select></label>
      <button class="btn btn-sm" id="btnOpenMode" style="padding:4px 8px;background:#1f497d;border:1px solid rgba(255,255,255,.15);color:#e6f0ff;border-radius:4px;cursor:pointer;">打开模式</button>
      <button class="btn btn-sm" id="btnRefreshInfo" style="margin-left:auto;padding:4px 8px;background:#203246;border:1px solid rgba(255,255,255,.15);color:#e6f0ff;border-radius:4px;cursor:pointer;">刷新</button>
    </div>
  `;

  wrap.querySelector('#ovCloseBtn').addEventListener('click', () => closeInfoWindow());
  wrap.querySelector('#btnOpenVideo').addEventListener('click', () => openVideoInGrid(info.id, info.no || String(info.id || '')));
  wrap.querySelector('#btnOpenMode').addEventListener('click', () => {
    const modeId = wrap.querySelector('#ovModeSel').value;
    openModeInGrid(info.id, info.no || String(info.id || ''), modeId);
  });
  wrap.querySelector('#btnRefreshInfo').addEventListener('click', () => openDeviceOverlay(info.id));
  return wrap;
}

/* ---------- 右侧面板渲染 ---------- */
function renderSite(s) {
  renderSummary(s.summary);
  renderNotifications(s.notifications);
}
function renderSummary(sum) {
  const el = document.getElementById('summaryChart'); if (!el) return;
  el.innerHTML = (sum?.stateList || []).map(item => {
    const offline = item.total - item.onlineCount;
    return `<div style="margin:6px 0;">
      <div style="font-size:12px;margin-bottom:4px;">${escapeHTML(item.typeName || '')}</div>
      <div style="display:flex;gap:4px;height:16px;">
        <div style="flex:${item.onlineCount||0};background:#3d89ff;color:#fff;text-align:center;font-size:11px;line-height:16px;border-radius:3px;">${item.onlineCount||0}</div>
        <div style="flex:${offline||0};background:#324153;color:#dde;text-align:center;font-size:11px;line-height:16px;border-radius:3px;">${offline||0}</div>
      </div>
    </div>`;
  }).join('');
}
function renderNotifications(list) {
  const el = document.getElementById('notifyList'); if (!el) return;
  el.innerHTML = (list || []).map(l => {
    const displayName = l.uname || l.uid;
    return `<div style="padding:4px 0;border-bottom:1px dashed rgba(255,255,255,.06);font-size:12px;">${formatTime(l.time)} ${escapeHTML(String(displayName))} ${l.online ? '上线' : '下线'}</div>`;
  }).join('');
}

/* ---------- 媒体格子：初始化/关闭/播放 ---------- */
function initMediaGrid() {
  mediaSlots.forEach(slot => {
    slot.node = document.querySelector(`.media-cell[data-idx="${slot.idx}"]`);
    const closeBtn = slot.node.querySelector(`[data-close="${slot.idx}"]`);
    closeBtn.addEventListener('click', () => closeMediaSlot(slot.idx));
  });
}
function destroyAllMediaSlots() { mediaSlots.forEach(s => closeMediaSlot(s.idx)); }
function closeMediaSlot(idx) {
  const s = mediaSlots[idx]; if (!s) return;
  if (s.timer) { clearInterval(s.timer); s.timer = null; }
  if (s.player && s.player.destroy) { try { s.player.destroy(); } catch {} }
  s.player = null; s.type = null; s.title = '';
  const titleEl = document.getElementById(`mediaTitle${idx}`);
  const bodyEl = document.getElementById(`mediaBody${idx}`);
  if (titleEl) titleEl.textContent = '空闲';
  if (bodyEl) bodyEl.innerHTML = `<div class="media-placeholder">在此显示视频流或模式</div>`;
}

/* ---------- WebRTC 依赖加载（adapter + srs.sdk） ---------- */
function ensureAdapter() {
  return new Promise((resolve) => {
    if (window.adapter) return resolve();
    const s = document.createElement('script');
    s.src = '/js/adapter-7.4.0.min.js'; // 与你 SitePage.html 一致的路径
    s.onload = () => resolve();
    s.onerror = () => resolve(); // 失败也不阻塞（Chrome 一般无须 adapter）
    document.head.appendChild(s);
  });
}
function ensureSrsSdk() {
  return new Promise((resolve, reject) => {
    if (window.SrsRtcPlayerAsync) return resolve();
    const primaryUrl = '/js/srs.sdk.js';
    const fallbackUrl = 'https://ossrs.net/srs.sdk.js';
    const s = document.createElement('script');
    s.src = primaryUrl;
    s.onload = () => resolve();
    s.onerror = () => {
      const s2 = document.createElement('script');
      s2.src = fallbackUrl;
      s2.onload = () => resolve();
      s2.onerror = (e) => reject(e);
      document.head.appendChild(s2);
    };
    document.head.appendChild(s);
  });
}
async function ensureWebRTCDeps() {
  await ensureAdapter();
  await ensureSrsSdk();
}

/* ---------- SRS 播放器（video+canvas 渲染） ---------- */
function makeRenderLoop(draw){ let run=false; function loop(){ if(!run) return; draw(); requestAnimationFrame(loop);} return { start(){ if(!run){run=true; requestAnimationFrame(loop);} }, stop(){ run=false; } }; }
function createSrsCanvasPlayer() {
  const video = document.createElement('video');
  // 有用户点击手势，允许声音；如需静音可改为 true
  video.autoplay = true; video.muted = false; video.playsInline = true;
  // 放到屏幕外，避免闪烁
  video.style.position='absolute'; video.style.left='-99999px'; video.style.top='-99999px';
  document.body.appendChild(video);

  const canvas = document.createElement('canvas');
  canvas.width = 1280; canvas.height = 720;
  const ctx = canvas.getContext('2d');

  let sdk=null, rotation=0, mode='fit';
  const loop = makeRenderLoop(()=>{
    const w = canvas.clientWidth || canvas.width;
    const h = canvas.clientHeight || canvas.height;
    const vw = video.videoWidth, vh = video.videoHeight;
    if(!vw || !vh) return;

    ctx.save(); ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.translate(canvas.width/2, canvas.height/2);
    ctx.rotate(rotation*Math.PI/180);

    let videoW=vw, videoH=vh;
    if(rotation%180!==0) [videoW,videoH] = [videoH,videoW];

    let drawW=w, drawH=h;
    if(mode==='fit'){
      const vr=videoW/videoH, cr=w/h;
      if(vr>cr){ drawW=w; drawH=w/vr; } else { drawH=h; drawW=h*vr; }
    }
    const sx=canvas.width/w, sy=canvas.height/h;
    if(rotation%180===0){ ctx.drawImage(video, -drawW/2*sx, -drawH/2*sy, drawW*sx, drawH*sy); }
    else { ctx.drawImage(video, -drawH/2*sx, -drawW/2*sy, drawH*sx, drawW*sy); }
    ctx.restore();
  });

  async function play(url) {
    if (!url) throw new Error('empty url');
    if (sdk) { try { sdk.close(); } catch {}; sdk=null; }
    // eslint-disable-next-line no-undef
    sdk = new SrsRtcPlayerAsync();
    video.srcObject = sdk.stream;

    // 调用 sdk.play；随后再显式 video.play() 以兼容性兜底
    await sdk.play(url);
    loop.start();
    try { await video.play(); } catch {}
  }
  function destroy() {
    try { loop.stop(); } catch {}
    try { if(sdk){ sdk.close(); sdk=null; } } catch {}
    try { video.srcObject = null; video.remove(); } catch {}
    try { canvas.remove(); } catch {}
  }
  return { canvas, play, destroy, setMode:(m)=>mode=m, rotate:()=>{rotation=(rotation+90)%360;} };
}

/* ---------- 视频/模式打开到底部网格 ---------- */
async function openVideoInGrid(devId, devNo) {
  const idx = findFreeMediaSlot();
  if (idx === -1) { eventBus.emit('toast:show', { type: 'error', message: '没有可用窗口' }); return; }
  const bodyEl = document.getElementById(`mediaBody${idx}`);
  const titleEl = document.getElementById(`mediaTitle${idx}`);
  if (!bodyEl || !titleEl) return;

  try {
    // 关键：播放前确保 adapter + srs.sdk 已加载
    await ensureWebRTCDeps();
  } catch (e) {
    console.error('[SRS] load deps failed', e);
    eventBus.emit('toast:show', { type: 'error', message: '加载 WebRTC 依赖失败（adapter/srs.sdk）' });
    return;
  }

  console.debug('[SRS] play start', { idx, url: SRS_FIXED_URL, devId, devNo });

  const player = createSrsCanvasPlayer();
  bodyEl.innerHTML = '';
  bodyEl.appendChild(player.canvas);
  titleEl.textContent = `${devNo} 视频`;
  mediaSlots[idx].type = 'video';
  mediaSlots[idx].player = player;

  try {
    await player.play(SRS_FIXED_URL);
    console.debug('[SRS] play ok', { idx });
  } catch (e) {
    console.error('[SRS] play failed', e);
    titleEl.textContent = `${devNo} 视频(失败)`;
    eventBus.emit('toast:show', { type: 'error', message: '拉流失败，请检查 webrtc 服务/证书/网络' });
    // 失败时回收画布
    try { player.destroy(); } catch {}
    bodyEl.innerHTML = `<div class="media-placeholder">在此显示视频流或模式</div>`;
    mediaSlots[idx].type = null;
    mediaSlots[idx].player = null;
  }
}
function openModeInGrid(devId, devNo, modeId) {
  const idx = findFreeMediaSlot();
  if (idx === -1) { eventBus.emit('toast:show', { type: 'error', message: '没有可用窗口' }); return; }
  const bodyEl = document.getElementById(`mediaBody${idx}`);
  const titleEl = document.getElementById(`mediaTitle${idx}`);
  if (!bodyEl || !titleEl) return;

  mediaSlots[idx].type = 'mode';
  mediaSlots[idx].title = `${devNo} 模式`;
  titleEl.textContent = `${devNo} 模式`;
  bodyEl.innerHTML = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#0b1119;color:#cfe;">
    <div style="width:90%;max-width:420px;">
      <div style="display:flex;justify-content:space-between;margin:6px 0;"><span>倾角X</span><strong id="m${idx}-x">0.00</strong></div>
      <div style="display:flex;justify-content:space-between;margin:6px 0;"><span>倾角Y</span><strong id="m${idx}-y">0.00</strong></div>
      <div style="display:flex;justify-content:space-between;margin:6px 0;"><span>倾角Z</span><strong id="m${idx}-z">0.00</strong></div>
      <div style="display:flex;justify-content:space-between;margin:6px 0;"><span>位移</span><strong id="m${idx}-m">0.000</strong></div>
      <div style="display:flex;justify-content:space-between;margin:6px 0;"><span>电量</span><strong id="m${idx}-b">100%</strong></div>
    </div>
  </div>`;
  let state = { x: 0, y: 0, z: 0, m: 0.0, b: 100 };
  const t = setInterval(() => {
    state.x = clamp(state.x + rand(-0.05,0.05), -5, 5);
    state.y = clamp(state.y + rand(-0.05,0.05), -5, 5);
    state.z = clamp(state.z + rand(-0.05,0.05), -5, 5);
    state.m = Math.max(0, state.m + rand(0.001,0.003));
    if (state.b > 0 && Math.random() < 0.03) state.b -= 1;

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set(`m${idx}-x`, state.x.toFixed(2));
    set(`m${idx}-y`, state.y.toFixed(2));
    set(`m${idx}-z`, state.z.toFixed(2));
    set(`m${idx}-m`, state.m.toFixed(3));
    set(`m${idx}-b`, state.b + '%');
  }, 200);
  mediaSlots[idx].timer = t;
}
function findFreeMediaSlot() { for (const s of mediaSlots) if (!s.type) return s.idx; return -1; }

/* ---------- 通用工具 ---------- */
function escapeHTML(str='') { return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function rand(a,b){return Math.random()*(b-a)+a;}
function clamp(v,min,max){return v<min?min:v>max?max:v;}
function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts); const p = n => n<10?'0'+n:n;
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function debounce(fn,ms=300){ let t=null; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args),ms); }; }
function throttle(fn,ms=100){ let t=0, id=null, lastArgs=null; return (...args)=>{ const now=Date.now(); lastArgs=args; if(now-t>=ms){ t=now; fn(...lastArgs); } else if(!id){ id=setTimeout(()=>{ t=Date.now(); id=null; fn(...lastArgs); }, ms-(now-t)); } }; }