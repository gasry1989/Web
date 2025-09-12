/**
 * 现场管理主页面：
 * - 地图初始化（高德）
 * - 设备树构建（用户树 + 设备，树型结构）
 * - 可拖拽调整左侧树栏宽度（带本地记忆）
 * - 过滤 + 刷新 + 统计 + 通知列表
 * - 设备详情浮层 + 预览窗口管理
 * - 模式数据模拟
 *
 * 变更要点（根据你的要求）：
 * 1) 树根只显示“当前登录用户 本人 + 角色名”，不再出现“用户”字样，也不重复出现同名根节点。
 *    - 角色名优先使用 currentUser.roleName；否则按 roleId 映射：0 管理员，1 总帐号，2 子帐号，3 测试人员。
 * 2) 去掉用户行右侧数字徽章；设备行去掉灰点。
 * 3) 在线为白色，离线为灰色。在线判断直接使用接口返回的 onlineState：
 *    - 用户：userInfo.onlineState（若缺失则回退按子节点/设备聚合）
 *    - 设备：devInfo.onlineState
 * 4) 地图在离开“现场管理”（hash 不包含 /site）时自动销毁，关闭地图浮层；返回后自动重新创建地图。
 */
import { siteState } from '@state/siteState.js';
import { previewState, computePreviewCapacity } from '@state/previewState.js';
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

let unsubSite;
let unsubPreview;
let mapInited = false;
let mapInstance = null;
let markersLayer = [];
let routeWatcher = null;

/* ========== 内联样式（JS 注入） ========== */
let __SITE_STYLE_INJECTED = false;
const __SITE_STYLE_ID = 'sitepage-inline-style';
function injectSiteStylesOnce() {
  if (__SITE_STYLE_INJECTED || document.getElementById(__SITE_STYLE_ID)) return;
  const css = `
  /* 主题变量（暗色） */
  .site-page {
    --panel-bg: #0f1720;
    --panel-bg-2: #0b121a;
    --panel-line: rgba(255,255,255,0.08);
    --text-primary: #cfd8dc;
    --text-dim: #9fb1bb;
    --chip-hover: #15202b;
    --toggle-color: #9fb1bb;
    --border-dash: rgba(255,255,255,0.12);
    --online-text: #ffffff;
    --offline-text: #7a8a93;
  }

  /* 整体三栏布局（左-分隔-中-右） */
  .site-layout { display:flex; height: 100%; min-height: 100vh; }
  .site-left {
    width: var(--site-left-width, 320px);
    min-width: 240px;
    max-width: 50vw;
    background: var(--panel-bg);
    color: var(--text-primary);
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--panel-line);
  }
  .site-splitter {
    width: 6px;
    cursor: col-resize;
    position: relative;
    background: transparent;
    user-select: none;
  }
  .site-splitter::after {
    content:'';
    position:absolute; top:0; bottom:0; left:2px; width:2px;
    background: var(--panel-line);
    transition: background .15s ease;
  }
  .site-splitter:hover::after, .site-splitter.dragging::after {
    background: rgba(93,188,252,.45);
  }
  .site-center { flex: 1 1 auto; background: #0a0f14; }
  .site-right { width: 320px; max-width: 36vw; background: var(--panel-bg-2); color: var(--text-primary); border-left: 1px solid var(--panel-line); }

  /* 过滤条区域（暗色适配） */
  .filters { padding: 10px 12px; border-bottom: 1px solid var(--panel-line); }
  .filters label { color: var(--text-dim); }
  .filters input, .filters select {
    background: #0b121a; color: var(--text-primary); border: 1px solid var(--panel-line); border-radius: 4px; padding: 4px 6px;
  }
  .filters .btn { background: #122133; color: var(--text-primary); border: 1px solid var(--panel-line); }
  .filters .btn:hover { background: #17314d; }

  /* 仅显示在线：左对齐 */
  .filters .only-online { text-align: left; }
  .filters .only-online label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    width: auto;
    text-align: left;
  }

  /* 树容器：允许水平/垂直滚动 */
  .device-tree {
    flex: 1 1 auto;
    overflow: auto;
    color: var(--text-primary);
    background: var(--panel-bg);
  }
  .gdt-tree { padding: 6px 8px; width: max-content; min-width: 100%; }

  /* 树节点与样式 */
  .gdt-node { margin-left: 0; }
  .gdt-node + .gdt-node { margin-top: 6px; }
  .gdt-row { display:flex; align-items:center; gap:6px; padding:4px 6px; border-radius:4px; cursor:pointer; user-select:none; }
  .gdt-row:hover { background:#0e1a24; }
  .gdt-toggle { width:16px; text-align:center; color: var(--toggle-color); }
  .gdt-toggle.is-empty { visibility:hidden; }
  .gdt-icon { width:14px; height:14px; display:inline-block; }
  .gdt-icon-user { background:linear-gradient(135deg,#6a8,#3a6); border-radius:50%; }
  .gdt-icon-device { background:linear-gradient(135deg,#88a,#4653d3); border-radius:3px; }

  /* 在线/离线颜色：白/灰（标题和设备行） */
  .gdt-title { flex:0 1 auto; white-space:nowrap; }
  .gdt-row.is-online .gdt-title { color: var(--online-text); }
  .gdt-row.is-offline .gdt-title { color: var(--offline-text); }
  .gdt-node--device.is-online .gdt-title { color: var(--online-text); }
  .gdt-node--device.is-offline .gdt-title { color: var(--offline-text); }

  /* 根节点才显示角色名；其他节点不显示“用户”等字样 */
  .gdt-role { margin-left:6px; font-size:12px; }
  .gdt-role.role-admin{ color:#ff8a80; }
  .gdt-role.role-tester{ color:#80d8ff; }
  .gdt-role.role-owner{ color:#a5d6a7; }
  .gdt-role.role-sub{ color:#ce93d8; }

  /* 去除右侧徽章（避免误解为 roleId） */
  .gdt-count { display:none; }

  .gdt-children { margin-left: 18px; border-left:1px dashed var(--border-dash); padding-left: 10px; }
  .gdt-children.is-collapsed { display:none; }

  .gdt-node--device { padding:2px 6px 2px 22px; display:flex; align-items:center; gap:6px; cursor:pointer; }
  .gdt-node--device:hover { background:#0e1a24; border-radius:4px; }

  /* 未分组区域 */
  .gdt-section { margin: 8px 8px 12px; }
  .gdt-section__title { font-weight:600; padding:6px 8px; color:#e1edf7; background:#10212e; border-radius:4px; border: 1px solid var(--panel-line); }
  .gdt-list { padding:6px 8px; display:flex; flex-direction:column; gap:4px; }
  .gdt-chip { display:flex; align-items:center; gap:6px; padding:6px 8px; border-radius:4px; cursor:pointer; background: transparent; border: 1px solid transparent; }
  .gdt-chip:hover { background: var(--chip-hover); border-color: var(--panel-line); }
  .gdt-chip .gdt-title { white-space: nowrap; }
  .gdt-chip.is-online .gdt-title { color: var(--online-text); }
  .gdt-chip.is-offline .gdt-title { color: var(--offline-text); }

  /* 地图适配 */
  .map-container { width: 100%; height: 100%; }
  `;
  const style = document.createElement('style');
  style.id = __SITE_STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
  __SITE_STYLE_INJECTED = true;
}

/* ========== 入口挂载 ========== */
const LS_LEFT_WIDTH_KEY = 'site.left.width';
const MIN_LEFT_WIDTH = 240;
const MAX_LEFT_WIDTH_VW = 50;

export function mountSitePage() {
  injectSiteStylesOnce();

  const main = document.getElementById('mainView');
  main.innerHTML = `
    <div class="site-page">
      <div class="site-layout" id="siteLayout">
        <div class="site-left" id="siteLeft">
          <div class="filters">
            <div>
              <label>设备类型：
                <select id="fltDevType"><option value="0">全部</option></select>
              </label>
            </div>
            <div>
              <label>设备模式：
                <select id="fltDevMode"><option value="0">全部</option></select>
              </label>
            </div>
            <div>
              <label>名称/编号：
                <input id="fltSearch" placeholder="模糊搜索"/>
              </label>
            </div>
            <div class="only-online">
              <label><input type="checkbox" id="fltOnline"/> 仅显示在线</label>
            </div>
            <div>
              <button class="btn btn-sm" id="btnSiteRefresh">刷新</button>
            </div>
          </div>
          <div class="device-tree" id="deviceTree"><!-- 树 --></div>
        </div>
        <div class="site-splitter" id="siteSplitter" title="拖动调整左侧宽度"></div>
        <div class="site-center">
          <div id="mapContainer" class="map-container">地图加载中...</div>
        </div>
        <div class="site-right">
            <div class="summary-panel">
              <h3>设备状态</h3>
              <div id="summaryChart"></div>
            </div>
            <div class="notify-panel">
              <h3>通知列表</h3>
              <div id="notifyList" class="notify-list"></div>
            </div>
        </div>
      </div>
    </div>
  `;
  document.getElementById('previewBar').classList.remove('hidden');

  initSplitter();

  bindFilters();
  unsubSite = siteState.subscribe(renderSite);
  unsubPreview = previewState.subscribe(renderPreviewBar);

  // 加载基础数据
  loadBaseData();

  // 初始化地图
  initAMap();

  // 建立（或准备）WebSocket
  ensureWS();

  // 模式模拟器启动
  startModeSimulator();

  // 离开 /site 自动清理地图与浮层；回到 /site 自动恢复地图
  setupRouteWatcher();

  // 窗口尺寸变更时，通知地图自适应
  window.addEventListener('resize', onWindowResize);
}

export function unmountSitePage() {
  teardownPage();
}

function teardownPage() {
  unsubSite && unsubSite();
  unsubPreview && unsubPreview();
  unsubSite = unsubPreview = null;

  stopModeSimulator();
  window.removeEventListener('resize', onWindowResize);

  removeRouteWatcher();

  // 关闭地图与浮层
  destroyAMap();
  forceCloseOverlay();

  const bar = document.getElementById('previewBar');
  if (bar) bar.classList.add('hidden');
}

/* ========== 路由监听：离开 /site 时清理 ========== */
function setupRouteWatcher() {
  removeRouteWatcher();
  const handler = () => {
    const isSite = String(location.hash || '').includes('/site');
    if (!isSite) {
      // 离开现场管理：销毁地图 + 关闭浮层
      destroyAMap();
      forceCloseOverlay();
    } else {
      // 回到现场管理：若地图尚未就绪则创建
      if (!mapInstance) initAMap();
    }
  };
  window.addEventListener('hashchange', handler);
  routeWatcher = handler;
  // 首次也检查一次
  handler();
}
function removeRouteWatcher() {
  if (routeWatcher) {
    window.removeEventListener('hashchange', routeWatcher);
    routeWatcher = null;
  }
}

/* ========== 左侧栏宽度拖拽 ========== */
let splitterMoveHandler = null;
let splitterUpHandler = null;

function initSplitter() {
  const layout = document.getElementById('siteLayout');
  const left = document.getElementById('siteLeft');
  const splitter = document.getElementById('siteSplitter');

  // 读取上次宽度
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
      // 保存宽度
      const w = parseInt(left.style.width || getComputedStyle(left).width, 10);
      if (w) localStorage.setItem(LS_LEFT_WIDTH_KEY, String(w));
      // 收尾一次地图 resize
      if (mapInstance) { try { mapInstance.resize(); } catch(e){} }
      document.removeEventListener('mousemove', splitterMoveHandler);
      document.removeEventListener('mouseup', splitterUpHandler);
      splitterMoveHandler = null;
      splitterUpHandler = null;
    };
    document.addEventListener('mousemove', splitterMoveHandler);
    document.addEventListener('mouseup', splitterUpHandler);
    e.preventDefault();
  });
}

function destroySplitter() {
  const splitter = document.getElementById('siteSplitter');
  if (!splitter) return;
  splitter.classList.remove('dragging');
  if (splitterMoveHandler) document.removeEventListener('mousemove', splitterMoveHandler);
  if (splitterUpHandler) document.removeEventListener('mouseup', splitterUpHandler);
  splitterMoveHandler = null;
  splitterUpHandler = null;
}

function onWindowResize() {
  if (mapInited && mapInstance) {
    try { mapInstance.resize(); } catch {}
  }
}

const throttleMapResize = throttle(() => {
  if (mapInited && mapInstance) {
    try { mapInstance.resize(); } catch {}
  }
}, 60);

/* ------- 过滤、数据加载 ------- */
function bindFilters() {
  const left = document.getElementById('siteLeft');
  left.addEventListener('change', e => {
    if (e.target.id === 'fltDevType' || e.target.id === 'fltDevMode' || e.target.id === 'fltOnline') {
      updateFilters();
    }
  });
  left.querySelector('#fltSearch').addEventListener('input', debounce(updateFilters,300));
  left.querySelector('#btnSiteRefresh').addEventListener('click', () => {
    loadBaseData(true);
  });
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

function loadBaseData(force = false) {
  Promise.all([
    apiDevTypes(),
    apiDevModes(),
    apiOnlineList(),
    apiDeviceSummary()
  ]).then(([types, modes, online, summary]) => {
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
  }).catch(err => {
    console.error('[Site] loadBaseData error', err);
  });
}

function loadDeviceTrees() {
  const filters = siteState.get().filters;
  Promise.all([
    apiGroupedDevices(filters),
    apiUngroupedDevices(filters)
  ]).then(([g,u]) => {
    siteState.set({
      groupedDevices: g.devList || [],
      ungroupedDevices: u.devList || []
    });
    buildTree();
    buildMarkers();
  }).catch(err => {
    console.error('[Site] loadDeviceTrees error', err);
    siteState.set({ groupedDevices: [], ungroupedDevices: [] });
    buildTree();
    buildMarkers();
  });
}

function loadSummary() {
  apiDeviceSummary().then(summary => {
    siteState.set({
      summary: {
        total: summary.total,
        onlineCount: summary.onlineCount,
        stateList: summary.stateList || []
      }
    });
  }).catch(err => {
    console.error('[Site] loadSummary error', err);
  });
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

/* ------- 角色映射与当前用户 ------- */
// REPLACE: 角色映射常量
const ROLE_ID_MAP = window.__ROLE_ID_MAP || {
  0: { key: 'admin',  label: '管理员' },
  1: { key: 'tester', label: '测试人员' },
  2: { key: 'owner',  label: '总帐号' },
  3: { key: 'sub',    label: '子帐号' }
};

// REPLACE: roleKey 与 getRoleDisplay
function roleKey(raw) {
  const s = String(raw ?? '').toLowerCase();
  if (['0','admin','管理员'].includes(s)) return 'admin';
  if (['1','tester','测试人员'].includes(s)) return 'tester';
  if (['2','owner','main','总帐号','root'].includes(s)) return 'owner';
  if (['3','sub','子帐号','child'].includes(s)) return 'sub';
  return 'user';
}

function getRoleDisplay(cu) {
  // 优先后端给的中文 roleName
  if (cu?.roleName) return { key: roleKey(cu.roleName), label: cu.roleName };
  // 其次按 roleId 映射
  if (cu?.roleId != null && ROLE_ID_MAP[cu.roleId]) return ROLE_ID_MAP[cu.roleId];
  // 最后回退 role 字段
  const key = roleKey(cu?.role);
  const label = ({admin:'管理员', tester:'测试人员', owner:'总帐号', sub:'子帐号', user:'用户'})[key] || '用户';
  return { key, label };
}

function getCurrentUser() {
  if (window.__currentUser && (window.__currentUser.userId != null)) return window.__currentUser;
  try {
    const cu = siteState.get().currentUser;
    if (cu && cu.userId != null) return cu;
  } catch(e){}
  return { userId: null, roleId: 0, role: 'admin', roleName: '管理员', userName: '管理员' };
}

/* ------- 树构建（用户树 + 设备） ------- */
// REPLACE: 规范化用户信息（保留 onlineState）
function normalizeUserInfo(ui) {
  if (!ui) return null;
  return {
    userId: ui.userId ?? ui.id,
    userName: ui.userName ?? ui.name ?? '',
    parentUserId: ui.parentUserId ?? ui.pid ?? null,
    role: ui.role ?? ui.userRole ?? ui.type,
    roleId: ui.roleId != null ? Number(ui.roleId) : undefined,
    roleName: ui.roleName,
    onlineState: typeof ui.onlineState === 'boolean' ? ui.onlineState : undefined
  };
}

// REPLACE: 构建用户森林（强制以当前用户为唯一根，并过滤上级）
function buildUserForestFromGroupedDevices(groupedDevices) {
  const userMap = new Map();

  // 1) 收集用户节点（带 userInfo.onlineState）
  groupedDevices.forEach(entry => {
    const ui = normalizeUserInfo(entry.userInfo);
    if (!ui || ui.userId == null) return;
    if (!userMap.has(ui.userId)) {
      userMap.set(ui.userId, { ...ui, type: 'user', children: [], deviceChildren: [], isOnline: ui.onlineState });
    } else {
      const cur = userMap.get(ui.userId);
      userMap.set(ui.userId, {
        ...cur,
        userName: cur.userName || ui.userName,
        role: cur.role || ui.role,
        roleId: cur.roleId ?? ui.roleId,
        roleName: cur.roleName || ui.roleName,
        parentUserId: cur.parentUserId ?? ui.parentUserId,
        isOnline: typeof cur.isOnline === 'boolean' ? cur.isOnline : ui.onlineState
      });
    }
  });

  // 2) 如果当前用户不在 userMap，补一个“合成的根节点”
  const cu = getCurrentUser();
  if (cu?.userId != null && !userMap.has(cu.userId)) {
    userMap.set(cu.userId, {
      userId: cu.userId,
      userName: cu.userName || '',
      parentUserId: null, // 作为根，不连接上级
      role: cu.role,
      roleId: cu.roleId,
      roleName: cu.roleName,
      type: 'user',
      children: [],
      deviceChildren: [],
      isOnline: undefined
    });
  }

  // 3) 附加设备（devInfo.onlineState）
  groupedDevices.forEach(entry => {
    const ui = normalizeUserInfo(entry.userInfo);
    const di = entry.devInfo || {};
    if (!ui || ui.userId == null || di == null) return;
    const node = userMap.get(ui.userId);
    if (!node) return;
    node.deviceChildren.push({
      type: 'device',
      devId: di.id,
      devName: di.no || di.name || String(di.id || ''),
      onlineState: !!di.onlineState,
      raw: di
    });
  });

  // 4) 建立父子关系（以 userMap 中的节点为准）
  userMap.forEach(node => { node.children = node.children || []; });
  userMap.forEach(node => {
    const pid = node.parentUserId;
    if (pid != null && userMap.has(pid)) {
      userMap.get(pid).children.push(node);
    }
  });

  // 5) 在线聚合：若用户 isOnline 未给，则按子/设备聚合
  function computeOnline(n) {
    if (typeof n.isOnline === 'boolean') return n.isOnline;
    let online = n.deviceChildren?.some(d => d.onlineState) || false;
    if (n.children?.length) {
      for (const c of n.children) online = computeOnline(c) || online;
    }
    n.isOnline = online;
    return online;
  }
  userMap.forEach(n => computeOnline(n));

  // 6) 以“当前用户”为唯一根，并过滤掉其上级
  const selfNode = cu?.userId != null ? userMap.get(cu.userId) : null;
  if (selfNode) {
    // 确保根节点不指向上级
    selfNode.parentUserId = null;
    return { roots: [selfNode], userMap, currentUser: cu };
  }

  // 兜底：没有当前用户节点时，按接口顶层（极少发生）
  const roots = [];
  userMap.forEach(n => { if (n.parentUserId == null || !userMap.has(n.parentUserId)) roots.push(n); });
  return { roots, userMap, currentUser: cu };
}

// REPLACE: 渲染用户节点（根节点显示当前登录用户角色）
function renderUserNodeHTML(node, level = 1, expandLevel = 2, rootRoleDisp = null) {
  const hasChildren = (node.children && node.children.length) || (node.deviceChildren && node.deviceChildren.length);
  const expanded = level <= expandLevel;
  const rowOnlineCls = node.isOnline ? 'is-online' : 'is-offline';

  const roleSpan = (level === 1 && rootRoleDisp)
    ? `<span class="gdt-role role-${rootRoleDisp.key}">${escapeHTML(rootRoleDisp.label)}</span>`
    : '';

  const header = `
    <div class="gdt-row ${rowOnlineCls}" data-node-type="user" data-user-id="${node.userId}">
      <span class="gdt-toggle ${hasChildren ? '' : 'is-empty'}">${hasChildren ? (expanded ? '▾' : '▸') : ''}</span>
      <span class="gdt-icon gdt-icon-user"></span>
      <span class="gdt-title" title="${escapeHTML(node.userName)}">${escapeHTML(node.userName || '(未命名用户)')}</span>
      ${roleSpan}
      <span class="gdt-count"></span>
    </div>
  `;

  const childrenHTML = `
    <div class="gdt-children ${expanded ? '' : 'is-collapsed'}">
      ${(node.children || []).map(child => renderUserNodeHTML(child, level + 1, expandLevel, rootRoleDisp)).join('')}
      ${(node.deviceChildren || []).map(d => `
        <div class="gdt-node gdt-node--device ${d.onlineState ? 'is-online' : 'is-offline'}" data-devid="${d.devId}">
          <span class="gdt-icon gdt-icon-device"></span>
          <span class="gdt-title" title="${escapeHTML(d.devName)}">${escapeHTML(d.devName)}</span>
        </div>
      `).join('')}
    </div>
  `;

  return `<div class="gdt-node gdt-node--user" data-user-id="${node.userId}">${header}${hasChildren ? childrenHTML : ''}</div>`;
}

// REPLACE: 构建并渲染整棵树（根角色名从 currentUser.roleId/roleName 决定）
function buildTree() {
  const treeEl = document.getElementById('deviceTree');
  const { groupedDevices, ungroupedDevices } = siteState.get();

  const { roots, currentUser } = buildUserForestFromGroupedDevices(groupedDevices);
  const rootRoleDisp = getRoleDisplay(currentUser); // { key, label }

  const expandLevel = 2;
  const treeHTML = `
    <div class="gdt-tree">
      ${roots.map(root => renderUserNodeHTML(root, 1, expandLevel, rootRoleDisp)).join('')}
    </div>
    <div class="gdt-section">
      <div class="gdt-section__title">未分组设备 (${ungroupedDevices.length})</div>
      <div class="gdt-list">
        ${ungroupedDevices.map(e => {
          const d = e.devInfo || {};
          const name = d.no || d.name || String(d.id || '');
          const cls = d.onlineState ? 'is-online' : 'is-offline';
          return `
            <div class="gdt-chip ${cls}" data-devid="${d.id}" title="${escapeHTML(name)}">
              <span class="gdt-icon gdt-icon-device"></span>
              <span class="gdt-title">${escapeHTML(name)}</span>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
  treeEl.innerHTML = treeHTML;

  treeEl.addEventListener('click', (e) => {
    const row = e.target.closest('.gdt-row');
    if (row && treeEl.contains(row)) {
      const nodeEl = row.parentElement;
      const children = nodeEl.querySelector(':scope > .gdt-children');
      const toggle = row.querySelector('.gdt-toggle');
      if (children) {
        const collapsed = children.classList.toggle('is-collapsed');
        if (toggle) toggle.textContent = collapsed ? '▸' : '▾';
      }
      return;
    }
    const devEl = e.target.closest('[data-devid]');
    if (devEl && treeEl.contains(devEl)) {
      const devId = Number(devEl.getAttribute('data-devid'));
      if (!Number.isNaN(devId)) openDeviceOverlay(devId);
    }
  }, { passive: true });
}

/* ------- 地图 (高德) ------- */
function initAMap() {
  if (mapInstance) return; // 已存在
  // 若脚本已加载，直接初始化；否则加载脚本
  if (window.AMap) {
    createMap();
    return;
  }
  const script = document.createElement('script');
  script.src = `https://webapi.amap.com/maps?v=2.0&key=${ENV.AMAP_KEY}`;
  script.onload = () => {
    try { createMap(); } catch (e) { console.error('[Site] AMap init error', e); }
  };
  script.onerror = (e) => {
    console.error('[Site] AMap script load error', e);
  };
  document.head.appendChild(script);
}

function createMap() {
  try {
    // eslint-disable-next-line no-undef
    mapInstance = new AMap.Map('mapContainer', { zoom: 5, center: [105.0, 35.0] });
    mapInited = true;
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
  try {
    if (markersLayer.length) {
      markersLayer.forEach(m => { try { m.setMap(null); } catch {} });
    }
  } catch {}
  markersLayer = [];
  if (mapInstance) {
    try { mapInstance.destroy(); } catch {}
    mapInstance = null;
  }
  mapInited = false;
  const mc = document.getElementById('mapContainer');
  if (mc) mc.innerHTML = '';
}

/* ------- 设备详情浮层 ------- */
function forceCloseOverlay() {
  try {
    const st = siteState.get().overlay || {};
    if (st.open) siteState.set({ overlay: { ...st, open: false } });
  } catch {}
  const root = document.getElementById('overlayRoot');
  if (root) root.innerHTML = '';
}

function openDeviceOverlay(devId) {
  apiDeviceInfo(devId).then(data => {
    const info = data.devInfo;
    siteState.set({
      overlay: {
        open: true,
        devId: info.id,
        selectedStream: 'main',
        selectedModeId: info.modeList?.[0]?.id || null
      }
    });
    renderOverlay(info);
  }).catch(err => {
    console.error('[Site] apiDeviceInfo error', err);
    eventBus.emit('toast:show', { type: 'error', message: '获取设备信息失败' });
  });
}

function renderOverlay(info) {
  const root = document.getElementById('overlayRoot');
  if (!root) return;
  root.innerHTML = `
    <div class="overlay-card">
      <div class="overlay-card__close" id="ovClose">×</div>
      <h3>${info.no} ${info.onlineState ? '<span class="tag tag-green">在线</span>' : '<span class="tag tag-gray">离线</span>'} 
        <span class="battery-badge">${info.battery != null ? info.battery + '%' : ''}</span>
      </h3>
      <div class="ov-section">
        <div>位置：${info.lastLocation ? (info.lastLocation.lat + ',' + info.lastLocation.lng + ' 高度:' + info.lastLocation.height + 'm') : '无定位数据'}</div>
        <div>更新时间：${info.lastLocation ? formatTime(info.lastLocation.time) : ''}  速度：${info.lastLocation ? info.lastLocation.speed + ' km/h' : ''}</div>
      </div>
      <div class="ov-section">
        <label>视频流：
          <select id="ovStreamSel">
            <option value="main">主码流</option>
            <option value="sub">副码流</option>
          </select>
        </label>
        <button class="btn btn-sm" id="btnOpenVideo">打开视频</button>
      </div>
      <div class="ov-section">
        <label>模式：
          <select id="ovModeSel">
            ${(info.modeList||[]).map(m => `<option value="${m.id}">${m.name}</option>`).join('')}
          </select>
        </label>
        <button class="btn btn-sm" id="btnOpenMode">打开模式</button>
      </div>
      <div class="ov-section ov-actions">
        <button class="btn btn-sm" id="btnDetail">详细(占位)</button>
        <button class="btn btn-sm" id="btnRefreshInfo">刷新</button>
      </div>
    </div>
  `;
  root.querySelector('#ovClose').addEventListener('click', () => {
    siteState.set({ overlay: { ...siteState.get().overlay, open: false } });
    root.innerHTML = '';
  });
  root.querySelector('#btnOpenVideo').addEventListener('click', () => {
    const streamType = root.querySelector('#ovStreamSel').value;
    openVideoPreview(info.id, info.no, streamType);
  });
  root.querySelector('#btnOpenMode').addEventListener('click', () => {
    const modeId = root.querySelector('#ovModeSel').value;
    openModePreview(info.id, info.no, modeId, info.modeList);
  });
  root.querySelector('#btnRefreshInfo').addEventListener('click', () => {
    openDeviceOverlay(info.id);
  });
}

/* ------- 预览窗口管理（视频 & 模式） ------- */
function openVideoPreview(devId, devNo, streamType) {
  const key = `video:${devId}:${streamType}`;
  const st = previewState.get();
  if (st.windows.find(w => w.id === key)) {
    eventBus.emit('toast:show', { type: 'info', message: streamType === 'main' ? '该主码流视频已在预览' : '该副码流视频已在预览' });
    return;
  }
  if (st.windows.length >= st.capacity) {
    eventBus.emit('toast:show', { type: 'error', message: `最多同时打开 ${st.capacity} 个预览窗口` });
    return;
  }
  const title = `${devNo} ${streamType === 'main' ? '主码流' : '副码流'}`;
  const order = st.windows.length;

  previewState.set({
    windows: [...st.windows, {
      id: key,
      devId,
      kind: 'video',
      subtype: streamType,
      title,
      status: 'connecting',
      order,
      createdAt: Date.now(),
      player: null,
      streamUrl: streamType === 'main'
        ? 'webrtc://media.szdght.com/1/camera_audio'
        : 'webrtc://media.szdght.com/1/screen'
    }]
  });

  // 延迟等 DOM 渲染完成后开始真正挂载播放器
  setTimeout(async () => {
    const current = previewState.get().windows.find(w => w.id === key);
    if (!current) return;
    // 找到窗口 DOM
    const winEl = document.querySelector(`.preview-win[data-id="${key}"] .pw-body`);
    if (!winEl) return;
    try {
      const { createWebRTCPlayer } = await import('./webrtc/webrtcPlayer.js');
      const player = createWebRTCPlayer({ streamType });
      player.mount(winEl);
      await player.play(current.streamUrl);
      // 更新状态
      const newArr = previewState.get().windows.map(w =>
        w.id === key ? { ...w, status: player.getStatus()==='playing'?'playing':'error', player } : w
      );
      previewState.set({ windows: newArr });
    } catch (e) {
      console.error(e);
      const newArr = previewState.get().windows.map(w =>
        w.id === key ? { ...w, status:'error' } : w
      );
      previewState.set({ windows: newArr });
    }
  }, 50);
}

function closePreviewWindow(id) {
  const st = previewState.get();
  const target = st.windows.find(w => w.id === id);
  if (target?.player) {
    try { target.player.destroy(); } catch(e){}
  }
  let arr = st.windows.filter(w => w.id !== id);
  arr = arr.map((w, idx) => ({ ...w, order: idx }));
  previewState.set({ windows: arr });
}

function openModePreview(devId, devNo, modeId, modeList=[]) {
  const key = `mode:${devId}:${modeId}`;
  const st = previewState.get();
  if (st.windows.find(w => w.id === key)) {
    eventBus.emit('toast:show', { type: 'info', message: '该模式已在预览' });
    return;
  }
  if (st.windows.length >= st.capacity) {
    eventBus.emit('toast:show', { type: 'error', message: `最多同时打开 ${st.capacity} 个预览窗口` });
    return;
  }
  const modeName = modeList.find(m => String(m.id) === String(modeId))?.name || '模式';
  const order = st.windows.length;
  previewState.set({
    windows: [...st.windows, {
      id: key,
      devId, kind: 'mode', subtype: modeId,
      title: `${devNo} ${modeName}`,
      status: 'connecting', order, createdAt: Date.now(),
      metrics: { angle: { x: rand(-1,1), y: rand(-1,1), z: rand(-1,1) }, move: 0.000, battery: randInt(90,100), lastUpdate: Date.now() }
    }]
  });
  setTimeout(() => {
    const now = previewState.get().windows.map(w => w.id === key ? { ...w, status: 'playing' } : w);
    previewState.set({ windows: now });
  }, 500);
}

function renderPreviewBar(pState) {
  const bar = document.getElementById('previewBarInner');
  computePreviewCapacity(); // 每次刷新重新确保容量的一致性
  const { windows } = pState;
  bar.innerHTML = windows
    .sort((a,b) => a.order - b.order)
    .map(w => previewWindowHTML(w))
    .join('');

  bar.querySelectorAll('.preview-win').forEach(win => {
    win.querySelector('.close-btn').addEventListener('click', () => {
      closePreviewWindow(win.getAttribute('data-id'));
    });
    // 拖拽
    enableDrag(win);
  });
}

function previewWindowHTML(w) {
  const statusBadge = w.status === 'connecting' ? '连接中...' :
    (w.status === 'error' ? '错误' : (w.kind === 'mode'
      ? formatModeMetrics(w.metrics)
      : ''));
  return `
    <div class="preview-win" data-id="${w.id}" draggable="true">
      <div class="pw-head">
        <span class="pw-title">${w.title}</span>
        <button class="close-btn" title="关闭">×</button>
      </div>
      <div class="pw-body ${w.kind}">
        ${w.kind === 'video'
          ? (w.status === 'playing'
              ? `<div class="video-placeholder">[视频画面占位 - ${w.subtype==='main'?'主码流':'副码流'}]</div>`
              : `<div class="video-placeholder status">${statusBadge}</div>`
            )
          : (w.status === 'playing'
              ? `<div class="mode-metrics">${statusBadge}</div>`
              : `<div class="mode-metrics status">${statusBadge}</div>`
            )
        }
      </div>
    </div>
  `;
}

function formatModeMetrics(metrics) {
  if (!metrics) return '';
  return `
    <div class="metric-line">角度X：${metrics.angle.x.toFixed(2)}</div>
    <div class="metric-line">角度Y：${metrics.angle.y.toFixed(2)}</div>
    <div class="metric-line">角度Z：${metrics.angle.z.toFixed(2)}</div>
    <div class="metric-line">位移值：${metrics.move.toFixed(3)}</div>
    <div class="metric-line battery-${metrics.battery<=5?'red': metrics.battery<=10?'yellow':'normal'}">
      电量：${metrics.battery}%
    </div>
  `;
}

/* ------- 预览条拖拽交换 ------- */
function enableDrag(winEl) {
  winEl.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', winEl.getAttribute('data-id'));
    winEl.classList.add('dragging');
  });
  winEl.addEventListener('dragend', () => {
    winEl.classList.remove('dragging');
  });
  winEl.addEventListener('dragover', e => {
    e.preventDefault();
  });
  winEl.addEventListener('drop', e => {
    e.preventDefault();
    const fromId = e.dataTransfer.getData('text/plain');
    const toId = winEl.getAttribute('data-id');
    if (fromId === toId) return;
    reorderWindows(fromId, toId);
  });
}

function reorderWindows(fromId, toId) {
  const st = previewState.get();
  const arr = [...st.windows];
  const fromIndex = arr.findIndex(w => w.id === fromId);
  const toIndex = arr.findIndex(w => w.id === toId);
  if (fromIndex < 0 || toIndex < 0) return;
  const item = arr.splice(fromIndex, 1)[0];
  arr.splice(toIndex, 0, item);
  // 重排 order
  const newArr = arr.map((w, idx) => ({ ...w, order: idx }));
  previewState.set({ windows: newArr });
}

/* ------- 模式数据模拟器 ------- */
let modeTimer = null;

function startModeSimulator() {
  if (modeTimer) return;
  modeTimer = setInterval(() => {
    const st = previewState.get();
    let changed = false;
    const newWins = st.windows.map(w => {
      if (w.kind === 'mode' && w.status === 'playing') {
        const m = { ...w.metrics };
        // 漂移
        m.angle.x = clamp(m.angle.x + rand(-0.05,0.05), -5, 5);
        m.angle.y = clamp(m.angle.y + rand(-0.05,0.05), -5, 5);
        m.angle.z = clamp(m.angle.z + rand(-0.05,0.05), -5, 5);
        m.move = Math.max(0, m.move + rand(0.001,0.003));
        // 电量衰减
        if (Date.now() - (m._batteryTick || 0) > 5000) {
          m._batteryTick = Date.now();
          if (m.battery > 0) m.battery -= 1;
        }
        changed = true;
        return { ...w, metrics: m };
      }
      return w;
    });
    if (changed) {
      previewState.set({ windows: newWins });
    }
  }, 200);
}

function stopModeSimulator() {
  if (modeTimer) {
    clearInterval(modeTimer);
    modeTimer = null;
  }
}

/* ------- 渲染函数（summary / notifications） ------- */
function renderSite(s) {
  renderSummary(s.summary);
  renderNotifications(s.notifications);
  if (!s.overlay.open) {
    const or = document.getElementById('overlayRoot');
    if (or) or.innerHTML = '';
  }
}

function renderSummary(sum) {
  const el = document.getElementById('summaryChart');
  if (!el) return;
  el.innerHTML = sum.stateList.map(item => {
    const offline = item.total - item.onlineCount;
    return `
      <div class="summary-item">
        <div class="summary-label">${item.typeName}</div>
        <div class="summary-bars">
          <div class="bar-online" style="flex:${item.onlineCount||0}">${item.onlineCount}</div>
          <div class="bar-offline" style="flex:${offline||0}">${offline}</div>
        </div>
      </div>
    `;
  }).join('');
}

function renderNotifications(list) {
  const el = document.getElementById('notifyList');
  if (!el) return;
  el.innerHTML = list.map(l => {
    const displayName = l.uname || l.uid;
    return `<div class="notify-item">${formatTime(l.time)} ${escapeHTML(String(displayName))} ${l.online ? '上线' : '下线'}</div>`;
  }).join('');
}

/* ------- 工具函数 ------- */
function escapeHTML(str='') {
  return String(str).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
function rand(a,b){return Math.random()*(b-a)+a;}
function randInt(a,b){return Math.floor(Math.random()*(b-a+1))+a;}
function clamp(v,min,max){return v<min?min:v>max?max:v;}
function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = n => n<10?'0'+n:n;
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function debounce(fn,ms=300){
  let t=null;
  return (...args)=>{
    clearTimeout(t);
    t=setTimeout(()=>fn(...args),ms);
  };
}
function throttle(fn,ms=100){
  let t=0, id=null, lastArgs=null;
  return (...args)=>{
    const now=Date.now();
    lastArgs=args;
    if (now - t >= ms) {
      t = now;
      fn(...lastArgs);
    } else if (!id) {
      id = setTimeout(()=>{
        t = Date.now();
        id = null;
        fn(...lastArgs);
      }, ms - (now - t));
    }
  };
}