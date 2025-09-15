/**
 * SitePage 修改点：
 * 1) 模式窗口标题显示具体模式名称
 * 2) window.pushModeData 已存在（上一轮改动），保留
 * 3)（无改）Mock 喂数保持 300ms，你可继续使用
 */
import { createTreePanel } from './components/TreePanel.js';
import { createVideoPreview } from './modes/VideoPreview.js';
import { createModePreview } from './modes/ModePreview.js';
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

const SRS_FIXED_URL = 'webrtc://media.szdght.com/1/camera_audio';
const KEY_TREE_COLLAPSED = 'ui.sitepage.tree.collapsed';

// 本地模拟喂数（保持 300ms）
const urlParams = new URLSearchParams(location.search);
const ENABLE_MODE_MOCK = urlParams.get('mock') != null ? urlParams.get('mock') === '1' : true;
const MOCK_INTERVAL_MS = 300;

let __prevHtmlOverflow = '';
let __prevBodyOverflow = '';
let __prevMainStyle = null;

let rootEl = null;
let tree = null;
let mapView = null;

const mediaSlots = Array.from({ length: 6 }, (_, i) => ({ idx:i, type:null, inst:null, devId:null, modeId:null }));

const mockState = new Map();
let mockTimer = null;

const MODE_NAME = (mid)=>{
  switch(Number(mid)){
    case 1: return '倾角模式';
    case 2: return '位移·倾角模式';
    case 3: return '音视频模式';
    default: return '模式';
  }
};

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

      // 筛选变化
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

      mapView.addEventListener('openVideo', (e)=> openVideoInSlot(e.detail.devId, e.detail.devNo));
      mapView.addEventListener('openMode',  (e)=> openModeInSlot(e.detail.devId, e.detail.devNo, e.detail.modeId));
      mapView.addEventListener('refreshDevice', async (e)=>{ try{ const data=await apiDeviceInfo(e.detail.devId); mapView.openDevice({ devInfo:data.devInfo, followCenterWhenNoLocation:true }); }catch{} });
      mapView.addEventListener('markerClick', async (e) => {
        try {
          const data = await apiDeviceInfo(e.detail.devId);
          mapView.openDevice({ devInfo: data.devInfo, followCenterWhenNoLocation: true });
        } catch (err) {
          console.error('[Site] markerClick -> openDevice error', err);
        }
      });
      // 树点击 -> 信息窗（无经纬度：MapView 内部会按“上次位置/首次居中”逻辑处理）
      tree.addEventListener('deviceclick', async (e)=>{
        try{
          const data=await apiDeviceInfo(e.detail.devId);
          mapView.openDevice({ devInfo:data.devInfo, followCenterWhenNoLocation:true });
        }catch{}
      });

      // 媒体关闭
      grid.addEventListener('click', (ev)=>{ const btn=ev.target.closest('[data-close]'); if(!btn) return; const idx=Number(btn.getAttribute('data-close')); closeSlot(idx); });

      // 分隔条
      initSplitter(leftWrap, splitter, ()=>{ try{ mapView.resize(); }catch{} });

      // 清空网格状态
      for (let i=0;i<mediaSlots.length;i++) {
        mediaSlots[i].type = null; mediaSlots[i].inst = null; mediaSlots[i].devId=null; mediaSlots[i].modeId=null;
        const body = document.getElementById(`mediaBody${i}`); if (body) body.setAttribute('data-free','1');
      }

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
  document.documentElement.style.overflow = __prevHtmlOverflow;
  document.body.style.overflow = __prevBodyOverflow;
  stopMockFeeder();
  mediaSlots.forEach(s=>{ if(s.inst?.destroy){ try{s.inst.destroy();}catch{} } s.inst=null; s.type=null; s.devId=null; s.modeId=null; });
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
    if (leftWrap.classList.contains('collapsed')) return;
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

  try {
    vp.style.willChange = 'transform';
    vp.style.transform = 'translateZ(0)';
    vp.style.backfaceVisibility = 'hidden';
    vp.setAttribute?.('tabindex', '-1');
  } catch {}

  body.innerHTML = ''; body.appendChild(vp);
  body.setAttribute('data-free','0');
  title.textContent = `${devNo} 视频`;
  mediaSlots[idx].type = 'video'; mediaSlots[idx].inst = vp; mediaSlots[idx].devId=null; mediaSlots[idx].modeId=null;

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

  let mp = null;
  const mid = Number(modeId);
  if (mid === 1) mp = createModeTilt({ devId });
  else if (mid === 2) mp = createModeDispTilt({ devId });
  else if (mid === 3) mp = createModeAudio({ devId });
  else {
    console.warn('[Site] unknown modeId:', modeId, 'use ModePreview fallback');
    mp = createModePreview({ modeId, devId });
  }

  body.innerHTML = ''; body.appendChild(mp.el);
  body.setAttribute('data-free','0');
  title.textContent = `${devNo} ${MODE_NAME(mid)}`;
  mediaSlots[idx].type = 'mode'; mediaSlots[idx].inst = mp; mediaSlots[idx].devId = devId; mediaSlots[idx].modeId = mid;

  try { mp.start && mp.start(); } catch {}
}
function closeSlot(idx) {
  const s = mediaSlots[idx]; if (!s) return;
  if (s.inst?.destroy) { try { s.inst.destroy(); } catch {} }
  s.inst=null; s.type=null; s.devId=null; s.modeId=null;
  const body = document.getElementById(`mediaBody${idx}`);
  const title = document.getElementById(`mediaTitle${idx}`);
  if (body) {
    body.innerHTML = '<div style="color:#567;font-size:12px;">在此显示视频流或模式</div>';
    body.setAttribute('data-free','1');
  }
  if (title) title.textContent = '空闲';
}

/* ---------------- MOCK：300ms 本地演示 ---------------- */
function startMockFeeder(){
  stopMockFeeder();
  console.info('[MOCK] enabled, interval=', MOCK_INTERVAL_MS, 'ms');
  mockTimer = setInterval(()=>{
    mediaSlots.forEach(s=>{
      if (s.type!=='mode' || s.devId==null || s.modeId==null) return;
      const sendPayload = { t:'mode_pull', devId: s.devId, modeId: s.modeId };
      console.debug('[MOCK][send]', JSON.stringify(sendPayload));
      const resp = genMockResponse(s.devId, s.modeId);
      console.debug('[MOCK][recv]', JSON.stringify({ t:'mode_data', devId:s.devId, modeId:s.modeId, preview: previewForLog(resp)}));
      try { window.pushModeData && window.pushModeData({ devId: s.devId, modeId: s.modeId, data: resp }); } catch(e){ console.warn('[MOCK] push error', e); }
    });
  }, MOCK_INTERVAL_MS);
}
function stopMockFeeder(){ try{ mockTimer && clearInterval(mockTimer); }catch{} mockTimer=null; }
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
function previewForLog(d){
  if (d.items) return { n:d.items.length, first:d.items[0] };
  return { n:(d.values?.length||0), first:d.values?.[0] };
}
function genMockResponse(devId, modeId){
  const mid = Number(modeId);
  if (mid===1){
    const st = ensureState(devId, mid, ()=>({
      items: Array.from({length:2},(_,i)=>({ name:`倾角${i+1}#`, deg: rnd(0,1), batt: rnd(70,100), alarmOn: Math.random()>.2, sirenOn: Math.random()>.2 }))
    }));
    st.items.forEach(it=>{
      it.deg = step(it.deg, 0.15, 0, 1.5);
      if (prob(0.05)) it.alarmOn = !it.alarmOn;
      if (prob(0.05)) it.sirenOn = !it.sirenOn;
      if (prob(0.02)) it.batt = clamp(it.batt - 1, 0, 100);
    });
    return { items: st.items.map(x=>({ ...x })) };
  }
  if (mid===2){
    const st = ensureState(devId, mid, ()=>({
      items: [
        { type:'位移', badge: Math.floor(rnd(10,99)), batt: rnd(70,100), sirenOn:true,  value: 0 },
        { type:'位移', badge: Math.floor(rnd(10,99)), batt: rnd(70,100), sirenOn:true,  value: 0 },
        { type:'倾角', badge: Math.floor(rnd(60,99)), batt: rnd(70,100), sirenOn:true,  valueDeg: 0 }
      ]
    }));
    st.items[0].value = step(st.items[0].value, 0.002, 0, 0.012);
    st.items[1].value = step(st.items[1].value, 0.002, 0, 0.012);
    st.items[2].valueDeg = step(st.items[2].valueDeg, 0.03, 0, 0.30);
    st.items.forEach(it=>{
      if (prob(0.04)) it.sirenOn = !it.sirenOn;
      if (prob(0.02)) it.badge = clamp((it.badge|0) + (Math.random()<.5?-1:1), 0, 99);
      if (prob(0.02)) it.batt = clamp(it.batt - 1, 0, 100);
    });
    return {
      items: [
        { type:'位移', badge: st.items[0].badge, batt: st.items[0].batt, sirenOn: st.items[0].sirenOn, valueText: st.items[0].value.toFixed(3)+'m' },
        { type:'位移', badge: st.items[1].badge, batt: st.items[1].batt, sirenOn: st.items[1].sirenOn, valueText: st.items[1].value.toFixed(3)+'m' },
        { type:'倾角', badge: st.items[2].badge, batt: st.items[2].batt, sirenOn: st.items[2].sirenOn, valueText: st.items[2].valueDeg.toFixed(2)+'°' }
      ]
    };
  }
  const st = ensureState(devId, 3, ()=>({
    labels:[1,2,10], values:[rnd(0,100), rnd(0,100), rnd(0,100)], batteries:[rnd(60,100), rnd(60,100), rnd(10,100)]
  }));
  for (let i=0;i<st.values.length;i++){
    st.values[i] = clamp(st.values[i] + (Math.random()*2-1)*8, 0, 100);
    if (prob(0.05)) st.batteries[i] = clamp(st.batteries[i] + (Math.random()*2-1)*3, 0, 100);
  }
  return { labels: st.labels.slice(), values: st.values.slice(), batteries: st.batteries.slice() };
}

/* ---------------- 工具 ---------------- */
function debounce(fn, wait=300) { let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), wait); }; }
function getFiltersFromTree(){ return tree.getFilterValues(); }
function escapeHTML(str=''){return String(str).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fmt(ts){ if(!ts) return ''; const d=new Date(ts); const p=n=>n<10?'0'+n:n; return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; }