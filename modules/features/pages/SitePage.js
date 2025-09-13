/**
 * SitePage（装配）
 * - 使用 sp- 前缀类名，避开历史 CSS
 * - 提升地图容器层级（z-index），防止被其它元素覆盖
 * - 不改你的数据和交互逻辑
 */
import { createTreePanel } from './components/TreePanel.js';
import { createVideoPreview } from './components/VideoPreview.js';
import { createModePreview } from './components/ModePreview.js';
import { createMapView } from './components/MapView.js';
import { ENV } from '@config/env.js';
import { siteState } from '@state/siteState.js';

import {
  apiDevTypes, apiDevModes, apiGroupedDevices, apiUngroupedDevices,
  apiDeviceSummary, apiOnlineList, apiDeviceInfo
} from '@api/deviceApi.js';
import { eventBus } from '@core/eventBus.js';

const SRS_FIXED_URL = 'webrtc://media.szdght.com/1/camera_audio';

let __prevHtmlOverflow = '';
let __prevBodyOverflow = '';
let __prevMainStyle = null;

let rootEl = null;
let tree = null;
let mapView = null;

const mediaSlots = Array.from({ length: 6 }, (_, i) => ({ idx:i, type:null, inst:null }));

export function mountSitePage() {
  __prevHtmlOverflow = document.documentElement.style.overflow;
  __prevBodyOverflow = document.body.style.overflow;
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';

  const main = document.getElementById('mainView');
  __prevMainStyle = { padding: main.style.padding, overflow: main.style.overflow, position: main.style.position, height: main.style.height };
  main.innerHTML = ''; main.style.padding = '0'; main.style.overflow = 'hidden';
  if (!getComputedStyle(main).position || getComputedStyle(main).position === 'static') main.style.position = 'relative';
  const fitMainHeight = () => { const top = main.getBoundingClientRect().top; const h = window.innerHeight - top; if (h > 0) main.style.height = h + 'px'; };
  fitMainHeight(); window.addEventListener('resize', fitMainHeight);

  rootEl = document.createElement('div');
  rootEl.className = 'sp-root';
  rootEl.style.cssText = 'position:absolute;inset:0;display:flex;min-width:0;min-height:0;background:#0d1216;color:#cfd8dc;';
  main.appendChild(rootEl);

  // 左侧树容器
  const leftWrap = document.createElement('div');
  leftWrap.className = 'sp-left';
  leftWrap.style.cssText = 'width:320px;min-width:240px;max-width:50vw;display:flex;flex-direction:column;min-height:0;border-right:1px solid rgba(255,255,255,.08);position:relative;z-index:10;';

  // 分隔条
  const splitter = document.createElement('div');
  splitter.className = 'sp-splitter';
  splitter.title = '拖动调整左侧宽度';
  splitter.style.cssText = 'width:6px;cursor:col-resize;position:relative;z-index:10;';

  // 右侧整体（两行：上地图/状态，下媒体网格）
  const centerWrap = document.createElement('div');
  centerWrap.className = 'sp-center';
  centerWrap.style.cssText = 'flex:1 1 auto;display:grid;grid-template-rows:1fr 360px;min-width:0;min-height:0;position:relative;';

  rootEl.append(leftWrap, splitter, centerWrap);

  // 左树
  tree = createTreePanel();
  leftWrap.appendChild(tree);

  // 监听树筛选变化（事件名兼容几种），以及左侧容器上的 input/change 兜底
  const onTreeFiltersChange = debounce(() => { reloadByFilters(leftWrap); }, 250);
  ['filtersChange','filterchange','filterschange','filters:change'].forEach(evt => {
    try { tree.addEventListener(evt, onTreeFiltersChange); } catch {}
  });
  // 兜底：捕获左侧容器内部的输入变更（即使 TreePanel 不派发自定义事件也能触发）
  leftWrap.addEventListener('input', onTreeFiltersChange, true);
  leftWrap.addEventListener('change', onTreeFiltersChange, true);

  // 上半部分：地图 + 侧栏
  const topRow = document.createElement('div');
  topRow.className = 'sp-top';
  // 关键：z-index 提升；建立独立层叠环境
  topRow.style.cssText = 'position:relative;z-index:10;display:flex;gap:10px;padding:4px 10px;min-width:0;min-height:0;overflow:hidden;isolation:isolate;';

  const mapBox = document.createElement('div');
  mapBox.className = 'sp-mapbox';
  // 关键：地图容器层级更高，且 pointer-events: auto，避免被外部样式覆盖
  mapBox.style.cssText = 'position:relative;z-index:20;flex:1 1 auto;border:1px solid rgba(255,255,255,.08);border-radius:4px;min-width:0;min-height:0;overflow:hidden;pointer-events:auto;';
  const mapMount = document.createElement('div');
  mapMount.className = 'sp-mapmount';
  mapMount.style.cssText = 'width:100%;height:100%;';
  mapBox.appendChild(mapMount);

  const sideBox = document.createElement('div');
  sideBox.className = 'sp-side';
  sideBox.style.cssText = 'position:relative;z-index:15;width:380px;max-width:42vw;display:grid;grid-template-rows:auto 1fr;gap:10px;min-width:0;min-height:0;';
  const statusPanel = document.createElement('div');
  statusPanel.className = 'sp-status';
  statusPanel.style.cssText = 'border:1px solid rgba(255,255,255,.08);background:#0b121a;border-radius:4px;padding:8px 10px;';
  statusPanel.innerHTML = '<h3 style="margin:0 0 6px;font-size:15px;">设备状态</h3><div id="summaryChart"></div>';
  const notifyPanel = document.createElement('div');
  notifyPanel.className = 'sp-notify';
  notifyPanel.style.cssText = 'border:1px solid rgba(255,255,255,.08);background:#0b121a;border-radius:4px;padding:8px 10px;display:flex;flex-direction:column;min-height:0;';
  notifyPanel.innerHTML = '<h3 style="margin:0 0 6px;font-size:15px;">通知列表</h3><div id="notifyList" style="flex:1 1 auto;overflow:auto;min-height:0;"></div>';

  sideBox.append(statusPanel, notifyPanel);
  topRow.append(mapBox, sideBox);

  // 下半部分：媒体网格
  const bottomRow = document.createElement('div');
  bottomRow.className = 'sp-bottom';
  // 关键：明确比地图低的层级
  bottomRow.style.cssText = 'position:relative;z-index:1;padding:0 10px 4px;overflow:hidden;';
  const grid = document.createElement('div');
  grid.id = 'mediaGrid';
  grid.className = 'sp-grid';
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(6,1fr);gap:10px;height:100%;min-width:0;';
  grid.innerHTML = mediaSlots.map(s => `
    <div class="sp-cell" data-idx="${s.idx}" style="background:#111722;border:2px solid #3a4854;border-radius:6px;display:flex;flex-direction:column;overflow:hidden;">
      <div class="sp-cell-hd" style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;font-size:12px;background:#0f1b27;border-bottom:1px solid rgba(255,255,255,.08);">
        <div id="mediaTitle${s.idx}" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:calc(100% - 24px);">空闲</div>
        <button data-close="${s.idx}" title="关闭" style="width:20px;height:20px;border:none;background:transparent;color:#ccd;cursor:pointer;">✕</button>
      </div>
      <div id="mediaBody${s.idx}" class="sp-cell-bd" style="position:relative;flex:1 1 auto;min-height:0;background:#000;display:flex;align-items:center;justify-content:center;">
        <div style="color:#567;font-size:12px;">在此显示视频流或模式</div>
      </div>
    </div>
  `).join('');
  bottomRow.appendChild(grid);

  centerWrap.append(topRow, bottomRow);

  // 地图
  mapView = createMapView({ amapKey: (ENV && ENV.AMAP_KEY) || (window.__AMAP_KEY || ''), debug: true });
  mapMount.appendChild(mapView);
  mapView.mount();

  // 地图事件
  mapView.addEventListener('openVideo', (e)=> openVideoInSlot(e.detail.devId, e.detail.devNo));
  mapView.addEventListener('openMode',  (e)=> openModeInSlot(e.detail.devId, e.detail.devNo, e.detail.modeId));
  mapView.addEventListener('refreshDevice', async (e)=>{ try{ const data=await apiDeviceInfo(e.detail.devId); mapView.openDevice({ devInfo:data.devInfo, followCenterWhenNoLocation:true }); }catch{} });

  // 树点击 -> 信息窗
  tree.addEventListener('deviceclick', async (e)=>{
    try{ const data=await apiDeviceInfo(e.detail.devId); mapView.openDevice({ devInfo:data.devInfo, followCenterWhenNoLocation:true }); }catch{}
  });

  // 媒体关闭
  grid.addEventListener('click', (ev)=>{ const btn=ev.target.closest('[data-close]'); if(!btn) return; const idx=Number(btn.getAttribute('data-close')); closeSlot(idx); });

  // 分隔条
  initSplitter(leftWrap, splitter, ()=>{ try{ mapView.resize(); }catch{} });

  // 首次加载
  bootstrapData(statusPanel.querySelector('#summaryChart'), notifyPanel.querySelector('#notifyList'));
}

export function unmountSitePage() {
  document.documentElement.style.overflow = __prevHtmlOverflow;
  document.body.style.overflow = __prevBodyOverflow;
  mediaSlots.forEach(s=>{ if(s.inst?.destroy){ try{s.inst.destroy();}catch{} } s.inst=null; s.type=null; });
  try{ mapView?.destroy(); }catch{} mapView=null;
  if (rootEl){ try{ rootEl.remove(); }catch{} rootEl=null; }
  const main=document.getElementById('mainView');
  if (__prevMainStyle && main) { main.style.padding=__prevMainStyle.padding; main.style.overflow=__prevMainStyle.overflow; main.style.position=__prevMainStyle.position; main.style.height=__prevMainStyle.height; }
}

/* ---------------- 数据装配（同步 filters 到 siteState） ---------------- */
async function bootstrapData(summaryEl, notifyEl) {
  try {
    const [types, modes, online, summary] = await Promise.all([ apiDevTypes(), apiDevModes(), apiOnlineList(), apiDeviceSummary() ]);

    const filters = getFiltersFromTree();
    try { siteState.set({ filters }); } catch {}

    console.info('[Site] filters:', JSON.stringify(filters));

    const [grouped, ungrouped] = await Promise.all([ apiGroupedDevices(filters), apiUngroupedDevices(filters) ]);
    console.info('[Site] device counts:', { grouped: grouped?.devList?.length||0, ungrouped: ungrouped?.devList?.length||0 });

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

// 新增：根据当前树筛选刷新树与地图（不再重复取 types/modes/summary）
async function reloadByFilters(leftWrapRef) {
  try {
    const filters = getFiltersFromTree();
    try { siteState.set({ filters }); } catch {}
    console.info('[Site] filters:', JSON.stringify(filters));

    const [grouped, ungrouped] = await Promise.all([ apiGroupedDevices(filters), apiUngroupedDevices(filters) ]);
    console.info('[Site] device counts:', { grouped: grouped?.devList?.length||0, ungrouped: ungrouped?.devList?.length||0 });

    tree.setData({
      groupedDevices: grouped.devList || [],
      ungroupedDevices: ungrouped.devList || [],
      // 保持展开层级，可按需调整
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
    const layoutRect = rootEl.getBoundingClientRect();
    const maxPx = Math.floor(window.innerWidth * (MAXVW / 100));
    const glass = document.createElement('div');
    Object.assign(glass.style, { position:'fixed', inset:'0', cursor:'col-resize', zIndex:'2147483646', background:'transparent' });
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
function findFreeSlot() { const s = mediaSlots.find(s => !s.type); return s ? s.idx : -1; }
async function openVideoInSlot(devId, devNo) {
  const idx = findFreeSlot();
  if (idx === -1) { eventBus.emit('toast:show', { type:'error', message:'没有可用窗口' }); return; }
  const body = document.getElementById(`mediaBody${idx}`);
  const title = document.getElementById(`mediaTitle${idx}`);
  const vp = createVideoPreview({ objectFit:'fill' });
  body.innerHTML = ''; body.appendChild(vp);
  title.textContent = `${devNo} 视频`;
  mediaSlots[idx].type = 'video'; mediaSlots[idx].inst = vp;
  try { await vp.play(SRS_FIXED_URL); } catch { eventBus.emit('toast:show', { type:'error', message:'拉流失败' }); closeSlot(idx); }
}
function openModeInSlot(devId, devNo, modeId) {
  const idx = findFreeSlot();
  if (idx === -1) { eventBus.emit('toast:show', { type:'error', message:'没有可用窗口' }); return; }
  const body = document.getElementById(`mediaBody${idx}`);
  const title = document.getElementById(`mediaTitle${idx}`);
  const mp = createModePreview({ modeId, devId });
  body.innerHTML = ''; body.appendChild(mp.el); mp.start();
  title.textContent = `${devNo} 模式`;
  mediaSlots[idx].type = 'mode'; mediaSlots[idx].inst = mp;
}
function closeSlot(idx) {
  const s = mediaSlots[idx]; if (!s) return;
  if (s.inst?.destroy) { try { s.inst.destroy(); } catch {} } s.inst=null; s.type=null;
  const body = document.getElementById(`mediaBody${idx}`); const title = document.getElementById(`mediaTitle${idx}`);
  if (body) body.innerHTML = '<div style="color:#567;font-size:12px;">在此显示视频流或模式</div>'; if (title) title.textContent = '空闲';
}

/* ---------------- 工具 ---------------- */
function debounce(fn, wait=300) { let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), wait); }; }
function getFiltersFromTree(){
  const { devType, devMode, searchStr, onlyOnline } = tree.getFilterValues();
  return { devType, devMode, filterOnline: !!onlyOnline, searchStr };
}
function escapeHTML(str=''){return String(str).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fmt(ts){ if(!ts) return ''; const d=new Date(ts); const p=n=>n<10?'0'+n:n; return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; }