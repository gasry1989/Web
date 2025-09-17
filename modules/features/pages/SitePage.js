/**
 * SitePage（装配）
 * 要点：
 * - 树状栏设备点击兼容多事件名（deviceclick/deviceClick/devclick/dev:click），失败兜底也能弹出信息窗
 * - 网格标题/内容点击：标题=设备详情；内容=模式/视频详情（enableGridClickOpen）
 * - 标题栏拖拽重排（插入式）并在短时间内抑制误触点击；标题按下（左键）才显示“移动”光标
 * - Overlay（iframe 全屏）打开 5 个详情页（设备/视频/三种模式）
 * - 去除可选链/空 catch 等可能触发解析错误的语法
 */
import { createTreePanel } from './components/TreePanel.js';
import { createVideoPreview } from './modes/VideoPreview.js';
import { createModePreview } from './modes/ModePreview.js'; // 兜底
import { createModeTilt } from './modes/ModeTilt.js';
import { createModeDispTilt } from './modes/ModeDispTilt.js';
import { createModeAudio } from './modes/ModeAudio.js';
import { createMapView } from './components/MapView.js';
import { ENV } from '/config/env.js';
import { siteState } from '@state/siteState.js';
import { wsHub } from '@core/hub.js';

import {
  apiDevTypes, apiDevModes, apiGroupedDevices, apiUngroupedDevices,
  apiDeviceSummary, apiOnlineList, apiDeviceInfo
} from '@api/deviceApi.js';
import { eventBus } from '@core/eventBus.js';
import { importTemplate } from '@ui/templateLoader.js';

const KEY_TREE_COLLAPSED = 'ui.sitepage.tree.collapsed';

// 本地模拟喂数（默认开启，可用 URL ?mock=0 关闭）
const urlParams = new URLSearchParams(location.search);
const ENABLE_MODE_MOCK = urlParams.get('mock') != null ? urlParams.get('mock') === '1' : true;
const MOCK_INTERVAL_MS = 300;

let rootEl = null;
let tree = null;
let mapView = null;

// 网格 6 格（带 devNo 以便详情用）
const mediaSlots = Array.from({ length: 6 }, function(_, i){ return { idx:i, type:null, inst:null, devId:null, devNo:null, modeId:null }; });

// MOCK 状态
const mockState = new Map();
let mockTimer = null;

function MODE_NAME(mid){
  switch(Number(mid)){
    case 1: return '倾角模式';
    case 2: return '位移·倾角模式';
    case 3: return '音频模式';
    default: return '模式';
  }
}

export function mountSitePage() {
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';

  const main = document.getElementById('mainView');
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

  importTemplate('/modules/features/pages/site-page.html', 'tpl-site-page')
    .then(async function (frag) {
      main.appendChild(frag);
      rootEl = main.querySelector('#spRoot');

      const leftWrap = rootEl.querySelector('#spLeft');
      const splitter = rootEl.querySelector('#spSplitter');
      const mapMount = rootEl.querySelector('#spMapMount');
      const statusPanel = rootEl.querySelector('.sp-status');
      const notifyPanel = rootEl.querySelector('.sp-notify');
      const grid = rootEl.querySelector('#mediaGrid');
      const treeToggleBtn = rootEl.querySelector('#spTreeToggle');
      const treeHandleBtn = rootEl.querySelector('#spTreeHandle');

      // 左树
      tree = createTreePanel();
      leftWrap.appendChild(tree);

      try { if (tree.whenReady) await tree.whenReady(); } catch (e) {}

      // 折叠状态
      const initCollapsed = loadCollapsed();
      applyLeftCollapsed(initCollapsed);

      treeToggleBtn.addEventListener('click', function () {
        const next = !leftWrap.classList.contains('collapsed');
        applyLeftCollapsed(next);
        saveCollapsed(next);
        try { mapView.resize(); } catch (e) {}
      });
      treeHandleBtn.addEventListener('click', function () {
        applyLeftCollapsed(false);
        saveCollapsed(false);
        try { mapView.resize(); } catch (e) {}
      });

      // 监听树筛选变化（防抖）
      const onTreeFiltersChange = debounce(function () { reloadByFilters(); }, 250);
      ['filtersChange','filterchange','filterschange','filters:change'].forEach(function(evt){
        try { tree.addEventListener(evt, onTreeFiltersChange); } catch (e) {}
      });
      leftWrap.addEventListener('input', onTreeFiltersChange, true);
      leftWrap.addEventListener('change', onTreeFiltersChange, true);

      // 地图
      mapView = createMapView({
        amapKey: (ENV && ENV.AMAP_KEY) || (window.__AMAP_KEY || ''),
        debug: true
      });
      mapMount.appendChild(mapView);
      mapView.mount();

      // 打开视频/模式/刷新/标注点击/详情
      mapView.addEventListener('openVideo', function(e){ openVideoInSlot(e.detail.devId, e.detail.devNo); });
      mapView.addEventListener('openMode',  function(e){ openModeInSlot(e.detail.devId, e.detail.devNo, e.detail.modeId); });
      mapView.addEventListener('refreshDevice', async function(e){
        try{
          const data = await apiDeviceInfo(e.detail.devId);
          mapView.openDevice({ devInfo:data.devInfo, followCenterWhenNoLocation:true });
        }catch(err){
          console.warn('[Site] refreshDevice api error, keep window, id=', e.detail.devId, err);
        }
      });
      mapView.addEventListener('markerClick', async function(e){
        try {
          const data = await apiDeviceInfo(e.detail.devId);
          mapView.openDevice({ devInfo: data.devInfo, followCenterWhenNoLocation: true });
        } catch (err) {
          console.warn('[Site] markerClick api error, fallback openDevice', err);
          mapView.openDevice({ devInfo: { id: e.detail.devId, devNo: e.detail.devNo }, followCenterWhenNoLocation: true });
        }
      });
      mapView.addEventListener('openDetail', function(e){ openDeviceDetailOverlay(e.detail.devId, e.detail.devNo); });

      // 树点击 -> 信息窗（兼容多事件名 + 兜底 + 调试日志）
      bindTreeDeviceClick(tree);

      // 媒体关闭
      grid.addEventListener('click', function (ev){
        const btn = ev.target.closest('[data-close]');
        if(!btn) return;
        const idx = Number(btn.getAttribute('data-close'));
        closeSlot(idx);
      });

      // 分隔条
      initSplitter(leftWrap, splitter, function(){ try{ mapView.resize(); }catch(e){} });

      // 初始化网格状态
      for (let i=0;i<mediaSlots.length;i++) {
        mediaSlots[i].type = null; mediaSlots[i].inst = null; mediaSlots[i].devId=null; mediaSlots[i].devNo=null; mediaSlots[i].modeId=null;
        const body = document.getElementById('mediaBody'+i);
        if (body) body.setAttribute('data-free','1');
      }

      // 启用：标题栏拖拽 -> 插入式重排（带点击抑制）
      enableGridDragReorder(grid);
      // 新增：点击打开详情（标题=设备；内容=模式/视频），并统一 hover 手型
      enableGridClickOpen(grid);

      // 首屏数据
      bootstrapData(statusPanel.querySelector('#summaryChart'), notifyPanel.querySelector('#notifyList'));

      // 路由：外部 WS/Mock 都调用它
      window.pushModeData = function pushModeData(payload) {
        try {
          const devId = payload && payload.devId;
          const modeId = payload && payload.modeId;
          const data = payload && payload.data;
          const s = mediaSlots.find(function(x){ return x.type==='mode' && String(x.devId)===String(devId) && Number(x.modeId)===Number(modeId); });
          if (!s || !s.inst || typeof s.inst.setData!=='function') return;
          s.inst.setData(data);
        } catch (e) {
          console.warn('[Site] pushModeData error', e);
        }
      };
      console.info('[Site] window.pushModeData ready: pushModeData({devId, modeId, data})');

      if (ENABLE_MODE_MOCK) startMockFeeder();
    })
    .catch(function (err) { console.error('[SitePage] template load failed', err); });
}

export function unmountSitePage() {
  stopMockFeeder();
  try{ if (mapView && typeof mapView.destroy === 'function') mapView.destroy(); }catch(e){}
  mapView=null;
  if (rootEl){ try{ rootEl.remove(); }catch(e){} rootEl=null; }
}

/* ---------------- 左侧树折叠 ---------------- */
function applyLeftCollapsed(flag){
  const leftWrap = document.getElementById('spLeft');
  const root = document.getElementById('spRoot');
  const toggle = document.getElementById('spTreeToggle');
  const handle = document.getElementById('spTreeHandle');
  if (!leftWrap || !toggle || !root || !handle) return;

  if (flag) {
    if (!leftWrap.dataset.prevW) {
      const w = leftWrap.getBoundingClientRect().width;
      if (w > 0) leftWrap.dataset.prevW = w + 'px';
    }
    leftWrap.classList.add('collapsed');
    root.classList.add('left-collapsed');
    toggle.textContent = '»'; toggle.title = '展开树状栏';
    handle.textContent = '»'; handle.title = '展开树状栏';
  } else {
    leftWrap.classList.remove('collapsed');
    root.classList.remove('left-collapsed');
    toggle.textContent = '«'; toggle.title = '折叠树状栏';
    handle.textContent = '«'; handle.title = '折叠树状栏';
    leftWrap.style.width = leftWrap.dataset.prevW || '320px';
  }
}
function loadCollapsed(){ try{ return localStorage.getItem(KEY_TREE_COLLAPSED) === '1'; } catch (e) { return false; } }
function saveCollapsed(v){ try{ localStorage.setItem(KEY_TREE_COLLAPSED, v?'1':'0'); } catch (e) {} }

/* ---------------- 数据装配（同步 filters 到 siteState） ---------------- */
async function bootstrapData(summaryEl, notifyEl) {
  // 1) 并发请求基础数据，但不因单个失败而中断
  const [typesRes, modesRes, onlineRes, summaryRes] = await Promise.allSettled([
    apiDevTypes(),
    apiDevModes(),
    apiOnlineList(),
    apiDeviceSummary()
  ]);

  if (typesRes.status !== 'fulfilled') console.warn('[Site][bootstrap] apiDevTypes failed:', typesRes.reason && (typesRes.reason.message || typesRes.reason));
  if (modesRes.status !== 'fulfilled') console.warn('[Site][bootstrap] apiDevModes failed:', modesRes.reason && (modesRes.reason.message || modesRes.reason));
  if (onlineRes.status !== 'fulfilled') console.warn('[Site][bootstrap] apiOnlineList failed:', onlineRes.reason && (onlineRes.reason.message || onlineRes.reason));
  if (summaryRes.status !== 'fulfilled') console.warn('[Site][bootstrap] apiDeviceSummary failed:', summaryRes.reason && (summaryRes.reason.message || summaryRes.reason));

  const types   = typesRes.status   === 'fulfilled' ? (typesRes.value || {})   : {};
  const modes   = modesRes.status   === 'fulfilled' ? (modesRes.value || {})   : {};
  const online  = onlineRes.status  === 'fulfilled' ? (onlineRes.value || {})  : { list: [] };
  const summary = summaryRes.status === 'fulfilled' ? (summaryRes.value || {}) : { stateList: [] };

  // 2) 同步当前筛选条件
  let filters = {};
  try { filters = getFiltersFromTree(); siteState.set({ filters: filters }); } catch (e) { console.warn('[Site][bootstrap] read/set filters failed', e); }

  // 3) 拉取树数据（同样容错）
  const [groupedRes, ungroupedRes] = await Promise.allSettled([
    apiGroupedDevices(filters),
    apiUngroupedDevices(filters)
  ]);
  if (groupedRes.status !== 'fulfilled') console.warn('[Site][bootstrap] apiGroupedDevices failed:', groupedRes.reason && (groupedRes.reason.message || groupedRes.reason));
  if (ungroupedRes.status !== 'fulfilled') console.warn('[Site][bootstrap] apiUngroupedDevices failed:', ungroupedRes.reason && (ungroupedRes.reason.message || ungroupedRes.reason));

  const grouped   = groupedRes.status   === 'fulfilled' ? (groupedRes.value || { devList: [] })   : { devList: [] };
  const ungrouped = ungroupedRes.status === 'fulfilled' ? (ungroupedRes.value || { devList: [] }) : { devList: [] };

  // 4) 渲染树与地图（尽力而为）
  try {
    tree.setData({
      groupedDevices: grouped.devList || [],
      ungroupedDevices: ungrouped.devList || [],
      expandLevel: 2,
      devTypes: (types.devTypeList || []),
      devModes: (modes.devModeList || [])
    });
  } catch (e) { console.warn('[Site][bootstrap] tree.setData failed', e); }

  try {
    const all = [].concat(grouped.devList || [], ungrouped.devList || []);
    mapView.setMarkers(all);
  } catch (e) { console.warn('[Site][bootstrap] mapView.setMarkers failed', e); }

  // 5) 摘要与通知
  try { renderSummary(summaryEl, summary); } catch (e) { console.warn('[Site][bootstrap] renderSummary failed', e); }
  try { renderNotify(notifyEl, (online.list || []).slice(0,50)); } catch (e) { console.warn('[Site][bootstrap] renderNotify failed', e); }
}

// 根据当前树筛选刷新树与地图
async function reloadByFilters() {
  // 1) 取筛选条件（容错）
  let filters = {};
  try { filters = getFiltersFromTree(); siteState.set({ filters: filters }); } catch (e) { console.warn('[Site][reload] read/set filters failed', e); }

  // 2) 拉取数据（容错、不阻断）
  const [groupedRes, ungroupedRes] = await Promise.allSettled([
    apiGroupedDevices(filters),
    apiUngroupedDevices(filters)
  ]);
  if (groupedRes.status !== 'fulfilled') console.warn('[Site][reload] apiGroupedDevices failed:', groupedRes.reason && (groupedRes.reason.message || groupedRes.reason));
  if (ungroupedRes.status !== 'fulfilled') console.warn('[Site][reload] apiUngroupedDevices failed:', ungroupedRes.reason && (ungroupedRes.reason.message || ungroupedRes.reason));

  const grouped   = groupedRes.status   === 'fulfilled' ? (groupedRes.value || { devList: [] })   : { devList: [] };
  const ungrouped = ungroupedRes.status === 'fulfilled' ? (ungroupedRes.value || { devList: [] }) : { devList: [] };

  // 3) 渲染树与地图（尽力而为）
  try {
    tree.setData({
      groupedDevices: grouped.devList || [],
      ungroupedDevices: ungrouped.devList || [],
      expandLevel: 2
    });
  } catch (e) { console.warn('[Site][reload] tree.setData failed', e); }

  try {
    const all = [].concat(grouped.devList || [], ungrouped.devList || []);
    mapView.setMarkers(all);
  } catch (e) { console.warn('[Site][reload] mapView.setMarkers failed', e); }
}

function renderSummary(el, summary) {
  const list = (summary && summary.stateList) || [];
  el.innerHTML = list.map(function(item){
    const offline = item.total - item.onlineCount;
    return '<div style="margin:6px 0;">'
      + '<div style="font-size:12px;margin-bottom:4px;">' + escapeHTML(item.typeName || '') + '</div>'
      + '<div style="display:flex;gap:4px;height:16px;">'
      +   '<div style="flex:'+(item.onlineCount||0)+';background:#3d89ff;color:#fff;text-align:center;font-size:11px;line-height:16px;border-radius:3px;">'+(item.onlineCount||0)+'</div>'
      +   '<div style="flex:'+(offline||0)+';background:#324153;color:#dde;text-align:center;font-size:11px;line-height:16px;border-radius:3px;">'+(offline||0)+'</div>'
      + '</div>'
      + '</div>';
  }).join('');
}
function renderNotify(el, list) {
  el.innerHTML = (list || []).map(function(l){
    const name = l.uname || l.uid;
    return '<div style="padding:4px 0;border-bottom:1px dashed rgba(255,255,255,.06);font-size:12px;">'
      + fmt(l.time) + ' ' + escapeHTML(String(name)) + ' ' + (l.online ? '上线' : '下线') + '</div>';
  }).join('');
}

/* ---------------- 分隔条拖拽 ---------------- */
function initSplitter(leftWrap, splitter, onDrag) {
  const MIN = 240, MAXVW = 50;
  splitter.addEventListener('mousedown', function (e) {
    if (leftWrap.classList.contains('collapsed')) return; // 折叠时不允许拖拽
    const layoutRect = rootEl.getBoundingClientRect();
    const maxPx = Math.floor(window.innerWidth * (MAXVW / 100));
    const glass = document.createElement('div');
    Object.assign(glass.style, {
      position:'fixed', inset:'0', cursor:'col-resize', zIndex:'2147483646',
      background:'transparent', userSelect:'none'
    });
    document.body.appendChild(glass);

    const move = function (ev) {
      const x = (ev.clientX || 0) - layoutRect.left;
      const w = Math.max(MIN, Math.min(Math.round(x), maxPx));
      leftWrap.style.width = w + 'px';
      if (onDrag) onDrag();
      ev.preventDefault();
    };
    const end = function () {
      try { glass.remove(); } catch (e) {}
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', end);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('blur', end);
      document.removeEventListener('visibilitychange', end);
      requestAnimationFrame(function(){ if (onDrag) onDrag(); });
      setTimeout(function(){ if (onDrag) onDrag(); }, 100);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end, { once:true });
    window.addEventListener('pointerup', end, { once:true });
    window.addEventListener('blur', end, { once:true });
    document.addEventListener('visibilitychange', end, { once:true });
    e.preventDefault();
  });
}

/* ---------------- 媒体窗口 ---------------- */
function findFreeSlot() {
  // 按“当前可视顺序”（DOM 顺序）从左到右寻找空位
  const grid = document.getElementById('mediaGrid');
  if (!grid) return -1;
  const orderedCells = Array.from(grid.children);
  for (let i=0;i<orderedCells.length;i++) {
    const cell = orderedCells[i];
    const idx = Number(cell.getAttribute('data-idx'));
    const body = document.getElementById('mediaBody'+idx);
    const isFreeDom = body && body.getAttribute('data-free') !== '0';
    if (!mediaSlots[idx].type && isFreeDom) return idx;
  }
  return -1;
}
function isModeOpened(devId, modeId){
  for (let i=0;i<mediaSlots.length;i++){
    const s = mediaSlots[i];
    if (s.type==='mode' && String(s.devId)===String(devId) && Number(s.modeId)===Number(modeId)) return true;
  }
  return false;
}
async function openVideoInSlot(devId, devNo) {
  const idx = findFreeSlot();
  if (idx === -1) { eventBus.emit('toast:show', { type:'error', message:'没有可用窗口' }); return; }
  const body = document.getElementById('mediaBody'+idx);
  const title = document.getElementById('mediaTitle'+idx);
  const vp = createVideoPreview({ objectFit:'fill' });

  // 视频容器本身的合成优化
  try {
    vp.style.willChange = 'transform';
    vp.style.transform = 'translateZ(0)';
    vp.style.backfaceVisibility = 'hidden';
    if (vp && vp.setAttribute) vp.setAttribute('tabindex', '-1');
  } catch (e) {}

  body.innerHTML = '';
  body.appendChild(vp);

  // 兜底：画面和内容元素始终显示手型（覆盖播放器默认样式）
  body.style.cursor = 'pointer';
  try { vp.style.cursor = 'pointer'; } catch (e) {}

  body.setAttribute('data-free','0');
  title.textContent = (devNo || '') + ' 视频';
  mediaSlots[idx].type = 'video'; mediaSlots[idx].inst = vp; mediaSlots[idx].devId = devId; mediaSlots[idx].devNo = devNo; mediaSlots[idx].modeId=null;

  try { await vp.play('webrtc://media.szdght.com/1/camera_audio'); }
  catch (e) {
    eventBus.emit('toast:show', { type:'error', message:'拉流失败' });
    closeSlot(idx);
  }
}
function openModeInSlot(devId, devNo, modeId) {
  const mid = Number(modeId);

  // 同设备同模式只能打开一次
  if (isModeOpened(devId, mid)) {
    const msg = (devNo ? devNo + ' ' : '') + MODE_NAME(mid) + '已打开';
    eventBus.emit('toast:show', { type:'info', message: msg });
    return;
  }

  const idx = findFreeSlot();
  if (idx === -1) { eventBus.emit('toast:show', { type:'error', message:'没有可用窗口' }); return; }
  const body = document.getElementById('mediaBody'+idx);
  const title = document.getElementById('mediaTitle'+idx);

  let mp = null;
  if (mid === 1) mp = createModeTilt({ devId: devId });
  else if (mid === 2) mp = createModeDispTilt({ devId: devId });
  else if (mid === 3) mp = createModeAudio({ devId: devId });
  else {
    console.warn('[Site] unknown modeId:', modeId, 'use ModePreview fallback');
    mp = createModePreview({ modeId: mid, devId: devId });
  }

  body.innerHTML = '';
  body.appendChild(mp.el);

  // 兜底：画面和内容元素始终显示手型（覆盖 Web Component/Shadow DOM 宿主默认样式）
  body.style.cursor = 'pointer';
  try { if (mp.el) mp.el.style.cursor = 'pointer'; } catch (e) {}

  body.setAttribute('data-free','0');
  title.textContent = (devNo || '') + ' ' + MODE_NAME(mid);
  mediaSlots[idx].type = 'mode'; mediaSlots[idx].inst = mp; mediaSlots[idx].devId = devId; mediaSlots[idx].devNo = devNo; mediaSlots[idx].modeId = mid;

  try { if (mp.start) mp.start(); } catch (e) {}
}
function closeSlot(idx) {
  const s = mediaSlots[idx]; if (!s) return;
  try { if (s.inst && s.inst.destroy) s.inst.destroy(); } catch (e) {}
  s.inst=null; s.type=null; s.devId=null; s.devNo=null; s.modeId=null;
  const body = document.getElementById('mediaBody'+idx);
  const title = document.getElementById('mediaTitle'+idx);
  if (body) {
    body.innerHTML = '<div style="color:#567;font-size:12px;">在此显示视频流或模式</div>';
    body.setAttribute('data-free','1');
    body.style.cursor = '';
  }
  if (title) title.textContent = '空闲';
}

/* ---------------- MOCK：300ms 本地演示（设备数量可变） ---------------- */
function startMockFeeder(){
  stopMockFeeder();
  console.info('[MOCK] enabled, interval=', MOCK_INTERVAL_MS, 'ms');
  mockTimer = setInterval(function(){
    mediaSlots.forEach(function(s){
      if (s.type!=='mode' || s.devId==null || s.modeId==null) return;
      const resp = genMockResponse(s.devId, s.modeId);
      try { if (window.pushModeData) window.pushModeData({ devId: s.devId, modeId: s.modeId, data: resp }); } catch(e){ console.warn('[MOCK] push error', e); }
    });
  }, MOCK_INTERVAL_MS);
}
function stopMockFeeder(){ try{ if (mockTimer) clearInterval(mockTimer); }catch(e){} mockTimer=null; }

// ---- MOCK helpers（定义一份，避免重复声明）----
function getKey(devId, modeId){ return String(devId)+'|'+String(modeId); }
function ensureState(devId, modeId, init){
  const k=getKey(devId, modeId);
  if(!mockState.has(k)) mockState.set(k, init());
  return mockState.get(k);
}
function clamp(v,min,max){ return v<min?min:(v>max?max:v); }
function step(v,amp,min,max){ return clamp(v + (Math.random()*2-1)*amp, min, max); }
function prob(p){ return Math.random() < p; }
function rnd(a,b){ return Math.random()*(b-a)+a; }
function genMockResponse(devId, modeId){
  const mid = Number(modeId);

  // 倾角
  if (mid===1){
    const st = ensureState(devId, mid, function(){ return { items: [] }; });
    if (!st.items || prob(0.10)) {
      const n = Math.floor(rnd(0,13));
      st.items = Array.from({length:n}, function(_,i){
        return {
          name:'倾角'+(i+1)+'#',
          deg: rnd(0,1.2),
          batt: rnd(60,100),
          alarmOn: Math.random()>.2,
          sirenOn: Math.random()>.2
        };
      });
    }
    st.items.forEach(function(it){ it.deg = step(it.deg, 0.12, 0, 1.5); });
    return { items: st.items.slice(0,12).map(function(x){ return Object.assign({}, x); }) };
  }

  // 位移·倾角
  if (mid===2){
    const st = ensureState(devId, mid, function(){ return { list: [] }; });
    if (!st.list || prob(0.10)) {
      const total = Math.floor(rnd(0,13));
      const nDisp = total > 0 ? Math.floor(rnd(0, total+1)) : 0;
      const nTilt = total - nDisp;
      const list = [];
      for (let i=0;i<nDisp;i++) list.push({ type:'位移', badge: Math.floor(rnd(10,99)), batt: rnd(60,100), sirenOn: Math.random()>.3, value: rnd(0,0.012) });
      for (let i=0;i<nTilt;i++) list.push({ type:'倾角', badge: Math.floor(rnd(60,99)), batt: rnd(60,100), sirenOn: Math.random()>.3, valueDeg: rnd(0,0.30) });
      st.list = list;
    }
    st.list.forEach(function(it){
      if (it.type==='位移') it.value = step(it.value, 0.002, 0, 0.012);
      else it.valueDeg = step(it.valueDeg, 0.03, 0, 0.30);
    });
    return {
      items: st.list.slice(0,12).map(function(it){
        return it.type==='位移'
          ? { type:'位移', badge: it.badge, batt: it.batt, sirenOn: it.sirenOn, valueText: it.value.toFixed(3)+'m' }
          : { type:'倾角', badge: it.badge, batt: it.batt, sirenOn: it.sirenOn, valueText: it.valueDeg.toFixed(2)+'°' };
      })
    };
  }

  // 音频
  const st = ensureState(devId, 3, function(){ return { labels:[], values:[], batteries:[] }; });
  if (!st.values || prob(0.10)) {
    const n = Math.floor(rnd(0,13));
    st.values = Array.from({length:n}, function(){ return rnd(0,100); });
    st.batteries = Array.from({length:n}, function(){ return rnd(40,100); });
    st.labels = Array.from({length:n}, function(_,i){ return i+1; });
  }
  for (let i=0;i<st.values.length;i++){
    st.values[i] = Math.max(0, Math.min(100, st.values[i] + (Math.random()*2-1)*8));
    if (prob(0.05)) st.batteries[i] = Math.max(0, Math.min(100, st.batteries[i] + (Math.random()*2-1)*3));
  }
  return { labels: st.labels.slice(0,12), values: st.values.slice(0,12), batteries: st.batteries.slice(0,12) };
}

/* ---------------- 拖拽重排（插入式）+ 点击抑制 + 标题按下才显示“移动”光标 ---------------- */
function enableGridDragReorder(grid) {
  if (!grid) return;

  // 让标题栏可拖，关闭按钮不参与拖拽
  Array.from(grid.querySelectorAll('.sp-cell-hd')).forEach(function(hd){
    hd.setAttribute('draggable', 'true');
    const btn = hd.querySelector('[data-close]');
    if (btn) {
      btn.setAttribute('draggable', 'false');
      btn.addEventListener('dragstart', function(e){ e.stopPropagation(); });
      btn.addEventListener('mousedown', function(e){ e.stopPropagation(); });
    }
  });

  let dragSrcCell = null;
  let dragOverCell = null;
  let headerDragging = false;
  let suppressHeaderClickUntil = 0;

  // 标题按下（仅左键）才显示“移动”光标；松开或拖拽结束恢复
  const showMoveCursor = function (on) {
    const v = on ? 'move' : '';
    try { document.documentElement.style.cursor = v; } catch (e) {}
    try { document.body.style.cursor = v; } catch (e) {}
  };
  const releaseMoveCursor = function () { showMoveCursor(false); };

  // 仅对标题栏 mousedown 切换为 move（内容区不要切换）
  grid.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return; // 只处理左键
    const hd = e.target.closest('.sp-cell-hd');
    if (!hd) return;
    if (e.target.closest('[data-close]')) return;
    showMoveCursor(true);
  }, true);
  window.addEventListener('mouseup', releaseMoveCursor, true);

  grid.addEventListener('dragstart', function (e) {
    const hd = e.target.closest('.sp-cell-hd');
    if (!hd || e.target.closest('[data-close]')) { if (e.preventDefault) e.preventDefault(); return; }
    dragSrcCell = hd.closest('.sp-cell');
    if (!dragSrcCell) return;
    try { e.dataTransfer.setData('text/plain', dragSrcCell.getAttribute('data-idx') || ''); } catch (ex) {}
    e.dataTransfer.effectAllowed = 'move';
    dragSrcCell.classList.add('dragging');
    headerDragging = true;
    showMoveCursor(true);
  });

  grid.addEventListener('dragend', function () {
    if (dragSrcCell) dragSrcCell.classList.remove('dragging');
    if (dragOverCell) dragOverCell.classList.remove('drag-target');
    dragSrcCell = null; dragOverCell = null;
    headerDragging = false;
    suppressHeaderClickUntil = performance.now() + 180; // 刚拖完抑制误触
    releaseMoveCursor();
  });

  grid.addEventListener('dragover', function (e) {
    if (!dragSrcCell) return;
    e.preventDefault(); // 必须，drop 才会触发
    e.dataTransfer.dropEffect = 'move';

    const cell = e.target.closest('.sp-cell');
    if (!cell || cell === dragSrcCell) {
      if (dragOverCell) dragOverCell.classList.remove('drag-target');
      dragOverCell = null;
      return;
    }
    if (dragOverCell !== cell) {
      if (dragOverCell) dragOverCell.classList.remove('drag-target');
      dragOverCell = cell;
      dragOverCell.classList.add('drag-target');
    }
  });

  grid.addEventListener('drop', function (e) {
    if (!dragSrcCell) return;
    e.preventDefault();

    const targetCell = e.target.closest('.sp-cell');
    if (!targetCell || targetCell === dragSrcCell) return;

    // 根据鼠标在目标单元的左右半区决定插入到“前面”还是“后面”
    const rect = targetCell.getBoundingClientRect();
    const insertAfter = (e.clientX > rect.left + rect.width / 2);

    const parent = grid;
    if (insertAfter) {
      const ref = targetCell.nextElementSibling;
      parent.insertBefore(dragSrcCell, ref); // ref 为 null 时等同 append 到末尾
    } else {
      parent.insertBefore(dragSrcCell, targetCell);
    }

    dragSrcCell.classList.remove('dragging');
    if (dragOverCell) dragOverCell.classList.remove('drag-target');
    dragSrcCell = null; dragOverCell = null;
    headerDragging = false;
    suppressHeaderClickUntil = performance.now() + 180;
    releaseMoveCursor();
  });

  // 提供给点击逻辑使用：刚拖完 180ms 内忽略标题点击
  grid.__wasHeaderDraggedRecently__ = function () { return headerDragging || performance.now() < suppressHeaderClickUntil; };
}

/* ---------------- 点击打开详情（标题=设备；画面=模式/视频） + 标题/内容 hover 手型 ---------------- */
function enableGridClickOpen(grid) {
  if (!grid) return;

  // 用 mouseover/mouseout 代理（可冒泡）
  grid.addEventListener('mouseover', function (e) {
    const hd = e.target.closest('.sp-cell-hd');
    if (hd) { hd.style.cursor = 'pointer'; return; }
    const body = e.target.closest('.sp-cell-bd');
    if (body) { body.style.cursor = 'pointer'; }
  }, true);

  grid.addEventListener('mouseout', function (e) {
    const hd = e.target.closest('.sp-cell-hd');
    if (hd) { hd.style.cursor = ''; }
    const body = e.target.closest('.sp-cell-bd');
    if (body) { body.style.cursor = ''; }
  }, true);

  // 标题栏 -> 打开设备详情
  grid.addEventListener('click', function (e) {
    const hd = e.target.closest('.sp-cell-hd');
    if (!hd) return;
    // 刚拖完 180ms 内忽略点击
    if (typeof grid.__wasHeaderDraggedRecently__ === 'function' && grid.__wasHeaderDraggedRecently__()) return;
    if (e.target.closest('[data-close]')) return;
    const cell = hd.closest('.sp-cell'); if (!cell) return;
    const idx = Number(cell.getAttribute('data-idx'));
    const slot = mediaSlots[idx];
    if (!slot || !slot.devId) return;
    openDeviceDetailOverlay(slot.devId, slot.devNo);
  }, true);

  // 内容区 -> 打开模式/视频详情
  grid.addEventListener('click', function (e) {
    const body = e.target.closest('.sp-cell-bd');
    if (!body) return;
    const cell = body.closest('.sp-cell'); if (!cell) return;
    const idx = Number(cell.getAttribute('data-idx'));
    const slot = mediaSlots[idx];
    if (!slot) return;

    if (slot.type === 'mode' && slot.devId && slot.modeId) {
      openModeDetailOverlay(slot.devId, slot.devNo, slot.modeId);
    } else if (slot.type === 'video' && slot.devId) {
      openVideoDetailOverlay(slot.devId, slot.devNo);
    }
  }, true);
}

/* ---------------- Overlay（iframe 全屏） ---------------- */
let __overlay = null;
function ensureOverlay() {
  if (__overlay && document.body.contains(__overlay.host)) return __overlay;

  const host = document.createElement('div');
  Object.assign(host.style, { position:'fixed', inset:'0', background:'#000', zIndex:'2147483645', display:'none' });

  const iframe = document.createElement('iframe');
  Object.assign(iframe.style, { position:'absolute', inset:'0', width:'100%', height:'100%', border:'0', background:'#000' });
  host.appendChild(iframe);
  document.body.appendChild(host);

  // 新增：为每个“子页通道”维护订阅（ch -> unbind），以及 key（便于调试）
  const chUnsub = new Map(); // ch -> () => void
  const chKey = new Map();   // ch -> { kind, devId, modeId }

  const onMsg = function (e) {
    const msg = e.data || {};
    if (!msg || !msg.__detail) return;

    switch (msg.t) {
      case 'ready': {
        // 子页 ready -> 下发 init
        try {
          const payload = Object.assign({ t:'init' }, (__overlay.initParams || {}));
          iframe.contentWindow?.postMessage(Object.assign({ __detail:true }, payload), '*');
        } catch (err) {
          console.warn('[Overlay] send init failed', err);
        }
        return;
      }

      case 'back':
        closeOverlay();
        return;

      case 'openMode':
        openModeDetailOverlay(msg.devId, msg.devNo, msg.modeId);
        return;

      // ========= detailBridge 的 WS 桥接：BEGIN =========
      case 'ws:open': {
        // 生成一个通道 id（仅用于在父页区分同一个 iframe 内的不同通道）
        const ch = Date.now() + Math.floor(Math.random() * 1000);
        chKey.set(ch, { kind: msg.kind, devId: msg.devId, modeId: msg.modeId });

        // 建立匹配订阅：按 to.id / modeId 分发回这个 iframe
        const filter = {};
        if (msg.devId != null) filter['to.id'] = String(msg.devId);
        if (msg.modeId != null) filter['modeId'] = String(msg.modeId);

        const unbind = wsHub.onMatch(filter, (m) => {
          try {
            iframe.contentWindow?.postMessage({ __detail:true, t:'ws:message', ch, data: m }, '*');
          } catch (err) {
            console.warn('[Overlay] forward ws message failed', err);
          }
        });
        chUnsub.set(ch, unbind);

        // 回 OK + 通道 id
        try {
          iframe.contentWindow?.postMessage({ __detail:true, t:'ws:open:ok', reqId: msg.reqId, ch }, '*');
        } catch (err) {
          console.warn('[Overlay] ws:open:ok postMessage failed', err);
        }
        return;
      }

      case 'ws:send': {
        // 子页请求发送（父页集中接入 wsHub）
        try {
          wsHub.send(msg.data);
        } catch (err) {
          console.warn('[Overlay] ws:send failed', err);
        }
        return;
      }

      case 'ws:close': {
        // 关闭该通道的订阅
        const ch = msg.ch;
        const un = chUnsub.get(ch);
        if (un) { try { un(); } catch {} }
        chUnsub.delete(ch);
        chKey.delete(ch);
        try {
          iframe.contentWindow?.postMessage({ __detail:true, t:'ws:closed', ch }, '*');
        } catch (err) {}
        return;
      }
      // ========= detailBridge 的 WS 桥接：END =========
    }
  };

  window.addEventListener('message', onMsg);

  __overlay = { host, iframe, onMsg, initParams: null, chUnsub, chKey };
  return __overlay;
}
function openOverlay(url, params){
  const ov = ensureOverlay();
  const qs = new URLSearchParams(params || {});
  qs.set('_ts', Date.now());
  ov.initParams = Object.assign({}, params || {}); // 记住，供 ready 时下发 init
  ov.iframe.src = url + '?' + qs.toString();
  ov.host.style.display = 'block';
}
function closeOverlay() {
  if (!__overlay) return;

  // 先清理 WS 订阅，避免内存泄漏
  try {
    if (__overlay.chUnsub) {
      for (const un of __overlay.chUnsub.values()) { try { un(); } catch {} }
      __overlay.chUnsub.clear?.();
    }
    __overlay.chKey && __overlay.chKey.clear?.();
  } catch (e) {
    console.warn('[Overlay] cleanup subs error', e);
  }

  __overlay.host.style.display = 'none';
  try { __overlay.iframe.src = 'about:blank'; } catch (e) {}
}
function openDeviceDetailOverlay(devId, devNo){
  openOverlay('/modules/features/pages/details/device-detail.html', { devId: devId, devNo: devNo });
}
function openVideoDetailOverlay(devId, devNo){
  openOverlay('/modules/features/pages/details/video-detail.html', { devId: devId, devNo: devNo, stream:'main' });
}
function openModeDetailOverlay(devId, devNo, modeId){
  const mid = Number(modeId);
  const url = mid===1 ? '/modules/features/pages/details/mode-tilt-detail.html'
            : mid===2 ? '/modules/features/pages/details/mode-disp-tilt-detail.html'
            : '/modules/features/pages/details/mode-audio-detail.html';
  openOverlay(url, { devId: devId, devNo: devNo, modeId: mid });
}

/* ---------------- 工具 ---------------- */
function debounce(fn, wait){ let t; return function(){ const args=arguments; clearTimeout(t); t=setTimeout(function(){ fn.apply(null, args); }, wait||300); }; }
function getFiltersFromTree(){ return tree.getFilterValues(); }
function escapeHTML(str){ str = String(str||''); return str.replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
function fmt(ts){ if(!ts) return ''; const d=new Date(ts); const p=function(n){return n<10?'0'+n:n;}; return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds()); }

/* ---------------- 树设备点击绑定（兼容多事件名） ---------------- */
function bindTreeDeviceClick(treeEl){
  const handler = async function (e){
    const devId = (e && e.detail && (e.detail.devId || e.detail.id)) || e.devId || e.id;
    const devNo = (e && e.detail && (e.detail.devNo || e.detail.no)) || e.devNo || e.no;
    const lastLocation = e && e.detail && e.detail.lastLocation;
    if (!devId) { console.warn('[Site][tree] device click missing devId', e); return; }
    try{
      const data = await apiDeviceInfo(devId);
      console.debug('[Site][tree] openDevice with api data', devId);
      mapView.openDevice({ devInfo: (data && data.devInfo) ? data.devInfo : { id: devId, no: devNo, lastLocation: lastLocation }, followCenterWhenNoLocation:true });
    }catch(err){
      console.warn('[Site][tree] apiDeviceInfo failed, fallback openDevice. id=', devId, err);
      mapView.openDevice({ devInfo: { id: devId, no: devNo, lastLocation: lastLocation }, followCenterWhenNoLocation:true });
    }
  };
  ['deviceclick','deviceClick','devclick','dev:click'].forEach(function(evt){
    try { treeEl.addEventListener(evt, handler); } catch (e) {}
  });
}