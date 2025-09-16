/**
 * 详情页公用顶部栏与桥接工具（运行于子 iframe 内）
 * 用法：
 *  - import { mountTopbar, detailBridge } from './common/detail-common.js'
 *  - const ui = mountTopbar(document.body)
 *  - const bridge = detailBridge()
 *  - bridge.ready({ page:'video'|'device'|'mode-tilt'|'mode-disp-tilt'|'mode-audio', devId, devNo, modeId? })
 *  - const ch = await bridge.wsOpen({ kind:'mode', devId, modeId })
 *  - bridge.onWsMessage((m)=>{ ... })
 *
 * 更新：
 *  - 新增 getInit()/waitInit()：获取/等待父页下发的 init（含 devId/devNo/modeId/stream 等）
 */
export function mountTopbar(container) {
  const bar = document.createElement('div');
  bar.id = 'detailTopbar';
  bar.innerHTML = `
    <style>
      #detailTopbar{
        height:48px;
        display:flex;
        align-items:center;
        gap:14px;
        padding:0 16px;
        background:#111c28;
        color:#e6f0ff;
        border-bottom:1px solid rgba(255,255,255,.12);
        font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;
        white-space:nowrap;
        overflow:hidden;
      }
      #detailTopbar .btn{
        background:#1f7fb8;
        border:1px solid rgba(255,255,255,.25);
        color:#fff;
        border-radius:6px;
        height:32px;
        padding:0 12px;
        cursor:pointer;
        font-weight:600;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        line-height:1;
        white-space:nowrap;
      }
      #detailTopbar .btn.secondary{ background:#1f497d; }
      #btnBack{ background:#2a8fbc; }
      #lblOnline{ color:#aee6a7; font-weight:600; }
      #lblConnTimer{ color:#cfd8dc; opacity:.85; margin-left:auto; white-space:nowrap; }
      #btnVolume{
        font-size:20px; line-height:1; cursor:pointer; background:transparent; border:none; color:#fff;
        width:32px; height:32px; display:inline-flex; align-items:center; justify-content:center;
      }
      #lblDevNo{
        min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:28vw;
      }
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
  const pendingOpen = new Map();// reqId -> { resolve, key }
  const chByKey = new Map();   // key -> ch
  const pendingByKey = new Map(); // key -> Promise<ch>
  let inited = false;

  // 新增：保存 init，并支持等待
  let initData = null;
  const initWaiters = [];

  function keyOf({ kind, devId, modeId, extra }) {
    const ex = extra ? JSON.stringify(extra) : '';
    return `${kind||''}|${devId||''}|${modeId||''}|${ex}`;
  }

  function post(msg){ parent.postMessage(Object.assign({ __detail:true }, msg), '*'); }

  function onMsg(e){
    const m = e.data || {};
    if (!m || !m.__detail) return;
    switch (m.t) {
      case 'init':
        // 可按需使用 m.devId/devNo/config/mock
        inited = true;
        initData = m;
        while (initWaiters.length) {
          try { initWaiters.shift()(initData); } catch {}
        }
        break;
      case 'ws:open:ok':
        {
          const p = pendingOpen.get(m.reqId);
          if (p) {
            pendingOpen.delete(m.reqId);
            chSet.add(m.ch);
            if (p.key) chByKey.set(p.key, m.ch);
            p.resolve(m.ch);
          }
        }
        break;
      case 'ws:message':
        if (chSet.has(m.ch)) {
          for (const fn of listeners) { try { fn(m.data); } catch(e){} }
        }
        break;
      case 'ws:closed':
        chSet.delete(m.ch);
        // 清理 key->ch 映射
        for (const [k, chVal] of chByKey.entries()) {
          if (chVal === m.ch) chByKey.delete(k);
        }
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
    async wsOpen(params) {
      const key = keyOf(params||{});
      const existing = chByKey.get(key);
      if (existing && chSet.has(existing)) {
        return existing; // 已连接则复用
      }
      if (pendingByKey.has(key)) {
        return await pendingByKey.get(key); // 正在连接中，复用同一个 Promise
      }
      const reqId = Date.now() + Math.floor(Math.random()*1000);
      const p = new Promise((resolve)=> {
        pendingOpen.set(reqId, { resolve, key });
      });
      pendingByKey.set(key, p);
      post(Object.assign({ t:'ws:open', reqId }, params));
      try {
        const ch = await p;
        return ch;
      } finally {
        pendingByKey.delete(key);
      }
    },
    wsSend(ch, data) {
      post({ t:'ws:send', ch, data });
    },
    wsClose(ch) {
      post({ t:'ws:close', ch });
    },
    onWsMessage(fn) { listeners.add(fn); return ()=>listeners.delete(fn); },

    // 新增：读取/等待父页下发的 init
    getInit(){ return initData; },
    waitInit(){ return initData ? Promise.resolve(initData) : new Promise(res => initWaiters.push(res)); }
  };
}