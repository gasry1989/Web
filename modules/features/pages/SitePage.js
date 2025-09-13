/**
 * 现场管理主页面（Shadow DOM 隔离 + 稳定分栏拖拽 + 地图交互打通 + 树形恢复）
 * 变更要点：
 * - 地图容器添加捕获阶段阻断（wheel/mouse/touch/pointer），避免外层拦截，保证拖拽/缩放可用
 * - 树形恢复：基于原树构建，新增“占位父节点”兜底，不改变旧结构与样式
 * - 分栏拖拽用 body 级玻璃层，仅拖拽时存在；结束彻底清除，后续地图交互不受影响
 * - 媒体区（6窗口、灰色线框、画布DPR自适应）保持你上版确认的行为
 */
import { siteState } from '@state/siteState.js';
import { previewState } from '@state/previewState.js';
import {
  apiDevTypes, apiDevModes, apiGroupedDevices, apiUngroupedDevices,
  apiDeviceSummary, apiOnlineList, apiDeviceInfo
} from '@api/deviceApi.js';
import { eventBus } from '@core/eventBus.js';
import { ENV } from '@config/env.js';
import { ensureWS } from '@ws/wsClient.js';

let unsubSite, unsubPreview;
let routeWatcher = null;

let mapInstance = null;
let markersLayer = [];
let infoWindow = null;
let followCenter = false; // 无定位时 InfoWindow 跟随地图中心

let __prevHtmlOverflow = '';
let __prevBodyOverflow = '';
let __prevMainStyle = null;

let SP_HOST = null;
let SP_ROOT = null;
const $ = (sel) => SP_ROOT?.querySelector(sel);
const $id = (id) => SP_ROOT?.getElementById(id);

/* 6 个窗口（保持上版） */
const SRS_FIXED_URL = 'webrtc://media.szdght.com/1/camera_audio';
const mediaSlots = Array.from({ length: 6 }, (_, i) => ({ idx: i, type: null, player: null, node: null, title: '', timer: null }));

function injectStyles() {
  const s = document.createElement('style');
  s.id = 'sp-style';
  s.textContent = `
  :host { all: initial; contain: content; }
  *, *::before, *::after { box-sizing: border-box; }
  .sp-page {
    --panel-bg:#0f1720; --panel-bg-2:#0b121a; --panel-line:rgba(255,255,255,.08);
    --text-primary:#cfd8dc; --text-dim:#9fb1bb; --online-text:#fff; --offline-text:#7a8a93;
    --grid-border:#3a4854; /* 灰线框 */
    --media-row-height: 360px;
    --device-online-bg:linear-gradient(135deg,#5aa0ff,#3d89ff);
    --device-offline-bg:#5b6b78;
    --scroll-track:#141b20; --scroll-thumb:#33424d; --scroll-thumb-hover:#415464;
    height:100%; overflow:hidden; background:#0d1216;
    font-family: system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif; color:#cfd8dc;
  }
  .sp-page * { scrollbar-width: thin; scrollbar-color: var(--scroll-thumb) var(--scroll-track); }
  .sp-page *::-webkit-scrollbar { width: 10px; height: 10px; }
  .sp-page *::-webkit-scrollbar-track { background: var(--scroll-track); }
  .sp-page *::-webkit-scrollbar-thumb { background: var(--scroll-thumb); border-radius: 4px; }
  .sp-page *::-webkit-scrollbar-thumb:hover { background: var(--scroll-thumb-hover); }

  .sp-layout { height:100%; display:flex; min-width:0; }
  .sp-left { width:320px; min-width:240px; max-width:50vw; background:var(--panel-bg); border-right:1px solid var(--panel-line); display:flex; flex-direction:column; min-height:0; }
  .sp-splitter { width:6px; cursor:col-resize; position:relative; z-index:50; }
  .sp-splitter::after { content:''; position:absolute; top:0; bottom:0; left:2px; width:2px; background: var(--panel-line); transition: background .15s; }
  .sp-splitter:hover::after, .sp-splitter.dragging::after { background: rgba(93,188,252,.45); }

  .sp-center { flex:1 1 auto; background:#0a0f14; display:grid; grid-template-rows: 1fr var(--media-row-height); overflow:visible; min-width:0; min-height:0; }
  .sp-top { display:flex; gap:10px; padding:4px 10px; overflow:hidden; min-width:0; }
  .sp-map-wrap { flex:1 1 auto; background:#0a0f14; border:1px solid var(--panel-line); border-radius:4px; overflow:hidden; min-width:0; position:relative; }
  .sp-map { width:100%; height:100%; background:#0a0f14; touch-action: pan-x pan-y; }

  .sp-side { width:380px; max-width:42vw; display:grid; grid-template-rows:auto 1fr; gap:10px; overflow:hidden; min-width:0; }
  .sp-box { background:var(--panel-bg-2); border:1px solid var(--panel-line); border-radius:4px; padding:8px 10px; display:flex; flex-direction:column; min-height:0; }
  .sp-box h3 { margin:0 0 6px; font-size:15px; font-weight:600; }
  .sp-scroll { flex:1 1 auto; overflow:auto; min-height:0; touch-action: pan-y; }

  .sp-bottom { padding:0 10px 4px; min-width:0; }
  .sp-media-grid { display:grid; grid-template-columns:repeat(6,1fr); gap:10px; height:100%; align-items:stretch; min-width:0; }
  .sp-media { background:#111722; border:2px solid var(--grid-border); border-radius:6px; display:flex; flex-direction:column; overflow:hidden; height:100%; min-width:0; }
  .sp-media-head { flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; color:#cfd8dc; padding:6px 8px; font-size:12px; background:#0f1b27; border-bottom:1px solid var(--panel-line); }
  .sp-title { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:calc(100% - 24px); }
  .sp-close { width:20px; height:20px; border:none; color:#ccd; background:transparent; cursor:pointer; }
  .sp-close:hover { color:#fff; }
  .sp-media-body { position:relative; flex:1 1 auto; min-height:0; background:#000; display:flex; align-items:center; justify-content:center; }
  .sp-media-body canvas { width:100%; height:100%; display:block; }
  .sp-placeholder { color:#567; font-size:12px; }

  .sp-filters { padding:8px 10px; border-bottom:1px solid var(--panel-line); }
  .sp-filters label { color:var(--text-dim); }
  .sp-filters input, .sp-filters select { background:#0b121a; color:#cfd8dc; border:1px solid var(--panel-line); border-radius:4px; padding:4px 6px; }
  .sp-filters .btn { background:#122133; color:#cfd8dc; border:1px solid var(--panel-line); }
  .sp-filters .btn:hover { background:#17314d; }

  .sp-tree { flex:1 1 auto; overflow:auto; color:#cfd8dc; background:var(--panel-bg); min-height:0; }
  .sp-gdt { padding:6px 8px; width:max-content; min-width:100%; }
  .sp-node + .sp-node { margin-top:6px; }
  .sp-row { display:flex; align-items:center; gap:6px; padding:4px 6px; border-radius:4px; cursor:pointer; user-select:none; }
  .sp-row:hover { background:#0e1a24; }
  .sp-toggle { width:16px; text-align:center; color:#9fb1bb; }
  .sp-toggle.is-empty { visibility:hidden; }
  .sp-ic-user { display:none !important; }
  .sp-ic-dev { width:12px; height:12px; border-radius:2px; background:linear-gradient(135deg,#5aa0ff,#3d89ff); display:inline-block; }
  .sp-title2 { white-space:nowrap; }
  .sp-row.is-online .sp-title2 { color: var(--online-text); }
  .sp-row.is-offline .sp-title2 { color: var(--offline-text); }

  .sp-children { margin-left:18px; border-left:1px dashed rgba(255,255,255,.12); padding-left:10px; }
  .sp-children.is-collapsed { display:none; }
  .sp-dev { padding:2px 6px 2px 22px; display:flex; align-items:center; gap:6px; cursor:pointer; }
  .sp-dev:hover { background:#0e1a24; border-radius:4px; }
  .sp-dev.is-online .sp-ic-dev { background:linear-gradient(135deg,#5aa0ff,#3d89ff); }
  .sp-dev.is-offline .sp-ic-dev { background:#5b6b78; }

  .sp-sec { margin:8px 8px 12px; }
  .sp-sec__title { font-weight:600; padding:6px 8px; color:#e1edf7; background:#10212e; border-radius:4px; border:1px solid rgba(255,255,255,.08); }
  .sp-list { padding:6px 8px; display:flex; flex-direction:column; gap:4px; }
  .sp-chip { display:flex; align-items:center; gap:6px; padding:6px 8px; border-radius:4px; cursor:pointer; background:transparent; border:1px solid transparent; }
  .sp-chip:hover { background:#15202b; border-color:rgba(255,255,255,.08); }
  .sp-list .sp-ic-dev { width:12px; height:12px; border-radius:2px; display:inline-block; }
  .sp-chip.is-online .sp-ic-dev { background:linear-gradient(135deg,#5aa0ff,#3d89ff); }
  .sp-chip.is-offline .sp-ic-dev { background:#5b6b78; }
  `;
  SP_ROOT.appendChild(s);
}

const LS_LEFT_WIDTH_KEY = 'site.left.width';
const MIN_LEFT_WIDTH = 240;
const MAX_LEFT_WIDTH_VW = 50;

export function mountSitePage() {
  __prevHtmlOverflow = document.documentElement.style.overflow;
  __prevBodyOverflow = document.body.style.overflow;
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';

  const main = document.getElementById('mainView');
  __prevMainStyle = {
    padding: main.style.padding,
    overflow: main.style.overflow,
    position: main.style.position,
    height: main.style.height,
  };
  main.innerHTML = '';
  main.style.padding = '0';
  main.style.overflow = 'hidden';
  if (!getComputedStyle(main).position || getComputedStyle(main).position === 'static') main.style.position = 'relative';
  const fitMainHeight = () => {
    const top = main.getBoundingClientRect().top;
    const h = window.innerHeight - top;
    if (h > 0) main.style.height = h + 'px';
  };
  fitMainHeight();
  window.addEventListener('resize', fitMainHeight);

  SP_HOST = document.createElement('div');
  SP_HOST.style.position = 'absolute';
  SP_HOST.style.inset = '0';
  main.appendChild(SP_HOST);
  SP_ROOT = SP_HOST.attachShadow({ mode: 'open' });

  injectStyles();

  SP_ROOT.innerHTML += `
    <div class="sp-page">
      <div class="sp-layout" id="spLayout">
        <div class="sp-left" id="spLeft">
          <div class="sp-filters">
            <div><label>设备类型：<select id="fltDevType"><option value="0">全部</option></select></label></div>
            <div><label>设备模式：<select id="fltDevMode"><option value="0">全部</option></select></label></div>
            <div><label>名称/编号：<input id="fltSearch" placeholder="模糊搜索"/></label></div>
            <div class="only-online"><label><input type="checkbox" id="fltOnline"/> 仅显示在线</label></div>
            <div><button class="btn btn-sm" id="btnSiteRefresh">刷新</button></div>
          </div>
          <div class="sp-tree" id="deviceTree"></div>
        </div>
        <div class="sp-splitter" id="spSplitter" title="拖动调整左侧宽度"></div>
        <div class="sp-center">
          <div class="sp-top">
            <div class="sp-map-wrap"><div id="mapContainer" class="sp-map">地图加载中...</div></div>
            <div class="sp-side">
              <div class="sp-box">
                <h3>设备状态</h3>
                <div id="summaryChart"></div>
              </div>
              <div class="sp-box">
                <h3>通知列表</h3>
                <div id="notifyList" class="sp-scroll"></div>
              </div>
            </div>
          </div>
          <div class="sp-bottom">
            <div class="sp-media-grid" id="mediaGrid">
              ${mediaSlots.map(s => `
                <div class="sp-media" data-idx="${s.idx}">
                  <div class="sp-media-head">
                    <div class="sp-title" id="mediaTitle${s.idx}">空闲</div>
                    <button class="sp-close" data-close="${s.idx}" title="关闭">✕</button>
                  </div>
                  <div class="sp-media-body" id="mediaBody${s.idx}">
                    <div class="sp-placeholder">在此显示视频流或模式</div>
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

  // 右下关闭按钮：事件代理确保始终可用
  $id('mediaGrid').addEventListener('click', (ev) => {
    const btn = ev.target.closest('.sp-close');
    if (!btn) return;
    const idx = Number(btn.getAttribute('data-close'));
    if (!Number.isNaN(idx)) closeMediaSlot(idx);
  });

  unsubSite = siteState.subscribe(renderSite);
  unsubPreview = previewState.subscribe(() => {});

  loadBaseData();
  initAMap();
  ensureWS();
  setupRouteWatcher();
}

export function unmountSitePage() { teardownPage(); }

function teardownPage() {
  document.documentElement.style.overflow = __prevHtmlOverflow;
  document.body.style.overflow = __prevBodyOverflow;

  unsubSite && unsubSite(); unsubSite = null;
  unsubPreview && unsubPreview(); unsubPreview = null;

  window.removeEventListener('resize', onWindowResize);
  removeRouteWatcher();

  closeInfoWindow();
  destroyAMap();
  destroyAllMediaSlots();

  const main = document.getElementById('mainView');
  if (__prevMainStyle && main) {
    main.style.padding = __prevMainStyle.padding;
    main.style.overflow = __prevMainStyle.overflow;
    main.style.position = __prevMainStyle.position;
    main.style.height = __prevMainStyle.height;
  }
  if (SP_HOST) { try { SP_HOST.remove(); } catch {} SP_HOST = null; SP_ROOT = null; }
}

/* ---------------- 分隔条拖拽（body 级玻璃层，稳定且仅拖拽期间占用） ---------------- */
function initSplitter() {
  const layout = $id('spLayout');
  const left = $id('spLeft');
  const splitter = $id('spSplitter');

  const saved = Number(localStorage.getItem(LS_LEFT_WIDTH_KEY));
  if (saved && saved >= MIN_LEFT_WIDTH) left.style.width = saved + 'px';

  splitter.addEventListener('mousedown', (e) => {
    const bounds = layout.getBoundingClientRect();
    const maxPx = Math.floor(window.innerWidth * (MAX_LEFT_WIDTH_VW / 100));
    splitter.classList.add('dragging');

    const glass = document.createElement('div');
    Object.assign(glass.style, {
      position: 'fixed', inset: '0', cursor: 'col-resize', zIndex: '2147483646', background: 'transparent'
    });
    document.body.appendChild(glass);

    const move = (ev) => {
      const x = (ev.clientX ?? 0) - bounds.left;
      const w = clamp(Math.round(x), MIN_LEFT_WIDTH, maxPx);
      left.style.width = w + 'px';
      try { mapInstance && mapInstance.resize(); } catch {}
      ev.preventDefault();
    };
    const cleanup = () => {
      splitter.classList.remove('dragging');
      try { glass.remove(); } catch {}
      const w = parseInt(left.style.width || getComputedStyle(left).width, 10);
      if (w) localStorage.setItem(LS_LEFT_WIDTH_KEY, String(w));
      requestAnimationFrame(() => { try { mapInstance && mapInstance.resize(); } catch {} });
      setTimeout(() => { try { mapInstance && mapInstance.resize(); } catch {} }, 100);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', cleanup);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('blur', cleanup);
      document.removeEventListener('visibilitychange', cleanup);
    };

    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', cleanup, { once: true });
    window.addEventListener('pointerup', cleanup, { once: true });
    window.addEventListener('blur', cleanup, { once: true });
    document.addEventListener('visibilitychange', cleanup, { once: true });
    e.preventDefault();
  });
}

function onWindowResize() { try { mapInstance && mapInstance.resize(); } catch {} }

/* ---------------- 路由监听 ---------------- */
function setupRouteWatcher() {
  removeRouteWatcher();
  const handler = () => {
    const isSite = String(location.hash || '').includes('/site');
    if (!isSite) { closeInfoWindow(); destroyAMap(); destroyAllMediaSlots(); return; }
    initAMap().then(() => {
      requestAnimationFrame(() => { try { mapInstance && mapInstance.resize(); } catch {} });
      setTimeout(() => { try { mapInstance && mapInstance.resize(); } catch {} }, 120);
    });
  };
  window.addEventListener('hashchange', handler);
  routeWatcher = handler; handler();
}
function removeRouteWatcher() { if (routeWatcher) { window.removeEventListener('hashchange', routeWatcher); routeWatcher = null; } }

/* ---------------- 过滤/数据 ---------------- */
function bindFilters() {
  const left = $id('spLeft');
  left.addEventListener('change', e => {
    if (['fltDevType','fltDevMode','fltOnline'].includes(e.target.id)) updateFilters();
  });
  $id('fltSearch').addEventListener('input', debounce(updateFilters, 300));
  $id('btnSiteRefresh').addEventListener('click', () => loadBaseData(true));
}
function updateFilters() {
  const devType = Number($id('fltDevType').value);
  const devMode = Number($id('fltDevMode').value);
  const filterOnline = $id('fltOnline').checked;
  const searchStr = $id('fltSearch').value.trim();
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
        notifications: (online.list || []).slice(0, 50),
        summary: { total: summary.total, onlineCount: summary.onlineCount, stateList: summary.stateList || [] }
      });
      loadDeviceTrees();
    })
    .catch(err => console.error('[Site] loadBaseData error', err));
}
function loadDeviceTrees() {
  const filters = siteState.get().filters;
  Promise.all([apiGroupedDevices(filters), apiUngroupedDevices(filters)])
    .then(([g, u]) => {
      siteState.set({ groupedDevices: g.devList || [], ungroupedDevices: u.devList || [] });
      buildTree(); buildMarkers();
    })
    .catch(err => {
      console.error('[Site] loadDeviceTrees error', err);
      siteState.set({ groupedDevices: [], ungroupedDevices: [] });
      buildTree(); buildMarkers();
    });
}
function loadSummary() {
  apiDeviceSummary()
    .then(summary => { siteState.set({ summary: { total: summary.total, onlineCount: summary.onlineCount, stateList: summary.stateList || [] } }); })
    .catch(err => console.error('[Site] loadSummary error', err));
}
function fillDevTypeSelect(list) {
  const sel = $id('fltDevType'); const cur = sel.value;
  sel.innerHTML = `<option value="0">全部</option>` + list.map(t => `<option value="${t.typeId}">${t.typeName}</option>`).join('');
  sel.value = cur || '0';
}
function fillDevModeSelect(list) {
  const sel = $id('fltDevMode'); const cur = sel.value;
  sel.innerHTML = `<option value="0">全部</option>` + list.map(m => `<option value="${m.modeId}">${m.modeName}</option>`).join('');
  sel.value = cur || '0';
}

/* ---------------- 树：恢复旧结构 + 占位父节点兜底 ---------------- */
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
  // 1) 先把所有出现在 userInfo 的用户放入 map
  const userMap = new Map();
  groupedDevices.forEach(entry => {
    const ui = normalizeUserInfo(entry.userInfo);
    if (!ui || ui.userId == null) return;
    if (!userMap.has(ui.userId)) {
      userMap.set(ui.userId, { ...ui, type: 'user', children: [], deviceChildren: [], isOnline: ui.onlineState });
    }
  });
  // 2) 占位父节点兜底（父节点可能没有设备但需要出现在树上）
  userMap.forEach(node => {
    const pid = node.parentUserId;
    if (pid != null && !userMap.has(pid)) {
      userMap.set(pid, { userId: pid, userName: '', parentUserId: null, type: 'user', children: [], deviceChildren: [], isOnline: false, placeholder: true });
    }
  });
  // 3) 挂设备到对应用户
  groupedDevices.forEach(entry => {
    const ui = normalizeUserInfo(entry.userInfo); const di = entry.devInfo || {};
    if (!ui || ui.userId == null) return;
    const node = userMap.get(ui.userId); if (!node) return;
    node.deviceChildren.push({ type:'device', devId: di.id, devName: di.no || di.name || String(di.id || ''), onlineState: !!di.onlineState, raw: di });
  });
  // 4) 挂用户到父用户
  userMap.forEach(n => { n.children = n.children || []; });
  userMap.forEach(n => { const pid = n.parentUserId; if (pid != null && userMap.has(pid)) userMap.get(pid).children.push(n); });

  // 5) 计算在线（沿袭旧逻辑）
  function computeOnline(n) {
    if (typeof n.isOnline === 'boolean') return n.isOnline;
    let online = n.deviceChildren?.some(d => d.onlineState) || false;
    if (n.children?.length) for (const c of n.children) online = computeOnline(c) || online;
    n.isOnline = online; return online;
  }
  userMap.forEach(n => computeOnline(n));

  // 6) 选择根：优先当前用户；若当前用户不在 map，则找无父级或父丢失者
  const cu = getCurrentUserStrict();
  if (cu?.userId != null) {
    if (userMap.has(cu.userId)) {
      const root = userMap.get(cu.userId);
      root.parentUserId = null;
      return { roots: [root] };
    } else {
      // 当前用户不在 map，用占位根，把所有 parentUserId===cu.userId 的一层挂上来
      const root = { userId: cu.userId, userName: cu.userName || cu.name || '当前用户', parentUserId: null, type:'user', children: [], deviceChildren: [], isOnline: false, placeholder: true };
      userMap.forEach(n => { if (n.parentUserId === cu.userId) root.children.push(n); });
      return { roots: [root] };
    }
  }
  const roots = [];
  userMap.forEach(n => { if (n.parentUserId == null || !userMap.has(n.parentUserId)) roots.push(n); });
  return { roots };
}
function renderUserNodeHTML(node, level = 1, expandLevel = 2) {
  const hasChildren = (node.children && node.children.length) || (node.deviceChildren && node.deviceChildren.length);
  const expanded = level <= expandLevel;
  const rowOnlineCls = node.isOnline ? 'is-online' : 'is-offline';
  const safeName = node.userName || '(未命名用户)';
  const header = `
    <div class="sp-row ${rowOnlineCls}" data-node-type="user" data-user-id="${node.userId}">
      <span class="sp-toggle ${hasChildren ? '' : 'is-empty'}">${hasChildren ? (expanded ? '▾' : '▸') : ''}</span>
      <span class="sp-ic-user"></span>
      <span class="sp-title2" title="${escapeHTML(safeName)}">${escapeHTML(safeName)}</span>
    </div>`;
  const childrenHTML = hasChildren ? `
    <div class="sp-children ${expanded ? '' : 'is-collapsed'}">
      ${(node.children || []).map(child => renderUserNodeHTML(child, level + 1, expandLevel)).join('')}
      ${(node.deviceChildren || []).map(d => `
        <div class="sp-node sp-dev ${d.onlineState ? 'is-online' : 'is-offline'}" data-devid="${d.devId}">
          <span class="sp-ic-dev"></span>
          <span class="sp-title2" title="${escapeHTML(d.devName)}">${escapeHTML(d.devName)}</span>
        </div>
      `).join('')}
    </div>` : '';
  return `<div class="sp-node sp-user" data-user-id="${node.userId}">${header}${childrenHTML}</div>`;
}
function buildTree() {
  const treeEl = $id('deviceTree');
  const { groupedDevices, ungroupedDevices } = siteState.get();
  const { roots } = buildUserForestFromGroupedDevices(groupedDevices);
  const expandLevel = 2;
  const treeHTML = `
    <div class="sp-gdt">${roots.map(root => renderUserNodeHTML(root, 1, expandLevel)).join('')}</div>
    <div class="sp-sec">
      <div class="sp-sec__title">未分组设备 (${ungroupedDevices.length})</div>
      <div class="sp-list">
        ${ungroupedDevices.map(e => {
          const d = e.devInfo || {}; const name = d.no || d.name || String(d.id || ''); const cls = d.onlineState ? 'is-online' : 'is-offline';
          return `<div class="sp-chip ${cls}" data-devid="${d.id}" title="${escapeHTML(name)}">
            <span class="sp-ic-dev"></span><span class="sp-title2">${escapeHTML(name)}</span>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  treeEl.innerHTML = treeHTML;

  // 展开/收起 + 打开设备
  treeEl.addEventListener('click', (e) => {
    const row = e.target.closest('.sp-row');
    if (row && treeEl.contains(row)) {
      const nodeEl = row.parentElement; const children = nodeEl.querySelector(':scope > .sp-children'); const toggle = row.querySelector('.sp-toggle');
      if (children) { const collapsed = children.classList.toggle('is-collapsed'); if (toggle) toggle.textContent = collapsed ? '▸' : '▾'; }
      return;
    }
    const devEl = e.target.closest('[data-devid]');
    if (devEl && treeEl.contains(devEl)) {
      const devId = Number(devEl.getAttribute('data-devid')); if (!Number.isNaN(devId)) openDeviceOverlay(devId);
    }
  }, { passive: true });
}

/* ---------------- 地图：拖拽/缩放彻底打通 ---------------- */
function ensureAMapReady() {
  return new Promise((resolve, reject) => {
    if (window.AMap) return resolve();
    const id = 'amap-sdk-v2';
    if (document.getElementById(id)) {
      const wait = setInterval(() => { if (window.AMap) { clearInterval(wait); resolve(); } }, 50);
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
  const container = $id('mapContainer'); if (!container) return;
  if (mapInstance) { try { mapInstance.resize(); } catch {} return; }
  try {
    await ensureAMapReady();
    await new Promise(r => requestAnimationFrame(r));

    // 在捕获阶段阻断外层 wheel/drag/touch 拦截，保证 AMap 能拿到原始事件
    const stopCap = (e) => { e.stopPropagation(); };
    ['wheel','mousewheel','DOMMouseScroll','touchstart','touchmove','touchend','pointerdown','pointermove','pointerup','mousedown','mousemove','mouseup','contextmenu']
      .forEach(evt => container.addEventListener(evt, stopCap, { capture:true, passive:false }));

    // eslint-disable-next-line no-undef
    mapInstance = new AMap.Map(container, { zoom: 5, center: [105.0, 35.0], viewMode: '2D', dragEnable: true, scrollWheel: true, keyboardEnable: true, doubleClickZoom: true });
    try { mapInstance.setStatus && mapInstance.setStatus({ dragEnable: true, scrollWheel: true, keyboardEnable: true, doubleClickZoom: true }); } catch {}
    buildMarkers();

    const obs = new ResizeObserver(() => { try { mapInstance && mapInstance.resize(); } catch {} });
    obs.observe(container);

    mapInstance.on && mapInstance.on('mapmove', () => {
      if (followCenter && infoWindow) {
        const c = mapInstance.getCenter();
        infoWindow.setPosition(c);
      }
    });
  } catch (e) { console.error('[Site] initAMap failed', e); }
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
  if (mapInstance) { try { mapInstance.destroy(); } catch {} mapInstance = null; }
}

function closeInfoWindow() { try { if (infoWindow) infoWindow.close(); } catch {} infoWindow = null; followCenter = false; }
function openDeviceOverlay(devId) {
  apiDeviceInfo(devId).then(data => {
    const info = data.devInfo;
    let pos;
    if (info.lastLocation && info.lastLocation.lng != null && info.lastLocation.lat != null) {
      pos = [info.lastLocation.lng, info.lastLocation.lat];
      followCenter = false;
    } else if (mapInstance) {
      pos = mapInstance.getCenter();
      followCenter = true;
    } else {
      pos = [105, 35];
      followCenter = false;
    }

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
      <label style="margin-left:8px;">设备模式：<select id="ovModeSel">${(info.modeList||[]).map(m=>`<option value="${m.modeId}">${escapeHTML(m.modeName)}</option>`).join('')}</select></label>
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

/* ---------------- 渲染右侧 ---------------- */
function renderSite(s) { renderSummary(s.summary); renderNotifications(s.notifications); }
function renderSummary(sum) {
  const el = $id('summaryChart'); if (!el) return;
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
  const el = $id('notifyList'); if (!el) return;
  el.innerHTML = (list || []).map(l => {
    const displayName = l.uname || l.uid;
    return `<div style="padding:4px 0;border-bottom:1px dashed rgba(255,255,255,.06);font-size:12px;">${formatTime(l.time)} ${escapeHTML(String(displayName))} ${l.online ? '上线' : '下线'}</div>`;
  }).join('');
}

/* ---------------- 媒体（保持上版：DPR自适配、填满） ---------------- */
function initMediaGrid() {
  mediaSlots.forEach(slot => {
    slot.node = SP_ROOT.querySelector(`.sp-media[data-idx="${slot.idx}"]`);
  });
}
function destroyAllMediaSlots() { mediaSlots.forEach(s => closeMediaSlot(s.idx)); }
function closeMediaSlot(idx) {
  const s = mediaSlots[idx]; if (!s) return;
  if (s.timer) { clearInterval(s.timer); s.timer = null; }
  if (s.player && s.player.destroy) { try { s.player.destroy(); } catch {} }
  s.player = null; s.type = null; s.title = '';
  const titleEl = $id(`mediaTitle${idx}`);
  const bodyEl = $id(`mediaBody${idx}`);
  if (titleEl) titleEl.textContent = '空闲';
  if (bodyEl) bodyEl.innerHTML = `<div class="sp-placeholder">在此显示视频流或模式</div>`;
}

/* WebRTC 依赖 */
function ensureAdapter() {
  return new Promise((resolve) => {
    if (window.adapter) return resolve();
    const s = document.createElement('script');
    s.src = '/js/adapter-7.4.0.min.js';
    s.onload = () => resolve();
    s.onerror = () => resolve();
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
async function ensureWebRTCDeps() { await ensureAdapter(); await ensureSrsSdk(); }

/* Player：canvas + DPI 观察（保持上版） */
function makeRenderLoop(draw){ let run=false; function loop(){ if(!run) return; draw(); requestAnimationFrame(loop);} return { start(){ if(!run){run=true; requestAnimationFrame(loop);} }, stop(){ run=false; } }; }
function createSrsCanvasPlayer() {
  const video = document.createElement('video');
  video.autoplay = true; video.muted = false; video.playsInline = true;
  video.style.position='absolute'; video.style.left='-99999px'; video.style.top='-99999px';
  document.body.appendChild(video);

  const canvas = document.createElement('canvas');
  canvas.width = 1280; canvas.height = 720;
  const ctx = canvas.getContext('2d');

  const ro = new ResizeObserver(() => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }
  });
  ro.observe(canvas);

  let sdk=null, rotation=0, mode='fill';

  const loop = makeRenderLoop(()=>{
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || 1;
    const h = rect.height || 1;
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
    } else { drawW = w; drawH = h; }

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
    await sdk.play(url);
    loop.start();
    try { await video.play(); } catch {}
  }
  function destroy() {
    try { loop.stop(); } catch {}
    try { if(sdk){ sdk.close(); sdk=null; } } catch {}
    try { ro.disconnect(); } catch {}
    try { video.srcObject = null; video.remove(); } catch {}
    try { canvas.remove(); } catch {}
  }
  return { canvas, play, destroy, setMode:(m)=>mode=m, rotate:()=>{rotation=(rotation+90)%360;} };
}

/* 打开媒体 */
async function openVideoInGrid(devId, devNo) {
  const idx = findFreeMediaSlot();
  if (idx === -1) { eventBus.emit('toast:show', { type: 'error', message: '没有可用窗口' }); return; }
  const bodyEl = $id(`mediaBody${idx}`);
  const titleEl = $id(`mediaTitle${idx}`);
  if (!bodyEl || !titleEl) return;

  try { await ensureWebRTCDeps(); } catch (e) {
    console.error('[SRS] deps failed', e);
    eventBus.emit('toast:show', { type: 'error', message: '加载 WebRTC 依赖失败' });
    return;
  }

  const player = createSrsCanvasPlayer();
  bodyEl.innerHTML = '';
  bodyEl.appendChild(player.canvas);
  titleEl.textContent = `${devNo} 视频`;
  mediaSlots[idx].type = 'video';
  mediaSlots[idx].player = player;

  try { await player.play(SRS_FIXED_URL); } catch (e) {
    console.error('[SRS] play failed', e);
    titleEl.textContent = `${devNo} 视频(失败)`;
    eventBus.emit('toast:show', { type: 'error', message: '拉流失败' });
    try { player.destroy(); } catch {}
    bodyEl.innerHTML = `<div class="sp-placeholder">在此显示视频流或模式</div>`;
    mediaSlots[idx].type = null; mediaSlots[idx].player = null;
  }
}
function openModeInGrid(devId, devNo, modeId) {
  const idx = findFreeMediaSlot();
  if (idx === -1) { eventBus.emit('toast:show', { type: 'error', message: '没有可用窗口' }); return; }
  const bodyEl = $id(`mediaBody${idx}`);
  const titleEl = $id(`mediaTitle${idx}`);
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
    state.x = clamp(state.x + rand(-0.05, 0.05), -5, 5);
    state.y = clamp(state.y + rand(-0.05, 0.05), -5, 5);
    state.z = clamp(state.z + rand(-0.05, 0.05), -5, 5);
    state.m = Math.max(0, state.m + rand(0.001, 0.003));
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

/* 工具 */
function escapeHTML(str = '') { return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function rand(a, b) { return Math.random() * (b - a) + a; }
function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }
function formatTime(ts) { if (!ts) return ''; const d = new Date(ts); const p = n => n < 10 ? '0' + n : n; return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; }
function debounce(fn, ms = 300) { let t = null; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; }
function throttle(fn, ms = 100) { let t = 0, id = null, lastArgs = null; return (...args) => { const now = Date.now(); lastArgs = args; if (now - t >= ms) { t = now; fn(...lastArgs); } else if (!id) { id = setTimeout(() => { t = Date.now(); id = null; fn(...lastArgs); }, ms - (now - t)); } }; }