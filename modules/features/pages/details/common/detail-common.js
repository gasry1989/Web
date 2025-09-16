/**
 * 详情页公用顶部栏与桥接工具（运行于子 iframe 内）
 * 用法：
 *  - import { mountTopbar, detailBridge } from './common/detail-common.js'
 *  - const ui = mountTopbar(document.body)
 *  - const bridge = detailBridge()
 *  - bridge.ready({ page:'video'|'device'|'mode-tilt'|'mode-disp-tilt'|'mode-audio', devId, devNo, modeId? })
 *  - const ch = await bridge.wsOpen({ kind:'mode', devId, modeId })
 *  - bridge.onWsMessage((m)=>{ ... })
 */
export function mountTopbar(container) {
  const bar = document.createElement('div');
  bar.id = 'detailTopbar';
  bar.innerHTML = `
    <style>
      #detailTopbar{
        height:48px; display:grid; grid-template-columns:auto 1fr auto auto auto auto auto;
        align-items:center; gap:14px; padding:0 16px; background:#111c28; color:#e6f0ff;
        border-bottom:1px solid rgba(255,255,255,.12); font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;
      }
      .btn{background:#1f7fb8;border:1px solid rgba(255,255,255,.25); color:#fff; border-radius:6px; padding:6px 12px; cursor:pointer; font-weight:600;}
      .btn.secondary{ background:#1f497d; }
      #btnBack{ background:#2a8fbc; }
      #lblOnline{ color:#aee6a7; font-weight:600; }
      #lblConnTimer{ color:#cfd8dc; opacity:.85; }
      #btnVolume{ font-size:20px; line-height:1; cursor:pointer; background:transparent; border:none; color:#fff; }
    </style>
    <button class="btn" id="btnBack">返回</button>
    <div id="lblDevNo">--</div>
    <div id="lblOnline">在线</div>
    <button class="btn secondary" id="btnShot">拍照</button>
    <button class="btn secondary" id="btnRecord">录像</button>
    <button id="btnVolume" title="音量">🔊</button>
    <button class="btn" id="btnTalk">开始/停止对讲</button>
    <div id="lblConnTimer">未连接 00:00:00</div>
  `;
  container.appendChild(bar);

  const els = {
    btnBack: bar.querySelector('#btnBack'),
    lblDevNo: bar.querySelector('#lblDevNo'),
    lblOnline: bar.querySelector('#lblOnline'),
    btnShot: bar.querySelector('#btnShot'),
    btnRecord: bar.querySelector('#btnRecord'),
    btnVolume: bar.querySelector('#btnVolume'),
    btnTalk: bar.querySelector('#btnTalk'),
    lblConnTimer: bar.querySelector('#lblConnTimer')
  };
  // 默认事件桩
  els.btnBack.onclick = ()=> parent.postMessage({ __detail:true, t:'back' }, '*');
  els.btnShot.onclick = ()=> console.log('[detail] shot click');
  els.btnRecord.onclick = ()=> console.log('[detail] record click');
  els.btnVolume.onclick = ()=> console.log('[detail] volume click');
  els.btnTalk.onclick = ()=> console.log('[detail] talk click');

  return els;
}

export function detailBridge() {
  const listeners = new Set(); // ws message listeners
  const chSet = new Set();     // opened channels
  const pendingOpen = new Map();// reqId -> resolve
  let inited = false;

  function post(msg){ parent.postMessage(Object.assign({ __detail:true }, msg), '*'); }

  function onMsg(e){
    const m = e.data || {};
    if (!m || !m.__detail) return;
    switch (m.t) {
      case 'init':
        // 可按需使用 m.devId/devNo/config/mock
        inited = true;
        break;
      case 'ws:open:ok':
        {
          const p = pendingOpen.get(m.reqId);
          if (p) { pendingOpen.delete(m.reqId); chSet.add(m.ch); p.resolve(m.ch); }
        }
        break;
      case 'ws:message':
        if (chSet.has(m.ch)) {
          for (const fn of listeners) { try { fn(m.data); } catch(e){} }
        }
        break;
      case 'ws:closed':
        chSet.delete(m.ch);
        break;
      case 'navigate':
        // 同遮罩内导航（设备页内打开模式）
        location.href = m.url; // 父页已带 query 参数
        break;
    }
  }
  window.addEventListener('message', onMsg);

  return {
    ready({ page, devId, devNo, modeId }) {
      post({ t:'ready', page, devId, devNo, modeId });
    },
    async wsOpen({ kind, devId, modeId, extra }) {
      const reqId = Date.now() + Math.floor(Math.random()*1000);
      post({ t:'ws:open', reqId, kind, devId, modeId, extra });
      return await new Promise((resolve)=> pendingOpen.set(reqId, { resolve }));
    },
    wsSend(ch, data) {
      post({ t:'ws:send', ch, data });
    },
    wsClose(ch) {
      post({ t:'ws:close', ch });
    },
    onWsMessage(fn) { listeners.add(fn); return ()=>listeners.delete(fn); }
  };
}