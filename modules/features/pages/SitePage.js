/**
 * SitePage（装配）
 * 更新：
 *  - 等待树组件 whenReady() 后再注册筛选监听并调用 bootstrapData，避免首次空引用
 */
import { createTreePanel } from './components/TreePanel.js';
import { createVideoPreview } from './components/VideoPreview.js';
import { createModePreview } from './components/ModePreview.js';
import { createMapView } from './components/MapView.js';
import { ENV } from '/config/env.js'; // 统一从 /config/env.js 获取 AMAP_KEY
import { siteState } from '@state/siteState.js';

import {
  apiDevTypes, apiDevModes, apiGroupedDevices, apiUngroupedDevices,
  apiDeviceSummary, apiOnlineList, apiDeviceInfo
} from '@api/deviceApi.js';
import { eventBus } from '@core/eventBus.js';
import { importTemplate } from '@ui/templateLoader.js';

const SRS_FIXED_URL = 'webrtc://media.szdght.com/1/camera_audio';
const KEY_TREE_COLLAPSED = 'ui.sitepage.tree.collapsed';

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

  const fitMainHeight = () => {
    const top = main.getBoundingClientRect().top;
    const h = window.innerHeight - top;
    if (h > 0) main.style.height = h + 'px';
  };
  fitMainHeight(); window.addEventListener('resize', fitMainHeight);

  importTemplate('/modules/features/pages/templates/site-page.html', 'tpl-site-page')
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

      // 等待树模板渲染完成后再进行后续初始化，避免空引用
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

      // 地图：只在父页面配置一次 Key，这里传给 MapView
      mapView = createMapView({
        amapKey: (ENV && ENV.AMAP_KEY) || (window.__AMAP_KEY || ''), // 统一来源：/config/env.js
        debug: true
      });
      mapMount.appendChild(mapView);
      mapView.mount();

      mapView.addEventListener('openVideo', (e)=> openVideoInSlot(e.detail.devId, e.detail.devNo));
      mapView.addEventListener('openMode',  (e)=> openModeInSlot(e.detail.devId, e.detail.devNo, e.detail.modeId));
      mapView.addEventListener('refreshDevice', async (e)=>{ try{ const data=await apiDeviceInfo(e.detail.devId); mapView.openDevice({ devInfo:data.devInfo, followCenterWhenNoLocation:true }); }catch{} });
      mapView.addEventListener('markerClick', async (e) => {
        try {
          const data = await apiDeviceInfo(e.detail.devId);
          // 无定位的设备，信息窗会跟随地图中心显示
          mapView.openDevice({ devInfo: data.devInfo, followCenterWhenNoLocation: true });
        } catch (err) {
          console.error('[Site] markerClick -> openDevice error', err);
        }
      });
      // 树点击 -> 信息窗
      tree.addEventListener('deviceclick', async (e)=>{
        try{ const data=await apiDeviceInfo(e.detail.devId); mapView.openDevice({ devInfo:data.devInfo, followCenterWhenNoLocation:true }); }catch{}
      });

      // 媒体关闭
      grid.addEventListener('click', (ev)=>{ const btn=ev.target.closest('[data-close]'); if(!btn) return; const idx=Number(btn.getAttribute('data-close')); closeSlot(idx); });

      // 分隔条
      initSplitter(leftWrap, splitter, ()=>{ try{ mapView.resize(); }catch{} });

      // 重置窗口状态（0→5 顺序）
      for (let i=0;i<mediaSlots.length;i++) {
        mediaSlots[i].type = null; mediaSlots[i].inst = null;
        const body = document.getElementById(`mediaBody${i}`);
        if (body) body.setAttribute('data-free','1');
      }

      // 首次加载（此时树已就绪）
      bootstrapData(statusPanel.querySelector('#summaryChart'), notifyPanel.querySelector('#notifyList'));
    })
    .catch(err => console.error('[SitePage] template load failed', err));
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
  for (let i = 0; i < mediaSlots.length; i++) {
    const s = mediaSlots[i];
    const body = document.getElementById(`mediaBody${i}`);
    const isFreeDom = body && body.getAttribute('data-free') !== '0';
    if (!s.type && isFreeDom) return i;
  }
  return -1;
}
async function openVideoInSlot(devId, devNo) {
  const idx = findFreeSlot();
  if (idx === -1) { eventBus.emit('toast:show', { type:'error', message:'没有可用窗口' }); return; }
  const body = document.getElementById(`mediaBody${idx}`);
  const title = document.getElementById(`mediaTitle${idx}`);
  const vp = createVideoPreview({ objectFit:'fill' });

  // 关键：视频容器自身也给到稳定的合成/不抢焦点
  try {
    vp.style.willChange = 'transform';
    vp.style.transform = 'translateZ(0)';
    vp.style.backfaceVisibility = 'hidden';
    vp.setAttribute?.('tabindex', '-1');
  } catch {}

  body.innerHTML = ''; body.appendChild(vp);
  body.setAttribute('data-free','0');
  title.textContent = `${devNo} 视频`;
  mediaSlots[idx].type = 'video'; mediaSlots[idx].inst = vp;

  try { await vp.play(SRS_FIXED_URL); }
  catch {
    eventBus.emit('toast:show', { type:'error', message:'拉流失败' });
    closeSlot(idx);
  }
}
function openModeInSlot(devId, devNo, modeId) {
  const idx = findFreeSlot();
  if (idx === -1) { eventBus.emit('toast:show', { type:'error', message:'没有可用窗口' }); return; }
  const body = document.getElementById(`mediaBody${idx}`);
  const title = document.getElementById(`mediaTitle${idx}`);
  const mp = createModePreview({ modeId, devId });
  body.innerHTML = ''; body.appendChild(mp.el); mp.start();
  body.setAttribute('data-free','0');
  title.textContent = `${devNo} 模式`;
  mediaSlots[idx].type = 'mode'; mediaSlots[idx].inst = mp;
}
function closeSlot(idx) {
  const s = mediaSlots[idx]; if (!s) return;
  if (s.inst?.destroy) { try { s.inst.destroy(); } catch {} }
  s.inst=null; s.type=null;
  const body = document.getElementById(`mediaBody${idx}`);
  const title = document.getElementById(`mediaTitle${idx}`);
  if (body) {
    body.innerHTML = '<div style="color:#567;font-size:12px;">在此显示视频流或模式</div>';
    body.setAttribute('data-free','1');
  }
  if (title) title.textContent = '空闲';
}

/* ---------------- 工具 ---------------- */
function debounce(fn, wait=300) { let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), wait); }; }
function getFiltersFromTree(){
  // TreePanel.getFilterValues 内部已做兜底，这里直接调用
  return tree.getFilterValues();
}
function escapeHTML(str=''){return String(str).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fmt(ts){ if(!ts) return ''; const d=new Date(ts); const p=n=>n<10?'0'+n:n; return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; }