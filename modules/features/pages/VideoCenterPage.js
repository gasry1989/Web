/**
 * VideoCenterPage
 * - 共用 TreePanel
 * - 布局预设：1/2/4/6/9/12/13/16/25/36/50（一次性提供）
 * - 打开规则：cameraCount <1 不支持；=1 主码流；>=2 主码流 + 右下角画中画（副码流）
 * - 不重复打开设备；满格 toast “没有空闲位置”
 * - 点击主画面/小窗分别打开对应 stream 的视频详情 Overlay
 * - WS：提供 pushStream 请求示例与订阅示例
 */
import { importTemplate } from '@ui/templateLoader.js';
import { createTreePanel } from './components/TreePanel.js';
import { apiDevTypes, apiDevModes, apiGroupedDevices, apiUngroupedDevices } from '@api/deviceApi.js';
import { createVideoPreview } from './modes/VideoPreview.js';
import { eventBus } from '@core/eventBus.js';
import { wsHub } from '@core/hub.js';

const PRESETS = [1,2,4,6,9,12,13,16,25,36,50];

let root=null, left=null, splitter=null, grid=null, presetsEl=null, tree=null;
let deviceMap = new Map(); // devId -> { userInfo, devInfo }
let slots = [];            // 按当前容量生成的槽位
let opened = new Map();    // devId -> slotIndex

export function mountVideoCenterPage() {
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

  importTemplate('/modules/features/pages/video-center-page.html', 'tpl-video-center-page')
    .then(async frag => {
      main.appendChild(frag);
      root = main.querySelector('#vcRoot');
      left = root.querySelector('#vcLeft');
      splitter = root.querySelector('#vcSplitter');
      grid = root.querySelector('#vcGrid');
      presetsEl = root.querySelector('#vcPresets');

      // 左树
      tree = createTreePanel();
      left.appendChild(tree);
      try { await tree.whenReady?.(); } catch {}

      // 分隔条
      initSplitter(left, splitter);

      // 筛选监听
      const onFilters = debounce(reloadByFilters, 250);
      ['filterchange','filtersChange','filterschange','filters:change'].forEach(evt => {
        try { tree.addEventListener(evt, onFilters); } catch {}
      });
      left.addEventListener('input', onFilters, true);
      left.addEventListener('change', onFilters, true);

      // 设备点击
      bindTreeDeviceClick(tree, (devId) => openVideoForDevice(devId));

      // 预设按钮
      renderPresets(9); // 默认 9 宫格
      applyPreset(9);

      // 首屏数据
      await bootstrapData();
    })
    .catch(err => console.error('[VideoCenter] template load failed', err));

  return unmountVideoCenterPage;
}

export function unmountVideoCenterPage() {
  // 清理所有槽位
  for (let i=0;i<slots.length;i++) { try { closeSlot(i); } catch {} }
  slots = []; opened.clear(); deviceMap.clear();
  if (root) { try { root.remove(); } catch {} root = null; }
}

/* ---------------- 数据加载 ---------------- */
// 修改函数：bootstrapData
async function bootstrapData() {
  const [typesRes, modesRes] = await Promise.allSettled([ apiDevTypes(), apiDevModes() ]);
  const types = typesRes.status==='fulfilled' ? (typesRes.value||{}) : {};
  const modes = modesRes.status==='fulfilled' ? (modesRes.value||{}) : {};

  // 缓存完整列表（用于“索引 -> 真实ID”的映射）
  const allTypes = Array.isArray(types.devTypeList) ? types.devTypeList : [];
  const allModes = Array.isArray(modes.devModeList) ? modes.devModeList : [];
  tree.__allTypes = allTypes;
  tree.__allModes = allModes;

  // 视频中心下拉显示：类型仅索引 4；模式仅索引 4
  const t4 = allTypes[3]; // 第 4 项（索引从 0 开始）
  const m4 = allModes[3];
  const vcTypes = t4 ? [{ typeId: 4, typeName: t4.typeName }] : [];
  const vcModes = m4 ? [{ modeId: 4, modeName: m4.modeName }] : [];

  try {
    tree.setData({
      devTypes: vcTypes,
      devModes: vcModes, // setData 会默认加“全部(0)”，下面移除
      groupedDevices: [],
      ungroupedDevices: [],
      expandLevel: 2,
      hideUngrouped: true
    });

    // 模式只保留索引 4（移除“全部(0)”）
    const modeSel = tree.controls?.modeSelect?.();
    if (modeSel) {
      modeSel.innerHTML = vcModes.map(m => `<option value="4">${m.modeName}</option>`).join('');
      modeSel.value = '4';
      modeSel.dispatchEvent(new Event('change', { bubbles:true }));
    }
  } catch {}

  await reloadByFilters();
}

// 修改函数：reloadByFilters
async function reloadByFilters() {
  // 直接按索引 4 取真实 ID
  const allTypes = Array.isArray(tree.__allTypes) ? tree.__allTypes : [];
  const allModes = Array.isArray(tree.__allModes) ? tree.__allModes : [];
  const t4 = allTypes[3];
  const m4 = allModes[3];

  const payload = {
    searchStr: (tree.getFilterValues().searchStr || ''),
    filterOnline: !!(tree.getFilterValues().filterOnline),
    devTypeIdArr: t4 ? [Number(t4.typeId)] : [],
    devModeIdArr: m4 ? [Number(m4.modeId)] : []
  };

  const [gRes] = await Promise.allSettled([ apiGroupedDevices(payload) ]);
  const grouped = gRes.status==='fulfilled' ? (gRes.value||{devList:[]}) : {devList:[]};

  try {
    tree.setData({
      groupedDevices: grouped.devList || [],
      ungroupedDevices: [], // 不显示未分组
      expandLevel: 2,
      hideUngrouped: true
    });
  } catch {}

  // 索引
  deviceMap.clear();
  const all = (grouped.devList || []);
  all.forEach(item => {
    const di = item.devInfo || {};
    deviceMap.set(Number(di.id), item);
  });
}

/* ---------------- 布局 ---------------- */
function renderPresets(active) {
  presetsEl.innerHTML = '';
  PRESETS.forEach(n => {
    const b = document.createElement('button');
    b.textContent = String(n).padStart(2,'0');
    if (n===active) b.classList.add('active');
    b.addEventListener('click', () => {
      presetsEl.querySelectorAll('button').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      applyPreset(n);
    });
    presetsEl.appendChild(b);
  });
}
function applyPreset(n) {
  // 计算列数：尽量接近方形
  let cols = Math.ceil(Math.sqrt(n));
  // 对常见预设做手工调整以视觉更好
  if (n===2) cols = 2;
  if (n===4) cols = 2;
  if (n===6) cols = 3;
  if (n===9) cols = 3;
  if (n===12) cols = 4;
  if (n===13) cols = 4; // 用 4x4，最后 3 个用作空槽
  if (n===16) cols = 4;
  if (n===25) cols = 5;
  if (n===36) cols = 6;
  if (n===50) cols = 10;
  grid.setAttribute('data-cols', String(cols));

  // 生成/收缩槽位
  const need = n;
  const cur = slots.length;
  if (cur > need) {
    for (let i=need;i<cur;i++) closeSlot(i, {removeCell:true});
    slots.length = need;
  } else if (cur < need) {
    for (let i=cur;i<need;i++) {
      slots.push({ idx:i, type:null, devId:null, devNo:null, main:null, sub:null });
      const cell = document.createElement('div'); cell.className = 'vc-cell'; cell.setAttribute('data-idx', String(i));
      cell.innerHTML = `
        <div class="vc-hd"><div class="title" id="vcTitle${i}">空闲</div><button data-close="${i}" title="关闭">✕</button></div>
        <div class="vc-bd" id="vcBody${i}" data-free="1"></div>
      `;
      grid.appendChild(cell);
      // 关闭
      cell.querySelector('[data-close]').addEventListener('click', () => closeSlot(i));
      // 点击打开详情：主/副分别识别
      cell.querySelector('.vc-bd').addEventListener('click', (e) => {
        const slot = slots[i]; if (!slot || !slot.devId) return;
        const targetPip = e.target.closest?.('.vc-pip');
        if (targetPip) openVideoDetailOverlay(slot.devId, slot.devNo, 'sub');
        else openVideoDetailOverlay(slot.devId, slot.devNo, 'main');
      }, true);
    }
  }
}

/* ---------------- 打开/关闭 ---------------- */
function findFreeSlot() {
  for (let i=0;i<slots.length;i++) {
    if (!slots[i].type) return i;
  }
  return -1;
}

async function openVideoForDevice(devId) {
  devId = Number(devId);
  if (!deviceMap.has(devId)) { eventBus.emit('toast:show', { type:'warn', message:'找不到设备数据' }); return; }
  if (opened.has(devId)) { eventBus.emit('toast:show', { type:'info', message:'该设备已打开' }); return; }

  const slotIdx = findFreeSlot();
  if (slotIdx === -1) { eventBus.emit('toast:show', { type:'error', message:'没有空闲位置' }); return; }

  const item = deviceMap.get(devId);
  const di = item.devInfo || {};
  const devNo = di.no || '';
  const cameraCount = Math.max(0, Number(di?.hardwareInfo?.cameraCount) || 0);

  if (cameraCount < 1) {
    eventBus.emit('toast:show', { type:'warn', message:'设备不支持打开视频' });
    return;
  }

  const body = document.getElementById('vcBody'+slotIdx);
  const title = document.getElementById('vcTitle'+slotIdx);

  // 主码流
  const main = createVideoPreview({ objectFit:'fill' });
  body.innerHTML = ''; body.appendChild(main);
  body.setAttribute('data-free','0');
  title.textContent = `${devNo} 视频（主码流）`;

  slots[slotIdx].type = 'video';
  slots[slotIdx].devId = devId;
  slots[slotIdx].devNo = devNo;
  slots[slotIdx].main = main;
  slots[slotIdx].sub = null;
  opened.set(devId, slotIdx);

  // 画中画（副码流）
  if (cameraCount >= 2) {
    const pipWrap = document.createElement('div');
    pipWrap.className = 'vc-pip';
    pipWrap.setAttribute('data-stream','sub');
    const sub = createVideoPreview({ objectFit:'fill' });
    pipWrap.appendChild(sub);
    body.appendChild(pipWrap);
    slots[slotIdx].sub = sub;
  }

  try {
    // 示例：固定 URL（如需按设备定制，请改为你的拼装规则）
    await main.play('webrtc://media.szdght.com/1/camera_audio');
    if (slots[slotIdx].sub) {
      await slots[slotIdx].sub.play('webrtc://media.szdght.com/1/camera_audio_sub');
    }
    // WS 示例：向设备发起推流请求（按你的后端协议调整 cmd/to）
    // wsHub.request({ cmd:'pushStream', to:{ type:1, id: Number(devId) }, data:{ stream: (cameraCount>=2?'main+sub':'main') } }).catch(()=>{});
    // 订阅状态变更（示例）
    // const off = wsHub.onMatch({ 'to.id': String(devId) }, msg => { /* 根据 msg 更新 UI */ });
    // slots[slotIdx].offStatus = off;
  } catch (e) {
    eventBus.emit('toast:show', { type:'error', message:'拉流失败' });
    closeSlot(slotIdx);
  }
}

function closeSlot(idx, opts = {}) {
  const s = slots[idx]; if (!s) return;
  const devId = s.devId;
  try { s.main?.destroy?.(); } catch {}
  try { s.sub?.destroy?.(); } catch {}
  if (s.offStatus) { try { s.offStatus(); } catch {} }
  s.type = null; s.devId=null; s.devNo=null; s.main=null; s.sub=null;
  const body = document.getElementById('vcBody'+idx);
  const title = document.getElementById('vcTitle'+idx);
  if (opts.removeCell) {
    try { grid.querySelector(`.vc-cell[data-idx="${idx}"]`)?.remove(); } catch {}
  } else {
    if (body) { body.innerHTML=''; body.setAttribute('data-free','1'); }
    if (title) title.textContent = '空闲';
  }
  if (devId != null) opened.delete(devId);
}

/* ---------------- Overlay（与 DataCenter/ SitePage 同思路） ---------------- */
let __overlay = null;
function ensureOverlay() {
  if (__overlay && document.body.contains(__overlay.host)) return __overlay;
  const host = document.createElement('div');
  Object.assign(host.style, { position:'fixed', inset:'0', background:'#000', zIndex:'2147483645', display:'none' });
  const iframe = document.createElement('iframe');
  Object.assign(iframe.style, { position:'absolute', inset:'0', width:'100%', height:'100%', border:'0', background:'#000' });
  host.appendChild(iframe); document.body.appendChild(host);

  const chUnsub = new Map(), chKey = new Map();
  const onMsg = (e) => {
    const msg = e.data || {}; if (!msg || !msg.__detail) return;
    switch (msg.t) {
      case 'ready': {
        const payload = Object.assign({ t:'init' }, (__overlay.initParams || {}));
        iframe.contentWindow?.postMessage(Object.assign({ __detail:true }, payload), '*'); return;
      }
      case 'back': closeOverlay(); return;
      case 'ws:open': {
        const ch = Date.now()+Math.floor(Math.random()*1000);
        chKey.set(ch, { kind: msg.kind, devId: msg.devId, stream: msg.stream });
        const filter = {}; if (msg.devId != null) filter['to.id'] = String(msg.devId);
        const un = wsHub.onMatch(filter, m => {
          try { iframe.contentWindow?.postMessage({ __detail:true, t:'ws:message', ch, data:m }, '*'); } catch {}
        });
        chUnsub.set(ch, un);
        try { iframe.contentWindow?.postMessage({ __detail:true, t:'ws:open:ok', reqId: msg.reqId, ch }, '*'); } catch {}
        return;
      }
      case 'ws:send': { try { wsHub.send(msg.data); } catch {} return; }
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
  __overlay = { host, iframe, onMsg, initParams:null, chUnsub, chKey }; return __overlay;
}
function openOverlay(url, params){
  const ov = ensureOverlay();
  const qs = new URLSearchParams(params || {}); qs.set('_ts', Date.now());
  ov.initParams = Object.assign({}, params||{}); ov.iframe.src = url + '?' + qs.toString();
  ov.host.style.display = 'block';
}
function closeOverlay(){ if(!__overlay) return; try{ for (const un of __overlay.chUnsub.values()) { try{ un(); }catch{} } __overlay.chUnsub.clear?.(); }catch{}; __overlay.host.style.display='none'; try{ __overlay.iframe.src='about:blank'; }catch{} }
function openVideoDetailOverlay(devId, devNo, stream){ openOverlay('/modules/features/pages/details/video-detail.html', { devId, devNo, stream: stream||'main' }); }

/* ---------------- 工具 ---------------- */
function debounce(fn, wait){ let t; return function(){ const a=arguments; clearTimeout(t); t=setTimeout(()=>fn.apply(null,a), wait||300); }; }
function initSplitter(leftWrap, splitter) {
  const MIN=240, MAXVW=50;
  splitter.addEventListener('mousedown', (e)=>{
    if (leftWrap.classList.contains('collapsed')) return;
    const rect = root.getBoundingClientRect();
    const maxPx = Math.floor(window.innerWidth*(MAXVW/100));
    const glass = document.createElement('div'); Object.assign(glass.style,{position:'fixed',inset:'0',cursor:'col-resize',zIndex:'2147483646',background:'transparent',userSelect:'none'}); document.body.appendChild(glass);
    const move = (ev)=>{ const x=(ev.clientX||0)-rect.left; const w=Math.max(MIN, Math.min(Math.round(x), maxPx)); leftWrap.style.width=w+'px'; ev.preventDefault(); };
    const end = ()=>{ try{glass.remove();}catch{}; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', end); window.removeEventListener('pointerup', end); window.removeEventListener('blur', end); document.removeEventListener('visibilitychange', end); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', end, {once:true}); window.addEventListener('pointerup', end, {once:true}); window.addEventListener('blur', end, {once:true}); document.addEventListener('visibilitychange', end, {once:true}); e.preventDefault();
  });
}
function bindTreeDeviceClick(treeEl, fn){
  const handler = (e) => { const devId=(e && e.detail && (e.detail.devId||e.detail.id)) || e.devId || e.id; if (!devId) return; fn(Number(devId)); };
  ['deviceclick','deviceClick','devclick','dev:click'].forEach(evt=>{ try{ treeEl.addEventListener(evt, handler); }catch{} });
}