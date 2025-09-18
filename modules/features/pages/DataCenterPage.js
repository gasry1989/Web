/**
 * DataCenterPage
 * - 共用 TreePanel 筛选
 * - 右侧最多 20 行，每行展示“该设备支持的前 1~3 种模式缩略图”（不显示不支持的占位卡）
 * - 点击支持的模式 -> 打开对应模式详情 Overlay（含 WS 桥）
 * - WS：对已打开模式建立 onMatch 订阅（不影响本地模拟）
 * - 新增：全局本地模拟（所有已打开设备与模式，每 300ms 推一帧 0~12 探头数据）
 */
import { importTemplate } from '@ui/templateLoader.js';
import { createTreePanel } from './components/TreePanel.js';
import { apiDevTypes, apiDevModes, apiGroupedDevices, apiUngroupedDevices } from '@api/deviceApi.js';
import { eventBus } from '@core/eventBus.js';
import { wsHub } from '@core/hub.js';
import { createModeTilt } from './modes/ModeTilt.js';
import { createModeDispTilt } from './modes/ModeDispTilt.js';
import { createModeAudio } from './modes/ModeAudio.js';

const MAX_ROWS = 20;
// 仅前端已支持的模式组件（用于与 devInfo.modeList 做交集；顺序以后端 modeList 为准）
const PREF_MODES = [1,2,3];

// ---- 模拟数据：300ms 推一帧 ----
const MOCK_INTERVAL_MS = 300;
const mockState = new Map(); // key: `${devId}|${modeId}` -> state
let mockTimer = null;

let root = null, left = null, splitter = null, listEl = null, tree = null;
let deviceMap = new Map(); // devId -> { userInfo, devInfo }
let opened = new Map();    // devId -> { row, comps:[{mid,inst,unsub}], cleanup, devId, devNo }

export function mountDataCenterPage() {
  const main = document.getElementById('mainView');
  main.innerHTML = '';
  main.style.padding = '0';
  main.style.overflow = 'hidden';
  if (!getComputedStyle(main).position || getComputedStyle(main).position === 'static') main.style.position = 'relative';

  const fit = () => {
    const top = main.getBoundingClientRect().top;
    const h = window.innerHeight - top;
    if (h > 0) main.style.height = h + 'px';
  };
  fit(); window.addEventListener('resize', fit);

  importTemplate('/modules/features/pages/data-center-page.html', 'tpl-data-center-page')
    .then(async frag => {
      main.appendChild(frag);
      root = main.querySelector('#dcRoot');
      left = root.querySelector('#dcLeft');
      splitter = root.querySelector('#dcSplitter');
      listEl = root.querySelector('#dcList');

      // 左树
      tree = createTreePanel();
      left.appendChild(tree);
      try { await tree.whenReady?.(); } catch {}

      // 分隔条拖拽
      initSplitter(left, splitter);

      // 监听筛选并加载数据
      const onFilters = debounce(reloadByFilters, 250);
      ['filterchange','filtersChange','filterschange','filters:change'].forEach(evt => {
        try { tree.addEventListener(evt, onFilters); } catch {}
      });
      left.addEventListener('input', onFilters, true);
      left.addEventListener('change', onFilters, true);

      // 设备点击
      bindTreeDeviceClick(tree, (devId) => openDeviceRow(devId));

      // 首屏
      await bootstrapData();

      // 启动本地模拟（全局一次）
      startMockFeeder();
    })
    .catch(err => console.error('[DataCenter] template load failed', err));

  return unmountDataCenterPage;
}

export function unmountDataCenterPage() {
  // 清理模式订阅与实例
  for (const rs of opened.values()) { try { rs.cleanup?.(); } catch {} }
  opened.clear();
  deviceMap.clear();
  stopMockFeeder();
  if (root) { try { root.remove(); } catch {} root = null; }
}

  /* ---------------- 数据加载 ---------------- */
async function bootstrapData() {
  const [typesRes, modesRes] = await Promise.allSettled([
    apiDevTypes(), apiDevModes()
  ]);
  const types = typesRes.status==='fulfilled' ? (typesRes.value||{}) : {};
  const modes = modesRes.status==='fulfilled' ? (modesRes.value||{}) : {};

  // 缓存完整列表（索引 -> 真实 ID 映射在 reloadByFilters 用）
  const allTypes = Array.isArray(types.devTypeList) ? types.devTypeList : [];
  const allModes = Array.isArray(modes.devModeList) ? modes.devModeList : [];
  tree.__allTypes = allTypes;
  tree.__allModes = allModes;

  // 下拉展示（索引）：类型 0/1/2/3，模式 0/1/2/3
  const dcTypes = allTypes.slice(0, 3).map((t, idx) => ({ typeId: idx + 1, typeName: t.typeName }));
  const dcModes = allModes.slice(0, 3).map((m, idx) => ({ modeId: idx + 1, modeName: m.modeName }));

  try {
    tree.setData({
      devTypes: dcTypes,
      devModes: dcModes,   // TreePanel 会保存为 __sourceAllModes，并按类型联动
      groupedDevices: [],
      ungroupedDevices: [],
      expandLevel: 2,
      hideUngrouped: true
    });
  } catch (e) {}

  await reloadByFilters();
}

// 修改函数：reloadByFilters
async function reloadByFilters() {
  const f = tree.getFilterValues();
  const allTypes = Array.isArray(tree.__allTypes) ? tree.__allTypes : [];
  const allModes = Array.isArray(tree.__allModes) ? tree.__allModes : [];

  // 索引 -> 真实 ID 数组
  // 类型索引：0 -> 前三项全部；1/2/3 -> 对应 allTypes[0/1/2]
  const typeArr = (Number(f.devType) === 0)
    ? allTypes.slice(0,3).map(t => Number(t.typeId)).filter(Boolean)
    : (allTypes[Number(f.devType) - 1] ? [Number(allTypes[Number(f.devType) - 1].typeId)] : []);

  // 模式索引：0 -> 前三项全部；1/2/3 -> 对应 allModes[0/1/2]
  const modeArr = (Number(f.devMode) === 0)
    ? allModes.slice(0,3).map(m => Number(m.modeId)).filter(Boolean)
    : (allModes[Number(f.devMode) - 1] ? [Number(allModes[Number(f.devMode) - 1].modeId)] : []);

  const payload = {
    searchStr: f.searchStr,
    filterOnline: f.filterOnline,
    devTypeIdArr: typeArr,
    devModeIdArr: modeArr
  };

  const [gRes] = await Promise.allSettled([
    apiGroupedDevices(payload)
    // 数据中心不显示未分组，此处不再请求 3.16，避免多余流量
  ]);
  const grouped = gRes.status==='fulfilled' ? (gRes.value||{devList:[]}) : {devList:[]};

  try {
    tree.setData({
      groupedDevices: grouped.devList || [],
      ungroupedDevices: [], // 不显示未分组
      expandLevel: 2,
      hideUngrouped: true
    });
  } catch (e) {}

  // 建索引
  deviceMap.clear();
  const all = (grouped.devList || []);
  all.forEach(item => {
    const di = item.devInfo || {};
    deviceMap.set(Number(di.id), item);
  });
}
 

/* ---------------- 行管理 ---------------- */
function openDeviceRow(devId) {
  devId = Number(devId);
  if (!deviceMap.has(devId)) {
    eventBus.emit('toast:show', { type:'warn', message:'找不到设备数据' });
    return;
  }
  if (opened.has(devId)) {
    eventBus.emit('toast:show', { type:'info', message:'该设备已打开' });
    return;
  }
  if (opened.size >= MAX_ROWS) {
    eventBus.emit('toast:show', { type:'error', message:'没有空闲行' });
    return;
  }

  const item = deviceMap.get(devId);
  const di = item.devInfo || {}, ui = item.userInfo || {};
  const devNo = di.no || di.devNo || '';
  const devName = di.name || '';
  const ownerName = ui.userName || '';

  // 行 DOM
  const row = document.createElement('div'); row.className = 'dc-row'; row.setAttribute('data-dev-id', String(devId));
  row.innerHTML = `
    <div class="dc-row-hd">
      <div class="title">${escapeHTML(devNo)}</div>
      <div class="meta"><span>${escapeHTML(devName)}</span><span>${escapeHTML(ownerName)}</span></div>
      <div class="spacer"></div>
      <button type="button" class="btn-close" data-close="1" title="关闭">✕</button>
    </div>
    <div class="dc-row-bd"></div>
  `;
  listEl.appendChild(row);

  const body = row.querySelector('.dc-row-bd');
  const closeBtn = row.querySelector('[data-close]');

  // 依据后端顺序：取 devInfo.modeList 的前 1~3 个，且仅保留前端已支持的模式（1/2/3）
  const allow = new Set(PREF_MODES);
  const orderedMids = [];
  (di.modeList || []).forEach(m => {
    const mid = Number(m.modeId);
    if (allow.has(mid) && orderedMids.length < 3) orderedMids.push(mid);
  });

  // 渲染支持的模式卡
  const comps = [];     // { mid, inst?, unsub? }
  orderedMids.forEach(mid => {
    const cell = document.createElement('div'); cell.className = 'dc-thumb'; cell.setAttribute('data-mode', String(mid));
    const label = document.createElement('div'); label.className = 'label'; label.textContent = modeName(mid);
    cell.appendChild(label);

    const inst = createModeComponent(mid, devId);
    cell.appendChild(inst.el || inst);

    // 覆盖层用于点击打开详情
    const clickLayer = document.createElement('div');
    clickLayer.className = 'clickable';
    clickLayer.addEventListener('click', () => openModeDetailOverlay(devId, devNo, mid));
    cell.appendChild(clickLayer);

    try { inst.start?.(); } catch {}

    // 订阅 WS（示例：匹配 to.id / modeId）
    const unsub = wsHub.onMatch({ 'to.id': String(devId), 'modeId': String(mid) }, msg => {
      try { inst.setData?.(msg.data); } catch {}
    });
    // 发送订阅请求（示例：按你们后端改 cmd/结构）
    // wsHub.request({ cmd:'subscribeMode', to:{ type:3, id: Number(devId) }, data:{ modeId: mid } }).catch(()=>{});

    body.appendChild(cell);
    comps.push({ mid, inst, unsub });
  });

  // 行状态
  const cleanup = () => {
    comps.forEach(c => { try { c.unsub?.(); } catch {} try { c.inst?.destroy?.(); } catch {} });
    try { row.remove(); } catch {}
    opened.delete(devId);
  };
  closeBtn.addEventListener('click', cleanup);

  opened.set(devId, { row, comps, cleanup, devId, devNo });
}

function createModeComponent(mid, devId) {
  if (mid === 1) return createModeTilt({ devId });
  if (mid === 2) return createModeDispTilt({ devId });
  if (mid === 3) return createModeAudio({ devId });
  // 理论不会到这里（已在 orderedMids 里过滤）
  return createModeAudio({ devId });
}

/* ---------------- 本地模拟（所有已打开设备） ---------------- */
function startMockFeeder() {
  stopMockFeeder();
  mockTimer = setInterval(() => {
    opened.forEach((rs) => {
      (rs.comps || []).forEach((c) => {
        const payload = genMockResponse(rs.devId, c.mid);
        try { c.inst?.setData?.(payload); } catch {}
      });
    });
  }, MOCK_INTERVAL_MS);
}
function stopMockFeeder() {
  try { if (mockTimer) clearInterval(mockTimer); } catch {}
  mockTimer = null;
}

// ---- 生成三种模式的模拟数据（与现场页一致的结构）----
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

  // 倾角（modeId=1）
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

  // 位移·倾角（modeId=2）
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

  // 音频（modeId=3）
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

/* ---------------- Overlay（复用 SitePage 的桥接思路） ---------------- */
let __overlay = null;
function ensureOverlay() {
  if (__overlay && document.body.contains(__overlay.host)) return __overlay;

  const host = document.createElement('div');
  Object.assign(host.style, { position:'fixed', inset:'0', background:'#000', zIndex:'2147483645', display:'none' });
  const iframe = document.createElement('iframe');
  Object.assign(iframe.style, { position:'absolute', inset:'0', width:'100%', height:'100%', border:'0', background:'#000' });
  host.appendChild(iframe);
  document.body.appendChild(host);

  const chUnsub = new Map();
  const chKey = new Map();

  const onMsg = (e) => {
    const msg = e.data || {};
    if (!msg || !msg.__detail) return;
    switch (msg.t) {
      case 'ready': {
        const payload = Object.assign({ t:'init' }, (__overlay.initParams || {}));
        iframe.contentWindow?.postMessage(Object.assign({ __detail:true }, payload), '*');
        return;
      }
      case 'back': closeOverlay(); return;
      case 'openMode': openModeDetailOverlay(msg.devId, msg.devNo, msg.modeId); return;
      case 'ws:open': {
        const ch = Date.now() + Math.floor(Math.random()*1000);
        chKey.set(ch, { kind: msg.kind, devId: msg.devId, modeId: msg.modeId });
        const filter = {};
        if (msg.devId != null) filter['to.id'] = String(msg.devId);
        if (msg.modeId != null) filter['modeId'] = String(msg.modeId);
        const un = wsHub.onMatch(filter, m => {
          try { iframe.contentWindow?.postMessage({ __detail:true, t:'ws:message', ch, data:m }, '*'); } catch {}
        });
        chUnsub.set(ch, un);
        try { iframe.contentWindow?.postMessage({ __detail:true, t:'ws:open:ok', reqId: msg.reqId, ch }, '*'); } catch {}
        return;
      }
      case 'ws:send': {
        try { wsHub.send(msg.data); } catch {}
        return;
      }
      case 'ws:close': {
        const ch = msg.ch, un = chUnsub.get(ch);
        if (un) { try { un(); } catch {} }
        chUnsub.delete(ch); chKey.delete(ch);
        try { iframe.contentWindow?.postMessage({ __detail:true, t:'ws:closed', ch }, '*'); } catch {}
        return;
      }
    }
  };
  window.addEventListener('message', onMsg);

  __overlay = { host, iframe, onMsg, initParams: null, chUnsub, chKey };
  return __overlay;
}
function openOverlay(url, params) {
  const ov = ensureOverlay();
  const qs = new URLSearchParams(params || {});
  qs.set('_ts', Date.now());
  ov.initParams = Object.assign({}, params || {});
  ov.iframe.src = url + '?' + qs.toString();
  ov.host.style.display = 'block';
}
function closeOverlay() {
  if (!__overlay) return;
  try {
    for (const un of __overlay.chUnsub.values()) { try { un(); } catch {} }
    __overlay.chUnsub.clear?.();
  } catch {}
  __overlay.host.style.display = 'none';
  try { __overlay.iframe.src = 'about:blank'; } catch {}
}
function openModeDetailOverlay(devId, devNo, modeId) {
  const mid = Number(modeId);
  const url = mid===1 ? '/modules/features/pages/details/mode-tilt-detail.html'
            : mid===2 ? '/modules/features/pages/details/mode-disp-tilt-detail.html'
            : '/modules/features/pages/details/mode-audio-detail.html';
  openOverlay(url, { devId, devNo, modeId: mid });
}

/* ---------------- 工具 ---------------- */
function escapeHTML(str=''){ return String(str).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function debounce(fn, wait){ let t; return function(){ const a=arguments; clearTimeout(t); t=setTimeout(()=>fn.apply(null,a), wait||300); }; }
function initSplitter(leftWrap, splitter) {
  const MIN = 240, MAXVW = 50;
  splitter.addEventListener('mousedown', (e) => {
    if (leftWrap.classList.contains('collapsed')) return;
    const layoutRect = root.getBoundingClientRect();
    const maxPx = Math.floor(window.innerWidth * (MAXVW/100));
    const glass = document.createElement('div');
    Object.assign(glass.style, { position:'fixed', inset:'0', cursor:'col-resize', zIndex:'2147483646', background:'transparent', userSelect:'none' });
    document.body.appendChild(glass);
    const move = (ev) => {
      const x = (ev.clientX||0) - layoutRect.left;
      const w = Math.max(MIN, Math.min(Math.round(x), maxPx));
      leftWrap.style.width = w+'px';
      ev.preventDefault();
    };
    const end = () => {
      try { glass.remove(); } catch {}
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', end);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('blur', end);
      document.removeEventListener('visibilitychange', end);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end, { once:true });
    window.addEventListener('pointerup', end, { once:true });
    window.addEventListener('blur', end, { once:true });
    document.addEventListener('visibilitychange', end, { once:true });
    e.preventDefault();
  });
}
function bindTreeDeviceClick(treeEl, fn) {
  const handler = (e) => {
    const devId = (e && e.detail && (e.detail.devId || e.detail.id)) || e.devId || e.id;
    if (!devId) return;
    fn(Number(devId));
  };
  ['deviceclick','deviceClick','devclick','dev:click'].forEach(evt => {
    try { treeEl.addEventListener(evt, handler); } catch {}
  });
}
function modeName(mid){
  switch(Number(mid)){
    case 1: return '倾角模式';
    case 2: return '位移·倾角模式';
    case 3: return '音频模式';
    default: return '模式';
  }
}