/**
 * MapView（iframe 隔离版，单文件，无反引号/模板插值）
 * - 不新增文件；iframe 子页通过 srcdoc 注入
 * - 外部 API 不变：mount/setMarkers/openDevice/setCenter/resize/destroy
 * - 外部事件不变：markerClick/openVideo/openMode/refreshDevice
 */
export function createMapView({ amapKey, debug = true } = {}) {
  const host = document.createElement('div');
  Object.assign(host.style, { display: 'block', width: '100%', height: '100%' });
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
  :host { all: initial; contain: content; display:block; width:100%; height:100%; }
  *,*::before,*::after{ box-sizing:border-box; }
  .wrap { width:100%; height:100%; position:relative; background:#0a0f14; }
  iframe { position:absolute; inset:0; width:100%; height:100%; border:0; display:block; background:#0a0f14; }
  .hint { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:#9fb1bb; font-size:13px; pointer-events:none; }
  `;
  const wrap = document.createElement('div'); wrap.className = 'wrap';
  const iframe = document.createElement('iframe');
  const hint = document.createElement('div'); hint.className = 'hint'; hint.style.display = 'none';
  wrap.append(iframe, hint); shadow.append(style, wrap);

  // 状态/缓存
  let ready = false;
  let destroyed = false;
  const queue = [];
  const markersCache = [];
  let lastOpenDevice = null;

  // 日志
  const log  = (...a)=>{ if (debug) try{ console.info('[MapView]', ...a); }catch{} };
  const warn = (...a)=>{ if (debug) try{ console.warn('[MapView]', ...a); }catch{} };
  const showHint = (t)=>{ hint.textContent=t; hint.style.display='flex'; };
  const hideHint = ()=>{ hint.style.display='none'; };

  function resolveKey() {
    if (amapKey && String(amapKey).trim()) return String(amapKey).trim();
    try { if (window.ENV?.AMAP_KEY) return String(window.ENV.AMAP_KEY).trim(); } catch {}
    try { if (window.__AMAP_KEY) return String(window.__AMAP_KEY).trim(); } catch {}
    const meta = document.querySelector('meta[name="amap-key"]'); if (meta?.content) return String(meta.content).trim();
    return '';
  }
  function escAttr(s=''){ return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // 发送给子页（未 ready 先入队）
  function send(msg) {
    if (destroyed) return;
    if (ready && iframe.contentWindow) {
      iframe.contentWindow.postMessage(Object.assign({ __mv: true }, msg), '*');
    } else {
      queue.push(msg);
    }
  }

  // 生成 iframe srcdoc：避免任何反引号/模板插值，全部字符串拼接
  function buildSrcdoc(key, dbg) {
    const k = escAttr(key || '');
    const dbgFlag = dbg ? 'true' : 'false';
    return '<!doctype html>'
      + '<html><head>'
      + '<meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">'
      + '<style>html,body,#map{height:100%;margin:0;padding:0;background:#0a0f14}*{box-sizing:border-box}.amap-info-content{user-select:none}</style>'
      + '</head><body>'
      + '<div id="map"></div>'
      + '<script>(function(){'
      + 'var AMAP_KEY="'+ k +'";'
      + 'var debug='+ dbgFlag +';'
      + 'var log=function(){ if(debug) try{ console.info.apply(console, ["[MapView-IFRAME]"].concat([].slice.call(arguments))); }catch(e){} };'
      + 'var warn=function(){ if(debug) try{ console.warn.apply(console, ["[MapView-IFRAME]"].concat([].slice.call(arguments))); }catch(e){} };'
      + 'var post=function(msg){ try{ parent.postMessage(Object.assign({__mv:true},msg),"*"); }catch(e){} };'
      + 'try{document.documentElement.style.height="100%";document.body.style.height="100%";document.body.style.margin="0";var mapEl=document.getElementById("map");mapEl.style.height="100%";mapEl.style.width="100%";mapEl.style.background="#0a0f14";}catch(e){}'
      + 'var map=null,markers=[],infoWindow=null,followCenter=false,mounted=false,currentDevInfo=null;'
      + 'function ensureAMap(cb){ if(!AMAP_KEY){ post({t:"error",message:"缺少高德 Key（AMAP_KEY）"}); return; } if(window.AMap){ cb&&cb(); return; } var s=document.createElement("script"); s.src="https://webapi.amap.com/maps?v=2.0&key="+encodeURIComponent(AMAP_KEY); s.onload=function(){ cb&&cb(); }; s.onerror=function(){ post({t:"error",message:"高德 SDK 加载失败"}); }; document.head.appendChild(s); }'
      + 'function init(){ try{'
      + 'map=new AMap.Map("map",{zoom:5,center:[105,35],viewMode:"2D",dragEnable:true,scrollWheel:true,keyboardEnable:true,doubleClickZoom:true});'
      + 'try{ map.setStatus({dragEnable:true,scrollWheel:true,keyboardEnable:true,doubleClickZoom:true}); }catch(e){}'
      + 'mounted=true;'
      + 'map.on&&map.on("complete",function(){ post({t:"ready"}); post({t:"log",m:"map complete"}); });'
      + 'map.on&&map.on("dragstart",function(){ post({t:"log",m:"dragstart"}); });'
      + 'map.on&&map.on("dragging",function(){ post({t:"log",m:"dragging"}); });'
      + 'map.on&&map.on("dragend",function(){ post({t:"log",m:"dragend"}); });'
      + 'map.on&&map.on("zoomstart",function(){ post({t:"log",m:"zoomstart"}); });'
      + 'map.on&&map.on("zoomchange",function(){ try{ post({t:"log",m:"zoomchange",z:map.getZoom()}); }catch(e){} });'
      + 'map.on&&map.on("zoomend",function(){ post({t:"log",m:"zoomend"}); });'
      + 'map.on&&map.on("mapmove",function(){ if(followCenter&&infoWindow) try{ infoWindow.setPosition(map.getCenter()); }catch(e){} });'
      + '}catch(e){ warn("init error",e); post({t:"error",message:"地图初始化失败"}); } }'
      + 'function clearMarkers(){ for(var i=0;i<markers.length;i++){ try{ markers[i].setMap(null); }catch(e){} } markers=[]; }'
      + 'function setMarkers(list){ if(!mounted) return; clearMarkers(); var cnt=0; (list||[]).forEach(function(e){ var d=e.devInfo||e; if(!d||!d.lastLocation||d.lastLocation.lng==null||d.lastLocation.lat==null) return; var mk=new AMap.Marker({position:[d.lastLocation.lng,d.lastLocation.lat],title:d.no}); mk.on("click",function(){ post({t:"markerClick",devId:d.id}); }); mk.setMap(map); markers.push(mk); cnt++; }); post({t:"log",m:"markers set",cnt:cnt}); }'
      + 'function openDevice(devInfo,followCenterWhenNoLocation){ if(!mounted) return; currentDevInfo=devInfo||{}; var pos; if(currentDevInfo.lastLocation&&currentDevInfo.lastLocation.lng!=null&&currentDevInfo.lastLocation.lat!=null){ pos=[currentDevInfo.lastLocation.lng,currentDevInfo.lastLocation.lat]; followCenter=false; } else { pos=map.getCenter(); followCenter=!!followCenterWhenNoLocation; }'
      + 'var options=(currentDevInfo.modeList||[]).map(function(m){ return "<option value=\\""+(m&&m.modeId!=null?m.modeId:"")+ "\\">"+ (m&&m.modeName?String(m.modeName):"") +"</option>"; }).join("");'
      + 'var posText = currentDevInfo.lastLocation ? (currentDevInfo.lastLocation.lat + "," + currentDevInfo.lastLocation.lng + (currentDevInfo.lastLocation.height!=null?(" 高度:"+currentDevInfo.lastLocation.height+"m"):"")) : "无定位数据";'
      + 'var timeText = currentDevInfo.lastLocation ? new Date(currentDevInfo.lastLocation.time).toLocaleString() : "";'
      + 'var onlineTag = currentDevInfo.onlineState ? "<span style=\\"font-size:12px;color:#7ef58b;margin-left:6px;\\">在线</span>" : "<span style=\\"font-size:12px;color:#99a;margin-left:6px;\\">离线</span>";'
      + 'var html = ""'
      + '+ "<div style=\\"display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.08);\\">"'
      + '+   "<div style=\\"font-weight:600;\\">" + (currentDevInfo.no || String(currentDevInfo.id||"")) + " " + onlineTag + "</div>"'
      + '+   "<button id=\\"ovCloseBtn\\" style=\\"background:transparent;border:none;color:#ccd;cursor:pointer;\\">✕</button>"'
      + '+ "</div>"'
      + '+ "<div style=\\"padding:10px 12px;font-size:12px;line-height:1.7;\\">"'
      + '+   "<div>位置：" + posText + "</div>"'
      + '+   "<div>更新时间：" + timeText + "  速度：" + (currentDevInfo.lastLocation ? ((currentDevInfo.lastLocation.speed||0) + " km/h") : "") + "</div>"'
      + '+ "</div>"'
      + '+ "<div style=\\"padding:0 12px 12px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;\\">"'
      + '+   "<button class=\\"btn\\" id=\\"btnOpenVideo\\" style=\\"padding:4px 8px;background:#1f497d;border:1px solid rgba(255,255,255,.15);color:#e6f0ff;border-radius:4px;cursor:pointer;\\">打开视频</button>"'
      + '+   "<label>设备模式：<select id=\\"ovModeSel\\">" + options + "</select></label>"'
      + '+   "<button class=\\"btn\\" id=\\"btnOpenMode\\" style=\\"padding:4px 8px;background:#1f497d;border:1px solid rgba(255,255,255,.15);color:#e6f0ff;border-radius:4px;cursor:pointer;\\">打开模式</button>"'
      + '+   "<button class=\\"btn\\" id=\\"btnRefreshInfo\\" style=\\"margin-left:auto;padding:4px 8px;background:#203246;border:1px solid rgba(255,255,255,.15);color:#e6f0ff;border-radius:4px;cursor:pointer;\\">刷新</button>"'
      + '+ "</div>";'
      + 'var w=document.createElement("div");'
      + 'w.style.cssText="min-width:340px;max-width:420px;background:#111c28;color:#cfd8dc;border:1px solid rgba(255,255,255,.12);border-radius:6px;box-shadow:0 8px 22px rgba(0,0,0,.45);";'
      + 'w.innerHTML = html;'
      + 'if(!infoWindow) infoWindow=new AMap.InfoWindow({ isCustom:true, offset:new AMap.Pixel(0,-20), closeWhenClickMap:true });'
      + 'infoWindow.setContent(w); infoWindow.open(map,pos);'
      + 'w.querySelector("#ovCloseBtn").addEventListener("click",function(){ try{ infoWindow&&infoWindow.close(); }catch(e){} });'
      + 'w.querySelector("#btnOpenVideo").addEventListener("click",function(){ post({ t:"openVideo", devId: currentDevInfo.id, devNo: currentDevInfo.no }); });'
      + 'w.querySelector("#btnOpenMode").addEventListener("click",function(){ var sel=w.querySelector("#ovModeSel"); var modeId = sel && sel.value; post({ t:"openMode", devId: currentDevInfo.id, devNo: currentDevInfo.no, modeId: modeId }); });'
      + 'w.querySelector("#btnRefreshInfo").addEventListener("click",function(){ post({ t:"refreshDevice", devId: currentDevInfo.id }); });'
      + 'post({ t:"log", m:"openDevice", pos: pos });'
      + '}'
      + 'function setCenter(lng,lat){ try{ map&&map.setCenter([lng,lat]); }catch(e){} }'
      + 'function resize(){ try{ map&&map.resize(); }catch(e){} }'
      + 'window.addEventListener("message",function(e){ var msg=e.data||{}; if(!msg.__mv) return; switch(msg.t){ case "init": ensureAMap(init); break; case "setMarkers": setMarkers(msg.list||[]); break; case "openDevice": openDevice(msg.devInfo||{}, !!msg.followCenterWhenNoLocation); break; case "setCenter": setCenter(msg.lng,msg.lat); break; case "resize": resize(); break; default: break; } }, { capture:true });'
      + '})();<\/script>'
      + '</body></html>';
  }

  function mount() {
    const key = resolveKey();
    if (!key) { showHint('缺少高德 Key（AMAP_KEY）'); warn('no AMAP key'); }
    hideHint();

    iframe.srcdoc = buildSrcdoc(key, !!debug);
    log('mount begin, size=', host.getBoundingClientRect());

    // 子窗消息桥
    const onMsg = (e) => {
      const data = e.data || {};
      if (!data || !data.__mv) return;
      if (e.source !== iframe.contentWindow) return;

      switch (data.t) {
        case 'ready': {
          ready = true;
          // flush 队列
          for (const m of queue.splice(0)) {
            try { iframe.contentWindow.postMessage(Object.assign({ __mv:true }, m), '*'); } catch {}
          }
          // 回放缓存
          if (markersCache.length) iframe.contentWindow.postMessage({ __mv:true, t:'setMarkers', list: markersCache }, '*');
          if (lastOpenDevice) iframe.contentWindow.postMessage({ __mv:true, t:'openDevice', devInfo: lastOpenDevice.devInfo, followCenterWhenNoLocation: lastOpenDevice.followCenterWhenNoLocation }, '*');
          break;
        }
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
        case 'log': log(data.m, data.z ?? ''); break;
        case 'error': warn(data.message); showHint(data.message || '地图加载失败'); break;
        default: break;
      }
    };
    window.addEventListener('message', onMsg);
    host.__onMsg = onMsg;

    // onload 后发送 init（带一次重试）
    let initSent = false;
    const sendInit = () => {
      if (destroyed || initSent || !iframe.contentWindow) return;
      initSent = true;
      try {
        iframe.contentWindow.postMessage({ __mv: true, t: 'init' }, '*');
        log('init sent to iframe');
        setTimeout(() => {
          if (!ready && iframe.contentWindow) {
            iframe.contentWindow.postMessage({ __mv: true, t: 'init' }, '*');
            log('init re-sent');
          }
        }, 800);
      } catch {}
    };
    iframe.addEventListener('load', sendInit, { once: true });
  }

  // 对外 API（保持不变）
  function setMarkers(list = []) {
    markersCache.length = 0; markersCache.push(...list);
    send({ t:'setMarkers', list });
  }
  function openDevice({ devInfo, followCenterWhenNoLocation = true }) {
    lastOpenDevice = { devInfo, followCenterWhenNoLocation };
    send({ t:'openDevice', devInfo, followCenterWhenNoLocation });
  }
  function setCenter(lng, lat) { send({ t:'setCenter', lng, lat }); }
  function resize() { send({ t:'resize' }); }
  function destroy() {
    destroyed = true;
    try { window.removeEventListener('message', host.__onMsg); } catch {}
    try { host.remove(); } catch {}
  }

  host.el = host;
  host.mount = mount;
  host.setMarkers = setMarkers;
  host.openDevice = openDevice;
  host.setCenter = setCenter;
  host.resize = resize;
  host.destroy = destroy;

  return host;
}