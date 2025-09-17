import { mountTopbar, detailBridge } from './common/detail-common.js';
import { STREAMS } from '/config/streams.js';
import { createVideoPreview } from '../modes/VideoPreview.js';
import { createModeTilt } from '../modes/ModeTilt.js';
import { createModeDispTilt } from '../modes/ModeDispTilt.js';
import { createModeAudio } from '../modes/ModeAudio.js';
import { apiDeviceInfo } from '@api/deviceApi.js';
import { authLoadToken } from '@core/auth.js';
import { openEditDeviceInfoModal } from '../modals/EditDeviceInfoModal.js';
import { openEditDeviceOwnerModal } from '../modals/EditDeviceOwnerModal.js';

try { authLoadToken(); } catch {}

const ui = mountTopbar(document.body);
const bridge = detailBridge();

// 先读 URL；若没有，再等待父页下发的 init 兜底拿 devId/devNo
const qs = new URLSearchParams(location.search);
let devId = qs.get('devId') || '';
let devNo = qs.get('devNo') || '';

bridge.ready({ page:'device', devId, devNo });

if (!devId) {
  const init = await bridge.waitInit();
  devId = String(init?.devId || '');
  devNo = devNo || String(init?.devNo || '');
  ui.lblDevNo.textContent = devNo || devId || '设备';
} else {
  ui.lblDevNo.textContent = devNo || devId || '设备';
}

// 布局
const main = document.createElement('div'); main.className='main';
main.innerHTML = `
  <div class="left" id="leftPane">
    <div id="secScreen" class="section">
      <h3>设备屏幕</h3>
      <div class="rail video" id="rowScreen" style="--cols:1;">
        <div class="card" id="cellScreen"><div class="label">屏幕</div></div>
      </div>
    </div>

    <div id="secMedia" class="section">
      <h3>媒体流</h3>
      <div class="rail video" id="rowMedia" style="--cols:2;">
        <div class="card" id="cellMain"><div class="label">主码流</div></div>
        <div class="card" id="cellSub"><div class="label">副码流</div></div>
      </div>
    </div>

    <div id="secModes" class="section modes">
      <h3>设备模式</h3>
      <div class="rail mode" id="rowModes" style="--cols:3;">
        <div class="card mode" id="cellModeTilt"></div>
        <div class="card mode" id="cellModeDispTilt"></div>
        <div class="card mode" id="cellModeAudio"></div>
      </div>
    </div>
  </div>

  <div class="right">
    <div class="kv"><div>设备ID：</div><div id="devIdLbl"></div></div>
    <div class="kv"><div>设备名称：</div><div id="devNameLbl">--</div></div>
    <div class="kv"><div>设备类型：</div><div id="devTypeLbl">--</div></div>
    <div class="kv"><div>支持模式：</div><div id="devModesLbl">--</div></div>
    <div class="kv"><div>所属用户ID：</div><div id="ownerIdLbl">--</div></div>
    <div class="kv"><div>所属用户帐号：</div><div id="ownerAccLbl">--</div></div>

    <div class="btnLine" style="margin-top:18px;">
      <button class="btn" id="btnEditInfo">编辑信息</button>
      <button class="btn" id="btnEditOwner">编辑属主</button>
    </div>
  </div>
`;
document.body.appendChild(main);
document.getElementById('devIdLbl').textContent = devId || '--';

/* ------------- 视频预览（填充） ------------- */
const mountedPreviews = [];
function mountPreview(cellId, url){
  const cell = document.getElementById(cellId);
  if (!cell) return;
  const vp = createVideoPreview({ objectFit:'fill' });
  cell.appendChild(vp);
  mountedPreviews.push(vp);
  vp.play(url).catch(err=>console.warn('[device-detail] preview play failed', cellId, err));
}

// 新增：每次刷新前清理已挂载的预览，避免重复叠加
function destroyAllPreviews(){
  try{
    mountedPreviews.forEach(p=>{
      try{ p.destroy && p.destroy(); }catch{}
      try{ p.remove && p.remove(); }catch{}
    });
  }catch{}
  mountedPreviews.length = 0;
  // 只移除卡片内除 label 外的动态子节点
  ['cellScreen','cellMain','cellSub'].forEach(id=>{
    const cell = document.getElementById(id);
    if (!cell) return;
    Array.from(cell.children).forEach(ch=>{
      if (ch.classList && ch.classList.contains('label')) return;
      ch.remove();
    });
  });
}

/* ------------- 模式预览（占满剩余高度） + Mock ------------- */
const mountedModes = [];
function mountMode(cellId, factory){
  const cell = document.getElementById(cellId);
  if (!cell) return;
  const mp = factory({ devId });
  try { mp.el.style.width = '100%'; mp.el.style.height = '100%'; mp.el.style.display = 'block'; } catch {}
  cell.appendChild(mp.el);
  try { if (typeof mp.start === 'function') mp.start(); } catch (e) { console.warn('[device-detail] mode start error', cellId, e); }
  mountedModes.push({ id: cellId, mp });
}
mountMode('cellModeTilt', createModeTilt);
mountMode('cellModeDispTilt', createModeDispTilt);
mountMode('cellModeAudio', createModeAudio);

// 音频/倾角/位移·倾角 mock feeder（省略生成函数，这里与 SitePage 一致的 12/<=12 逻辑）
const mockState = new Map();
let mockTimer = null;
function clamp(v,min,max){ return v<min?min:(v>max?max:v); }
function step(v,amp,min,max){ return clamp(v + (Math.random()*2-1)*amp, min, max); }
function prob(p){ return Math.random() < p; }
function rnd(a,b){ return Math.random()*(b-a)+a; }
function genTilt(){
  const key='tilt'; if(!mockState.has(key)) mockState.set(key,{items:[]});
  const st=mockState.get(key);
  if (!st.items || prob(0.10)) {
    const n = Math.floor(rnd(4,13));
    st.items = Array.from({length:n}, (_,i)=>({ name:'倾角'+(i+1)+'#', deg:rnd(0,1.2), batt:rnd(60,100), alarmOn:Math.random()>.2, sirenOn:Math.random()>.2 }));
  }
  st.items.forEach(it=> it.deg = step(it.deg, 0.12, 0, 1.5));
  return { items: st.items.slice(0,12).map(x=>({ ...x })) };
}
function genDispTilt(){
  const key='disptilt'; if(!mockState.has(key)) mockState.set(key,{list:[]});
  const st=mockState.get(key);
  if (!st.list || prob(0.10)) {
    const total = Math.floor(rnd(4,13));
    const nDisp = total > 0 ? Math.floor(rnd(0, total+1)) : 0;
    const nTilt = total - nDisp;
    const list = [];
    for (let i=0;i<nDisp;i++) list.push({ type:'位移', badge: Math.floor(rnd(10,99)), batt: rnd(60,100), sirenOn: Math.random()>.3, value: rnd(0,0.012) });
    for (let i=0;i<nTilt;i++) list.push({ type:'倾角', badge: Math.floor(rnd(60,99)), batt: rnd(60,100), sirenOn: Math.random()>.3, valueDeg: rnd(0,0.30) });
    st.list = list;
  }
  st.list.forEach(it=>{ if (it.type==='位移') it.value = clamp(it.value + (Math.random()*2-1)*0.002, 0, 0.012); else it.valueDeg = clamp(it.valueDeg + (Math.random()*2-1)*0.03, 0, 0.30); });
  return {
    items: st.list.slice(0,12).map(it=> it.type==='位移'
      ? { type:'位移', badge: it.badge, batt: it.batt, sirenOn: it.sirenOn, valueText: it.value.toFixed(3)+'m' }
      : { type:'倾角', badge: it.badge, batt: it.batt, sirenOn: it.sirenOn, valueText: it.valueDeg.toFixed(2)+'°' })
  };
}
function genAudioFixed12(){
  const key='audio12';
  if (!mockState.has(key)) {
    mockState.set(key, {
      labels: Array.from({length:12}, (_,i)=> i+1),
      values: Array.from({length:12}, ()=> rnd(0,100)),
      batteries: Array.from({length:12}, ()=> rnd(40,100))
    });
  }
  const st = mockState.get(key);
  for (let i=0;i<12;i++){
    st.values[i] = clamp(st.values[i] + (Math.random()*2-1)*8, 0, 100);
    if (prob(0.05)) st.batteries[i] = clamp(st.batteries[i] + (Math.random()*2-1)*3, 0, 100);
  }
  return { labels: st.labels, values: st.values, batteries: st.batteries };
}
function startMock(){
  stopMock();
  mockTimer = setInterval(()=>{
    for (const it of mountedModes){
      const setData = it?.mp?.setData;
      if (typeof setData !== 'function') continue;
      if (it.id === 'cellModeTilt') setData(genTilt());
      else if (it.id === 'cellModeDispTilt') setData(genDispTilt());
      else if (it.id === 'cellModeAudio') setData(genAudioFixed12());
    }
  }, 300);
}
function stopMock(){ try{ if (mockTimer) clearInterval(mockTimer); }catch{} mockTimer=null; }
startMock();

/* ------------------- 根据设备能力动态隐藏并重排 ------------------- */
function setCols(el, n){ if (el) el.style.setProperty('--cols', String(Math.max(0, n))); }
function hide(el, flag){ if (!el) return; el.classList.toggle('hide', !!flag); }

let currentDeviceInfo = null;

async function loadDeviceInfoAndLayout(){
if (!devId) return;
try{
  const resp = await apiDeviceInfo(Number(devId));
  const d = (resp && resp.devInfo) ? resp.devInfo : {};
  currentDeviceInfo = d;

  // 右侧信息
  document.getElementById('devIdLbl').textContent   = d.id ?? devId ?? '--';
  document.getElementById('devNameLbl').textContent = d.name || d.no || '--';
  document.getElementById('devTypeLbl').textContent = d.typeName || '--';

  // 修复点：严格使用 modeList[].modeName，英文逗号拼接
  let modeNames = '--';
  if (Array.isArray(d.modeList) && d.modeList.length) {
    modeNames = d.modeList
      .map(m => (m && (m.modeName ?? m.name)) || '')
      .filter(Boolean)
      .join(',');
  }
  document.getElementById('devModesLbl').textContent = modeNames;

  document.getElementById('ownerIdLbl').textContent  = (d.parentUserId ?? d.ownerUserId ?? '--');
  document.getElementById('ownerAccLbl').textContent = (d.parentUserAccount ?? d.ownerUserAccount ?? '无');

  // 先清理已有预览，避免重复叠加
  destroyAllPreviews();

  // 视频能力
  const screenCount = Number(d?.hardwareInfo?.screenCount ?? 0);
  const cameraCount = Number(d?.hardwareInfo?.cameraCount ?? 0);

  const hasScreen = screenCount > 0;
  const hasMain = cameraCount > 0;
  const hasSub  = cameraCount > 0;

  if (hasScreen) mountPreview('cellScreen', STREAMS.screen);
  hide(document.getElementById('secScreen'), !hasScreen);
  setCols(document.getElementById('rowScreen'), hasScreen ? 1 : 0);

  const mediaCards = [];
  if (hasMain) { mountPreview('cellMain', STREAMS.main); mediaCards.push(1); } else hide(document.getElementById('cellMain'), true);
  if (hasSub)  { mountPreview('cellSub',  STREAMS.sub);  mediaCards.push(1); } else hide(document.getElementById('cellSub'), true);
  hide(document.getElementById('secMedia'), mediaCards.length === 0);
  setCols(document.getElementById('rowMedia'), mediaCards.length);

  // 模式支持（沿用原逻辑）
  let supportTilt = true, supportDispTilt = true, supportAudio = true;
  if (Array.isArray(d.modeList) && d.modeList.length) {
    const names = d.modeList.map(m=>String(m.name||''));
    supportTilt     = names.some(n=>/倾角/.test(n));
    supportDispTilt = names.some(n=>/位移|倾角/.test(n));
    supportAudio    = names.some(n=>/音频/.test(n));
    if (!supportTilt && !supportDispTilt && !supportAudio) {
      supportTilt = supportDispTilt = supportAudio = true;
    }
  }
  hide(document.getElementById('cellModeTilt'), !supportTilt);
  hide(document.getElementById('cellModeDispTilt'), !supportDispTilt);
  hide(document.getElementById('cellModeAudio'), !supportAudio);

  const modeCount = (supportTilt?1:0) + (supportDispTilt?1:0) + (supportAudio?1:0);
  setCols(document.getElementById('rowModes'), Math.max(1, modeCount));
  if (modeCount === 0) {
    const row = document.getElementById('rowModes');
    const placeholder = document.createElement('div');
    placeholder.className = 'card mode';
    placeholder.innerHTML = '<div style="color:#8aa;display:flex;align-items:center;justify-content:center;width:100%;height:100%;">该设备无可用模式</div>';
    row.appendChild(placeholder);
    setCols(row, 1);
  }
} catch (e) {
  console.warn('[device-detail] apiDeviceInfo failed; will still show defaults', e);
  // 失败也先清理再尝试挂载默认预览，避免叠加
  destroyAllPreviews();
  mountPreview('cellScreen', STREAMS.screen);
  mountPreview('cellMain', STREAMS.main);
  mountPreview('cellSub',  STREAMS.sub);
}
}
await loadDeviceInfoAndLayout();

/* ------------------- 点击：跳详情/模式 ------------------- */
document.getElementById('leftPane').addEventListener('click', (e)=>{
  const t = e.target.closest('.card'); if (!t || t.classList.contains('blank') || t.classList.contains('hide')) return;
  const id = t.id || '';
  if (id === 'cellScreen') {
    location.href = `/modules/features/pages/details/video-detail.html?devId=${encodeURIComponent(devId)}&devNo=${encodeURIComponent(devNo)}&stream=screen`;
  } else if (id === 'cellMain') {
    location.href = `/modules/features/pages/details/video-detail.html?devId=${encodeURIComponent(devId)}&devNo=${encodeURIComponent(devNo)}&stream=main`;
  } else if (id === 'cellSub') {
    location.href = `/modules/features/pages/details/video-detail.html?devId=${encodeURIComponent(devId)}&devNo=${encodeURIComponent(devNo)}&stream=sub`;
  } else if (id === 'cellModeTilt') {
    parent.postMessage({ __detail:true, t:'openMode', devId, devNo, modeId:1 }, '*');
  } else if (id === 'cellModeDispTilt') {
    parent.postMessage({ __detail:true, t:'openMode', devId, devNo, modeId:2 }, '*');
  } else if (id === 'cellModeAudio') {
    parent.postMessage({ __detail:true, t:'openMode', devId, devNo, modeId:3 }, '*');
  }
});

/* ------------------- 顶栏按钮 -> 发 WS + 打印 ------------------- */
const ch = await bridge.wsOpen({ kind:'device', devId });
const to = { type: 1, id: devId };

ui.btnShot.onclick = ()=>{
  const payload = { cmd:'deviceShot', to };
  console.log('[device-detail] 点击拍照 -> send', payload);
  bridge.wsSend(ch, payload);
};
ui.btnRecord.onclick = ()=>{
  const payload = { cmd:'deviceRecordToggle', to };
  console.log('[device-detail] 点击录像 -> send', payload);
  bridge.wsSend(ch, payload);
};
ui.btnTalk.onclick = ()=>{
  const payload = { cmd:'talkToggle', to };
  console.log('[device-detail] 点击开始/停止对讲 -> send', payload);
  bridge.wsSend(ch, payload);
};
ui.btnBack.onclick = ()=> parent.postMessage({ __detail:true, t:'back' }, '*');

// 编辑信息/属主：弹窗
document.getElementById('btnEditInfo').onclick  = async ()=>{
  const dev = currentDeviceInfo || { id: Number(devId), no: devNo || '', name: '', type: 0, modeList: [] };
  const ok = await openEditDeviceInfoModal({ dev });
  if (ok) await loadDeviceInfoAndLayout();
};
document.getElementById('btnEditOwner').onclick = async ()=>{
  const dev = currentDeviceInfo || { id: Number(devId), no: devNo || '', name: '' };
  const ok = await openEditDeviceOwnerModal({ dev });
  if (ok) await loadDeviceInfoAndLayout();
};

bridge.onWsMessage((m)=>{ console.log('[device-detail] WS message:', m); });

// 清理
window.addEventListener('beforeunload', ()=>{
  try{ mountedPreviews.forEach(p=>p.destroy && p.destroy()); }catch{}
  try{ mountedModes.forEach(x=>x.mp && x.mp.destroy && x.mp.destroy()); }catch{}
  try{ if (mockTimer) clearInterval(mockTimer); }catch{}
});