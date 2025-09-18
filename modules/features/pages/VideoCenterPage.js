/**
 * 视频中心：不规则宫格（CSS Grid 跨行跨列 + gap + 迁移保留）
 * - 树状栏可折叠（与现场页一致，持久化）
 * - 空窗口仅显示纯黑面板；打开视频后才显示标题栏
 */
import { importTemplate } from '@ui/templateLoader.js';
import { createTreePanel } from './components/TreePanel.js';
import { apiDevTypes, apiDevModes, apiGroupedDevices } from '@api/deviceApi.js';
import { createVideoPreview } from './modes/VideoPreview.js';
import { eventBus } from '@core/eventBus.js';
import { wsHub } from '@core/hub.js';

const KEY_TREE_COLLAPSED = 'ui.videocenter.tree.collapsed';

/* 四行顺序 */
const PRESET_ROWS = [
  ['1','2','4','6u'],
  ['5','6s','7','8'],
  ['9','10','12','13'],
  ['16','25','36','50']
];

let root=null, left=null, splitter=null, grid=null, presetsEl=null, tree=null, closeAllBtn=null, layoutBtn=null, layoutPop=null;
let treeToggleBtn=null, treeHandleBtn=null;
let deviceMap = new Map();
let slots = [];            // 与布局 cell 对应：[{ idx, type, devId, devNo, main, sub, offStatus? }]
let opened = new Map();    // devId -> slotIndex
let currentPresetId = '12';
let __openOrderCache = null;

/* ---------- 布局定义（x,y,w,h，坐标从 1 开始） ---------- */
const LAYOUTS = {
  '1' : { cols:1, rows:1, cells:[[1,1,1,1]] },
  '2' : { cols:2, rows:1, cells:[[1,1,1,1],[2,1,1,1]] },
  '4' : { cols:2, rows:2, cells:uniform(2,2) },

  // 05：左上 2x2 大窗 + 右侧整列 1x2 高窗 + 底部三格（严格填满右侧整列）
  '5' : { cols:3, rows:3, cells:[
    [1,1,2,2],
    [3,1,1,2],
    [1,3,1,1],[2,3,1,1],[3,3,1,1]
  ] },

  '6u': { cols:3, rows:2, cells:uniform(3,2) },
  '6s': { cols:3, rows:3, cells:[[1,1,2,2],[3,1,1,1],[3,2,1,1],[1,3,1,1],[2,3,1,1],[3,3,1,1]] },
  '7' : { cols:3, rows:3, cells:[[2,1,1,3],[1,1,1,1],[1,2,1,1],[1,3,1,1],[3,1,1,1],[3,2,1,1],[3,3,1,1]] },
  '8' : { cols:4, rows:4, cells:[[1,1,3,3],[4,1,1,1],[4,2,1,1],[4,3,1,1],[1,4,1,1],[2,4,1,1],[3,4,1,1],[4,4,1,1]] },
  '9' : { cols:3, rows:3, cells:uniform(3,3) },
  '10': { cols:5, rows:5, cells:[[1,1,4,4],[5,1,1,1],[5,2,1,1],[5,3,1,1],[5,4,1,1],[1,5,1,1],[2,5,1,1],[3,5,1,1],[4,5,1,1],[5,5,1,1]] },
  '12': { cols:6, rows:6, cells:[[1,1,5,5],[6,1,1,1],[6,2,1,1],[6,3,1,1],[6,4,1,1],[6,5,1,1],[1,6,1,1],[2,6,1,1],[3,6,1,1],[4,6,1,1],[5,6,1,1],[6,6,1,1]] },
  '13': { cols:4, rows:4, cells:[[2,2,2,2],[1,1,1,1],[2,1,1,1],[3,1,1,1],[4,1,1,1],[1,2,1,1],[4,2,1,1],[1,3,1,1],[4,3,1,1],[1,4,1,1],[2,4,1,1],[3,4,1,1],[4,4,1,1]] },
  '16': { cols:4, rows:4, cells:uniform(4,4) },
  '25': { cols:5, rows:5, cells:uniform(5,5) },
  '36': { cols:6, rows:6, cells:uniform(6,6) },
  '50': { cols:10, rows:5, cells:uniform(10,5) }
};
function uniform(cols, rows){
  const arr=[]; for(let y=1;y<=rows;y++) for(let x=1;x<=cols;x++) arr.push([x,y,1,1]); return arr;
}

/* 面积优先 + 靠中心优先（“一个个打开”的顺序） */
function orderFromLayout(layout){
  const cx = (layout.cols+1)/2, cy=(layout.rows+1)/2;
  return layout.cells
    .map((c, idx) => {
      const [x,y,w,h]=c; const area=w*h;
      const mx=x+(w-1)/2, my=y+(h-1)/2;
      const d = Math.hypot(mx-cx, my-cy);
      return { idx, area, d, y, x };
    })
    .sort((a,b)=> b.area-a.area || a.d-b.d || a.y-b.y || a.x-b.x)
    .map(x=>x.idx);
}

/* ---------------- 生命周期 ---------------- */
export function mountVideoCenterPage() {
  const main = document.getElementById('mainView');
  main.innerHTML = '';
  main.style.padding = '0';
  main.style.overflow = 'hidden';
  if (!getComputedStyle(main).position || getComputedStyle(main).position === 'static') main.style.position = 'relative';

  const fit = () => { const top = main.getBoundingClientRect().top; const h = window.innerHeight - top; if (h > 0) main.style.height = h + 'px'; };
  fit(); window.addEventListener('resize', fit);

  importTemplate('/modules/features/pages/video-center-page.html', 'tpl-video-center-page')
    .then(async frag => {
      main.appendChild(frag);
      root = main.querySelector('#vcRoot');
      left = root.querySelector('#vcLeft');
      splitter = root.querySelector('#vcSplitter');
      grid = root.querySelector('#vcGrid');
      presetsEl = root.querySelector('#vcPresets');
      layoutBtn = root.querySelector('#vcLayoutBtn');
      layoutPop = root.querySelector('#vcLayoutPop');
      closeAllBtn = root.querySelector('#vcCloseAll');
      treeToggleBtn = root.querySelector('#vcTreeToggle');
      treeHandleBtn = root.querySelector('#vcTreeHandle');

      // 左树
      tree = createTreePanel();
      left.appendChild(tree);
      try { await tree.whenReady?.(); } catch {}

      // 折叠状态
      const initCollapsed = loadCollapsed();
      applyLeftCollapsed(initCollapsed);
      treeToggleBtn.addEventListener('click', () => {
        const next = !left.classList.contains('collapsed');
        applyLeftCollapsed(next); saveCollapsed(next);
      });
      treeHandleBtn.addEventListener('click', () => { applyLeftCollapsed(false); saveCollapsed(false); });

      // 分隔条
      initSplitter(left, splitter);

      // 筛选监听
      const onFilters = debounce(reloadByFilters, 250);
      ['filterchange','filtersChange','filterschange','filters:change'].forEach(evt => {
        try { tree.addEventListener(evt, onFilters); } catch {}
      });
      left.addEventListener('input', onFilters, true);
      left.addEventListener('change', onFilters, true);

      // 树设备点击
      bindTreeDeviceClick(tree, (devId) => openVideoForDevice(devId));

      // 弹窗+按钮
      renderPresets(currentPresetId);
      updateLayoutBtnIcon();
      layoutBtn?.addEventListener('click', toggleLayoutPop);
      document.addEventListener('click', (e)=>{ if (!layoutPop) return; if (layoutPop.contains(e.target) || layoutBtn.contains(e.target)) return; hideLayoutPop(); });
      window.addEventListener('resize', hideLayoutPop);
      closeAllBtn?.addEventListener('click', closeAllSlots);

      // 默认布局
      applyPreset(currentPresetId);

      // 首屏数据
      await bootstrapData();
    })
    .catch(err => console.error('[VideoCenter] template load failed', err));

  return unmountVideoCenterPage;
}

export function unmountVideoCenterPage() {
  for (let i=0;i<slots.length;i++) { try { closeSlot(i); } catch {} }
  slots = []; opened.clear(); deviceMap.clear();
  if (root) { try { root.remove(); } catch {} root = null; }
}

/* ---------------- 数据加载（固定 4） ---------------- */
async function bootstrapData() {
  const [typesRes, modesRes] = await Promise.allSettled([ apiDevTypes(), apiDevModes() ]);
  const types = typesRes.status==='fulfilled' ? (typesRes.value||{}) : {};
  const modes = modesRes.status==='fulfilled' ? (modesRes.value||{}) : {};

  const allTypes = Array.isArray(types.devTypeList) ? types.devTypeList : [];
  const allModes = Array.isArray(modes.devModeList) ? modes.devModeList : [];
  tree.__allTypes = allTypes; tree.__allModes = allModes;

  const t4 = allTypes[3], m4 = allModes[3];
  const vcTypes = t4 ? [{ typeId: 4, typeName: t4.typeName }] : [];
  const vcModes = m4 ? [{ modeId: 4, modeName: m4.modeName }] : [];

  try {
    tree.setData({
      devTypes: vcTypes,
      devModes: vcModes,
      groupedDevices: [],
      ungroupedDevices: [],
      expandLevel: 2,
      hideUngrouped: true
    });
    const modeSel = tree.controls?.modeSelect?.();
    if (modeSel) {
      modeSel.innerHTML = vcModes.map(m => `<option value="4">${m.modeName}</option>`).join('');
      modeSel.value = '4';
      modeSel.dispatchEvent(new Event('change', { bubbles:true }));
    }
  } catch {}

  await reloadByFilters();
}

async function reloadByFilters() {
  const allTypes = Array.isArray(tree.__allTypes) ? tree.__allTypes : [];
  const allModes = Array.isArray(tree.__allModes) ? tree.__allModes : [];
  const t4 = allTypes[3], m4 = allModes[3];

  const filters = tree.getFilterValues?.() || {};
  const payload = {
    searchStr: (filters.searchStr || ''),
    filterOnline: !!(filters.filterOnline),
    devTypeIdArr: t4 ? [Number(t4.typeId)] : [],
    devModeIdArr: m4 ? [Number(m4.modeId)] : []
  };

  const [gRes] = await Promise.allSettled([ apiGroupedDevices(payload) ]);
  const grouped = gRes.status==='fulfilled' ? (gRes.value||{devList:[]}) : {devList:[]};

  try {
    tree.setData({
      groupedDevices: grouped.devList || [],
      ungroupedDevices: [],
      expandLevel: 2,
      hideUngrouped: true
    });
  } catch {}

  deviceMap.clear();
  (grouped.devList || []).forEach(item => {
    const di = item.devInfo || {};
    deviceMap.set(Number(di.id), item);
  });
}

/* ---------------- 宫格弹窗 ---------------- */
function toggleLayoutPop(){
  if (!layoutPop || !layoutBtn) return;
  if (layoutPop.classList.contains('show')) { hideLayoutPop(); return; }
  // 定位到按钮下方
  const r = layoutBtn.getBoundingClientRect();
  const rootR = root.getBoundingClientRect();
  const top = r.bottom - rootR.top + 6; // 6px 间距
  const left = Math.min(r.left - rootR.left, rootR.width - 560 - 12);
  layoutPop.style.top = `${top}px`;
  layoutPop.style.left = `${Math.max(6, left)}px`;
  layoutPop.classList.add('show');
}
function hideLayoutPop(){ try{ layoutPop?.classList.remove('show'); }catch{} }

function updateLayoutBtnIcon(){
  if (!layoutBtn) return;
  const layout = LAYOUTS[currentPresetId] || LAYOUTS['12'];
  layoutBtn.innerHTML = renderIconMini(layout);
}
function labelOf(id){
  if (id==='6u' || id==='6s') return '06';
  return String(id).padStart(2,'0');
}
function renderIconMini(layout){
  // 主窗：面积最大
  let primary = 0, maxA=0;
  layout.cells.forEach((c,i)=>{ const a=c[2]*c[3]; if (a>maxA){ maxA=a; primary=i; } });
  const top = new Map(); const occ = Array.from({length:layout.rows+1}, ()=>Array(layout.cols+1).fill(-1));
  layout.cells.forEach((c,i)=>{ const [x,y,w,h]=c; top.set(`${x},${y}`,{i,w,h}); for(let yy=y; yy<y+h; yy++) for(let xx=x; xx<x+w; xx++) occ[yy][xx]=i; });
  let html = `<table class="ico-t"><tbody>`;
  for(let y=1;y<=layout.rows;y++){
    html += `<tr>`;
    for(let x=1;x<=layout.cols;x++){
      const t = top.get(`${x},${y}`);
      if (t){
        const cls = t.i===primary ? 'ico-td primary' : 'ico-td';
        html += `<td class="${cls}" colspan="${t.w}" rowspan="${t.h}"></td>`;
      } else if (occ[y][x] >= 0) {
        // 被跨越覆盖
      } else {
        html += `<td class="ico-td"></td>`;
      }
    }
    html += `</tr>`;
  }
  html += `</tbody></table>`;
  return html;
}

function renderPresets(activeId) {
  if (!presetsEl) return;
  presetsEl.innerHTML = '';
  PRESET_ROWS.forEach(row => {
    row.forEach(id => {
      const layout = LAYOUTS[id];
      const b = document.createElement('button');
      b.title = '选择布局';

      const wrap = document.createElement('div'); wrap.className = 'ico-wrap';
      wrap.innerHTML = renderIconMini(layout);

      const num = document.createElement('span'); num.className = 'num'; num.textContent = labelOf(id);

      b.appendChild(wrap); b.appendChild(num);

      if (id===activeId) b.classList.add('active');
      b.addEventListener('click', () => {
        applyPreset(id);                    // 迁移保留已开
        updateLayoutBtnIcon();
        // 激活态
        presetsEl.querySelectorAll('button').forEach(x=>x.classList.remove('active'));
        b.classList.add('active');
        hideLayoutPop();
      });
      presetsEl.appendChild(b);
    });
  });
}

/* 新增：创建单个 cell 的小工厂（默认空窗：隐藏标题栏） */
function createCell(idx){
  const cell = document.createElement('div');
  cell.className = 'vc-cell';
  cell.setAttribute('data-idx', String(idx));
  cell.setAttribute('aria-empty','1'); // 空窗：隐藏标题栏
  cell.innerHTML = `
    <div class="vc-hd"><div class="title" id="vcTitle${idx}"></div><button data-close="${idx}" title="关闭">✕</button></div>
    <div class="vc-bd" id="vcBody${idx}" data-free="1"></div>
  `;
  // 交互
  cell.querySelector('[data-close]').addEventListener('click', (ev)=>{ ev.stopPropagation(); closeSlot(idx); });
  cell.querySelector('.vc-hd').addEventListener('click', (e) => {
    if (e.target.closest?.('[data-close]')) return;
    const slot = slots[idx];
    if (slot && slot.devId) openDeviceDetailOverlay(slot.devId, slot.devNo);
  }, true);
  cell.querySelector('.vc-bd').addEventListener('click', (e) => {
    const slot = slots[idx]; if (!slot || !slot.devId) return;
    const targetPip = e.target.closest?.('.vc-pip');
    if (targetPip) openVideoDetailOverlay(slot.devId, slot.devNo, 'sub');
    else openVideoDetailOverlay(slot.devId, slot.devNo, 'main');
  }, true);
  return cell;
}

/* 应用布局：CSS Grid + 迁移保留（不销毁播放器）；空窗默认隐藏标题栏 */
function applyPreset(id) {
  const layout = LAYOUTS[id] || LAYOUTS['12'];
  const need = layout.cells.length;

  grid.style.gridTemplateColumns = `repeat(${layout.cols}, minmax(0,1fr))`;
  grid.style.gridTemplateRows = `repeat(${layout.rows}, minmax(0,1fr))`;

  const cur = slots.length;
  if (cur < need) {
    for (let i=cur; i<need; i++) {
      slots.push({ idx:i, type:null, devId:null, devNo:null, main:null, sub:null, offStatus:null });
      grid.appendChild(createCell(i));
    }
  }

  for (let i=0; i<need; i++) {
    const [x,y,w,h] = layout.cells[i];
    const cell = grid.querySelector(`.vc-cell[data-idx="${i}"]`);
    if (!cell) continue;
    cell.style.gridColumn = `${x} / span ${w}`;
    cell.style.gridRow = `${y} / span ${h}`;
  }

  if (cur > need) {
    for (let i=cur-1; i>=need; i--) {
      if (slots[i] && slots[i].type) { try { closeSlot(i); } catch {} }
      try { grid.querySelector(`.vc-cell[data-idx="${i}"]`)?.remove(); } catch {}
      slots.pop();
    }
  }

  currentPresetId = id;
  __openOrderCache = orderFromLayout(layout);
}

/* 用于在容量变小且必须关闭时，安全关闭某个旧槽对象（不依赖 DOM 仍在不在） */
function safeCloseSlotObject(s){
  try { s.main?.destroy?.(); } catch {}
  try { s.sub?.destroy?.(); } catch {}
  if (s.offStatus) { try { s.offStatus(); } catch {} }
  if (s.devId != null) opened.delete(s.devId);
}

/* ---------------- 打开/关闭 ---------------- */
function findFreeSlot() {
  // 与切换宫格后的排布保持一致：slots 的索引即当前布局 cells 的顺序
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const body = document.getElementById('vcBody' + i);
    const isFreeDom = body && body.getAttribute('data-free') !== '0';
    if (s && !s.type && isFreeDom) return i;
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
  if (cameraCount < 1) { eventBus.emit('toast:show', { type:'warn', message:'设备不支持打开视频' }); return; }

  const cell = grid.querySelector(`.vc-cell[data-idx="${slotIdx}"]`);
  const body = document.getElementById('vcBody'+slotIdx);
  const title = document.getElementById('vcTitle'+slotIdx);

  const main = createVideoPreview({ objectFit:'fill' });
  body.innerHTML=''; body.appendChild(main);
  body.setAttribute('data-free','0');
  title.textContent = `${devNo} 视频（主码流）`;
  if (cell) cell.setAttribute('aria-empty','0'); // 显示标题栏

  slots[slotIdx].type = 'video';
  slots[slotIdx].devId = devId;
  slots[slotIdx].devNo = devNo;
  slots[slotIdx].main = main;
  slots[slotIdx].sub = null;
  opened.set(devId, slotIdx);

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
    await main.play('webrtc://media.szdght.com/1/camera_audio');
    if (slots[slotIdx].sub) await slots[slotIdx].sub.play('webrtc://media.szdght.com/1/camera_audio_sub');
  } catch(e) {
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
  const cell = grid.querySelector(`.vc-cell[data-idx="${idx}"]`);
  const body = document.getElementById('vcBody'+idx);
  const title = document.getElementById('vcTitle'+idx);
  if (opts.removeCell) {
    try { grid.querySelector(`.vc-cell[data-idx="${idx}"]`)?.remove(); } catch {}
  } else {
    if (body) { body.innerHTML=''; body.setAttribute('data-free','1'); }
    if (title) title.textContent = '';
    if (cell) cell.setAttribute('aria-empty','1'); // 恢复“纯黑面板”
  }
  if (devId != null) opened.delete(devId);
}

function closeAllSlots(){ for (let i=0;i<slots.length;i++) { try { closeSlot(i); } catch {} } }

/* ---------------- Overlay ---------------- */
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
function openDeviceDetailOverlay(devId, devNo){ openOverlay('/modules/features/pages/details/device-detail.html', { devId, devNo }); }

/* ---------------- 树折叠 ---------------- */
function applyLeftCollapsed(flag){
  const toggle = document.getElementById('vcTreeToggle');
  const handle = document.getElementById('vcTreeHandle');
  if (!left || !root || !toggle || !handle) return;
  if (flag) {
    if (!left.dataset.prevW) {
      const w = left.getBoundingClientRect().width; if (w>0) left.dataset.prevW = w+'px';
    }
    left.classList.add('collapsed');
    root.classList.add('left-collapsed');
    toggle.textContent = '»'; toggle.title = '展开树状栏';
    handle.textContent = '»'; handle.title = '展开树状栏';
  } else {
    left.classList.remove('collapsed');
    root.classList.remove('left-collapsed');
    toggle.textContent = '«'; toggle.title = '折叠树状栏';
    handle.textContent = '«'; handle.title = '折叠树状栏';
    left.style.width = left.dataset.prevW || '320px';
  }
}
function loadCollapsed(){ try{ return localStorage.getItem(KEY_TREE_COLLAPSED) === '1'; } catch { return false; } }
function saveCollapsed(v){ try{ localStorage.setItem(KEY_TREE_COLLAPSED, v?'1':'0'); } catch {} }

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