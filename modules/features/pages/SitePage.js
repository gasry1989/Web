/**
 * SitePage（装配）
 * 本版改动要点：
 * - 树状栏设备点击事件兼容多名称（deviceclick/deviceClick/devclick/dev:click），失败兜底也能弹出信息窗
 * - 网格标题/内容点击：标题=设备详情；内容=模式/视频详情（enableGridClickOpen）
 * - 标题栏拖拽重排（插入式）并在短时间内抑制误触点击
 * - Overlay（iframe 全屏）打开 5 个详情页（设备/视频/三种模式）
 * - 维持原有 Mock 模式推送；openVideoInSlot 继续拉主码流占位
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
const mediaSlots = Array.from({ length: 6 }, (_, i) => ({ idx:i, type:null, inst:null, devId:null, devNo:null, modeId:null }));

// MOCK 状态
const mockState = new Map();
let mockTimer = null;

const MODE_NAME = (mid)=>{
  switch(Number(mid)){
    case 1: return '倾角模式';
    case 2: return '位移·倾角模式';
    case 3: return '音频模式';
    default: return '模式';
  }
};

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
    .then(async (frag) => {
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

      try { await (tree.whenReady ? tree.whenReady() : Promise.resolve()); } catch {}

      // 折叠状态
      const initCollapsed = loadCollapsed();
      applyLeftCollapsed(initCollapsed);

      treeToggleBtn.addEventListener('click', () => {
        const next = !leftWrap.classList.contains('collapsed');
        applyLeftCollapsed(next);
        saveCollapsed(next);
        try { mapView.resize(); } catch {}
      });
      treeHandleBtn.addEventListener('click', () => {
        applyLeftCollapsed(false);
        saveCollapsed(false);
        try { mapView.resize(); } catch {}
      });

      // 监听树筛选变化（防抖）
      const onTreeFiltersChange = debounce(() => { reloadByFilters(); }, 250);
      ['filtersChange','filterchange','filterschange','filters:change'].forEach(evt => {
        try { tree.addEventListener(evt, onTreeFiltersChange); } catch {}
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
      mapView.addEventListener('openVideo', (e)=> openVideoInSlot(e.detail.devId, e.detail.devNo));
      mapView.addEventListener('openMode',  (e)=> openModeInSlot(e.detail.devId, e.detail.devNo, e.detail.modeId));
      mapView.addEventListener('refreshDevice', async (e)=>{ 
        try{ 
          const data=await apiDeviceInfo(e.detail.devId); 
          mapView.openDevice({ devInfo:data.devInfo, followCenterWhenNoLocation:true }); 
        }catch(err){ 
          console.warn('[Site] refreshDevice api error, keep window, id=', e.detail.devId, err); 
        } 
      });
      mapView.addEventListener('markerClick', async (e) => {
        try {
          const data = await apiDeviceInfo(e.detail.devId);
          mapView.openDevice({ devInfo: data.devInfo, followCenterWhenNoLocation: true });
        } catch (err) {
          console.warn('[Site] markerClick api error, fallback openDevice', err);
          mapView.openDevice({ devInfo: { id: e.detail.devId, devNo: e.detail.devNo }, followCenterWhenNoLocation: true });
        }
      });
      mapView.addEventListener('openDetail', (e)=> openDeviceDetailOverlay(e.detail.devId, e.detail.devNo));

      // 树点击 -> 信息窗（兼容多事件名 + 兜底 + 调试日志）
      bindTreeDeviceClick(tree);

      // 媒体关闭
      grid.addEventListener('click', (ev)=>{ 
        const btn=ev.target.closest('[data-close]'); 
        if(!btn) return; 
        const idx=Number(btn.getAttribute('data-close')); 
        closeSlot(idx); 
      });

      // 分隔条
      initSplitter(leftWrap, splitter, ()=>{ try{ mapView.resize(); }catch{} });

      // 清空网格状态
      for (let i=0;i<mediaSlots.length;i++) {
        mediaSlots[i].type = null; mediaSlots[i].inst = null; mediaSlots[i].devId=null; mediaSlots[i].devNo=null; mediaSlots[i].modeId=null;
        const body = document.getElementById(`mediaBody${i}`); if (body) body.setAttribute('data-free','1');
      }

      // 启用：标题栏拖拽 -> 插入式重排（带点击抑制）
      enableGridDragReorder(grid);
      // 新增：点击打开详情（标题=设备；内容=模式/视频）
      enableGridClickOpen(grid);

      // 首屏数据
      bootstrapData(statusPanel.querySelector('#summaryChart'), notifyPanel.querySelector('#notifyList'));

      // 路由：外部 WS/Mock 都调用它
      window.pushModeData = function pushModeData({ devId, modeId, data }) {
        try {
          const s = mediaSlots.find(x => x.type==='mode' && String(x.devId)===String(devId) && Number(x.modeId)===Number(modeId));
          if (!s || !s.inst || typeof s.inst.setData!=='function') return;
          s.inst.setData(data);
        } catch (e) {
          console.warn('[Site] pushModeData error', e);
        }
      };
      console.info('[Site] window.pushModeData ready: pushModeData({devId, modeId, data})');

      if (ENABLE_MODE_MOCK) startMockFeeder();
    })
    .catch(err => console.error('[SitePage] template load failed', err));
}

export function unmountSitePage() {
  stopMockFeeder();
  try{ mapView?.destroy(); }catch{} mapView=null;
  if (rootEl){ try{ rootEl.remove(); }catch{} rootEl=null; }
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
function loadCollapsed(){ try{ return localStorage.getItem(KEY_TREE_COLLAPSED) === '1'; } catch { return false; } }
function saveCollapsed(v){ try{ localStorage.setItem(KEY_TREE_COLLAPSED, v?'1':'0'); } catch {} }

/* ---------------- 数据装配（同步 filters 到 siteState） ---------------- */
async function bootstrapData(summaryEl, notifyEl) {
  try {
    const [types, modes, online, summary] = await Promise.all([ apiDevTypes(), apiDevModes(), apiOnlineList(), apiDeviceSummary() ]);

    const filters = getFiltersFromTree();
    try { siteState.set({ filters }); } catch {}

    const [grouped, ungrouped] = await Promise.all([ apiGroupedDevices(filters), apiUngroupedDevices(filters) ]);

    tree.setData({
      groupedDevices: grouped.devList || [],
      ungroupedDevices: ungrouped.devList || [],
      expandLevel: 2,
      devTypes: (types.devTypeList || []),
      devModes: (modes.devModeList || [])
    });

    const all = [...(grouped.devList||[]), ...(ungrouped.devList||[])];
    mapView.setMarkers(all);

    renderSummary(summaryEl, summary);
    renderNotify(notifyEl, (online.list || []).slice(0,50));
  } catch (e) {
    console.error('[Site] bootstrapData error', e);
  }
}

// 根据当前树筛选刷新树与地图
async function reloadByFilters() {
  try {
    const filters = getFiltersFromTree();
    try { siteState.set({ filters }); } catch {}

    const [grouped, ungrouped] = await Promise.all([ apiGroupedDevices(filters), apiUngroupedDevices(filters) ]);

    tree.setData({
      groupedDevices: grouped.devList || [],
      ungroupedDevices: ungrouped.devList || [],
      expandLevel: 2
    });

    const all = [...(grouped.devList||[]), ...(ungrouped.devList||[])];
    mapView.setMarkers(all);
  } catch (e) {
    console.error('[Site] reloadByFilters error', e);
  }
}

function renderSummary(el, summary) {
  const list = summary?.stateList || [];
  el.innerHTML = list.map(item => {
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
function renderNotify(el, list) {
  el.innerHTML = (list || []).map(l => {
    const name = l.uname || l.uid;
    return `<div style="padding:4px 0;border-bottom:1px dashed rgba(255,255,255,.06);font-size:12px;">${fmt(l.time)} ${escapeHTML(String(name))} ${l.online ? '上线' : '下线'}</div>`;
  }).join('');
}

/* ---------------- 分隔条拖拽 ---------------- */
function initSplitter(leftWrap, splitter, onDrag) {
  const MIN = 240, MAXVW = 50;
  splitter.addEventListener('mousedown', (e) => {
    if (leftWrap.classList.contains('collapsed')) return; // 折叠时不允许拖拽
    const layoutRect = rootEl.getBoundingClientRect();
    const maxPx = Math.floor(window.innerWidth * (MAXVW / 100));
    const glass = document.createElement('div');
    Object.assign(glass.style, {
      position:'fixed', inset:'0', cursor:'col-resize', zIndex:'2147483646',
      background:'transparent', userSelect:'none'
    });
    document.body.appendChild(glass);

    const move = (ev) => {
      const x = (ev.clientX ?? 0) - layoutRect.left;
      const w = Math.max(MIN, Math.min(Math.round(x), maxPx));
      leftWrap.style.width = w + 'px';
      onDrag && onDrag();
      ev.preventDefault();
    };
    const end = () => {
      try { glass.remove(); } catch {}
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', end);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('blur', end);
      document.removeEventListener('visibilitychange', end);
      requestAnimationFrame(()=> onDrag && onDrag());
      setTimeout(()=> onDrag && onDrag(), 100);
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
  for (const cell of orderedCells) {
    const idx = Number(cell.getAttribute('data-idx'));
    const body = document.getElementById(`mediaBody${idx}`);
    const isFreeDom = body && body.getAttribute('data-free') !== '0';
    if (!mediaSlots[idx].type && isFreeDom) return idx;
  }
  return -1;
}
function isModeOpened(devId, modeId){
  return mediaSlots.some(s => s.type==='mode' && String(s.devId)===String(devId) && Number(s.modeId)===Number(modeId));
}
async function openVideoInSlot(devId, devNo) {
  const idx = findFreeSlot();
  if (idx === -1) { eventBus.emit('toast:show', { type:'error', message:'没有可用窗口' }); return; }
  const body = document.getElementById(`mediaBody${idx}`);
  const title = document.getElementById(`mediaTitle${idx}`);
  const vp = createVideoPreview({ objectFit:'fill' });

  // 视频容器本身的合成优化
  try {
    vp.style.willChange = 'transform';
    vp.style.transform = 'translateZ(0)';
    vp.style.backfaceVisibility = 'hidden';
    vp.setAttribute?.('tabindex', '-1');
  } catch {}

  body.innerHTML = ''; body.appendChild(vp);
  body.setAttribute('data-free','0');
  title.textContent = `${devNo||''} 视频`;
  mediaSlots[idx].type = 'video'; mediaSlots[idx].inst = vp; mediaSlots[idx].devId = devId; mediaSlots[idx].devNo = devNo; mediaSlots[idx].modeId=null;

  try { await vp.play('webrtc://media.szdght.com/1/camera_audio'); }
  catch {
    eventBus.emit('toast:show', { type:'error', message:'拉流失败' });
    closeSlot(idx);
  }
}
function openModeInSlot(devId, devNo, modeId) {
  const mid = Number(modeId);

  // 同设备同模式只能打开一次
  if (isModeOpened(devId, mid)) {
    const msg = `${devNo ? devNo + ' ' : ''}${MODE_NAME(mid)}已打开`;
    eventBus.emit('toast:show', { type:'info', message: msg });
    return;
  }

  const idx = findFreeSlot();
  if (idx === -1) { eventBus.emit('toast:show', { type:'error', message:'没有可用窗口' }); return; }
  const body = document.getElementById(`mediaBody${idx}`);
  const title = document.getElementById(`mediaTitle${idx}`);

  let mp = null;
  if (mid === 1) mp = createModeTilt({ devId });
  else if (mid === 2) mp = createModeDispTilt({ devId });
  else if (mid === 3) mp = createModeAudio({ devId });
  else {
    console.warn('[Site] unknown modeId:', modeId, 'use ModePreview fallback');
    mp = createModePreview({ modeId, devId });
  }

  body.innerHTML = ''; body.appendChild(mp.el);
  body.setAttribute('data-free','0');
  title.textContent = `${devNo||''} ${MODE_NAME(mid)}`;
  mediaSlots[idx].type = 'mode'; mediaSlots[idx].inst = mp; mediaSlots[idx].devId = devId; mediaSlots[idx].devNo = devNo; mediaSlots[idx].modeId = mid;

  try { mp.start && mp.start(); } catch {}
}
function closeSlot(idx) {
  const s = mediaSlots[idx]; if (!s) return;
  if (s.inst?.destroy) { try { s.inst.destroy(); } catch {} }
  s.inst=null; s.type=null; s.devId=null; s.devNo=null; s.modeId=null;
  const body = document.getElementById(`mediaBody${idx}`);
  const title = document.getElementById(`mediaTitle${idx}`);
  if (body) {
    body.innerHTML = '<div style="color:#567;font-size:12px;">在此显示视频流或模式</div>';
    body.setAttribute('data-free','1');
  }
  if (title) title.textContent = '空闲';
}

/* ---------------- MOCK：300ms 本地演示（设备数量可变） ---------------- */
function startMockFeeder(){
  stopMockFeeder();
  console.info('[MOCK] enabled, interval=', MOCK_INTERVAL_MS, 'ms');
  mockTimer = setInterval(()=>{
    mediaSlots.forEach(s=>{
      if (s.type!=='mode' || s.devId==null || s.modeId==null) return;
      const resp = genMockResponse(s.devId, s.modeId);
      try { window.pushModeData && window.pushModeData({ devId: s.devId, modeId: s.modeId, data: resp }); } catch(e){ console.warn('[MOCK] push error', e); }
    });
  }, MOCK_INTERVAL_MS);
}
function stopMockFeeder(){ try{ mockTimer && clearInterval(mockTimer); }catch{} mockTimer=null; }

// ---- MOCK helpers（定义一份，避免重复声明）----
function getKey(devId, modeId){ return String(devId)+'|'+String(modeId); }
function ensureState(devId, modeId, init){
  const k=getKey(devId, modeId);
  if(!mockState.has(k)) mockState.set(k, init());
  return mockState.get(k);
}
function clamp(v,min,max){ return v<min?min:v>max?max:v; }
function step(v,amp,min,max){ return clamp(v + (Math.random()*2-1)*amp, min, max); }
function prob(p){ return Math.random() < p; }
function rnd(a,b){ return Math.random()*(b-a)+a; }
function genMockResponse(devId, modeId){
  const mid = Number(modeId);

  // 倾角
  if (mid===1){
    const st = ensureState(devId, mid, ()=>({ items: [] }));
    if (!st.items || prob(0.10)) {
      const n = Math.floor(rnd(0,13));
      st.items = Array.from({length:n},(_,i)=>({
        name:`倾角${i+1}#`,
        deg: rnd(0,1.2),
        batt: rnd(60,100),
        alarmOn: Math.random()>.2,
        sirenOn: Math.random()>.2
      }));
    }
    st.items.forEach(it=>{ it.deg = step(it.deg, 0.12, 0, 1.5); });
    return { items: st.items.slice(0,12).map(x=>({ ...x })) };
  }

  // 位移·倾角
  if (mid===2){
    const st = ensureState(devId, mid, ()=>({ list: [] }));
    if (!st.list || prob(0.10)) {
      const total = Math.floor(rnd(0,13));
      const nDisp = total > 0 ? Math.floor(rnd(0, total+1)) : 0;
      const nTilt = total - nDisp;
      const list = [];
      for (let i=0;i<nDisp;i++) list.push({ type:'位移', badge: Math.floor(rnd(10,99)), batt: rnd(60,100), sirenOn: Math.random()>.3, value: rnd(0,0.012) });
      for (let i=0;i<nTilt;i++) list.push({ type:'倾角', badge: Math.floor(rnd(60,99)), batt: rnd(60,100), sirenOn: Math.random()>.3, valueDeg: rnd(0,0.30) });
      st.list = list;
    }
    st.list.forEach(it=>{
      if (it.type==='位移') it.value = step(it.value, 0.002, 0, 0.012);
      else it.valueDeg = step(it.valueDeg, 0.03, 0, 0.30);
    });
    return {
      items: st.list.slice(0,12).map(it=> it.type==='位移'
        ? { type:'位移', badge: it.badge, batt: it.batt, sirenOn: it.sirenOn, valueText: it.value.toFixed(3)+'m' }
        : { type:'倾角', badge: it.badge, batt: it.batt, sirenOn: it.sirenOn, valueText: it.valueDeg.toFixed(2)+'°' }
      )
    };
  }

  // 音频
  const st = ensureState(devId, 3, ()=>({ labels:[], values:[], batteries:[] }));
  if (!st.values || prob(0.10)) {
    const n = Math.floor(rnd(0,13));
    st.values = Array.from({length:n}, ()=> rnd(0,100));
    st.batteries = Array.from({length:n}, ()=> rnd(40,100));
    st.labels = Array.from({length:n}, (_,i)=> i+1);
  }
  for (let i=0;i<st.values.length;i++){
    st.values[i] = Math.max(0, Math.min(100, st.values[i] + (Math.random()*2-1)*8));
    if (prob(0.05)) st.batteries[i] = Math.max(0, Math.min(100, st.batteries[i] + (Math.random()*2-1)*3));
  }
  return { labels: st.labels.slice(0,12), values: st.values.slice(0,12), batteries: st.batteries.slice(0,12) };
}

/* ---------------- 拖拽重排（插入式）+ 点击抑制 ---------------- */
function enableGridDragReorder(grid) {
  if (!grid) return;

  grid.querySelectorAll('.sp-cell-hd').forEach(hd => {
    hd.setAttribute('draggable', 'true');
    const btn = hd.querySelector('[data-close]');
    if (btn) {
      btn.setAttribute('draggable', 'false');
      btn.addEventListener('dragstart', e => e.stopPropagation());
      btn.addEventListener('mousedown', e => e.stopPropagation());
    }
  });

  let dragSrcCell = null;
  let dragOverCell = null;
  let headerDragging = false;
  let suppressHeaderClickUntil = 0;

  grid.addEventListener('dragstart', (e) => {
    const hd = e.target.closest('.sp-cell-hd');
    if (!hd || e.target.closest('[data-close]')) { e.preventDefault?.(); return; }
    dragSrcCell = hd.closest('.sp-cell');
    if (!dragSrcCell) return;
    try { e.dataTransfer.setData('text/plain', dragSrcCell.getAttribute('data-idx') || ''); } catch {}
    e.dataTransfer.effectAllowed = 'move';
    dragSrcCell.classList.add('dragging');
    headerDragging = true;
  });
  grid.addEventListener('dragend', () => {
    if (dragSrcCell) dragSrcCell.classList.remove('dragging');
    if (dragOverCell) dragOverCell.classList.remove('drag-target');
    dragSrcCell = null; dragOverCell = null;
    headerDragging = false;
    suppressHeaderClickUntil = performance.now() + 180;
  });
  grid.addEventListener('dragover', (e) => {
    if (!dragSrcCell) return;
    e.preventDefault(); // 必须阻止默认，drop 才会触发
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
  grid.addEventListener('drop', (e) => {
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
  });

  // 给点击逻辑提供拖拽状态查询
  grid.__wasHeaderDraggedRecently__ = () => headerDragging || performance.now() < suppressHeaderClickUntil;
}

/* ---------------- 点击打开详情（标题=设备；画面=模式/视频） ---------------- */
function enableGridClickOpen(grid) {
  if (!grid) return;

  // 标题栏 -> 设备详情
  grid.addEventListener('click', (e) => {
    const hd = e.target.closest('.sp-cell-hd');
    if (!hd) return;
    if (typeof grid.__wasHeaderDraggedRecently__ === 'function' && grid.__wasHeaderDraggedRecently__()) return;
    if (e.target.closest('[data-close]')) return;
    const cell = hd.closest('.sp-cell'); if (!cell) return;
    const idx = Number(cell.getAttribute('data-idx'));
    const slot = mediaSlots[idx];
    if (!slot || !slot.devId) return;
    openDeviceDetailOverlay(slot.devId, slot.devNo);
  }, true);

  // 画面 -> 模式/视频详情
  grid.addEventListener('click', (e) => {
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

  const onMsg = (e) => {
    const msg = e.data || {};
    if (!msg || !msg.__detail) return;
    if (msg.t === 'back') closeOverlay();
    if (msg.t === 'openMode') openModeDetailOverlay(msg.devId, msg.devNo, msg.modeId);
  };
  window.addEventListener('message', onMsg);

  __overlay = { host, iframe, onMsg };
  return __overlay;
}
function openOverlay(url, params={}) {
  const ov = ensureOverlay();
  const qs = new URLSearchParams(params); qs.set('_ts', Date.now());
  ov.iframe.src = `${url}?${qs.toString()}`;
  ov.host.style.display = 'block';
}
function closeOverlay() {
  if (!__overlay) return;
  __overlay.host.style.display = 'none';
  try { __overlay.iframe.src = 'about:blank'; } catch {}
}
function openDeviceDetailOverlay(devId, devNo){
  openOverlay('/modules/features/pages/details/device-detail.html', { devId, devNo });
}
function openVideoDetailOverlay(devId, devNo){
  openOverlay('/modules/features/pages/details/video-detail.html', { devId, devNo, stream:'main' });
}
function openModeDetailOverlay(devId, devNo, modeId){
  const mid = Number(modeId);
  const url = mid===1 ? '/modules/features/pages/details/mode-tilt-detail.html'
            : mid===2 ? '/modules/features/pages/details/mode-disp-tilt-detail.html'
            : '/modules/features/pages/details/mode-audio-detail.html';
  openOverlay(url, { devId, devNo, modeId: mid });
}

/* ---------------- 工具 ---------------- */
function debounce(fn, wait=300) { let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), wait); }; }
function getFiltersFromTree(){ return tree.getFilterValues(); }
function escapeHTML(str=''){return String(str).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fmt(ts){ if(!ts) return ''; const d=new Date(ts); const p=n=>n<10?'0'+n:n; return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; }

/* ---------------- 树设备点击绑定（兼容多事件名） ---------------- */
function bindTreeDeviceClick(treeEl){
  const handler = async (e)=>{
    const devId = e?.detail?.devId ?? e?.detail?.id ?? e?.devId ?? e?.id;
    const devNo = e?.detail?.devNo ?? e?.detail?.no ?? e?.devNo ?? e?.no;
    const lastLocation = e?.detail?.lastLocation;
    if (!devId) { console.warn('[Site][tree] device click missing devId', e); return; }
    try{
      const data=await apiDeviceInfo(devId);
      console.debug('[Site][tree] openDevice with api data', devId);
      mapView.openDevice({ devInfo: (data && data.devInfo) ? data.devInfo : { id: devId, no: devNo, lastLocation }, followCenterWhenNoLocation:true });
    }catch(err){
      console.warn('[Site][tree] apiDeviceInfo failed, fallback openDevice. id=', devId, err);
      mapView.openDevice({ devInfo: { id: devId, no: devNo, lastLocation }, followCenterWhenNoLocation:true });
    }
  };
  ['deviceclick','deviceClick','devclick','dev:click'].forEach(evt=>{
    try { treeEl.addEventListener(evt, handler); } catch {}
  });
}