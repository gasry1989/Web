/**
 * 现场管理主页面：
 * - 地图初始化（高德）
 * - 设备树构建
 * - 过滤 + 刷新 + 统计 + 通知列表
 * - 设备详情浮层 + 预览窗口管理
 * - 模式数据模拟
 */
/* 只演示顶部 import 已改为别名，其余逻辑与之前版本一致 */
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
/* ...其余内容保持原实现... */

let unsubSite;
let unsubPreview;
let mapInited = false;
let mapInstance = null;
let markersLayer = [];

export function mountSitePage() {
  const main = document.getElementById('mainView');
  main.innerHTML = `
    <div class="site-page">
      <div class="site-layout">
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
            <div>
              <label><input type="checkbox" id="fltOnline"/> 仅显示在线</label>
            </div>
            <div>
              <button class="btn btn-sm" id="btnSiteRefresh">刷新</button>
            </div>
          </div>
          <div class="device-tree" id="deviceTree">
            <!-- 树 -->
          </div>
        </div>
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

  return () => {
    unsubSite && unsubSite();
    unsubPreview && unsubPreview();
    stopModeSimulator();
    document.getElementById('previewBar').classList.add('hidden');
  };
}

export function unmountSitePage() {}

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

/* ------- 树构建 (简化版) ------- */
function buildTree() {
  const treeEl = document.getElementById('deviceTree');
  const { groupedDevices, ungroupedDevices, filters } = siteState.get();

  // 构建用户ID -> 子设备数组
  const userMap = new Map();
  groupedDevices.forEach(entry => {
    const ui = entry.userInfo;
    if (!ui) return;
    if (!userMap.has(ui.userId)) userMap.set(ui.userId, { user: ui, devices: [] });
    userMap.get(ui.userId).devices.push(entry.devInfo);
  });

  // 简化：不做多层父子递归，仅平铺（可后续扩展 parentUserId）
  let html = '<div class="tree-section"><div class="tree-title">已分组设备</div>';
  userMap.forEach(v => {
    html += `<div class="tree-user">
      <div class="tree-user-title">${v.user.userName} (${v.devices.length})</div>
      <div class="tree-devices">
        ${v.devices.map(d => `<div class="tree-device" data-devid="${d.id}" title="${d.no}">
          ${d.no} ${d.onlineState ? '<span class="dot dot-green"></span>' : '<span class="dot dot-gray"></span>'}
        </div>`).join('')}
      </div>
    </div>`;
  });
  html += '</div>';

  html += `<div class="tree-section"><div class="tree-title">未分组设备(${ungroupedDevices.length})</div>
    <div class="tree-devices">
      ${ungroupedDevices.map(e => {
        const d = e.devInfo;
        return `<div class="tree-device" data-devid="${d.id}">
          ${d.no} ${d.onlineState ? '<span class="dot dot-green"></span>' : '<span class="dot dot-gray"></span>'}
        </div>`;
      }).join('')}
    </div>
  </div>`;

  treeEl.innerHTML = html;

  treeEl.querySelectorAll('.tree-device').forEach(div => {
    div.addEventListener('click', () => {
      const devId = Number(div.getAttribute('data-devid'));
      openDeviceOverlay(devId);
    });
  });
}

/* ------- 地图 (高德) 初始化简化占位 ------- */
function initAMap() {
  if (mapInited) return;
  // 动态加载高德脚本
  const script = document.createElement('script');
  script.src = `https://webapi.amap.com/maps?v=2.0&key=${ENV.AMAP_KEY}`;
  script.onload = () => {
    mapInstance = new AMap.Map('mapContainer', {
      zoom: 5,
      center: [105.0, 35.0]
    });
    mapInited = true;
    buildMarkers();
  };
  document.head.appendChild(script);
}

function buildMarkers() {
  if (!mapInited) return;
  // 清除旧 marker
  markersLayer.forEach(m => m.setMap(null));
  markersLayer = [];
  const { groupedDevices, ungroupedDevices } = siteState.get();
  const all = [...groupedDevices, ...ungroupedDevices];
  all.forEach(e => {
    const d = e.devInfo;
    if (!d.lastLocation || d.lastLocation.lng == null || d.lastLocation.lat == null) return;
    const marker = new AMap.Marker({
      position: [d.lastLocation.lng, d.lastLocation.lat],
      title: d.no
    });
    marker.on('click', () => openDeviceOverlay(d.id));
    marker.setMap(mapInstance);
    markersLayer.push(marker);
  });
}

/* ------- 设备详情浮层 (简化) ------- */
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
  });
}

function renderOverlay(info) {
  const root = document.getElementById('overlayRoot');
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
      player: null,     // 挂载播放实例
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
  const { capacity, windows } = pState;
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


// 拖拽交换
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
    document.getElementById('overlayRoot').innerHTML = '';
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
  el.innerHTML = list.map(l => `<div class="notify-item">${formatTime(l.time)} ${l.uid} ${l.online ? '上线' : '下线'}</div>`).join('');
}

/* ------- 工具函数 ------- */
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