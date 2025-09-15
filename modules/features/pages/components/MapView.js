/**
 * MapView（基于 iframe 的地图容器）
 * 变更：不再用 URL 传 Key，改为在 iframe load 后用 postMessage 发送 { t:'init', key, debug }
 * 统一约定：Key 仅在 /config/env.js 维护一次，由父页面传入此组件。
 * 外部 API：mount/setMarkers/openDevice/setCenter/resize/destroy
 * 外部事件：markerClick/openVideo/openMode/refreshDevice
 */
export function createMapView({ amapKey, debug = true } = {}) {
  const host = document.createElement('div');
  Object.assign(host.style, { display: 'block', width: '100%', height: '100%' });
  const shadow = host.attachShadow({ mode: 'open' });

  const css = document.createElement('style');
  css.textContent = `
    :host { all: initial; contain: content; display:block; width:100%; height:100%; }
    *,*::before,*::after{ box-sizing:border-box; }
    .wrap { width:100%; height:100%; position:relative; background:#0a0f14; }
    iframe { position:absolute; inset:0; width:100%; height:100%; border:0; display:block; background:#0a0f14; }
    .hint { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:#9fb1bb; font-size:13px; pointer-events:none; }
  `;
  const wrap = document.createElement('div'); wrap.className = 'wrap';
  const iframe = document.createElement('iframe');
  const hint = document.createElement('div'); hint.className = 'hint'; hint.style.display = 'none';
  wrap.append(iframe, hint); shadow.append(css, wrap);

  let ready = false;
  let destroyed = false;
  const queue = [];
  const markersCache = [];
  let lastOpenDevice = null;

  const log  = (...a)=>{ if (debug) try{ console.info('[MapView]', ...a); }catch{} };
  const warn = (...a)=>{ if (debug) try{ console.warn('[MapView]', ...a); }catch{} };
  const showHint = (t)=>{ hint.textContent=t; hint.style.display='flex'; };
  const hideHint = ()=>{ hint.style.display='none'; };

  // 仅作为兜底：优先使用入参，其次 window.__AMAP_KEY 和 <meta>
  function resolveKey() {
    if (amapKey && String(amapKey).trim()) return String(amapKey).trim();
    try { if (window.__AMAP_KEY) return String(window.__AMAP_KEY).trim(); } catch {}
    const meta = document.querySelector('meta[name="amap-key"]'); if (meta?.content) return String(meta.content).trim();
    return '';
  }

  function postToFrame(msg) {
    if (destroyed) return;
    if (ready && iframe.contentWindow) {
      try { iframe.contentWindow.postMessage(Object.assign({ __mv:true }, msg), '*'); } catch {}
    } else {
      queue.push(msg);
    }
  }

  function flushQueue() {
    if (!ready || !iframe.contentWindow) return;
    for (const m of queue.splice(0)) {
      try { iframe.contentWindow.postMessage(Object.assign({ __mv:true }, m), '*'); } catch {}
    }
  }

  function mount() {
    const key = resolveKey();
    if (!key) { showHint('缺少高德 Key（AMAP_KEY）'); warn('缺少高德 Key（AMAP_KEY）'); }

    // 加载独立的 iframe 页面（不带任何 key 参数）
    iframe.src = `/modules/features/pages/components/templates/map-view-frame.html`;
    log('mount begin, size=', host.getBoundingClientRect());

    const onMsg = (e) => {
      const data = e.data || {};
      if (!data || !data.__mv) return;
      if (e.source !== iframe.contentWindow) return;

      switch (data.t) {
        case 'ready':
          ready = true;
          hideHint();
          flushQueue();
          if (markersCache.length) postToFrame({ t:'setMarkers', list: markersCache });
          if (lastOpenDevice) postToFrame({ t:'openDevice', devInfo: lastOpenDevice.devInfo, followCenterWhenNoLocation: lastOpenDevice.followCenterWhenNoLocation });
          break;
        case 'markerClick':
          host.dispatchEvent(new CustomEvent('markerClick', { bubbles:true, detail:{ devId: data.devId } }));
          break;
        case 'openVideo':
          host.dispatchEvent(new CustomEvent('openVideo', { bubbles:true, detail:{ devId: data.devId, devNo: data.devNo } }));
          break;
        case 'openMode':
          host.dispatchEvent(new CustomEvent('openMode', { bubbles:true, detail:{ devId: data.devId, devNo: data.devNo, modeId: data.modeId } }));
          break;
        case 'refreshDevice':
          host.dispatchEvent(new CustomEvent('refreshDevice', { bubbles:true, detail:{ devId: data.devId } }));
          break;
        case 'error':
          warn(data.message); showHint(data.message || '地图加载失败');
          break;
        case 'log':
          log(data.m, data.z ?? '');
          break;
      }
    };
    window.addEventListener('message', onMsg);
    host.__onMsg = onMsg;

    // 等 iframe 加载完成后，再把 key 通过 postMessage 传进去（父页面只配置一次）
    iframe.addEventListener('load', () => {
      try {
        iframe.contentWindow?.postMessage({ __mv:true, t:'init', key, debug: !!debug }, '*');
      } catch {}
    }, { once: true });
  }

  function setMarkers(list = []) { markersCache.length = 0; markersCache.push(...list); postToFrame({ t:'setMarkers', list }); }
  function openDevice({ devInfo, followCenterWhenNoLocation = true }) { lastOpenDevice = { devInfo, followCenterWhenNoLocation }; postToFrame({ t:'openDevice', devInfo, followCenterWhenNoLocation }); }
  function setCenter(lng, lat) { postToFrame({ t:'setCenter', lng, lat }); }
  function resize() { postToFrame({ t:'resize' }); }
  function destroy() { destroyed = true; try { window.removeEventListener('message', host.__onMsg); } catch {} try { host.remove(); } catch {} }

  host.mount = mount;
  host.setMarkers = setMarkers;
  host.openDevice = openDevice;
  host.setCenter = setCenter;
  host.resize = resize;
  host.destroy = destroy;

  return host;
}